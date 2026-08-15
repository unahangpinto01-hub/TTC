import { requireDealer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CartView } from "./cart-view";

export default async function CartPage() {
  const user = await requireDealer();
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: user.customerId } });
  return <CartView allowedTerms={customer.allowedTerms.split(",")} />;
}
