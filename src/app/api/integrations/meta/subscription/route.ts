import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { checkSubscription, renewSubscription } from "@/lib/chat/meta-graph";
import { logError } from "@/lib/logger";

// „Sprawdź / odnów subskrypcję Meta” (wniosek 42) — ADMIN. GET: pola, na które
// strona jest zasubskrybowana; POST: ponowna subskrypcja (messages, message_echoes, standby).
async function run(fn: typeof checkSubscription, userId: string) {
  try {
    return NextResponse.json({ ok: true, info: await fn() });
  } catch (err) {
    logError("meta_subscription_failed", err, { userId });
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "Nie udało się połączyć z Meta." }, { status: 502 });
  }
}

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return run(checkSubscription, session.user.id);
}

export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return run(renewSubscription, session.user.id);
}
