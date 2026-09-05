export type PermLevel = "NONE" | "READ_WRITE" | "READ_ONLY";

/** Every function in the system, in sidebar order. */
export const FUNCTIONS = [
  ["dashboard", "Dashboard"],
  ["notifications", "Notifications"],
  ["orders", "Order Inbox"],
  ["salesOrders", "Sales Orders"],
  ["schedule", "Delivery Schedule"],
  ["deliveries", "Delivery Receipts"],
  ["invoicing", "For Invoicing"],
  ["invoices", "Invoices (SR)"],
  ["forecast", "Sales Forecast"],
  ["customers", "Customers"],
  ["inventory", "Products / Inventory"],
  ["purchaseOrders", "Purchase Orders"],
  ["suppliers", "Suppliers"],
  ["ar", "AR / Aging & Payments"],
  ["receivePayments", "Receive Payments"],
  ["refundsCredits", "Refunds & Credits"],
  ["coa", "Chart of Accounts"],
  ["expenses", "Expenses"],
  ["ledger", "Ledger"],
  ["reports", "Reports"],
  ["hr", "HR (Employees / Payroll / Evaluations)"],
  ["users", "User Management"],
  ["company", "Company Details"],
] as const;

export type FnKey = (typeof FUNCTIONS)[number][0];

const RW: PermLevel = "READ_WRITE";
const RO: PermLevel = "READ_ONLY";
const NO: PermLevel = "NONE";

const ALL_RW = Object.fromEntries(FUNCTIONS.map(([k]) => [k, RW])) as Record<FnKey, PermLevel>;

/** Defaults applied when a user has no explicit permission for a function. */
export const ROLE_DEFAULTS: Record<string, Record<FnKey, PermLevel>> = {
  SUPER_ADMIN: { ...ALL_RW },
  ADMIN: { ...ALL_RW, users: NO, company: NO },
  CLERK: {
    dashboard: RW, notifications: RW, orders: RW, salesOrders: RW, schedule: RW,
    deliveries: RW, invoicing: NO, invoices: RO, forecast: RO, customers: RW,
    inventory: RO, purchaseOrders: RO, suppliers: RO, ar: NO, receivePayments: NO, refundsCredits: NO, coa: NO, expenses: NO,
    ledger: NO, reports: NO, hr: NO, users: NO, company: NO,
  },
};

type PermUser = { role: string; access: string; permsJson: string | null };

/** Effective permission for a function. Super Admin always has full access.
    The account-level switch still caps everyone else (NONE disables, READ_ONLY caps writes). */
export function getPerm(user: PermUser, fn: FnKey): PermLevel {
  if (user.role === "SUPER_ADMIN") return RW;
  if (user.role === "DEALER") return NO;
  if (user.access === "NONE") return NO;
  let p: PermLevel | undefined;
  if (user.permsJson) {
    try {
      p = (JSON.parse(user.permsJson) as Record<string, PermLevel>)[fn];
    } catch {
      p = undefined;
    }
  }
  if (!p || !["NONE", "READ_WRITE", "READ_ONLY"].includes(p)) {
    p = ROLE_DEFAULTS[user.role]?.[fn] ?? NO;
  }
  if (user.access === "READ_ONLY" && p === RW) p = RO;
  return p;
}

/** Stored (or role-default) permission, without the account-level cap — for the settings UI. */
export function getStoredPerm(user: PermUser, fn: FnKey): PermLevel {
  if (user.permsJson) {
    try {
      const p = (JSON.parse(user.permsJson) as Record<string, PermLevel>)[fn];
      if (p && ["NONE", "READ_WRITE", "READ_ONLY"].includes(p)) return p;
    } catch {
      /* fall through to defaults */
    }
  }
  return ROLE_DEFAULTS[user.role]?.[fn] ?? NO;
}
