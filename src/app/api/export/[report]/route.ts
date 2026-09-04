import { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { sheetResponse, PESO_FMT, QTY_FMT } from "@/lib/xlsx-helpers";
import { getSalesReport, getExpenseReport, getPnl, getArAging, getMovements, getDeliveryPerformance, getMonthlyProductSales, getMerchandiseInventory, getCollections, getCustomerReport, getProductReport, getSalesJournal, parseRange } from "@/lib/reports";
import { cartonBreakdown, displayCartonSize, ctnValue, lineCartonSize } from "@/lib/units";
import { getActiveCompany, allowedCompanies } from "@/lib/company";
import { scopeIds } from "@/lib/report-scope";
import { getReceivingReport, getPOReceivingStatus, getSupplierReceivingHistory } from "@/lib/receiving-reports";
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
        ["Product Line", "Qty Sold (PCS)", "Equivalent (CTN)", "Amount"],
        ...r.byProduct.map((p) => [p.name, p.qty, p.noConversion ? "N/A" : Math.round(p.ctn * 100) / 100, p.amount]),
        [],
        ["BY REGION"],
        ["Region", "Amount"],
        ...r.byRegion.map((x) => [x.region, x.amount]),
        [],
        ["GOODS", "", "", r.goods],
        ["FREIGHT (billed to customers)", "", "", r.freight],
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
        ["Effective Date", "Entered On", ...(scope.combined ? ["Company"] : []), "SKU", "Product", "Type", "Qty (PCS)", "Equivalent (CTN)", "PCS per CTN", "Entered As", "Balance After (PCS)", "Balance (CTN)", "Ref", "User"],
        ...moves.map((m) => [
          m.date.toISOString().slice(0, 10), m.createdAt.toISOString().slice(0, 10), ...(scope.combined ? [m.product.company.companyName] : []), m.product.sku, m.product.name, m.type, m.qty,
          // a carton-entered movement converts at its own factor, not the product's current one
          (() => {
            const ppc = m.enteredUnit === "CARTON" && m.enteredQty ? Math.abs(m.qty) / m.enteredQty : displayCartonSize(m.product);
            return ctnValue(Math.abs(m.qty), ppc) ?? "N/A";
          })(),
          m.enteredUnit === "CARTON" && m.enteredQty ? Math.abs(m.qty) / m.enteredQty : (displayCartonSize(m.product) ?? "N/A"),
          m.enteredUnit === "CARTON" ? `${m.enteredQty} CARTON` : `${m.enteredQty ?? Math.abs(m.qty)} PCS`,
          m.balanceAfter,
          ctnValue(m.balanceAfter, displayCartonSize(m.product)) ?? "N/A",
          `${m.refType ?? ""} ${m.refNo ?? ""}`.trim(), m.user?.name ?? "",
        ]),
      ];
      return sheetResponse(rows, "Movements", `inventory-movement-${tag}.xlsx`);
    }
    case "stock-on-hand": {
      const products = await prisma.product.findMany({ where: { companyId: { in: scope.ids } }, orderBy: { sku: "asc" }, include: { company: { select: { companyName: true } }, supplier: true } });
      const rows: (string | number)[][] = [
        ["STOCK ON HAND", new Date().toISOString().slice(0, 10), scope.label],
        [],
        [...(scope.combined ? ["Company"] : []), "SKU", "Product", "Category", "Pack", "Stock (PCS)", "Equivalent (CTN)", "PCS/Carton", "Complete Cartons", "Loose PCS", "Reorder Point", "Status", "Unit Cost", "Stock Value", "Supplier"],
        ...products.map((p) => {
          const b = cartonBreakdown(p.stockQty, p);
          return [
            ...(scope.combined ? [p.company.companyName] : []), p.sku, p.name, p.category, p.packSize, p.stockQty,
            ctnValue(p.stockQty, displayCartonSize(p)) ?? "N/A",
            p.piecesPerCarton ?? "N/A", b ? b.cartons : "", b ? b.loose : "",
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
        ["Product", "Category", ...months, "Total Qty (PCS)", "Equivalent (CTN)", "Amount"],
        ...rows.map((r) => [
          r.name,
          r.category,
          ...r.monthsQty,
          r.monthsQty.reduce((a, b) => a + b, 0),
          r.noConversion ? "N/A" : Math.round(r.monthsCtn.reduce((a, b) => a + b, 0) * 100) / 100,
          Math.round(r.monthsAmt.reduce((a, b) => a + b, 0) * 100) / 100,
        ]),
        [
          "TOTAL", "",
          ...months.map((_, mi) => rows.reduce((s, r) => s + r.monthsQty[mi], 0)),
          rows.reduce((s, r) => s + r.monthsQty.reduce((a, b) => a + b, 0), 0),
          Math.round(rows.reduce((s, r) => s + r.monthsCtn.reduce((a, b) => a + b, 0), 0) * 100) / 100,
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
        ["#", "SKU", "Product", "Category", "Pack", "Batch", "Stock (PCS)", "Equivalent (CTN)", "PCS per CTN", "Complete Cartons", "Loose PCS", "Physical Count", "Variance", "Remarks"],
        ...products.map((p, i) => {
          const b = cartonBreakdown(p.stockQty, p);
          return [
            i + 1, p.sku, p.name, p.category, p.packSize, p.batchNo ?? "", p.stockQty,
            ctnValue(p.stockQty, displayCartonSize(p)) ?? "N/A",
            p.piecesPerCarton ?? "N/A",
            b ? b.cartons : "", b ? b.loose : "", "", "", "",
          ];
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
        ["#", "SKU", "Product Name", "Pack", "Unit Cost", "Stock (PCS)", "Equivalent (CTN)", "PCS per CTN", "Amount"],
        ...r.rows.map((row, i) => [
          i + 1, row.sku, row.name, row.packSize, row.unitCost, row.stock,
          ctnValue(row.stock, row.piecesPerCarton) ?? "N/A",
          row.piecesPerCarton ?? "N/A",
          row.amount,
        ]),
        [],
        ["", "", "", "", "", "", "", "TOTAL INVENTORY VALUE", r.totalValue],
        ["", "", "", "", "", "", "", "Inventory Items", String(r.items)],
        ["", "", "", "", "", "", "", "Total Stock (PCS)", r.totalStock.toLocaleString()],
        [
          "", "", "", "", "", "", "", "Total Equivalent (CTN)",
          Math.round(r.rows.reduce((s, row) => s + (ctnValue(row.stock, row.piecesPerCarton) ?? 0), 0) * 100) / 100,
        ],
      ];
      return sheetResponse(rows, "Merchandise Inventory", `Merchandise_Inventory_${asOfStr}.xlsx`, {
        colWidths: [4, 10, 42, 10, 14, 12, 14, 12, 16],
        numFmts: [
          { col: 4, fmt: PESO_FMT, fromRow: HEADER_ROW + 1 },
          { col: 5, fmt: QTY_FMT, fromRow: HEADER_ROW + 1 },
          { col: 8, fmt: PESO_FMT, fromRow: HEADER_ROW + 1 },
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
        ["SKU", "Product", ...(scope.combined ? ["Company"] : []), "Category", "Qty Sold (PCS)", "Equivalent (CTN)", "Revenue", "COGS", "Margin"],
        ...r.rows.map((x) => [
          x.sku, x.name, ...(scope.combined ? [x.company] : []), x.category, x.qty,
          x.noConversion ? "N/A" : Math.round(x.ctn * 100) / 100,
          x.revenue, x.cogs, x.margin,
        ]),
        [],
        ["TOTAL", "", ...(scope.combined ? [""] : []), "", r.totals.qty, r.totals.ctn, r.totals.revenue, r.totals.cogs, r.totals.margin],
      ];
      return sheetResponse(rows, "Products", `product-report-${tag}.xlsx`);
    }
    case "receiving": {
      const rep = await getReceivingReport(range, scope.ids, {
        supplierId: sp.supplier || undefined,
        status: sp.status || undefined,
        q: sp.q || undefined,
      });
      const rows: (string | number)[][] = [
        ["RECEIVING REPORT", tag, scope.label],
        [],
        ["Date", "GRN No.", ...(scope.combined ? ["Company"] : []), "Supplier", "PO No.", "Supplier DR", "Supplier Invoice", "Warehouse", "Received (PCS)", "Received (CTN)", "Rejected (PCS)", "Rejected (CTN)", "Accepted (PCS)", "Accepted (CTN)", "Accepted Value", "Cost Variance", "Status"],
        ...rep.rows.map((x) => [
          x.grn.receivedDate.toISOString().slice(0, 10),
          x.grn.grnNumber,
          ...(scope.combined ? [x.grn.company.companyName] : []),
          x.grn.purchaseOrder.supplier.name,
          x.grn.purchaseOrder.poNumber,
          x.grn.deliveryRefNo ?? "",
          x.grn.supplierInvoiceNo ?? "",
          x.grn.warehouse ?? "",
          x.receivedPcs,
          Math.round(x.receivedCtn * 100) / 100,
          x.rejectedPcs,
          Math.round(x.rejectedCtn * 100) / 100,
          x.acceptedPcs,
          Math.round(x.acceptedCtn * 100) / 100,
          x.value,
          x.costVariance,
          x.grn.status,
        ]),
        [],
        ["TOTAL", "", ...(scope.combined ? [""] : []), "", "", "", "", "",
          rep.totals.receivedPcs, Math.round(rep.totals.receivedCtn * 100) / 100,
          rep.totals.rejectedPcs, Math.round(rep.totals.rejectedCtn * 100) / 100,
          rep.totals.acceptedPcs, Math.round(rep.totals.acceptedCtn * 100) / 100,
          rep.totals.value, rep.totals.costVariance, ""],
        [],
        ["LINE DETAIL"],
        ["GRN No.", "SKU", "Product", "Pack Size", "Unit", "PCS per CTN", "Received", "Rejected", "Accepted", "Accepted (PCS)", "Accepted (CTN)", "Unit Cost", "PO Unit Cost", "Total", "Batch", "Expiry"],
        ...rep.rows.flatMap((x) =>
          x.grn.lines.map((l) => [
            x.grn.grnNumber,
            l.product.sku,
            l.product.name,
            l.product.packSize,
            l.unit,
            lineCartonSize(l, l.product) ?? "N/A",
            l.qty,
            l.rejectedQty,
            l.acceptedQty,
            l.acceptedBaseQty,
            ctnValue(l.acceptedBaseQty, lineCartonSize(l, l.product)) ?? "N/A",
            l.unitCost,
            l.poUnitCost,
            l.acceptedQty * l.unitCost,
            l.batchNo ?? "",
            l.expDate ? l.expDate.toISOString().slice(0, 10) : "",
          ])
        ),
      ];
      return sheetResponse(rows, "Receiving", `receiving-report-${tag}.xlsx`);
    }
    case "po-receiving": {
      const outstandingOnly = sp.outstanding === "1";
      const rep = await getPOReceivingStatus(scope.ids, { outstandingOnly, supplierId: sp.supplier || undefined });
      const rows: (string | number)[][] = [
        [outstandingOnly ? "PARTIAL RECEIVING REPORT" : "PURCHASE ORDER RECEIVING STATUS", tag, scope.label],
        [],
        ["PO No.", "Date", ...(scope.combined ? ["Company"] : []), "Supplier", "Ordered (PCS)", "Ordered (CTN)", "Received (PCS)", "Received (CTN)", "Remaining (PCS)", "Remaining (CTN)", "% Received", "Receipts", "Ordered Value", "Received Value", "Status"],
        ...rep.rows.map((x) => [
          x.po.poNumber,
          x.po.date.toISOString().slice(0, 10),
          ...(scope.combined ? [x.po.company.companyName] : []),
          x.po.supplier.name,
          x.orderedPcs,
          Math.round(x.orderedCtn * 100) / 100,
          x.receivedPcs,
          Math.round(x.receivedCtn * 100) / 100,
          x.remainingPcs,
          Math.round(x.remainingCtn * 100) / 100,
          Number(x.pct.toFixed(1)),
          x.receipts,
          x.orderedValue,
          x.receivedValue,
          x.po.status,
        ]),
        [],
        ["TOTAL", "", ...(scope.combined ? [""] : []), "",
          rep.totals.orderedPcs, Math.round(rep.totals.orderedCtn * 100) / 100,
          rep.totals.receivedPcs, Math.round(rep.totals.receivedCtn * 100) / 100,
          rep.totals.remainingPcs, Math.round(rep.totals.remainingCtn * 100) / 100,
          "", "", rep.totals.orderedValue, rep.totals.receivedValue, ""],
      ];
      return sheetResponse(rows, "PO Receiving", `po-receiving-status-${tag}.xlsx`);
    }
    case "supplier-receiving": {
      const rep = await getSupplierReceivingHistory(range, scope.ids);
      const rows: (string | number)[][] = [
        ["SUPPLIER RECEIVING HISTORY", tag, scope.label],
        [],
        ["Supplier", "Receipts", "Received (PCS)", "Received (CTN)", "Rejected (PCS)", "Rejected (CTN)", "Reject Rate %", "Accepted (PCS)", "Accepted (CTN)", "Accepted Value", "Cost Variance", "Last Delivery"],
        ...rep.rows.map((x) => [
          x.name,
          x.receipts,
          x.receivedPcs,
          Math.round(x.receivedCtn * 100) / 100,
          x.rejectedPcs,
          Math.round(x.rejectedCtn * 100) / 100,
          Number(x.rejectRate.toFixed(1)),
          x.acceptedPcs,
          Math.round(x.acceptedCtn * 100) / 100,
          x.value,
          x.costVariance,
          x.last ? x.last.toISOString().slice(0, 10) : "",
        ]),
        [],
        ["TOTAL", rep.totals.receipts,
          rep.totals.receivedPcs, Math.round(rep.totals.receivedCtn * 100) / 100,
          rep.totals.rejectedPcs, Math.round(rep.totals.rejectedCtn * 100) / 100,
          "", rep.totals.acceptedPcs, Math.round(rep.totals.acceptedCtn * 100) / 100,
          rep.totals.value, rep.totals.costVariance, ""],
      ];
      return sheetResponse(rows, "Supplier Receiving", `supplier-receiving-${tag}.xlsx`);
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
        ["Date", ...(scope.combined ? ["Company"] : []), "Invoice No.", "Customer", "Reference", "Product", "Qty", "Unit Price", "Gross Sales", "Freight", "Net Sales", "Payment", "Salesperson", "Status", "Qty (PCS)", "Equivalent (CTN)"],
        ...j.rows.map((r) => [
          r.date.toISOString().slice(0, 10),
          ...(scope.combined ? [r.company] : []),
          r.invoiceNo, r.customer, r.reference, r.product, r.qty,
          r.unitPrice ?? "", r.gross, r.freight || "", r.net,
          r.paymentStatus, r.salesperson, r.transactionStatus,
          r.productId ? r.qtyPcs : "",
          r.productId ? (r.qtyCtn === null ? "N/A" : Math.round(r.qtyCtn * 100) / 100) : "",
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
