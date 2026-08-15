"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; roles?: string[] };

const NAV: { section: string; items: Item[] }[] = [
  {
    section: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/notifications", label: "Notifications" },
    ],
  },
  {
    section: "Sales",
    items: [
      { href: "/orders", label: "Order Inbox" },
      { href: "/sales-orders", label: "Sales Orders" },
      { href: "/schedule", label: "Delivery Schedule" },
      { href: "/deliveries", label: "Delivery Receipts" },
      { href: "/invoicing", label: "For Invoicing", roles: ["SUPER_ADMIN", "ADMIN"] },
      { href: "/invoices", label: "Invoices (SR)" },
      { href: "/customers", label: "Customers" },
    ],
  },
  {
    section: "Inventory",
    items: [
      { href: "/inventory", label: "Products" },
      { href: "/purchase-orders", label: "Purchase Orders" },
      { href: "/suppliers", label: "Suppliers" },
    ],
  },
  {
    section: "Finance",
    items: [
      { href: "/finance/ar", label: "AR / Aging", roles: ["SUPER_ADMIN", "ADMIN"] },
      { href: "/finance/expenses", label: "Expenses", roles: ["SUPER_ADMIN", "ADMIN"] },
      { href: "/finance/ledger", label: "Ledger", roles: ["SUPER_ADMIN", "ADMIN"] },
      { href: "/reports", label: "Reports", roles: ["SUPER_ADMIN", "ADMIN"] },
    ],
  },
  {
    section: "Admin",
    items: [
      { href: "/hr", label: "HR", roles: ["SUPER_ADMIN", "ADMIN"] },
      { href: "/users", label: "Users", roles: ["SUPER_ADMIN"] },
    ],
  },
];

export function NavLinks({ role }: { role: string }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-6">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.roles || i.roles.includes(role));
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
