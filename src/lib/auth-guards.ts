import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logWarn } from "@/lib/logger";

export async function requireAdmin() {
  const session = await auth();

  if (session?.user.role !== "ADMIN") {
    logWarn("admin_page_access_denied", { userId: session?.user.id ?? null });
    redirect("/ustawienia/przypomnienia-sms");
  }

  return session;
}

// For API route handlers, where redirect() can't be used to gate access —
// callers respond with their own 403 JSON instead.
export async function requireAdminSession() {
  const session = await auth();

  if (session?.user.role !== "ADMIN") {
    logWarn("admin_api_access_denied", { userId: session?.user.id ?? null });
    return null;
  }

  return session;
}
