import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireAdmin() {
  const session = await auth();

  if (session?.user.role !== "ADMIN") {
    redirect("/ustawienia/konto");
  }

  return session;
}

// For API route handlers, where redirect() can't be used to gate access —
// callers respond with their own 403 JSON instead.
export async function requireAdminSession() {
  const session = await auth();

  if (session?.user.role !== "ADMIN") {
    return null;
  }

  return session;
}
