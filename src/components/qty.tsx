import { ctnLabel, ctnLooseLabel, conversionNote } from "@/lib/units";

/**
 * Carton equivalent display. Every screen and report renders the CTN figure through
 * these, so the number is identical everywhere and there is exactly one place to change
 * the format. They are plain functions — safe in server and client components alike.
 *
 * PCS stays the real quantity; nothing here is ever written back to inventory.
 */

/** "N/A" plus a flag, for a product with no packaging conversion maintained. */
export function NoConversion({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="whitespace-nowrap text-amber-700"
      title="No pieces-per-carton set on this product — complete its packaging setup in Product Details."
    >
      N/A{compact ? "" : " "}
      <span className="text-xs">⚠</span>
    </span>
  );
}

/**
 * The equivalent-carton cell: the exact decimal, with the whole cartons and loose
 * pieces beneath it when the division is not even.
 */
export function CtnEquiv({
  basePcs,
  ppc,
  showLoose = true,
  className = "",
}: {
  basePcs: number;
  ppc: number | null | undefined;
  showLoose?: boolean;
  className?: string;
}) {
  const label = ctnLabel(basePcs, ppc);
  if (label === null) return <NoConversion />;
  const loose = showLoose ? ctnLooseLabel(basePcs, ppc) : null;
  return (
    <span className={`whitespace-nowrap ${className}`} title={conversionNote(ppc) ?? undefined}>
      {label}
      {loose && <span className="block text-xs font-normal text-gray-500">{loose}</span>}
    </span>
  );
}

/** PCS on top (the primary quantity), the carton equivalent underneath in grey. */
export function QtyCtn({
  basePcs,
  ppc,
  suffix = "",
  className = "",
}: {
  basePcs: number;
  ppc: number | null | undefined;
  /** appended to the PCS figure, e.g. " PCS" */
  suffix?: string;
  className?: string;
}) {
  const label = ctnLabel(basePcs, ppc);
  const loose = ctnLooseLabel(basePcs, ppc);
  return (
    <span className={`whitespace-nowrap ${className}`} title={conversionNote(ppc) ?? undefined}>
      {basePcs.toLocaleString()}
      {suffix}
      <span className="block text-xs font-normal text-gray-500">
        {label ?? <NoConversion compact />}
        {loose && <span className="block">{loose}</span>}
      </span>
    </span>
  );
}

/**
 * A transaction line's quantity: what was entered stays the headline figure and the
 * equivalent in the other unit sits beneath it. The entered quantity is never altered.
 *
 * `ppc` should come from lineCartonSize(), so a document written under an older
 * packaging conversion keeps reading in that conversion.
 */
export function LineQty({
  qty,
  unit,
  basePcs,
  ppc,
}: {
  qty: number;
  unit: string;
  basePcs?: number | null;
  ppc: number | null | undefined;
}) {
  const inCartons = unit === "CARTON";
  const pcs = basePcs ?? qty;
  return (
    <span className="whitespace-nowrap" title={conversionNote(ppc) ?? undefined}>
      <span className="font-medium">
        {qty.toLocaleString()} {inCartons ? "CTN" : "PCS"}
      </span>
      <span className="block text-xs font-normal text-gray-500">
        {inCartons ? (
          <>= {pcs.toLocaleString()} PCS</>
        ) : ctnLabel(pcs, ppc) ? (
          <>= {ctnLabel(pcs, ppc)}</>
        ) : (
          <NoConversion compact />
        )}
      </span>
    </span>
  );
}
