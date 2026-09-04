/**
 * Unit conversion for inventory.
 *
 * PCS is the single source of truth for stock: Product.stockQty, StockMovement.qty,
 * and every *.baseQty column are always PCS. CARTON is only a selling/purchasing/display
 * unit, converted through Product.piecesPerCarton. Adding future units (BOX, PALLET, …)
 * means extending this module — transaction code only ever calls these helpers.
 */

export const PCS = "PCS";
export const CARTON = "CARTON";
export const UNITS = [PCS, CARTON] as const;
export type Unit = (typeof UNITS)[number];

type PackagedProduct = { name?: string; piecesPerCarton: number | null };
type PricedProduct = PackagedProduct & { dealerPrice: number; cartonDealerPrice: number | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

export class UnitError extends Error {}

/** Pieces per carton, validated (> 0). Throws UnitError if the product has no valid carton config. */
export function cartonSize(product: PackagedProduct): number {
  const ppc = product.piecesPerCarton;
  if (!ppc || ppc <= 0) {
    throw new UnitError(`${product.name ?? "Product"} has no pieces-per-carton configured — cannot transact in CARTON.`);
  }
  return ppc;
}

/** Convert an entered quantity to base PCS. Throws UnitError for CARTON without a valid conversion. */
export function convertToBaseUnit(quantity: number, unit: string, product: PackagedProduct): number {
  if (unit === CARTON) return quantity * cartonSize(product);
  return quantity; // PCS (and any unknown unit is treated as base — callers validate against UNITS)
}

/** Parse a unit value coming from a form; anything unrecognized is PCS. */
export function parseUnit(raw: unknown): Unit {
  return raw === CARTON ? CARTON : PCS;
}

/** Dealer price for the chosen unit: stored carton override, or PCS price × pieces per carton. */
export function unitDealerPrice(product: PricedProduct, unit: string): number {
  if (unit !== CARTON) return product.dealerPrice;
  return product.cartonDealerPrice ?? round2(product.dealerPrice * cartonSize(product));
}

/** Break a PCS stock figure into complete cartons + loose pieces. Null when no carton config. */
export function cartonBreakdown(stockPcs: number, product: PackagedProduct): { cartons: number; loose: number } | null {
  const ppc = product.piecesPerCarton;
  if (!ppc || ppc <= 0) return null;
  return { cartons: Math.floor(stockPcs / ppc), loose: stockPcs % ppc };
}

/** "89 CTN + 9 PCS" — or null when the product has no carton config. */
export function cartonLabel(stockPcs: number, product: PackagedProduct): string | null {
  const b = cartonBreakdown(stockPcs, product);
  if (!b) return null;
  return b.loose > 0 ? `${b.cartons.toLocaleString()} CTN + ${b.loose} PCS` : `${b.cartons.toLocaleString()} CTN`;
}

/** Short unit tag for line displays: "10 CTN" / "3 PCS". */
export function qtyLabel(qty: number, unit: string): string {
  return `${qty.toLocaleString()} ${unit === CARTON ? "CTN" : "PCS"}`;
}

type WeighedProduct = PackagedProduct & { packGrossWeightKg: number | null };

/** Total gross weight (kg) for a base-PCS quantity: packs × gross weight per pack.
    The pack is the carton when configured (loose pieces weigh proportionally), else one piece.
    Null when the product has no gross weight maintained. */
export function lineGrossWeightKg(baseQty: number, product: WeighedProduct): number | null {
  const w = product.packGrossWeightKg;
  if (!w || w <= 0) return null;
  const ppc = product.piecesPerCarton;
  const packs = ppc && ppc > 0 ? baseQty / ppc : baseQty;
  return packs * w;
}

/** "1,350 kg" display, rounded to 2 decimals. */
export function kgLabel(kg: number): string {
  return `${kg.toLocaleString("en-PH", { maximumFractionDigits: 2 })} kg`;
}

/* ------------------------------------------------------------------ *
 * Carton equivalent — the single source of the CTN figure shown       *
 * anywhere in the system.                                             *
 *                                                                     *
 * CTN is a DISPLAY conversion only. PCS remains the one inventory     *
 * balance; nothing here ever writes stock, and a carton figure must   *
 * never be fed back into a quantity field.                            *
 * ------------------------------------------------------------------ */

/** Pieces per carton for display. Unlike cartonSize() this never throws —
    it returns null so the caller can render "N/A" and flag the product. */
export function displayCartonSize(product: PackagedProduct | null | undefined): number | null {
  const ppc = product?.piecesPerCarton;
  return ppc && ppc > 0 ? ppc : null;
}

/**
 * The conversion that was in force when a transaction line was entered.
 *
 * A line entered in CARTON carries its own factor: baseQty / qty. Using it means an old
 * document keeps the packaging it was written under even after the product master changes
 * (Jakpot! 2.5 EC moved from 60 to 72 per carton — its old documents must still read 60).
 * A line entered in PCS never recorded a factor, so the product's current conversion is
 * the only one available.
 */
export function lineCartonSize(
  line: { qty: number; unit: string; baseQty?: number | null },
  product: PackagedProduct | null | undefined
): number | null {
  if (line.unit === CARTON && line.qty > 0 && line.baseQty && line.baseQty > 0) {
    return line.baseQty / line.qty;
  }
  return displayCartonSize(product);
}

/** Exact carton equivalent of a PCS figure. Null when there is no usable conversion. */
export function ctnEquivalent(basePcs: number, ppc: number | null | undefined): number | null {
  if (!ppc || ppc <= 0) return null; // guards division by zero and unset packaging
  return basePcs / ppc;
}

/** Rounded to 2 dp for display and Excel. The PCS quantity itself is never rounded. */
export function ctnValue(basePcs: number, ppc: number | null | undefined): number | null {
  const e = ctnEquivalent(basePcs, ppc);
  return e === null ? null : Math.round(e * 100) / 100;
}

/** "104.17 CTN" / "100 CTN". Null when the product has no conversion. */
export function ctnLabel(basePcs: number, ppc: number | null | undefined): string | null {
  const e = ctnEquivalent(basePcs, ppc);
  if (e === null) return null;
  return `${e.toLocaleString("en-PH", { maximumFractionDigits: 2 })} CTN`;
}

/** "104 + 2 PCS" — the whole cartons and loose pieces behind the decimal.
    Null when the split is exact or there is no conversion. */
export function ctnLooseLabel(basePcs: number, ppc: number | null | undefined): string | null {
  if (!ppc || ppc <= 0) return null;
  const sign = basePcs < 0 ? "-" : "";
  const abs = Math.abs(basePcs);
  const loose = abs % ppc;
  if (loose === 0) return null;
  return `${sign}${Math.floor(abs / ppc).toLocaleString()} + ${loose} PCS`;
}

/** "1 CTN = 12 PCS", for showing the conversion actually used. */
export function conversionNote(ppc: number | null | undefined): string | null {
  if (!ppc || ppc <= 0) return null;
  return `1 CTN = ${ppc.toLocaleString("en-PH", { maximumFractionDigits: 2 })} PCS`;
}
