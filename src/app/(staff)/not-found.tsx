import Link from "next/link";
import { getActiveCompany } from "@/lib/company";
import { getUser } from "@/lib/auth";

/**
 * Records are isolated per company, so a link to one belonging to another company is a 404
 * here — which reads as "it does not exist" when the real answer is "not in this company".
 * This says so without confirming whether any particular record exists.
 */
export default async function StaffNotFound() {
  const user = await getUser();
  const company = user ? await getActiveCompany(user).catch(() => null) : null;

  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <p className="text-5xl font-bold text-gray-300">404</p>
      <h1 className="mt-3 text-xl font-semibold">This page could not be found.</h1>
      <p className="mt-3 text-sm text-gray-600">
        If you followed a link to an order, delivery, invoice, product or purchase order, it may belong to a different
        company. Records are kept separate per company
        {company ? (
          <>
            {" "}and you are currently in <strong>{company.companyName}</strong>{" "}
          </>
        ) : (
          " "
        )}
        — switch company at the top of the sidebar and try the link again.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/dashboard" className="btn-primary">Go to Dashboard</Link>
        <Link href="/customers" className="btn-secondary">Customers</Link>
      </div>
    </div>
  );
}
