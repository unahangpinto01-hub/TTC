import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { allowedCompanies } from "@/lib/company";
import { SALESPERSON_WHERE } from "@/lib/salespeople";

/** One search endpoint behind every autocomplete box in the BMS.
 *
 * Matches from the BEGINNING of the name or code, ignoring case, and returns at
 * most `limit` rows — the browser never loads a whole table. Company-owned
 * records are scoped to the companies the signed-in user is granted; a company
 * filter from the client is honored only when it is one of those.
 */

export type SearchHit = { id: string; label: string; sub?: string; data?: Record<string, unknown> };

const MAX_LIMIT = 50;

const starts = (q: string) => ({ startsWith: q, mode: "insensitive" as const });

export async function GET(req: NextRequest, { params }: { params: { entity: string } }) {
  const user = await getUser();
  if (!user || user.role === "DEALER") return new Response("Unauthorized", { status: 401 });

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get("limit")) || 20));

  // company scope: everything the user may see, narrowed by an optional company param
  const allowed = (await allowedCompanies(user)).map((c) => c.id);
  const askCompany = sp.get("company");
  const companyIds = askCompany && allowed.includes(askCompany) ? [askCompany] : allowed;

  let hits: SearchHit[] = [];

  switch (params.entity) {
    case "customers": {
      // optional salesperson narrowing ("none" = unassigned accounts), used by the forecast grid
      const spFilter = sp.get("salesperson");
      const rows = await prisma.customer.findMany({
        where: {
          status: "Active",
          ...(q ? { businessName: starts(q) } : {}),
          ...(spFilter === "none" ? { salespersonId: null } : spFilter ? { salespersonId: spFilter } : {}),
        },
        select: {
          id: true, businessName: true, province: true, region: true,
          salespersonId: true, salesperson: { select: { name: true } },
        },
        orderBy: { businessName: "asc" },
        take: limit,
      });
      hits = rows.map((r) => ({
        id: r.id,
        label: r.businessName,
        sub: [r.province, r.region, r.salesperson?.name].filter(Boolean).join(" · "),
        data: { salespersonId: r.salespersonId, salesperson: r.salesperson?.name ?? null },
      }));
      break;
    }
    case "suppliers": {
      const rows = await prisma.supplier.findMany({
        where: q ? { name: starts(q) } : {},
        select: { id: true, name: true, contact: true },
        orderBy: { name: "asc" },
        take: limit,
      });
      hits = rows.map((r) => ({ id: r.id, label: r.name, sub: r.contact ?? undefined }));
      break;
    }
    case "products": {
      // line editors need enough detail to compute cartons/prices without a second request
      const rows = await prisma.product.findMany({
        where: {
          companyId: { in: companyIds },
          ...(sp.get("active") === "1" ? { status: "Active" } : {}),
          ...(q ? { OR: [{ name: starts(q) }, { sku: starts(q) }, { parentItem: starts(q) }] } : {}),
        },
        select: {
          id: true, name: true, sku: true, packSize: true, category: true, srp: true,
          dealerPrice: true, cartonDealerPrice: true, unitCost: true,
          piecesPerCarton: true, stockQty: true, companyId: true, company: { select: { companyName: true } },
        },
        orderBy: { name: "asc" },
        take: limit,
      });
      hits = rows.map((r) => ({
        id: r.id,
        label: r.name,
        sub: [r.sku, r.packSize, companyIds.length > 1 ? r.company.companyName : ""].filter(Boolean).join(" · "),
        data: {
          sku: r.sku, packSize: r.packSize, category: r.category, srp: r.srp,
          dealerPrice: r.dealerPrice, cartonDealerPrice: r.cartonDealerPrice, unitCost: r.unitCost,
          piecesPerCarton: r.piecesPerCarton, stockQty: r.stockQty,
          companyId: r.companyId, company: r.company.companyName,
        },
      }));
      break;
    }
    case "employees": {
      const rows = await prisma.employee.findMany({
        where: { status: "Active", ...(q ? { name: starts(q) } : {}) },
        select: { id: true, name: true, position: true },
        orderBy: { name: "asc" },
        take: limit,
      });
      hits = rows.map((r) => ({ id: r.id, label: r.name, sub: r.position || undefined }));
      break;
    }
    case "salespeople": {
      // same qualification rule as every salesperson picker (lib/salespeople.ts)
      const rows = await prisma.employee.findMany({
        where: { ...SALESPERSON_WHERE, ...(q ? { name: starts(q) } : {}) },
        select: { id: true, name: true, position: true },
        orderBy: { name: "asc" },
        take: limit,
      });
      hits = rows.map((r) => ({ id: r.id, label: r.name, sub: r.position || undefined }));
      break;
    }
    case "sales-orders": {
      const rows = await prisma.salesOrder.findMany({
        where: { companyId: { in: companyIds }, ...(q ? { soNumber: starts(q) } : {}) },
        select: { id: true, soNumber: true, status: true, customer: { select: { businessName: true } } },
        orderBy: { soNumber: "desc" },
        take: limit,
      });
      hits = rows.map((r) => ({ id: r.id, label: r.soNumber, sub: `${r.customer.businessName} · ${r.status}` }));
      break;
    }
    case "invoices": {
      const rows = await prisma.salesReceipt.findMany({
        where: {
          companyId: { in: companyIds },
          // open=1 → invoices still carrying a balance; customer narrows to one account
          ...(sp.get("open") === "1" ? { status: { in: ["Open", "Partial"] } } : {}),
          ...(sp.get("customer") ? { customerId: sp.get("customer")! } : {}),
          ...(q ? { srNumber: starts(q) } : {}),
        },
        select: { id: true, srNumber: true, status: true, customer: { select: { businessName: true } } },
        orderBy: { srNumber: "desc" },
        take: limit,
      });
      hits = rows.map((r) => ({ id: r.id, label: r.srNumber, sub: `${r.customer.businessName} · ${r.status}` }));
      break;
    }
    case "purchase-orders": {
      const rows = await prisma.purchaseOrder.findMany({
        where: {
          companyId: { in: companyIds },
          // open=1 → only POs still expecting goods (the Receive Inventory picker)
          ...(sp.get("open") === "1" ? { status: { in: ["Sent", "Partially Received"] } } : {}),
          ...(q ? { poNumber: starts(q) } : {}),
        },
        select: { id: true, poNumber: true, status: true, supplier: { select: { name: true } } },
        orderBy: { poNumber: "desc" },
        take: limit,
      });
      hits = rows.map((r) => ({ id: r.id, label: r.poNumber, sub: `${r.supplier?.name ?? ""} · ${r.status}` }));
      break;
    }
    case "payments": {
      const rows = await prisma.receivePayment.findMany({
        where: {
          companyId: { in: companyIds },
          ...(q ? { OR: [{ prNumber: starts(q) }, { refNo: starts(q) }, { checkNo: starts(q) }] } : {}),
        },
        select: { id: true, prNumber: true, status: true, amount: true, customer: { select: { businessName: true } } },
        orderBy: { prNumber: "desc" },
        take: limit,
      });
      hits = rows.map((r) => ({
        id: r.id,
        label: r.prNumber,
        sub: `${r.customer.businessName} · ₱${r.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })} · ${r.status}`,
      }));
      break;
    }
    case "refunds": {
      const rows = await prisma.refundCredit.findMany({
        where: { companyId: { in: companyIds }, ...(q ? { rcNumber: starts(q) } : {}) },
        select: { id: true, rcNumber: true, type: true, status: true, amount: true, customer: { select: { businessName: true } } },
        orderBy: { rcNumber: "desc" },
        take: limit,
      });
      hits = rows.map((r) => ({
        id: r.id,
        label: r.rcNumber,
        sub: `${r.type} · ${r.customer.businessName} · ₱${r.amount.toLocaleString("en-PH", { minimumFractionDigits: 2 })} · ${r.status}`,
      }));
      break;
    }
    default:
      return new Response("Unknown entity", { status: 404 });
  }

  return Response.json({ hits });
}
