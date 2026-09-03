"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { allowedCompanyIds } from "@/lib/company";

export async function createForecast(formData: FormData) {
  await requirePermWrite("forecast");
  const forecast = await prisma.forecast.create({
    data: {
      // shared across companies — products on the lines carry their own company
      companyId: null,
      title: String(formData.get("title")).trim(),
      year: Number(formData.get("year")) || new Date().getFullYear(),
      area: String(formData.get("area")).trim(),
    },
  });
  redirect(`/forecast/${forecast.id}`);
}

export async function deleteForecast(formData: FormData) {
  await requirePermWrite("forecast");
  const id = String(formData.get("id"));
  await prisma.forecast.delete({ where: { id } }).catch(() => {});
  revalidatePath("/forecast");
  redirect("/forecast");
}

export type ForecastRowInput = {
  /** null while the area forecast has not been split between customers */
  customerId: string | null;
  productId: string;
  /** the salesperson this row is planned under — stamped once, then left alone */
  salespersonId: string | null;
  /** planning price for this row; null follows the product's current SRP */
  unitPrice: number | null;
  months: number[];
};

/** Save the whole grid: header fields + upsert every row, delete removed rows. */
export async function saveForecast(input: {
  forecastId: string;
  title: string;
  year: number;
  area: string;
  rows: ForecastRowInput[];
}): Promise<{ ok: boolean }> {
  const actor = await requirePermWrite("forecast");
  const { forecastId } = input;
  const forecast = await prisma.forecast.findUnique({ where: { id: forecastId } });
  if (!forecast) redirect("/forecast");

  // a user may only put products from companies they are allowed to work in
  const permitted = await allowedCompanyIds(actor);
  const products = await prisma.product.findMany({
    where: { id: { in: input.rows.map((r) => r.productId).filter(Boolean) } },
    select: { id: true, companyId: true },
  });
  const allowedProducts = new Set(
    products.filter((p) => permitted.includes(p.companyId)).map((p) => p.id)
  );
  const customers = await prisma.customer.findMany({
    where: { id: { in: input.rows.map((r) => r.customerId).filter((x): x is string => !!x) } },
    select: { id: true, salespersonId: true },
  });
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const salespeople = await prisma.employee.findMany({
    where: { isSalesperson: true },
    select: { id: true },
  });
  const validSalesperson = new Set(salespeople.map((s) => s.id));

  await prisma.forecast.update({
    where: { id: forecastId },
    data: {
      title: input.title.trim() || "Untitled Forecast",
      year: Math.floor(input.year) || new Date().getFullYear(),
      area: input.area.trim(),
    },
  });

  const clean = input.rows
    .filter((r) => allowedProducts.has(r.productId) && (!r.customerId || customerById.has(r.customerId)))
    .map((r) => {
      // a blank or nonsensical price means "follow the product's SRP"
      const price = Number(r.unitPrice);
      // stamp the salesperson the row is planned under; fall back to whoever owns the
      // account right now, but never overwrite a stamp that already exists
      const stamped =
        r.salespersonId && validSalesperson.has(r.salespersonId)
          ? r.salespersonId
          : r.customerId
            ? customerById.get(r.customerId)!.salespersonId
            : null;
      return {
        customerId: r.customerId,
        productId: r.productId,
        salespersonId: stamped ?? null,
        unitPrice: r.unitPrice === null || !Number.isFinite(price) || price < 0 ? null : price,
        months: Array.from({ length: 12 }, (_, i) => Math.max(0, Math.floor(Number(r.months[i]) || 0))),
      };
    });

  // only prune rows the user could see — another company's lines stay untouched
  const keep = new Set(clean.map((r) => `${r.customerId ?? ""}:${r.productId}`));
  const existing = await prisma.forecastLine.findMany({
    where: { forecastId, product: { companyId: { in: permitted } } },
    select: { id: true, customerId: true, productId: true },
  });
  const stale = existing
    .filter((l) => !keep.has(`${l.customerId ?? ""}:${l.productId}`))
    .map((l) => l.id);
  if (stale.length) await prisma.forecastLine.deleteMany({ where: { id: { in: stale } } });

  for (const r of clean) {
    const months = {
      m1: r.months[0], m2: r.months[1], m3: r.months[2], m4: r.months[3],
      m5: r.months[4], m6: r.months[5], m7: r.months[6], m8: r.months[7],
      m9: r.months[8], m10: r.months[9], m11: r.months[10], m12: r.months[11],
    };
    const data = { salespersonId: r.salespersonId, unitPrice: r.unitPrice, ...months };
    if (r.customerId) {
      await prisma.forecastLine.upsert({
        where: {
          forecastId_customerId_productId: { forecastId, customerId: r.customerId, productId: r.productId },
        },
        create: { forecastId, customerId: r.customerId, productId: r.productId, ...data },
        update: data,
      });
    } else {
      // Postgres treats NULLs as distinct in a unique index, so the compound key cannot
      // match a customer-less row — upsert here would insert a duplicate on every save.
      const row = await prisma.forecastLine.findFirst({
        where: { forecastId, customerId: null, productId: r.productId },
        select: { id: true },
      });
      if (row) await prisma.forecastLine.update({ where: { id: row.id }, data });
      else await prisma.forecastLine.create({ data: { forecastId, customerId: null, productId: r.productId, ...data } });
    }
  }
  revalidatePath(`/forecast/${forecastId}`);
  return { ok: true };
}
