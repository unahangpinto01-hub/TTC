import { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { sheetResponse } from "@/lib/xlsx-helpers";
import { getSalesReport, getExpenseReport, getPnl, getArAging, getMovements, getDeliveryPerformance, parseRange } from "@/lib/reports";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: { report: string } }) {
  const user = await getUser();
  if (!user || user.role === "DEALER") return new Response("Unauthorized", { status: 401 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const range = parseRange(sp);
  const tag = `${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;

  switch (params.report) {
    case "sales": {
      const r = await getSalesReport(range);
      const rows: (string | number)[][] = [
        ["SALES REPORT", tag],
        [],
        ["BY CUSTOMER"],
        ["Customer", "Region", "Invoices", "Amount"],
        ...r.byCustomer.map((c) => [c.name, c.region, c.count, c.amount]),
        [],
        ["BY PRODUCT"],
        ["SKU", "Product", "Qty Sold", "Amount"],
        ...r.byProduct.map((p) => [p.sku, p.name, p.qty, p.amount]),
        [],
        ["BY REGION"],
        ["Region", "Amount"],
        ...r.byRegion.map((x) => [x.region, x.amount]),
        [],
        ["TOTAL", "", "", r.total],
      ];
      return sheetResponse(rows, "Sales", `sales-report-${tag}.xlsx`);
    }
    case "expenses": {
      const r = await getExpenseReport(range);
      const rows: (string | number)[][] = [
        ["EXPENSE REPORT", tag],
        [],
        ["Date", "Category", "Notes", "Amount"],
        ...r.expenses.map((e) => [e.date.toISOString().slice(0, 10), e.category, e.notes ?? "", e.amount]),
        [],
        ["BY CATEGORY"],
        ...r.byCategory.map((c) => [c.category, "", "", c.amount]),
        ["TOTAL", "", "", r.total],
      ];
      return sheetResponse(rows, "Expenses", `expense-report-${tag}.xlsx`);
    }
    case "pnl": {
      const r = await getPnl(range);
      const rows: (string | number)[][] = [
        ["INCOME STATEMENT", tag],
        [],
        ["Revenue (invoiced sales)", r.revenue],
        ["Cost of Goods Sold", r.cogs],
        ["GROSS PROFIT", r.grossProfit],
        [],
        ["Operating Expenses"],
        ...r.expenses.map((e) => [`  ${e.category}`, e.amount]),
        ["Total Expenses", r.totalExpenses],
        [],
        ["NET INCOME", r.netIncome],
      ];
      return sheetResponse(rows, "P&L", `income-statement-${tag}.xlsx`);
    }
    case "ar-aging": {
      const { rows: aging, totals } = await getArAging();
      const rows: (string | number)[][] = [
        ["AR AGING REPORT", new Date().toISOString().slice(0, 10)],
        [],
        ["Customer", "Region", "Current", "1-30", "31-60", "61-90", "90+", "Total"],
        ...aging.map((r) => [r.customer, r.region, r.current, r.d1_30, r.d31_60, r.d61_90, r.d90plus, r.total]),
        ["TOTAL", "", totals.current, totals.d1_30, totals.d31_60, totals.d61_90, totals.d90plus, totals.total],
      ];
      return sheetResponse(rows, "AR Aging", `ar-aging.xlsx`);
    }
    case "inventory-movement": {
      const moves = await getMovements(range);
      const rows: (string | number)[][] = [
        ["INVENTORY MOVEMENT", tag],
        [],
        ["Date", "SKU", "Product", "Type", "Qty", "Balance After", "Ref", "User"],
        ...moves.map((m) => [m.date.toISOString().slice(0, 10), m.product.sku, m.product.name, m.type, m.qty, m.balanceAfter, `${m.refType ?? ""} ${m.refNo ?? ""}`.trim(), m.user?.name ?? ""]),
      ];
      return sheetResponse(rows, "Movements", `inventory-movement-${tag}.xlsx`);
    }
    case "stock-on-hand": {
      const products = await prisma.product.findMany({ orderBy: { sku: "asc" }, include: { supplier: true } });
      const rows: (string | number)[][] = [
        ["STOCK ON HAND", new Date().toISOString().slice(0, 10)],
        [],
        ["SKU", "Product", "Category", "Pack", "Stock Qty", "Reorder Point", "Status", "Unit Cost", "Stock Value", "Supplier"],
        ...products.map((p) => [
          p.sku, p.name, p.category, p.packSize, p.stockQty, p.reorderPoint,
          p.stockQty <= 0 ? "OUT" : p.stockQty <= p.reorderPoint ? "LOW" : "OK",
          p.unitCost, Math.round(p.stockQty * p.unitCost * 100) / 100, p.supplier?.name ?? "",
        ]),
      ];
      return sheetResponse(rows, "Stock", `stock-on-hand.xlsx`);
    }
    case "delivery-performance": {
      const perf = await getDeliveryPerformance(range);
      const rows: (string | number)[][] = [
        ["DELIVERY PERFORMANCE", tag, "Target: 5/day"],
        [],
        ["Date", "Deliveries", "vs Target"],
        ...perf.map((d) => [d.date, d.count, d.count >= 5 ? "MET" : `${5 - d.count} short`]),
      ];
      return sheetResponse(rows, "Deliveries", `delivery-performance-${tag}.xlsx`);
    }
    default:
      return new Response("Unknown report", { status: 404 });
  }
}
