import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FUNCTIONS, getPerm } from "@/lib/permissions";
import { logout } from "@/app/login/actions";
import { NavLinks } from "./nav-links";
import { Clock } from "./clock";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // allowUnenrolled: the layout also wraps /account/security itself — enrollment enforcement
  // happens in each page's own guard (requirePerm/requireStaff), avoiding a redirect loop
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const perms = Object.fromEntries(FUNCTIONS.map(([key]) => [key, getPerm(user, key)]));
  const unread = await prisma.notification.count({
    where: {
      readAt: null,
      OR: [{ userId: user.id }, { role: user.role }],
    },
  });

  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-56 shrink-0 flex-col bg-emerald-950 text-emerald-100 md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
            T
          </div>
          <div>
            <p className="text-sm font-bold leading-tight text-white">Teamagro</p>
            <p className="text-[10px] text-emerald-300">Trading Corp. BMS</p>
          </div>
        </div>
        <NavLinks perms={perms} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
          <div className="md:hidden">
            <Link href="/dashboard" className="font-bold text-emerald-800">
              Teamagro BMS
            </Link>
          </div>
          <div className="hidden md:block">
            <Clock />
          </div>
          <div className="flex items-center gap-3">
            <Link href="/notifications" className="relative rounded-full p-2 hover:bg-gray-100" title="Notifications">
              <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{user.name}</p>
              <p className="text-xs text-gray-500">
                {user.role.replace("_", " ")}
                {user.access === "READ_ONLY" && (
                  <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">READ ONLY</span>
                )}
              </p>
            </div>
            <form action={logout}>
              <button className="btn-secondary" type="submit">
                Logout
              </button>
            </form>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
