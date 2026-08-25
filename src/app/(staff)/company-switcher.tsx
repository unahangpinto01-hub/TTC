"use client";

import { useTransition } from "react";
import { switchCompany } from "./company-actions";

export function CompanySwitcher({
  companies,
  activeId,
}: {
  companies: { id: string; companyName: string }[];
  activeId: string;
}) {
  const [pending, start] = useTransition();
  if (companies.length <= 1) {
    return (
      <p className="truncate px-4 pb-2 text-[11px] font-semibold text-emerald-300">
        {companies[0]?.companyName ?? ""}
      </p>
    );
  }
  return (
    <div className="px-3 pb-3">
      <label className="mb-1 block px-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
        Current Company
      </label>
      <select
        value={activeId}
        disabled={pending}
        onChange={(e) => start(() => switchCompany(e.target.value))}
        className="w-full rounded-lg border border-emerald-800 bg-emerald-900 px-2 py-1.5 text-sm font-semibold text-white"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.companyName}</option>
        ))}
      </select>
    </div>
  );
}
