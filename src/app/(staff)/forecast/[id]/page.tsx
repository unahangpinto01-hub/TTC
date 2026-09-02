import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { getForecastProducts } from "../parents";
import { ForecastGrid, type GridRow } from "./forecast-grid";
import { allowedCompanies } from "@/lib/company";
import { getCategoryNames } from "@/lib/categories";

export default async function ForecastDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("forecast");
  // forecasts are shared across companies; what a user sees is limited by the
  // companies they are granted, so lines for a company they cannot access stay hidden
  const companies = await allowedCompanies(user);
  const companyIds = companies.map((c) => c.id);

  const forecast = await prisma.forecast.findUnique({
    where: { id: params.id },
    include: {
      lines: {
        include: { product: { select: { id: true, sku: true, name: true, category: true, srp: true, companyId: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!forecast) notFound();

  const names = Object.fromEntries(companies.map((c) => [c.id, c.companyName]));
  const products = await getForecastProducts(companyIds);

  const rows: GridRow[] = forecast.lines
    .filter((l) => companyIds.includes(l.product.companyId))
    .map((l) => ({
      productId: l.productId,
      sku: l.product.sku,
      name: l.product.name,
      category: l.product.category,
      companyId: l.product.companyId,
      company: names[l.product.companyId] ?? "",
      srp: l.product.srp,
      price: l.unitPrice,
      months: [l.m1, l.m2, l.m3, l.m4, l.m5, l.m6, l.m7, l.m8, l.m9, l.m10, l.m11, l.m12],
    }));

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
        products={products}
        companies={companies.map((c) => ({ id: c.id, name: c.companyName }))}
        readOnly={user.perm !== "READ_WRITE"}
        categoryOrder={await getCategoryNames()}
      />
    </div>
  );
}
