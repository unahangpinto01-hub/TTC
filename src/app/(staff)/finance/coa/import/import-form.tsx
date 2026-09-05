"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { importGLAccounts, type ImportRow } from "../actions";

type PreviewRow = ImportRow & { row: number; problem: string | null; exists: boolean };

/** Import the masterlist Excel: parse in the browser, validate, PREVIEW, then commit.
    Nothing is written until "Import" is pressed, and existing codes are only overwritten
    when that authorization is explicitly ticked. */
export function ImportForm({ existingCodes }: { existingCodes: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const existing = new Set(existingCodes);

  const parse = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    const wb = XLSX.read(await file.arrayBuffer());
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null });
    // find the header row (contains "Cost Center" or "Code"), data follows it
    const headerIdx = raw.findIndex((r) => (r ?? []).some((c) => /cost center|account code/i.test(String(c ?? ""))));
    const seen = new Set<string>();
    const out: PreviewRow[] = [];
    for (let i = headerIdx + 1; i < raw.length; i++) {
      const [code, desc, fs, group] = raw[i] ?? [];
      if (code == null && desc == null) continue;
      if (code != null && desc == null) continue; // section-header codes carry no account
      const r: PreviewRow = {
        row: i + 1,
        code: String(code ?? "").trim(),
        description: String(desc ?? "").trim(),
        statement: String(fs ?? "").trim(),
        group: String(group ?? "").trim(),
        problem: null,
        exists: false,
      };
      if (!r.code) r.problem = "missing account code";
      else if (!r.description) r.problem = "missing description";
      else if (!["BS", "IS"].includes(r.statement)) r.problem = `invalid financial statement "${r.statement}" (must be BS or IS)`;
      else if (!r.group) r.problem = "missing account group";
      else if (seen.has(r.code)) r.problem = "duplicate code inside the file (first occurrence wins)";
      if (!r.problem) seen.add(r.code);
      r.exists = existing.has(r.code);
      out.push(r);
    }
    setRows(out);
  };

  const good = rows.filter((r) => !r.problem);
  const bad = rows.filter((r) => r.problem);
  const clashes = good.filter((r) => r.exists);

  const commit = async () => {
    setBusy(true);
    const res = await importGLAccounts({
      rows: good.map(({ code, description, statement, group }) => ({ code, description, statement, group })),
      overwrite,
    });
    setBusy(false);
    setResult(`Imported: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped.`);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <label className="label">Masterlist Excel (.xlsx — columns: Cost Center · GL Description · Financial Statement · Group)</label>
        <input
          type="file"
          accept=".xlsx,.xls"
          className="input"
          onChange={(e) => e.target.files?.[0] && parse(e.target.files[0])}
        />
        {fileName && <p className="mt-1 text-xs text-gray-500">{fileName} — {rows.length} account row(s) read</p>}
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-emerald-100 px-3 py-1">Valid: <b>{good.length}</b></span>
            <span className={`rounded-full px-3 py-1 ${bad.length ? "bg-red-100 text-red-700" : "bg-gray-100"}`}>Errors: <b>{bad.length}</b></span>
            <span className={`rounded-full px-3 py-1 ${clashes.length ? "bg-amber-100 text-amber-800" : "bg-gray-100"}`}>Already in COA: <b>{clashes.length}</b></span>
          </div>

          {bad.length > 0 && (
            <div className="card border-red-200 p-3">
              <p className="mb-1 text-sm font-semibold text-red-700">These rows will NOT be imported:</p>
              <ul className="max-h-40 space-y-0.5 overflow-auto text-xs text-red-600">
                {bad.map((r) => <li key={r.row}>Row {r.row}: {r.code || "(no code)"} {r.description} — {r.problem}</li>)}
              </ul>
            </div>
          )}

          <div className="card max-h-[420px] overflow-auto p-0">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Code</th><th className="table-th">Description</th><th className="table-th">FS</th><th className="table-th">Group</th><th className="table-th">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {good.map((r) => (
                  <tr key={r.row} className={r.exists ? "bg-amber-50/60" : ""}>
                    <td className="table-td font-mono">{r.code}</td>
                    <td className="table-td">{r.description}</td>
                    <td className="table-td">{r.statement}</td>
                    <td className="table-td">{r.group}</td>
                    <td className="table-td">{r.exists ? (overwrite ? "will update" : "kept as-is") : "new"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              Authorize overwriting the {clashes.length} existing account(s) with the file&rsquo;s description/classification
            </label>
            <button onClick={commit} disabled={busy || !good.length} className="btn-primary" type="button">
              {busy ? "Importing…" : `Import ${good.length} account(s)`}
            </button>
            {result && <span className="text-sm font-semibold text-emerald-700">✔ {result}</span>}
          </div>
        </>
      )}
    </div>
  );
}
