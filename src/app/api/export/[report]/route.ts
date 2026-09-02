import { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { sheetResponse, PESO_FMT, QTY_FMT } from "@/lib/xlsx-helpers";
import { getSalesReport, getExpenseReport, getPnl, getArAging, getMovements, getDeliveryPerformance, getMonthlyProductSales, getMerchandiseInventory, getCollections, getCustomerReport, getProductReport, getSalesJournal, parseRange } from "@/lib/reports";
import { cartonBreakdown } from "@/lib/units";
import { getActiveCompany, allowedCompanies } from "@/lib/company";
import { scopeIds } from "@/lib/report-scope";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: { report: string } }) {
  const user = await getUser();
  if (!user || user.role === "DEALER") return new Response("Unauthorized", { status: 401 });

  const company = await getActiveCompany(user);
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  // reports may cover one company or all of them (Super Admin) — resolved with the same permission rules
  const scope = await scopeIds(user, sp.company);
  const range = parseRange(sp);
  const tag = `${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;

  switch (params.report) {
    case "sales": {
      const r = await getSalesReport(range, scope.ids, sp.province ? { province: sp.province } : undefined);
      const rows: (string | number)[][] = [
        ["SALES REPORT", tag, scope.label, sp.province ? `Province: ${sp.province}` : ""],
        [],
        ...(scope.combined ? [["BY COMPANY"], ["Company", "Invoices", "Amount"], ...r.byCompany.map((c) => [c.name, c.count, c.amount]), []] : []),
        ["INVOICES"],
        ["Date", ...(scope.combined ? ["Company"] : []), "Invoice No.", "Customer", "Amount"],
        ...r.invoices.map((sr) => [sr.invoiceDate.toISOString().slice(0, 10), ...(scope.combined ? [sr.company.companyName] : []), sr.srNumber, sr.customer.businessName, sr.amount]),
        [],
        ["BY CUSTOMER"],
        ["Customer", "Region", "Invoices", "Amount"],
        ...r.byCustomer.map((c) => [c.name, c.region, c.count, c.amount]),
        [],
        ["BY PRODUCT"],
        ["Product Line", "Qty Sold (PCS)", "Amount"],
        ...r.byProduct.map((p) => [p.name, p.qty, p.amount]),
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
      const r = await getExpenseReport(range, scope.ids);
      const rows: (string | number)[][] = [
        ["EXPENSE REPORT", tag, scope.label],
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
      const r = await getPnl(range, scope.ids);
      const rows: (string | number)[][] = [
        ["INCOME STATEMENT", tag, scope.label],
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
      const { rows: aging, totals } = await getArAging(scope.ids);
      const rows: (string | number)[][] = [
        ["AR AGING REPORT", new Date().toISOString().slice(0, 10), scope.label],
        [],
        ["Customer", ...(scope.combined ? ["Company"] : []), "Region", "Current", "1-30", "31-60", "61-90", "90+", "Total"],
        ...aging.map((r) => [r.customer, ...(scope.combined ? [r.company] : []), r.region, r.current, r.d1_30, r.d31_60, r.d61_90, r.d90plus, r.total]),
        ["TOTAL", ...(scope.combined ? [""] : []), "", totals.current, totals.d1_30, totals.d31_60, totals.d61_90, totals.d90plus, totals.total],
      ];
      return sheetResponse(rows, "AR Aging", `ar-aging.xlsx`);
    }
    case "inventory-movement": {
      const moves = await getMovements(range, scope.ids);
      const rows: (string | number)[][] = [
        ["INVENTORY MOVEMENT", tag, scope.label],
        [],
        ["Effective Date", "Entered On", ...(scope.combined ? ["Company"] : []), "SKU", "Product", "Type", "Qty (PCS)", "Entered As", "Balance After (PCS)", "Ref", "User"],
        ...moves.map((m) => [
          m.date.toISOString().slice(0, 10), m.createdAt.toISOString().slice(0, 10), ...(scope.combined ? [m.product.company.companyName] : []), m.product.sku, m.product.name, m.type, m.qty,
          m.enteredUnit === "CARTON" ? `${m.enteredQty} CARTON` : `${m.enteredQty ?? Math.abs(m.qty)} PCS`,
          m.balanceAfter, `${m.refType ?? ""} ${m.refNo ?? ""}`.trim(), m.user?.name ?? "",
        ]),
      ];
      return sheetResponse(rows, "Movements", `inventory-movement-${tag}.xlsx`);
    }
    case "stock-on-hand": {
      const products = await prisma.product.findMany({ where: { companyId: { in: scope.ids } }, orderBy: { sku: "asc" }, include: { company: { select: { companyName: true } }, supplier: true } });
      const rows: (string | number)[][] = [
        ["STOCK ON HAND", new Date().toISOString().slice(0, 10), scope.label],
        [],
        [...(scope.combined ? ["Company"] : []), "SKU", "Product", "Category", "Pack", "Stock (PCS)", "PCS/Carton", "Complete Cartons", "Loose PCS", "Reorder Point", "Status", "Unit Cost", "Stock Value", "Supplier"],
        ...products.map((p) => {
          const b = cartonBreakdown(p.stockQty, p);
          return [
            ...(scope.combined ? [p.company.companyName] : []), p.sku, p.name, p.category, p.packSize, p.stockQty,
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
      const province = sp.province || "";
      const rows = await getMonthlyProductSales(year, scope.ids, region || undefined, province || undefined);
      const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const data: (string | number)[][] = [
        [`MONTHLY SALES PER PRODUCT — ${province || region || "ALL REGIONS"} ${year}`],
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
        where: { companyId: { in: scope.ids }, status: "Active", ...(category ? { category } : {}) },
        orderBy: [{ category: "asc" }, { sku: "asc" }],
      });
      const rows: (string | number)[][] = [
        ["PRODUCT MASTERLIST — PHYSICAL COUNT SHEET", new Date().toISOString().slice(0, 10), scope.label, category || "All categories"],
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
      const itemClass = sp.class === "NON_INVENTORY" ? "NON_INVENTORY" : "INVENTORY";
      const r = await getMerchandiseInventory({ companyIds: scope.ids, asOf: new Date(asOfStr), category, q, showZero, itemClass });
      const HEADER_ROW = 4; // 0-based index of the column-header row below
      const rows: (string | number)[][] = [
        ["MERCHANDISE INVENTORY — Valuation at Cost"],
        [`As of: ${asOfStr}${r.historical ? " (reconstructed from stock card)" : ""}`],
        [`Filters: ${itemClass === "NON_INVENTORY" ? "Non-Inventory (promo materials)" : "Inventory items"} · ${category || "All Categories"} · ${q ? `Search "${q}"` : "All Products"} · ${showZero ? "Including zero stock" : "Zero stock hidden"}`],
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
      const perf = await getDeliveryPerformance(range, scope.ids);
      const rows: (string | number)[][] = [
        ["DELIVERY PERFORMANCE", tag, scope.label, "Target: 5/day"],
        [],
        ["Date", "Deliveries", "vs Target"],
        ...perf.map((d) => [d.date, d.count, d.count >= 5 ? "MET" : `${5 - d.count} short`]),
      ];
      return sheetResponse(rows, "Deliveries", `delivery-performance-${tag}.xlsx`);
    }
    case "price-list": {
      // the company may be picked on the report, but only from the ones this user may access
      const target = { companyName: scope.label };
      const category = sp.category || "";
      const q = (sp.q || "").trim();
      const showInactive = sp.inactive === "1";
      const sortKey = sp.sort === "category" ? "category" : sp.sort === "srp" ? "srp" : "name";
      const orderBy: any =
        sortKey === "category" ? [{ category: "asc" }, { name: "asc" }]
        : sortKey === "srp" ? [{ srp: "desc" }, { name: "asc" }]
        : [{ name: "asc" }];
      const where: any = { companyId: { in: scope.ids } };
      if (!showInactive) where.status = "Active";
      if (category) where.category = category;
      if (q) {
        where.OR = [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { packSize: { contains: q, mode: "insensitive" } },
          { activeIngredient: { contains: q, mode: "insensitive" } },
        ];
      }
      const products = await prisma.product.findMany({ where, orderBy, include: { company: { select: { companyName: true } } } });
      const today = new Date().toISOString().slice(0, 10);
      const HEADER_ROW = 4;
      const rows: (string | number)[][] = [
        [target.companyName],
        ["PRODUCT PRICE LIST"],
        [`Generated: ${today} · ${category || "All Categories"}${q ? ` · Search "${q}"` : ""}${showInactive ? " · including inactive" : " · active products only"}`],
        [],
        ["#", ...(scope.combined ? ["Company"] : []), "Product Name", "Size", "SRP"],
        ...products.map((p, i) => [i + 1, ...(scope.combined ? [p.company.companyName] : []), p.name, p.packSize || "", p.itemClass === "NON_INVENTORY" ? "" : p.srp]),
        [],
        ["", `${products.length} product(s) listed`],
      ];
      return sheetResponse(rows, "Price List", `Product_Price_List_${today}.xlsx`, {
        colWidths: scope.combined ? [5, 22, 46, 18, 14] : [5, 46, 18, 14],
        numFmts: [{ col: scope.combined ? 4 : 3, fmt: PESO_FMT, fromRow: HEADER_ROW + 1 }],
      });
    }
    case "collections": {
      const r = await getCollections(range, scope.ids, sp.method ? { method: sp.method } : undefined);
      const rows: (string | number)[][] = [
        ["COLLECTIONS REPORT", tag, scope.label, sp.method ? `Method: ${sp.method}` : "All methods"],
        [],
        ...(scope.combined ? [["BY COMPANY"], ["Company", "Payments", "Collected"], ...r.byCompany.map((c) => [c.name, c.count, c.amount]), []] : []),
        ["BY METHOD"],
        ["Method", "Payments", "Amount"],
        ...r.byMethod.map((m) => [m.name, m.count, m.amount]),
        [],
        ["PAYMENTS RECEIVED"],
        ["Date", ...(scope.combined ? ["Company"] : []), "Invoice No.", "Customer", "Method", "Reference", "Amount"],
        ...r.rows.map((p) => [p.date.toISOString().slice(0, 10), ...(scope.combined ? [p.company] : []), p.srNumber, p.customer, p.method, p.refNo, p.amount]),
        [],
        ["TOTAL COLLECTED", "", "", "", "", "", r.total],
      ];
      return sheetResponse(rows, "Collections", `collections-${tag}.xlsx`);
    }
    case "customers": {
      const r = await getCustomerReport(range, scope.ids);
      const rows2 = sp.province ? r.rows.filter((x) => x.province === sp.province) : r.rows;
      const rows: (string | number)[][] = [
        ["CUSTOMER REPORT", tag, scope.label, sp.province ? `Province: ${sp.province}` : "All provinces"],
        [],
        ["Customer", ...(scope.combined ? ["Company"] : []), "Region", "Province", "Invoices", "Sales", "Collected", "Balance"],
        ...rows2.map((x) => [x.customer, ...(scope.combined ? [x.company] : []), x.region, x.province, x.invoices, x.sales, x.collected, x.balance]),
        [],
        ["TOTAL", ...(scope.combined ? [""] : []), "", "",
          rows2.reduce((s2, x) => s2 + x.invoices, 0),
          Math.round(rows2.reduce((s2, x) => s2 + x.sales, 0) * 100) / 100,
          Math.round(rows2.reduce((s2, x) => s2 + x.collected, 0) * 100) / 100,
          Math.round(rows2.reduce((s2, x) => s2 + x.balance, 0) * 100) / 100],
      ];
      return sheetResponse(rows, "Customers", `customer-report-${tag}.xlsx`);
    }
    case "products": {
      const r = await getProductReport(range, scope.ids, sp.category ? { category: sp.category } : undefined);
      const rows: (string | number)[][] = [
        ["PRODUCT REPORT", tag, scope.label, sp.category || "All categories"],
        [],
        ["SKU", "Product", ...(scope.combined ? ["Company"] : []), "Category", "Qty Sold (PCS)", "Revenue", "COGS", "Margin"],
        ...r.rows.map((x) => [x.sku, x.name, ...(scope.combined ? [x.company] : []), x.category, x.qty, x.revenue, x.cogs, x.margin]),
        [],
        ["TOTAL", "", ...(scope.combined ? [""] : []), "", r.totals.qty, r.totals.revenue, r.totals.cogs, r.totals.margin],
      ];
      return sheetResponse(rows, "Products", `product-report-${tag}.xlsx`);
    }
    case "sales-journal": {
      const j = await getSalesJournal(range, scope.ids, {
        customerId: sp.customer || undefined,
        productId: sp.product || undefined,
        salesperson: sp.salesperson || undefined,
        txStatus: sp.tx || undefined,
        q: sp.q || undefined,
      });
      const HEADER_ROW = 4;
      const rows: (string | number)[][] = [
        ["SALES JOURNAL", tag, scope.label],
        [`${j.invoiceCount} invoice(s) · ${j.rows.length} entries${j.voidedCount ? ` · ${j.voidedCount} voided (excluded from totals)` : ""}`],
        [],
        [],
        ["Date", ...(scope.combined ? ["Company"] : []), "Invoice No.", "Customer", "Reference", "Product", "Qty", "Unit Price", "Gross Sales", "Freight", "Net Sales", "Payment", "Salesperson", "Status"],
        ...j.rows.map((r) => [
          r.date.toISOString().slice(0, 10),
          ...(scope.combined ? [r.company] : []),
          r.invoiceNo, r.customer, r.reference, r.product, r.qty,
          r.unitPrice ?? "", r.gross, r.freight || "", r.net,
          r.paymentStatus, r.salesperson, r.transactionStatus,
        ]),
        [],
        ...(scope.combined ? j.byCompany.map((c) => [`${c.name} Net Sales`, "", "", "", "", "", "", "", "", "", c.net]) : []),
        [`Gross Sales`, "", "", "", "", "", "", "", j.totals.gross],
        [`Less: Freight Charge`, "", "", "", "", "", "", "", j.totals.freight],
        [`Net Sales`, "", "", "", "", "", "", "", j.totals.net],
      ];
      const money = scope.combined ? [8, 9, 10, 11] : [7, 8, 9, 10];
      return sheetResponse(rows, "Sales Journal", `sales-journal-${tag}.xlsx`, {
        colWidths: scope.combined ? [12, 20, 16, 26, 22, 34, 12, 13, 15, 13, 15, 11, 16, 10] : [12, 16, 26, 22, 34, 12, 13, 15, 13, 15, 11, 16, 10],
        numFmts: money.map((col) => ({ col, fmt: PESO_FMT, fromRow: HEADER_ROW + 1 })),
      });
    }
    default:
      return new Response("Unknown report", { status: 404 });
  }
}
