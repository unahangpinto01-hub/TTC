import { requireStaff } from "@/lib/auth";
import { StepUpForm } from "./step-up-form";

export default async function StepUpPage({ searchParams }: { searchParams: { next?: string } }) {
  const user = await requireStaff();
  const next = searchParams.next && searchParams.next.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : "/dashboard";
  return (
    <div className="mx-auto max-w-md">
      <div className="card mt-10">
        <h1 className="mb-1 text-lg font-bold">Confirm it&apos;s you</h1>
        <p className="mb-4 text-sm text-gray-500">
          This is a sensitive area, so we need a fresh confirmation
          {user.twoFactorEnabled ? " — enter your current authenticator code." : " — re-enter your password."}
        </p>
        <StepUpForm next={next} useTotp={user.twoFactorEnabled} />
      </div>
    </div>
  );
}
