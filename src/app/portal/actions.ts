"use server";

import { prisma } from "@/lib/db";
import { requireDealer } from "@/lib/auth";
import { notifyRoles } from "@/lib/notify";
import { convertToBaseUnit, parseUnit, unitDealerPrice, UnitError } from "@/lib/units";

export async function placePortalOrder(input: {
  items: { id: string; qty: number; unit?: string }[];
  term: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string; orderId?: string }> {
  const user = await requireDealer();
  if (user.access === "READ_ONLY") {
    return { ok: false, error: "Your account is read-only — orders cannot be placed. Contact Teamagro." };
  }
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: user.customerId } });

  const allowed = customer.allowedTerms.split(",");
  if (!allowed.includes(input.term)) return { ok: false, error: "Payment term not allowed for your account." };

  const items = input.items.filter((i) => i.qty > 0);
  if (!items.length) return { ok: false, error: "Cart is empty." };

  const products = await prisma.product.findMany({ where: { id: { in: [...new Set(items.map((i) => i.id))] } } });
  if (new Set(items.map((i) => i.id)).size !== products.length) return { ok: false, error: "Some products are no longer available." };

  let lineData;
  try {
    lineData = items.map((i) => {
      const product = products.find((p) => p.id === i.id)!;
      const unit = parseUnit(i.unit);
      const qty = Math.floor(i.qty);
      return {
        productId: i.id,
        qty,
        unit,
        baseQty: convertToBaseUnit(qty, unit, product),
        unitPrice: unitDealerPrice(product, unit), // price per selected unit, always from server data
      };
    });
  } catch (e) {
    if (e instanceof UnitError) return { ok: false, error: e.message };
    throw e;
  }

  const order = await prisma.incomingOrder.create({
    data: {
      source: "PORTAL",
      customerId: customer.id,
      term: input.term,
      status: "Pending",
      notes: input.notes?.trim() || null,
      lines: { create: lineData },
    },
  });

  await notifyRoles(
    ["CLERK", "ADMIN", "SUPER_ADMIN"],
    "NEW_ORDER",
    `New portal order from ${customer.businessName} (${items.length} items)`,
    `/orders/${order.id}`
  );

  return { ok: true, orderId: order.id };
}
