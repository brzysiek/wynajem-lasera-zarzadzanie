import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { runGmailSync } from "@/lib/gmail/sync";
import { logError } from "@/lib/logger";

// Ręczny przebieg (import historii z paskiem postępu — UI woła w pętli).
// Tylko ADMIN. W odpowiedzi i logach żadnych treści maili.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    return NextResponse.json({ results: await runGmailSync({ force: true, budgetMs: 25_000 }) });
  } catch (err) {
    logError("gmail_sync_manual_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
