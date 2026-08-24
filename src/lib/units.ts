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
