import type { FnKey } from "./permissions";

/**
 * The single registry of every report in the BMS.
 *
 * Adding a report here is what puts it into the permission system, the Reports hub and the
 * export authorisation at the same time — there is no second list to keep in step. A report
 * that is not registered cannot be granted, and a user with no explicit grant gets No Access.
 */
export type ReportDef = {
  /** stable key — stored in the user's permissions, so never rename one in use */
  key: string;
  title: string;
  /** grouping shown in the permission manager's Module filter */
  module: "Sales" | "Finance" | "Inventory" | "Purchasing" | "Executive";
  desc: string;
  /** page path, without the date query the hub adds */
  href: string;
  /** the /api/export/<segment> this report downloads through, when it has one */
  exportKey?: string;
  /**
   * The module permission that ALSO gates this report. A report never widens access to a
   * module: someone who cannot see AR cannot reach AR figures through a report either, so
   * the stricter of the two always wins.
   */
  fn: FnKey;
};

export const REPORTS: ReportDef[] = [
  // ---------------------------------------------------------------- Executive
  { key: "executive", title: "Executive Dashboard", module: "Executive", fn: "reports", exportKey: "executive",
    href: "/executive", desc: "One screen for the whole business — KPIs, sales trend, forecast achievement, and Teamagro against Trigreen" },

  // ---------------------------------------------------------------- Sales
  { key: "sales", title: "Sales Report", module: "Sales", fn: "reports", exportKey: "sales",
    href: "/reports/sales", desc: "By customer, product, and region" },
  { key: "sales-journal", title: "Sales Journal", module: "Sales", fn: "reports", exportKey: "sales-journal",
    href: "/reports/sales-journal", desc: "Chronological register of every posted invoice, by product line" },
  { key: "sales-monthly", title: "Monthly Sales per Region", module: "Sales", fn: "reports", exportKey: "sales-monthly",
    href: "/reports/sales-monthly", desc: "Products sold per month with totals, filtered by region" },
  { key: "customers", title: "Customer Report", module: "Sales", fn: "reports", exportKey: "customers",
    href: "/reports/customers", desc: "Sales, collections and outstanding balance per customer" },
  { key: "customer-statement", title: "Customer Statement", module: "Sales", fn: "reports",
    href: "/reports/customer-statement", desc: "Statement of account for one customer" },
  { key: "products", title: "Product Report", module: "Sales", fn: "reports", exportKey: "products",
    href: "/reports/products", desc: "Quantity sold, revenue, COGS and margin per product" },
  { key: "forecast", title: "Sales Forecast vs Sales", module: "Sales", fn: "reports",
    href: "/reports/forecast", desc: "Forecast against invoiced sales by salesperson, customer and product" },
  { key: "sales-vs-forecast", title: "Sales vs Forecast (by area)", module: "Sales", fn: "reports",
    href: "/reports/sales-vs-forecast", desc: "Forecast against actual sales for one area, normalised to the 1,000-ml equivalent" },
  { key: "deliveries", title: "Delivery Performance", module: "Sales", fn: "reports", exportKey: "delivery-performance",
    href: "/reports/deliveries", desc: "Deliveries per day against target" },
  { key: "price-list", title: "Product Price List", module: "Sales", fn: "reports", exportKey: "price-list",
    href: "/reports/price-list", desc: "Printable SRP list by category" },

  // ---------------------------------------------------------------- Finance
  { key: "pnl", title: "Income Statement (P&L)", module: "Finance", fn: "reports", exportKey: "pnl",
    href: "/reports/pnl", desc: "Revenue, COGS, expenses, net income" },
  { key: "ar-aging", title: "AR Aging", module: "Finance", fn: "ar", exportKey: "ar-aging",
    href: "/finance/ar", desc: "Receivables by days past due" },
  { key: "collections", title: "Collections", module: "Finance", fn: "ar", exportKey: "collections",
    href: "/reports/collections", desc: "Payments received by method, customer and company" },
  { key: "payments", title: "Receive Payments Report", module: "Finance", fn: "reports",
    href: "/reports/payments", desc: "Provisional receipts and how they were applied" },
  { key: "unapplied-payments", title: "Unapplied Payments", module: "Finance", fn: "reports",
    href: "/reports/unapplied-payments", desc: "Money received that is not yet against an invoice" },
  { key: "customer-credits", title: "Customer Credits", module: "Finance", fn: "reports",
    href: "/reports/customer-credits", desc: "Credit memos still to be used" },
  { key: "credit-applications", title: "Credit Applications", module: "Finance", fn: "reports",
    href: "/reports/credit-applications", desc: "Where each credit was applied" },
  { key: "refunds-credits", title: "Refunds & Credits", module: "Finance", fn: "reports",
    href: "/reports/refunds-credits", desc: "Credit memos and customer refunds raised in the period" },
  { key: "expenses", title: "Expense Report", module: "Finance", fn: "expenses", exportKey: "expenses",
    href: "/finance/expenses", desc: "By category with detail listing" },
  { key: "ap-aging", title: "AP Aging", module: "Finance", fn: "ap", exportKey: "ap-aging",
    href: "/finance/ap", desc: "What is owed to each supplier, by days past due" },
  { key: "supplier-statement", title: "Supplier Statement", module: "Finance", fn: "ap", exportKey: "supplier-statement",
    href: "/reports/supplier-statement", desc: "Statement of account for one supplier — bills, payments and balance" },
  { key: "supplier-payments", title: "Supplier Payments", module: "Finance", fn: "payBills", exportKey: "supplier-payments",
    href: "/reports/supplier-payments", desc: "Every payment to a supplier in the period — account, method, cheque, voucher and bills settled" },
  { key: "dv-register", title: "Disbursement Voucher Register", module: "Finance", fn: "dv", exportKey: "dv-register",
    href: "/reports/dv-register", desc: "Every voucher in the period — payee, bills, amount authorised, paid, status and signatories" },

  // ---------------------------------------------------------------- Inventory
  { key: "merchandise-inventory", title: "Merchandise Inventory", module: "Inventory", fn: "reports", exportKey: "merchandise-inventory",
    href: "/reports/merchandise-inventory", desc: "Inventory valuation at cost — stock × unit cost per product" },
  { key: "inventory-movement", title: "Inventory Movement", module: "Inventory", fn: "reports", exportKey: "inventory-movement",
    href: "/reports/inventory", desc: "Stock IN/OUT by date range plus stock on hand" },
  { key: "count-sheet", title: "Physical Count Sheet", module: "Inventory", fn: "reports", exportKey: "count-sheet",
    href: "/reports/count-sheet", desc: "Product masterlist with blank count columns for stocktaking" },

  // ---------------------------------------------------------------- Purchasing
  { key: "receiving", title: "Receiving Report", module: "Purchasing", fn: "purchaseOrders", exportKey: "receiving",
    href: "/reports/receiving", desc: "Every goods received note in the period" },
  { key: "po-receiving", title: "PO Receiving Status", module: "Purchasing", fn: "purchaseOrders", exportKey: "po-receiving",
    href: "/reports/po-receiving", desc: "Ordered against received for every purchase order" },
  { key: "supplier-receiving", title: "Supplier Receiving History", module: "Purchasing", fn: "purchaseOrders", exportKey: "supplier-receiving",
    href: "/reports/supplier-receiving", desc: "What each supplier delivered, reject rate and cost variance" },
  { key: "purchases", title: "Purchase Report", module: "Purchasing", fn: "bills", exportKey: "purchases",
    href: "/reports/purchases", desc: "Every posted supplier bill in the period — product cost, freight, VAT and what is still owed" },
  { key: "purchases-by-product", title: "Purchase by Product", module: "Purchasing", fn: "bills", exportKey: "purchases-by-product",
    href: "/reports/purchases/by-product", desc: "Quantity bought and landed cost per product" },
  { key: "purchases-by-supplier", title: "Purchase by Supplier", module: "Purchasing", fn: "bills", exportKey: "purchases-by-supplier",
    href: "/reports/purchases/by-supplier", desc: "Purchases, VAT and outstanding balance per supplier" },
  { key: "unbilled-receipts", title: "Received but Not Yet Billed", module: "Purchasing", fn: "bills", exportKey: "unbilled-receipts",
    href: "/reports/unbilled-receipts", desc: "Goods in stock whose supplier invoice has not been posted, valued at receiving cost" },
  { key: "invoice-discrepancies", title: "Supplier Invoice Discrepancies", module: "Purchasing", fn: "bills", exportKey: "invoice-discrepancies",
    href: "/reports/invoice-discrepancies", desc: "Bills whose quantities disagree with the receipt — over-billed or short — and what was raised with the supplier" },
  { key: "po-receiving-invoice", title: "PO vs Receiving vs Invoice", module: "Purchasing", fn: "bills", exportKey: "po-receiving-invoice",
    href: "/reports/po-receiving-invoice", desc: "Three-way match per purchase order line: ordered, received, invoiced, and the variances" },
  { key: "supplier-prices", title: "Supplier Price History", module: "Purchasing", fn: "purchaseOrders", exportKey: "supplier-prices",
    href: "/reports/supplier-prices", desc: "What each supplier has charged per piece for each product over time" },
];

export const REPORT_MODULES = ["Executive", "Sales", "Finance", "Inventory", "Purchasing"] as const;

export function reportByKey(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

/** Which report owns an /api/export/<segment> route, so the export can be authorised. */
export function reportByExportKey(exportKey: string): ReportDef | undefined {
  return REPORTS.find((r) => r.exportKey === exportKey);
}

/** The permission key a report is stored under. Prefixed so it can never collide with a
    module function key inside the same permissions blob. */
export const reportPermKey = (key: string) => `report:${key}`;
