import { sheetResponse, CUSTOMER_TEMPLATE_HEADERS } from "@/lib/xlsx-helpers";

export async function GET() {
  return sheetResponse(
    [
      CUSTOMER_TEMPLATE_HEADERS,
      ["Santos Agri Supply", "Juan Santos", "0917-123-4567", "Luzon", "Nueva Ecija", "COD,30,60", 200000],
    ],
    "Customers",
    "customer-import-template.xlsx"
  );
}
