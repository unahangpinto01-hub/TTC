"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";

export async function createForecast(formData: FormData) {
  const actor = await requirePermWrite("forecast");
  const company = await getActiveCompany(actor);
  const forecast = await prisma.forecast.create({
    data: {
      companyId: company.id,
      title: String(formData.get("title")).trim(),
      year: Number(formData.get("year")) || new Date().getFullYear(),
      area: String(formData.get("area")).trim(),
    },
  });
  redirect(`/forecast/${forecast.id}`);
}

export async function deleteForecast(formData: FormData) {
  const actor = await requirePermWrite("forecast");
  const company = await getActiveCompany(actor);
  const id = String(formData.get("id"));
  await prisma.forecast.deleteMany({ where: { id, companyId: company.id } }); // company isolation
  revalidatePath("/forecast");
  redirect("/forecast");
}

export type ForecastRowInput = { parentItem: string; months: number[] };

/** Save the whole grid: header fields + upsert every row, delete removed rows. */
export async function saveForecast(input: {
  forecastId: string;
  title: string;
  year: number;
  area: string;
  rows: ForecastRowInput[];
}): Promise<{ ok: boolean }> {
  const actor = await requirePermWrite("forecast");
  const company = await getActiveCompany(actor);
  const { forecastId } = input;
  const owned = await prisma.forecast.findUnique({ where: { id: forecastId } });
  if (!owned || owned.companyId !== company.id) redirect("/denied"); // company isolation
  await prisma.forecast.update({
    where: { id: forecastId },
    data: {
      title: input.title.trim() || "Untitled Forecast",
      year: Math.floor(input.year) || new Date().getFullYear(),
      area: input.area.trim(),
    },
  });

  const clean = input.rows
    .filter((r) => r.parentItem.trim())
    .map((r) => ({
      parentItem: r.parentItem.trim(),
      months: Array.from({ length: 12 }, (_, i) => Math.max(0, Math.floor(Number(r.months[i]) || 0))),
    }));

  await prisma.forecastLine.deleteMany({
    where: { forecastId, parentItem: { notIn: clean.map((r) => r.parentItem) } },
  });
  for (const r of clean) {
    const months = {
      m1: r.months[0], m2: r.months[1], m3: r.months[2], m4: r.months[3],
      m5: r.months[4], m6: r.months[5], m7: r.months[6], m8: r.months[7],
      m9: r.months[8], m10: r.months[9], m11: r.months[10], m12: r.months[11],
    };
    await prisma.forecastLine.upsert({
      where: { forecastId_parentItem: { forecastId, parentItem: r.parentItem } },
      create: { forecastId, parentItem: r.parentItem, ...months },
      update: months,
    });
  }
  revalidatePath(`/forecast/${forecastId}`);
  return { ok: true };
}
