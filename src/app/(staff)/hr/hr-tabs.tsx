"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/hr", label: "Employees" },
  { href: "/hr/payroll", label: "Payroll" },
  { href: "/hr/evaluations", label: "Evaluations" },
];

export function HrTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-4 flex gap-1 border-b border-gray-200">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${active ? "border-emerald-600 text-emerald-800" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
