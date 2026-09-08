"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, requireStepUp } from "@/lib/auth";
import { nextDocNumber, nextOrderNo } from "@/lib/numbering";
import { notifyRoles } from "@/lib/notify";
import { convertToBaseUnit, parseUnit, unitDealerPrice, UnitError } from "@/lib/units";
import { getActiveCompany } from "@/lib/company";
import { orderDeleteBlocker, DELETE_REASON_MIN } from "@/lib/orders";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function encodeOrder(formData: FormData) {
  const actor = await requirePermWrite("orders");
  const company = await getActiveCompany(actor);
  const customerId = String(formData.get("customerId"));
  const source = String(formData.get("source"));
  const term = String(formData.get("term"));
  const notes = String(formData.get("notes") || "").trim() || null;
  const productIds = formData.getAll("productId").map(String);
  const qtys = formData.getAll("qty").map(Number);
  const units = formData.getAll("unit").map(parseUnit);

  const lines = productIds
    .map((pid, i) => ({ productId: pid, qty: Math.floor(qtys[i] || 0), unit: units[i] ?? "PCS" }))
    .filter((l) => l.productId && l.qty > 0);
  if (!lines.length) redirect("/orders/new?error=empty");

  // products must belong to the active company — cross-company lines are rejected outright
  const products = await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) }, companyId: company.id } });
  if (products.length !== new Set(lines.map((l) => l.productId)).size) redirect("/orders/new?error=empty");
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });

  let lineData;
  try {
    lineData = lines.map((l) => {
      const product = products.find((p) => p.id === l.productId)!;
      return {
        productId: l.productId,
        qty: l.qty,
        unit: l.unit,
        baseQty: convertToBaseUnit(l.qty, l.unit, product),
        unitPrice: unitDealerPrice(product, l.unit),
      };
    });
  } catch (e) {
    if (e instanceof UnitError) redirect("/orders/new?error=nocarton");
    throw e;
  }

  // order date from the form — allows encoding a previous transaction (future/blank/invalid fall back to today)
  const dateRaw = String(formData.get("orderDate") || "");
  const parsedDate = dateRaw ? new Date(`${dateRaw}T12:00:00`) : null;
  const orderDate =
    parsedDate && !Number.isNaN(parsedDate.getTime()) && parsedDate.getTime() < Date.now() ? parsedDate : new Date();

  // freight is billed per carton on CARTON lines only — loose PCS lines carry no freight
  const freightPerCarton = Math.max(0, Number(formData.get("freightPerCarton")) || 0);
  const freightCartons = lines.filter((l) => l.unit === "CARTON").reduce((s, l) => s + l.qty, 0);
  const freightTotal = round2(freightPerCarton * freightCartons);

  const order = await prisma.incomingOrder.create({
    data: {
      companyId: company.id,
      orderNo: await nextOrderNo(company.id),
      source,
      customerId,
      term,
      status: "Pending",
      notes,
      orderDate,
      freightPerCarton,
      freightTotal,
      lines: { create: lineData },
    },
  });
  await notifyRoles(["ADMIN", "SUPER_ADMIN"], "NEW_ORDER", `New ${source.toLowerCase()} order encoded for ${customer.businessName}`, `/orders/${order.id}`, company.id);
  redirect(`/orders/${order.id}`);
}

export async function convertToSO(formData: FormData) {
  const user = await requirePermWrite("orders");
  const company = await getActiveCompany(user);
  const orderId = String(formData.get("orderId"));
  const order = await prisma.incomingOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: true, customer: true },
  });
  if (order.companyId !== company.id) redirect("/denied");
  if (order.status !== "Pending") redirect(`/orders/${orderId}`);

  const soNumber = await nextDocNumber("SO", order.companyId);
  const so = await prisma.salesOrder.create({
    data: {
      companyId: order.companyId,
      soNumber,
      customerId: order.customerId,
      incomingOrderId: order.id,
      term: order.term,
      status: "Draft",
      orderDate: order.orderDate, // the SO carries the (possibly backdated) transaction date
      freightCharge: order.freightTotal,
      preparedById: user.id,
      lines: {
        create: order.lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unit: l.unit,
          baseQty: l.baseQty,
          unitPrice: l.unitPrice,
          lineTotal: Math.round(l.qty * l.unitPrice * 100) / 100,
        })),
      },
    },
  });
  await prisma.incomingOrder.update({ where: { id: orderId }, data: { status: "Converted" } });
  await notifyRoles(["ADMIN", "SUPER_ADMIN"], "ORDER_CONVERTED", `${soNumber} created from ${order.customer.businessName}'s order`, `/sales-orders/${so.id}`, order.companyId);
  redirect(`/sales-orders/${so.id}`);
}

/**
 * Permanently delete an incoming order. Super Admin only, and only while the order has
 * produced nothing downstream.
 *
 * Every guard below runs on the server. Hiding the button in the Order Inbox is a
 * convenience for the people who cannot use it — it is not the control. A hand-made POST
 * straight at this action meets exactly the same checks in the same order.
 */
export async function deleteIncomingOrder(formData: FormData) {
  // 1. write access to Orders at all
  const user = await requirePermWrite("orders");
  // 2. and the Super Admin role specifically — an Admin with full write access is refused
  if (user.role !== "SUPER_ADMIN") redirect("/denied");
  // 3. a permanent delete is a sensitive action, so the password/2FA must be fresh,
  //    the same bar the Users and HR modules already set
  await requireStepUp("/orders");

  const company = await getActiveCompany(user);
  const orderId = String(formData.get("orderId"));
  const reason = String(formData.get("reason") || "").trim();

  const order = await prisma.incomingOrder.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { businessName: true } },
      company: { select: { companyName: true } },
      lines: { select: { qty: true, unitPrice: true } },
      salesOrders: { select: { soNumber: true } },
    },
  });
  // company isolation: another company's order is not visible even by direct id
  if (!order || order.companyId !== company.id) redirect("/orders?error=missing");

  // 4. the downstream check — converted, invoiced, or linked in any way blocks the delete
  const blocker = orderDeleteBlocker(order);
  if (blocker) redirect(`/orders/${orderId}?error=linked`);

  // 5. the reason is what makes the audit entry worth keeping
  if (reason.length < DELETE_REASON_MIN) redirect(`/orders/${orderId}?error=reason`);

  const amount = round2(order.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) + order.freightTotal);
  const label = order.orderNo ?? orderId.slice(-6);

  // the entry and the deletion commit together: no record of an order that is still here,
  // and no order vanishing without a record
  await prisma.$transaction([
    prisma.auditLog.create({
      data: {
        entity: "IncomingOrder",
        entityId: orderId,
        action: "DELETED",
        detail: `${label} · ${order.customer.businessName} · ${order.company.companyName} · ${order.lines.length} line(s) · ${amount.toLocaleString("en-PH", { style: "currency", currency: "PHP" })}`,
        actorName: user.name,
        actorEmail: user.email,
        companyId: order.companyId,
        reason,
        // the order itself is gone after this, so everything the audit screen needs to
        // describe it has to be captured here
        meta: JSON.stringify({
          orderNo: order.orderNo,
          customer: order.customer.businessName,
          company: order.company.companyName,
          source: order.source,
          term: order.term,
          status: order.status,
          lines: order.lines.length,
          amount,
          orderDate: order.orderDate.toISOString(),
          encodedAt: order.createdAt.toISOString(),
        }),
      },
    }),
    // IncomingOrderLine cascades on delete, so the lines go with it
    prisma.incomingOrder.delete({ where: { id: orderId } }),
  ]);

  revalidatePath("/orders");
  revalidatePath("/orders/deleted");
  redirect(`/orders?deleted=${encodeURIComponent(label)}`);
}

export async function cancelIncoming(formData: FormData) {
  const actor = await requirePermWrite("orders");
  const company = await getActiveCompany(actor);
  const orderId = String(formData.get("orderId"));
  await prisma.incomingOrder.updateMany({ where: { id: orderId, companyId: company.id }, data: { status: "Cancelled" } });
  revalidatePath("/orders");
  redirect("/orders");
}
