import { sheetResponse, PRODUCT_TEMPLATE_HEADERS } from "@/lib/xlsx-helpers";

export async function GET() {
  return sheetResponse(
    [
      PRODUCT_TEMPLATE_HEADERS,
      ["INS-101", "AgroShield 5 EC Insecticide 500ml", "Cypermethrin", "Insecticide", "Rice,Corn", "500ml", 250, 312.5, 359.38, 15, "AgChem Solutions Inc.", 100],
    ],
    "Products",
    "product-import-template.xlsx"
  );
}
