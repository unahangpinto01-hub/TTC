"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; fn: string };

const NAV: { section: string; items: Item[] }[] = [
  {
    section: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", fn: "dashboard" },
      { href: "/notifications", label: "Notifications", fn: "notifications" },
    ],
  },
  {
    section: "Sales",
    items: [
      { href: "/orders", label: "Order Inbox", fn: "orders" },
      { href: "/sales-orders", label: "Sales Orders", fn: "salesOrders" },
      { href: "/schedule", label: "Delivery Schedule", fn: "schedule" },
      { href: "/deliveries", label: "Delivery Receipts", fn: "deliveries" },
      { href: "/invoicing", label: "For Invoicing", fn: "invoicing" },
      { href: "/invoices", label: "Invoices (SR)", fn: "invoices" },
      { href: "/forecast", label: "Sales Forecast", fn: "forecast" },
      { href: "/customers", label: "Customers", fn: "customers" },
    ],
  },
  {
    section: "Inventory",
    items: [
      { href: "/inventory", label: "Products", fn: "inventory" },
      { href: "/purchase-orders", label: "Purchase Orders", fn: "purchaseOrders" },
      { href: "/suppliers", label: "Suppliers", fn: "suppliers" },
    ],
  },
  {
    section: "Finance",
    items: [
      { href: "/finance/ar", label: "AR / Aging", fn: "ar" },
      { href: "/finance/expenses", label: "Expenses", fn: "expenses" },
      { href: "/finance/ledger", label: "Ledger", fn: "ledger" },
      { href: "/reports", label: "Reports", fn: "reports" },
    ],
  },
  {
    section: "Admin",
    items: [
      { href: "/hr", label: "HR", fn: "hr" },
      { href: "/users", label: "Users", fn: "users" },
      { href: "/company", label: "Company Details", fn: "company" },
    ],
  },
];

/** perms: map of function key -> effective level; NONE entries are hidden. */
export function NavLinks({ perms }: { perms: Record<string, string> }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-6">
      {NAV.map((group) => {
        const items = group.items.filter((i) => perms[i.fn] && perms[i.fn] !== "NONE");
        if (!items.length) return null;
        return (
          <div key={group.section}>
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              {group.section}
            </p>
            <div className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-lg px-2.5 py-1.5 text-sm ${
                      active
                        ? "bg-emerald-800 font-semibold text-white"
                        : "text-emerald-200 hover:bg-emerald-900 hover:text-white"
                    }`}
                  >
                    {item.label}
                    {perms[item.fn] === "READ_ONLY" && <span className="ml-1 text-[9px] text-emerald-400">👁</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
