/**
 * One rule for whether an incoming order may be permanently deleted.
 *
 * The Order Inbox reads it to decide whether to offer the button, and the delete action
 * reads it again before touching anything — so hiding the button and refusing the request
 * can never disagree with each other.
 */

/** An order is only ever deletable while it has produced nothing downstream. */
export const DELETABLE_ORDER_STATUSES = ["Pending", "Cancelled"];

export type DeletableOrder = {
  status: string;
  salesOrders: { soNumber?: string }[];
};

/** null = deletable. A string = the reason it is not, ready to show the user. */
export function orderDeleteBlocker(order: DeletableOrder): string | null {
  if (order.salesOrders.length > 0) {
    const refs = order.salesOrders.map((s) => s.soNumber).filter(Boolean).join(", ");
    // a converted order stays linked even if that sales order was later cancelled —
    // the trail from the sales order back to its origin must not be broken
    return `This order cannot be deleted — it is already linked to sales order ${refs || "downstream"}.`;
  }
  if (!DELETABLE_ORDER_STATUSES.includes(order.status)) {
    return `This order cannot be deleted — only a ${DELETABLE_ORDER_STATUSES.join(" or ")} order may be removed, and this one is ${order.status}.`;
  }
  return null;
}

export function canDeleteOrder(order: DeletableOrder): boolean {
  return orderDeleteBlocker(order) === null;
}

/**
 * An order may only be amended while it is still sitting in the inbox.
 *
 * Once it has been converted, the figures have been acted on downstream and changing them
 * here would leave the order and its sales order disagreeing with nothing to say why.
 * A cancelled order is history and is not reopened by editing it either.
 */
export function orderEditBlocker(order: DeletableOrder): string | null {
  if (order.salesOrders.length > 0) {
    const refs = order.salesOrders.map((s) => s.soNumber).filter(Boolean).join(", ");
    return `This order can no longer be edited — it was converted to sales order ${refs || "downstream"}. Make the correction there while it is still a Draft.`;
  }
  if (order.status !== "Pending") {
    return `This order can no longer be edited — only a Pending order may be changed, and this one is ${order.status}.`;
  }
  return null;
}

export function canEditOrder(order: DeletableOrder): boolean {
  return orderEditBlocker(order) === null;
}

/** A permanent delete must be accounted for, so the reason is not optional. */
export const DELETE_REASON_MIN = 5;
