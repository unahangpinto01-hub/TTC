"use client";

import { useEffect, useState } from "react";
import { DvSheet, type DvSheetData } from "@/components/dv-sheet";
import { amountInWords } from "@/lib/dv-words";

/**
 * The voucher as it will print, redrawn from the form above it as the clerk types. It reads
 * the form's fields directly (payee, date, terms, particulars, pad DVN, the bill allocations
 * and the account lines), so any field changes the sheet at once — no save needed to see it.
 */
export function DvPreview({ formId, base }: { formId: string; base: DvSheetData }) {
  const [data, setData] = useState<DvSheetData>(base);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const read = () => {
      const fd = new FormData(form);
      const str = (k: string) => String(fd.get(k) ?? "").trim();
      const nums = (k: string) => fd.getAll(k).map((v) => Number(v) || 0);
      const strs = (k: string) => fd.getAll(k).map((v) => String(v ?? "").trim());
      // bill allocations: label from the row's data attribute, amount from its input
      const items: { label: string; amount: number }[] = [];
      const allocInputs = form.querySelectorAll<HTMLInputElement>("input[name=alloc]");
      allocInputs.forEach((inp) => {
        const amount = Number(inp.value) || 0;
        const label = inp.closest("tr")?.getAttribute("data-label") ?? "";
        if (amount > 0) items.push({ label, amount });
      });
      // the voucher's own items: description and (signed) amount from their inputs
      const itemInputs = form.querySelectorAll<HTMLInputElement>("input[name=itemAmount]");
      itemInputs.forEach((inp) => {
        const amount = Number(inp.value) || 0;
        const row = inp.closest("tr");
        const label = (row?.querySelector<HTMLInputElement>("input[name=itemDescription]")?.value ?? row?.getAttribute("data-item-label") ?? "").trim();
        if (amount !== 0 || label) items.push({ label: label || "(item)", amount });
      });
      const amount = allocInputs.length || itemInputs.length ? Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100 : base.amount;
      const titles = strs("lineTitle"), debits = nums("lineDebit"), credits = nums("lineCredit");
      const lines = titles.map((t, i) => ({ title: t, debit: debits[i] || 0, credit: credits[i] || 0 })).filter((l) => l.title || l.debit || l.credit);
      const pickedName = () => {
        const hidden = [...form.querySelectorAll<HTMLInputElement>("input[name=supplierId], input[name=employeeId]")].find((h) => h.value);
        return hidden?.parentElement?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.value?.trim() ?? "";
      };
      const rawDate = str("date");
      const date = rawDate ? new Date(`${rawDate}T12:00:00`).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" }) : base.date;
      setData({
        ...base,
        // no name typed: the supplier or employee just picked, as their search box shows it
        payee: str("payee") || pickedName() || base.payee,
        date,
        terms: form.querySelector("[name=terms]") ? str("terms") : base.terms,
        particulars: form.querySelector("[name=particulars]") ? str("particulars") : base.particulars,
        padRef: form.querySelector("[name=padRef]") ? str("padRef") || null : base.padRef,
        items: allocInputs.length || itemInputs.length ? items : base.items,
        amount,
        amountInWords: amountInWords(Math.max(0, amount)),
        lines: lines.length || form.querySelector("[name=lineTitle]") ? lines : base.lines,
      });
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    // search boxes set their hidden inputs without firing an event on the form — poll lightly
    const t = setInterval(read, 500);
    return () => { form.removeEventListener("input", read); form.removeEventListener("change", read); clearInterval(t); };
  }, [formId, base]);

  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3">
      <p className="mb-2 text-xs text-gray-500">
        <span className="font-semibold text-gray-700">Voucher preview</span> — redrawn as you type; this is what prints. Every box is the size of the paper form, so long
        text steps down in size rather than spilling over.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
        <DvSheet d={data} compact />
      </div>
    </div>
  );
}
