import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { IntakeError, createLeadFromEmailMessage } from "@/lib/leads/mail-intake";
import { logError } from "@/lib/logger";

// „+ sygnał z tego maila” (wniosek 43, pkt 9): ręcznie z historii klientki /
// podglądu wątku. ADMIN/STAFF.
export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { emailMessageId?: unknown } | null;
  if (typeof body?.emailMessageId !== "string" || !body.emailMessageId) return NextResponse.json({ message: "Podaj emailMessageId." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await createLeadFromEmailMessage(body.emailMessageId, session.user.id)) });
  } catch (err) {
    if (err instanceof IntakeError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("mail_intake_from_email_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: "Nie udało się założyć sygnału." }, { status: 500 });
  }
}
