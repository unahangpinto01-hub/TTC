import { UnitError } from "./units";

type Tx = {
  stockMovement: {
    findMany: (args: any) => Promise<{ id: string; type: string; qty: number; balanceAfter: number }[]>;
    update: (args: any) => Promise<unknown>;
  };
  product: { update: (args: any) => Promise<unknown> };
};

/** Recompute a product's whole stock-card chain in effective-date order and set its stock on hand.
    Needed whenever a movement is inserted with a backdated effective date.
    Throws UnitError("negative") if any point in history would go below zero. */
export async function recomputeStockChain(tx: Tx, productId: string): Promise<number> {
  const moves = await tx.stockMovement.findMany({
    where: { productId },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  let bal = 0;
  for (const m of moves) {
    bal += m.type === "OUT" ? -m.qty : m.qty; // IN/ADJUST are signed; OUT stores positive qty
    if (bal < 0) throw new UnitError("negative");
    if (m.balanceAfter !== bal) await tx.stockMovement.update({ where: { id: m.id }, data: { balanceAfter: bal } });
  }
  await tx.product.update({ where: { id: productId }, data: { stockQty: bal } });
  return bal;
}

/** Parse a date-input value into an effective timestamp: backdated days land at end-of-day,
    blank/invalid/future resolve to right now. */
export function parseEffectiveDate(raw: string): Date {
  if (raw) {
    const d = new Date(`${raw}T23:59:59.999`);
    if (!Number.isNaN(d.getTime()) && d.getTime() < Date.now()) return d;
  }
  return new Date();
}
