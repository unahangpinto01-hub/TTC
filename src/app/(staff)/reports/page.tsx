import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";

export default async function ReportsHub() {
  await requirePerm("reports");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const reports = [
    { title: "Sales Report", desc: "By customer, product, and region", href: `/reports/sales?from=${monthStart}&to=${today}`, alt: `/reports/sales?from=${yearStart}&to=${today}` },
    { title: "Sales Journal", desc: "Chronological register of every posted invoice, by product line", href: `/reports/sales-journal?from=${monthStart}&to=${today}`, alt: `/reports/sales-journal?from=${yearStart}&to=${today}` },
    { title: "Monthly Sales per Region", desc: "Products sold per month with totals, filtered by region", href: "/reports/sales-monthly", label: "Open Report" },
    { title: "Expense Report", desc: "By category with detail listing", href: `/finance/expenses?from=${monthStart}&to=${today}`, alt: `/finance/expenses?from=${yearStart}&to=${today}` },
    { title: "Income Statement (P&L)", desc: "Revenue, COGS, expenses, net income", href: `/reports/pnl?from=${monthStart}&to=${today}`, alt: `/reports/pnl?from=${yearStart}&to=${today}` },
    { title: "AR Aging", desc: "Receivables by days past due", href: "/finance/ar" },
    { title: "Collections", desc: "Payments received by method, customer and company", href: `/reports/collections?from=${monthStart}&to=${today}`, alt: `/reports/collections?from=${yearStart}&to=${today}` },
    { title: "Customer Report", desc: "Sales, collections and outstanding balance per customer", href: `/reports/customers?from=${monthStart}&to=${today}`, alt: `/reports/customers?from=${yearStart}&to=${today}` },
    { title: "Product Report", desc: "Quantity sold, revenue, COGS and margin per product", href: `/reports/products?from=${monthStart}&to=${today}`, alt: `/reports/products?from=${yearStart}&to=${today}` },
    { title: "Merchandise Inventory", desc: "Inventory valuation at cost — stock × unit cost per product", href: "/reports/merchandise-inventory", label: "Open Report" },
    { title: "Inventory Movement", desc: "Stock IN/OUT by date range + stock on hand", href: `/reports/inventory?from=${monthStart}&to=${today}` },
    { title: "Product Price List", desc: "Printable SRP list by category — for customers and sales staff", href: "/reports/price-list", label: "Open Report" },
    { title: "Sales Forecast vs Sales", desc: "Forecast against invoiced sales by salesperson, customer and product — quantity, value, % achieved and variance, monthly to annual", href: "/reports/forecast", label: "Open Report" },
    { title: "Physical Count Sheet", desc: "Product masterlist with blank count columns for stocktaking", href: "/reports/count-sheet", label: "Open Sheet" },
    { title: "Delivery Performance", desc: "Deliveries per day vs 5/day target", href: `/reports/deliveries?from=${monthStart}&to=${today}` },
  ];

  return (
    <div>
      <PageHeader title="Reports" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <div key={r.title} className="card">
            <h2 className="font-semibold text-emerald-900">{r.title}</h2>
            <p className="mb-3 text-sm text-gray-500">{r.desc}</p>
            <div className="flex gap-2">
              <Link href={r.href} className="btn-primary">{(r as any).label ?? "This Month"}</Link>
              {r.alt && <Link href={r.alt} className="btn-secondary">This Year</Link>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
