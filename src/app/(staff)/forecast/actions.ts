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

export type ForecastRowInput = { productId: string; months: number[] };

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
  const allowed = new Set(products.filter((p) => permitted.includes(p.companyId)).map((p) => p.id));

  await prisma.forecast.update({
    where: { id: forecastId },
    data: {
      title: input.title.trim() || "Untitled Forecast",
      year: Math.floor(input.year) || new Date().getFullYear(),
      area: input.area.trim(),
    },
  });

  const clean = input.rows
    .filter((r) => allowed.has(r.productId))
    .map((r) => ({
      productId: r.productId,
      months: Array.from({ length: 12 }, (_, i) => Math.max(0, Math.floor(Number(r.months[i]) || 0))),
    }));

  // only prune rows the user could see — another company's lines stay untouched
  await prisma.forecastLine.deleteMany({
    where: {
      forecastId,
      productId: { notIn: clean.map((r) => r.productId) },
      product: { companyId: { in: permitted } },
    },
  });
  for (const r of clean) {
    const months = {
      m1: r.months[0], m2: r.months[1], m3: r.months[2], m4: r.months[3],
      m5: r.months[4], m6: r.months[5], m7: r.months[6], m8: r.months[7],
      m9: r.months[8], m10: r.months[9], m11: r.months[10], m12: r.months[11],
    };
    await prisma.forecastLine.upsert({
      where: { forecastId_productId: { forecastId, productId: r.productId } },
      create: { forecastId, productId: r.productId, ...months },
      update: months,
    });
  }
  revalidatePath(`/forecast/${forecastId}`);
  return { ok: true };
}
