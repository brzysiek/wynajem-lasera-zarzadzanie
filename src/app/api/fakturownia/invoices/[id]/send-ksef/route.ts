import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { sendInvoiceToKsef } from "@/lib/integrations/fakturownia";
import { logInfo, logError } from "@/lib/logger";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId)) return NextResponse.json({ message: "Nieprawidłowe ID faktury." }, { status: 400 });

  try {
    const invoice = await sendInvoiceToKsef(invoiceId);
    logInfo("fakturownia_ksef_send_triggered", { userId: session.user.id, invoiceId, govStatus: invoice.govStatus });
    return NextResponse.json({ invoice });
  } catch (err) {
    logError("fakturownia_ksef_send_failed", err, { userId: session.user.id, invoiceId });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
