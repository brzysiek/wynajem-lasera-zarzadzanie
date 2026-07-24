import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireAdmin() {
  const session = await auth();

  if (session?.user.role !== "ADMIN") {
    redirect("/ustawienia/konto");
  }

  return session;
}
