import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { testSzybkiSmsConnection } from "@/lib/integrations/szybkisms";
import { logInfo, logError } from "@/lib/logger";

export async function POST() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const result = await testSzybkiSmsConnection();
  if (result.ok) {
    logInfo("integration_szybkisms_test_ok", { userId: session.user.id });
  } else {
    logError("integration_szybkisms_test_failed", new Error(result.message), { userId: session.user.id });
  }

  return NextResponse.json(result);
}
