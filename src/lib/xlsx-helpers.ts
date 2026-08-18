import * as XLSX from "xlsx";

export function sheetResponse(rows: (string | number)[][], sheetName: string, filename: string) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
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
  "unitCost", "dealerPrice", "srp", "reorderPoint", "supplier", "openingStock",
];

export const CUSTOMER_TEMPLATE_HEADERS = [
  "businessName", "contactPerson", "mobile", "region", "province", "allowedTerms", "creditLimit",
];
