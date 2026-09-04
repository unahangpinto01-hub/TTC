/** Central unit conversion for Sales Forecast vs Actual Sales.
 *
 * Liquid products are forecast on the 1,000-ml pack: 1 forecast PC = 1,000 ml.
 * Actual sales of the same product line in other pack sizes convert into that
 * base unit (500ml = 0.5, 250ml = 0.25, 100ml = 0.10, 1Gal = 3.75) before any
 * comparison. Everything reads the pack size straight from the Product Master —
 * nothing is hard-coded per product — and nothing here ever touches inventory,
 * invoice or stock-card quantities: those stay in real pack units.
 */

/** Millilitres in one pack, from the Product Master packSize (e.g. "500ml", "1Gal").
    Returns null for non-liquid packs ("1000g", "3LBS", "Free Size", ...). */
export function packSizeToMl(packSize: string): number | null {
  // the lookahead stops "3LBS" from reading as 3 liters
  const m = packSize.trim().toLowerCase().match(/^([\d.,]+)\s*(ml|gal|l)(?![a-z])/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (m[2] === "ml") return n;
  if (m[2] === "l") return n * 1000;
  return n * 3750; // the catalog's gallon is the 3.75-liter pack (see Glyphosel 480 SL 1gal)
}

/** How many 1,000-ml forecast PCS one actual pack counts as; null when not a liquid. */
export function forecastEquivalentFactor(packSize: string): number | null {
  const ml = packSizeToMl(packSize);
  return ml === null ? null : ml / 1000;
}

/** True for the pack a liquid product line is forecast on (the 1,000-ml pack). */
export function isForecastBasePack(packSize: string): boolean {
  return packSizeToMl(packSize) === 1000;
}

/** Which customer provinces belong to each forecast area, for matching actual
    sales to an area forecast. One place to edit as territories change. */
const AREA_PROVINCES: [RegExp, string[]][] = [
  [/pangasinan/i, ["Pangasinan"]],
  [/mindoro/i, ["Occidental Mindoro", "Oriental Mindoro"]],
  [/palawan/i, ["Palawan"]],
  [/pampanga/i, ["Pampanga"]],
  [/panay|negros/i, ["Iloilo", "Capiz", "Aklan", "Antique", "Guimaras", "Negros Occidental", "Negros Oriental"]],
  [
    /south\s*mindanao/i,
    ["General Santos", "South Cotabato", "Sarangani", "Cotabato", "North Cotabato", "Davao del Sur", "Davao del Norte", "Davao Occidental", "Davao Oriental", "Davao de Oro"],
  ],
];

/** Provinces covered by a forecast's area, or null when the area is not mapped
    (callers then compare against sales from everywhere and should say so). */
export function provincesForArea(area: string): string[] | null {
  for (const [re, provinces] of AREA_PROVINCES) if (re.test(area)) return provinces;
  return null;
}
