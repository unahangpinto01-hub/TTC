import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { getParentInfos } from "../parents";
import { ForecastGrid, type GridRow, type ParentOption } from "./forecast-grid";
import { getActiveCompany } from "@/lib/company";
import { getCategoryNames } from "@/lib/categories";

export default async function ForecastDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("forecast");
  const company = await getActiveCompany(user);
  const forecast = await prisma.forecast.findUnique({
    where: { id: params.id },
    include: { lines: true },
  });
  if (!forecast || forecast.companyId !== company.id) notFound(); // company isolation

  const parentMap = await getParentInfos(company.id);
  const parents: ParentOption[] = [...parentMap.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
  );

  const rows: GridRow[] = forecast.lines.map((l) => {
    const info = parentMap.get(l.parentItem);
    return {
      parentItem: l.parentItem,
      category: info?.category ?? "Others",
      price: info?.price ?? 0,
      packs: info?.packs ?? 0,
      months: [l.m1, l.m2, l.m3, l.m4, l.m5, l.m6, l.m7, l.m8, l.m9, l.m10, l.m11, l.m12],
    };
  });

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <Link href="/forecast" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
          ← Back to Forecasts
        </Link>
        <PrintButton />
      </div>
      <PageHeader title={forecast.title} />
      <p className="mb-3 hidden text-sm text-gray-600 print:block">
        Year {forecast.year} · Area {forecast.area}
      </p>
      <ForecastGrid
        forecastId={forecast.id}
        initialTitle={forecast.title}
        initialYear={forecast.year}
        initialArea={forecast.area}
        initialRows={rows}
        parents={parents}
        readOnly={user.perm !== "READ_WRITE"}
        categoryOrder={await getCategoryNames()}
      />
    </div>
  );
}
