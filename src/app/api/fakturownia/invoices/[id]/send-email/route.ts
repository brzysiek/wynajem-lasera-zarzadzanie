import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { sendInvoiceByEmail } from "@/lib/integrations/fakturownia";
import { logInfo, logError } from "@/lib/logger";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId)) return NextResponse.json({ message: "Nieprawidłowe ID faktury." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const emailTo = typeof body?.emailTo === "string" && body.emailTo.trim() ? body.emailTo.trim() : undefined;

  try {
    await sendInvoiceByEmail(invoiceId, emailTo);
    logInfo("fakturownia_email_sent", { userId: session.user.id, invoiceId, emailTo: emailTo ?? null });
    return NextResponse.json({ message: "Wysłano." });
  } catch (err) {
    logError("fakturownia_email_send_failed", err, { userId: session.user.id, invoiceId });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
