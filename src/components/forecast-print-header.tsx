/** Report header for printed forecasts — appears once, only on paper/PDF. */
export function ForecastPrintHeader({
  companies,
  title,
  period,
}: {
  /** company name, or both names joined for a shared/combined forecast */
  companies: string;
  title: string;
  period: string;
}) {
  const generated = new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "long",
    timeStyle: "short",
  });
  return (
    <div className="mb-3 hidden border-b-2 border-gray-800 pb-2 print:block">
      <p className="text-sm font-semibold uppercase tracking-wide text-gray-700">{companies}</p>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-sm text-gray-600">
        Forecast Period: {period} · Date Generated: {generated}
      </p>
    </div>
  );
}
