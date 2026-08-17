import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ForecastGrid, type GridRow, type ProductOption } from "./forecast-grid";

export default async function ForecastDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("forecast");
  const forecast = await prisma.forecast.findUnique({
    where: { id: params.id },
    include: { lines: { include: { product: true } } },
  });
  if (!forecast) notFound();

  const products = await prisma.product.findMany({
    where: { status: "Active" },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, sku: true, name: true, category: true, dealerPrice: true },
  });

  const rows: GridRow[] = forecast.lines.map((l) => ({
    productId: l.productId,
    name: l.product.name,
    category: l.product.category,
    dealerPrice: l.product.dealerPrice,
    months: [l.m1, l.m2, l.m3, l.m4, l.m5, l.m6, l.m7, l.m8, l.m9, l.m10, l.m11, l.m12],
  }));

  return (
    <div>
      <Link href="/forecast" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Forecasts
      </Link>
      <PageHeader title={forecast.title} />
      <ForecastGrid
        forecastId={forecast.id}
        initialTitle={forecast.title}
        initialYear={forecast.year}
        initialArea={forecast.area}
        initialRows={rows}
        products={products as ProductOption[]}
        readOnly={user.perm !== "READ_WRITE"}
      />
    </div>
  );
}
