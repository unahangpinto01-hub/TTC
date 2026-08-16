import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { createEvaluation } from "../actions";
import { HrTabs } from "../hr-tabs";

const CRITERIA = ["punctuality", "quality", "teamwork", "initiative"];

export default async function EvaluationsPage() {
  await requirePerm("hr");
  const [evals, employees] = await Promise.all([
    prisma.evaluation.findMany({ orderBy: { createdAt: "desc" }, include: { employee: true, evaluator: true } }),
    prisma.employee.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader title="Performance Evaluations" />
      <HrTabs />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {evals.map((ev) => {
            const scores = JSON.parse(ev.scoresJson) as Record<string, number>;
            const avg = Object.values(scores).reduce((s, v) => s + v, 0) / Object.values(scores).length;
            return (
              <div key={ev.id} className="card">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{ev.employee.name} <span className="text-sm font-normal text-gray-500">· {ev.period}</span></p>
                    <p className="text-xs text-gray-400">Evaluated by {ev.evaluator?.name ?? "—"} on {fmtDate(ev.createdAt)}</p>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-sm font-bold ${avg >= 4 ? "bg-emerald-100 text-emerald-800" : avg >= 3 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                    {avg.toFixed(1)} / 5
                  </div>
                </div>
                <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Object.entries(scores).map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center">
                      <p className="text-[10px] uppercase tracking-wide text-gray-500">{k}</p>
                      <p className="font-bold">{v}</p>
                    </div>
                  ))}
                </div>
                {ev.remarks && <p className="text-sm text-gray-600">“{ev.remarks}”</p>}
              </div>
            );
          })}
          {!evals.length && <p className="card p-8 text-center text-sm text-gray-500">No evaluations yet.</p>}
        </div>

        <form action={createEvaluation} className="card h-fit space-y-3">
          <h2 className="font-semibold">New Evaluation</h2>
          <div>
            <label className="label">Employee</label>
            <select name="employeeId" className="input">
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div><label className="label">Period</label><input name="period" required className="input" placeholder="H2 2026" /></div>
          {CRITERIA.map((c) => (
            <div key={c}>
              <label className="label capitalize">{c} (1–5)</label>
              <select name={`score_${c}`} className="input" defaultValue="3">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          ))}
          <div><label className="label">Remarks</label><textarea name="remarks" rows={2} className="input" /></div>
          <button className="btn-primary" type="submit">Save Evaluation</button>
        </form>
      </div>
    </div>
  );
}
