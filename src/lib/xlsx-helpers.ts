import * as XLSX from "xlsx";

export type SheetStyle = {
  /** column widths in characters, by column index */
  colWidths?: number[];
  /** number formats applied per column from a starting row (0-based), e.g. peso or thousands */
  numFmts?: { col: number; fmt: string; fromRow?: number }[];
};

export const PESO_FMT = '"₱"#,##0.00';
export const QTY_FMT = "#,##0";

export function sheetResponse(rows: (string | number)[][], sheetName: string, filename: string, style?: SheetStyle) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (style?.colWidths) ws["!cols"] = style.colWidths.map((wch) => ({ wch }));
  for (const { col, fmt, fromRow = 0 } of style?.numFmts ?? []) {
    for (let r = fromRow; r < rows.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
      if (cell && typeof cell.v === "number") cell.z = fmt;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function parseUpload(file: File): Promise<Record<string, any>[]> {
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

export const PRODUCT_TEMPLATE_HEADERS = [
  "sku", "name", "parentItem", "activeIngredient", "category", "cropTags", "packSize",
  "piecesPerCarton", "unitCost", "dealerPrice", "cartonDealerPrice", "srp", "reorderPoint", "supplier", "openingStock",
];

export const CUSTOMER_TEMPLATE_HEADERS = [
  "businessName", "contactPerson", "mobile", "region", "province", "allowedTerms", "creditLimit",
];
