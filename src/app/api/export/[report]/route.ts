import { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { sheetResponse, PESO_FMT, QTY_FMT } from "@/lib/xlsx-helpers";
import { getSalesReport, getExpenseReport, getPnl, getArAging, getMovements, getDeliveryPerformance, getMonthlyProductSales, getMerchandiseInventory, parseRange } from "@/lib/reports";
import { cartonBreakdown } from "@/lib/units";
import { getActiveCompany } from "@/lib/company";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: { report: string } }) {
  const user = await getUser();
  if (!user || user.role === "DEALER") return new Response("Unauthorized", { status: 401 });

  const company = await getActiveCompany(user);
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const range = parseRange(sp);
  const tag = `${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;

  switch (params.report) {
    case "sales": {
      const r = await getSalesReport(range, company.id);
      const rows: (string | number)[][] = [
        ["SALES REPORT", tag],
        [],
        ["BY CUSTOMER"],
        ["Customer", "Region", "Invoices", "Amount"],
        ...r.byCustomer.map((c) => [c.name, c.region, c.count, c.amount]),
        [],
        ["BY PRODUCT"],
        ["SKU", "Product", "Qty Sold (PCS)", "Amount"],
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
      const r = await getExpenseReport(range, company.id);
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
      const r = await getPnl(range, company.id);
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
      const { rows: aging, totals } = await getArAging(company.id);
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
      const moves = await getMovements(range, company.id);
      const rows: (string | number)[][] = [
        ["INVENTORY MOVEMENT", tag],
        [],
        ["Effective Date", "Entered On", "SKU", "Product", "Type", "Qty (PCS)", "Entered As", "Balance After (PCS)", "Ref", "User"],
        ...moves.map((m) => [
          m.date.toISOString().slice(0, 10), m.createdAt.toISOString().slice(0, 10), m.product.sku, m.product.name, m.type, m.qty,
          m.enteredUnit === "CARTON" ? `${m.enteredQty} CARTON` : `${m.enteredQty ?? Math.abs(m.qty)} PCS`,
          m.balanceAfter, `${m.refType ?? ""} ${m.refNo ?? ""}`.trim(), m.user?.name ?? "",
        ]),
      ];
      return sheetResponse(rows, "Movements", `inventory-movement-${tag}.xlsx`);
    }
    case "stock-on-hand": {
      const products = await prisma.product.findMany({ where: { companyId: company.id }, orderBy: { sku: "asc" }, include: { supplier: true } });
      const rows: (string | number)[][] = [
        ["STOCK ON HAND", new Date().toISOString().slice(0, 10)],
        [],
        ["SKU", "Product", "Category", "Pack", "Stock (PCS)", "PCS/Carton", "Complete Cartons", "Loose PCS", "Reorder Point", "Status", "Unit Cost", "Stock Value", "Supplier"],
        ...products.map((p) => {
          const b = cartonBreakdown(p.stockQty, p);
          return [
            p.sku, p.name, p.category, p.packSize, p.stockQty,
            p.piecesPerCarton ?? "", b ? b.cartons : "", b ? b.loose : "",
            p.reorderPoint,
            p.stockQty <= 0 ? "OUT" : p.stockQty <= p.reorderPoint ? "LOW" : "OK",
            p.unitCost, Math.round(p.stockQty * p.unitCost * 100) / 100, p.supplier?.name ?? "",
          ];
        }),
      ];
      return sheetResponse(rows, "Stock", `stock-on-hand.xlsx`);
    }
    case "sales-monthly": {
      const year = Number(sp.year) || new Date().getFullYear();
      const region = sp.region || "";
      const rows = await getMonthlyProductSales(year, company.id, region || undefined);
      const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const data: (string | number)[][] = [
        [`MONTHLY SALES PER PRODUCT — ${region || "ALL REGIONS"} ${year}`],
        [],
        ["Product", "Category", ...months, "Total Qty", "Amount"],
        ...rows.map((r) => [
          r.name,
          r.category,
          ...r.monthsQty,
          r.monthsQty.reduce((a, b) => a + b, 0),
          Math.round(r.monthsAmt.reduce((a, b) => a + b, 0) * 100) / 100,
        ]),
        [
          "TOTAL", "",
          ...months.map((_, mi) => rows.reduce((s, r) => s + r.monthsQty[mi], 0)),
          rows.reduce((s, r) => s + r.monthsQty.reduce((a, b) => a + b, 0), 0),
          Math.round(rows.reduce((s, r) => s + r.monthsAmt.reduce((a, b) => a + b, 0), 0) * 100) / 100,
        ],
      ];
      return sheetResponse(data, "Monthly Sales", `monthly-sales-${region || "all"}-${year}.xlsx`);
    }
    case "count-sheet": {
      const category = sp.category || "";
      const products = await prisma.product.findMany({
        where: { companyId: company.id, status: "Active", ...(category ? { category } : {}) },
        orderBy: [{ category: "asc" }, { sku: "asc" }],
      });
      const rows: (string | number)[][] = [
        ["PRODUCT MASTERLIST — PHYSICAL COUNT SHEET", new Date().toISOString().slice(0, 10), category || "All categories"],
        [],
        ["#", "SKU", "Product", "Category", "Pack", "Batch", "Stock (PCS)", "Complete Cartons", "Loose PCS", "Physical Count", "Variance", "Remarks"],
        ...products.map((p, i) => {
          const b = cartonBreakdown(p.stockQty, p);
          return [i + 1, p.sku, p.name, p.category, p.packSize, p.batchNo ?? "", p.stockQty, b ? b.cartons : "", b ? b.loose : "", "", "", ""];
        }),
        [],
        ["Counted by (Inventory Controller):", "", "", "Checked by (Supervisor):", "", "", "Noted by:"],
      ];
      return sheetResponse(rows, "Count Sheet", `physical-count-sheet.xlsx`);
    }
    case "merchandise-inventory": {
      const asOfStr = sp.asOf || new Date().toISOString().slice(0, 10);
      const category = sp.category || "";
      const q = sp.q || "";
      const showZero = sp.zero === "1";
      const r = await getMerchandiseInventory({ companyId: company.id, asOf: new Date(asOfStr), category, q, showZero });
      const HEADER_ROW = 4; // 0-based index of the column-header row below
      const rows: (string | number)[][] = [
        ["MERCHANDISE INVENTORY — Valuation at Cost"],
        [`As of: ${asOfStr}${r.historical ? " (reconstructed from stock card)" : ""}`],
        [`Filters: ${category || "All Categories"} · ${q ? `Search "${q}"` : "All Products"} · ${showZero ? "Including zero stock" : "Zero stock hidden"}`],
        [],
        ["#", "SKU", "Product Name", "Pack", "Unit Cost", "Stock (PCS)", "Amount"],
        ...r.rows.map((row, i) => [i + 1, row.sku, row.name, row.packSize, row.unitCost, row.stock, row.amount]),
        [],
        ["", "", "", "", "", "TOTAL INVENTORY VALUE", r.totalValue],
        ["", "", "", "", "", "Inventory Items", String(r.items)],
        ["", "", "", "", "", "Total Stock (PCS)", r.totalStock.toLocaleString()],
      ];
      return sheetResponse(rows, "Merchandise Inventory", `Merchandise_Inventory_${asOfStr}.xlsx`, {
        colWidths: [4, 10, 42, 10, 14, 12, 16],
        numFmts: [
          { col: 4, fmt: PESO_FMT, fromRow: HEADER_ROW + 1 },
          { col: 5, fmt: QTY_FMT, fromRow: HEADER_ROW + 1 },
          { col: 6, fmt: PESO_FMT, fromRow: HEADER_ROW + 1 },
        ],
      });
    }
    case "delivery-performance": {
      const perf = await getDeliveryPerformance(range, company.id);
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
