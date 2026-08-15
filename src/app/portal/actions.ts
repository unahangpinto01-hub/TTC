"use server";

import { prisma } from "@/lib/db";
import { requireDealer } from "@/lib/auth";
import { notifyRoles } from "@/lib/notify";

export async function placePortalOrder(input: {
  items: { id: string; qty: number }[];
  term: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string; orderId?: string }> {
  const user = await requireDealer();
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: user.customerId } });

  const allowed = customer.allowedTerms.split(",");
  if (!allowed.includes(input.term)) return { ok: false, error: "Payment term not allowed for your account." };

  const items = input.items.filter((i) => i.qty > 0);
  if (!items.length) return { ok: false, error: "Cart is empty." };

  const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.id) } } });
  if (products.length !== items.length) return { ok: false, error: "Some products are no longer available." };

  const order = await prisma.incomingOrder.create({
    data: {
      source: "PORTAL",
      customerId: customer.id,
      term: input.term,
      status: "Pending",
      notes: input.notes?.trim() || null,
      lines: {
        create: items.map((i) => ({
          productId: i.id,
          qty: Math.floor(i.qty),
          unitPrice: products.find((p) => p.id === i.id)!.dealerPrice,
        })),
      },
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
