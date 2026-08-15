import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");
  redirect(user.role === "DEALER" ? "/portal" : "/dashboard");
}
