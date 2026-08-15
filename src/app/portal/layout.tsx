import Link from "next/link";
import { requireDealer } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { CartBadge } from "./cart-ui";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDealer();
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/portal" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">T</div>
            <div>
              <p className="text-sm font-bold leading-tight text-emerald-900">Teamagro</p>
              <p className="text-[10px] text-gray-500">Dealer Portal</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3">
            <Link href="/portal" className="rounded-lg px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">Catalog</Link>
            <Link href="/portal/orders" className="rounded-lg px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">My Orders</Link>
            <Link href="/portal/cart" className="relative rounded-lg px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
              Cart <CartBadge />
            </Link>
            <form action={logout}>
              <button className="btn-secondary" type="submit">Logout</button>
            </form>
          </nav>
        </div>
        <div className="bg-emerald-800 px-4 py-1 text-center text-xs text-emerald-100">
          Signed in as <span className="font-semibold">{user.name}</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
