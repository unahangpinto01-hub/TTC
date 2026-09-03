import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { FitOnePageA3 } from "@/components/print-fit";
import { ForecastPrintHeader } from "@/components/forecast-print-header";
import { getForecastProducts, getForecastCustomers } from "../parents";
import { ForecastGrid, type GridRow } from "./forecast-grid";
import { allowedCompanies } from "@/lib/company";
import { getCategoryNames } from "@/lib/categories";
import { getSalespeople } from "@/lib/salespeople";

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
        include: {
          product: { select: { id: true, sku: true, name: true, category: true, srp: true, companyId: true } },
          customer: { select: { id: true, businessName: true, salespersonId: true } },
          salesperson: { select: { id: true, name: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!forecast) notFound();

  const names = Object.fromEntries(companies.map((c) => [c.id, c.companyName]));
  const [products, customers, salespeople] = await Promise.all([
    getForecastProducts(companyIds),
    getForecastCustomers(),
    getSalespeople(),
  ]);
  // a line saved before its account had an owner shows the account's current one until
  // the next save stamps it; once stamped it never moves again
  const currentOwner = new Map(customers.map((c) => [c.id, c]));

  const rows: GridRow[] = forecast.lines
    .filter((l) => companyIds.includes(l.product.companyId))
    .map((l) => {
      const fallback = l.salesperson ? null : currentOwner.get(l.customerId) ?? null;
      return {
        customerId: l.customerId,
        customer: l.customer.businessName,
        salespersonId: l.salespersonId ?? fallback?.salespersonId ?? null,
        salesperson: l.salesperson?.name ?? fallback?.salesperson ?? null,
        productId: l.productId,
        sku: l.product.sku,
        name: l.product.name,
        category: l.product.category,
        companyId: l.product.companyId,
        company: names[l.product.companyId] ?? "",
        srp: l.product.srp,
        price: l.unitPrice,
        months: [l.m1, l.m2, l.m3, l.m4, l.m5, l.m6, l.m7, l.m8, l.m9, l.m10, l.m11, l.m12],
      };
    });

  const printCompanies = Array.from(new Set(rows.map((r) => r.company).filter(Boolean)));

  return (
    <div className="print-page">
      {/* forecasts print on a single A3 landscape sheet with narrow margins */}
      <style>{`@page { size: A3 landscape; margin: 8mm; }`}</style>
      <div className="no-print mb-3 flex items-center justify-between">
        <Link href="/forecast" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
          ← Back to Forecasts
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/reports/forecast" className="btn-secondary">📊 Forecast Reports</Link>
          <PrintButton />
        </div>
      </div>
      <div className="no-print">
        <PageHeader title={forecast.title} />
      </div>
      {/* the header sits inside the fit block so header + table are scaled onto one sheet together */}
      <FitOnePageA3>
      <ForecastPrintHeader
        companies={printCompanies.join(" & ") || companies[0]?.companyName || ""}
        title={forecast.title}
        period={`January – December ${forecast.year} · ${forecast.area}`}
      />
      <ForecastGrid
        forecastId={forecast.id}
        initialTitle={forecast.title}
        initialYear={forecast.year}
        initialArea={forecast.area}
        initialRows={rows}
        products={products}
        customers={customers}
        salespeople={salespeople}
        companies={companies.map((c) => ({ id: c.id, name: c.companyName }))}
        readOnly={user.perm !== "READ_WRITE"}
        categoryOrder={await getCategoryNames()}
      />
      </FitOnePageA3>
    </div>
  );
}
