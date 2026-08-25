import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveCompany, allowedCompanies } from "@/lib/company";
import { FUNCTIONS, getPerm } from "@/lib/permissions";
import { logout } from "@/app/login/actions";
import { NavLinks } from "./nav-links";
import { CompanySwitcher } from "./company-switcher";
import { Clock } from "./clock";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // allowUnenrolled: the layout also wraps /account/security itself — enrollment enforcement
  // happens in each page's own guard (requirePerm/requireStaff), avoiding a redirect loop
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const [companies, active] = await Promise.all([allowedCompanies(user), getActiveCompany(user)]);
  const perms = Object.fromEntries(FUNCTIONS.map(([key]) => [key, getPerm(user, key)]));
  // HR / payroll / employees exist only for the primary company
  if (!active.isPrimary) {
    perms.hr = "NONE";
  }
  const unread = await prisma.notification.count({
    where: {
      readAt: null,
      OR: [{ userId: user.id }, { role: user.role }],
      AND: [{ OR: [{ companyId: active.id }, { companyId: null }] }],
    },
  });
  const initial = (active.companyName || "C").charAt(0).toUpperCase();
  const [firstWord, ...restWords] = (active.companyName || "Company").split(" ");

  return (
    <div className="flex min-h-screen">
      <aside className="no-print hidden w-56 shrink-0 flex-col bg-emerald-950 text-emerald-100 md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          {active.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={active.logoDataUrl} alt="" className="h-8 w-8 shrink-0 rounded-full bg-white object-contain" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-white">{firstWord}</p>
            <p className="truncate text-[10px] text-emerald-300">{restWords.join(" ") || "BMS"}</p>
          </div>
        </div>
        <CompanySwitcher companies={companies.map((c) => ({ id: c.id, companyName: c.companyName }))} activeId={active.id} />
        <NavLinks perms={perms} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
          <div className="md:hidden">
            <Link href="/dashboard" className="font-bold text-emerald-800">
              {active.companyName || "BMS"}
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
