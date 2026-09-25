import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getInvoiceDetail, getInvoicePdf } from "@/lib/integrations/fakturownia";
import { createInvoiceEmailDraft } from "@/lib/integrations/gmail";
import { resolveInvoiceContactEmail } from "@/lib/invoicing/contact-email";
import { p, fmtPlDate, daysPastDue, RECEIVABLES_SIGNATURE_HTML } from "@/lib/invoicing/email-template";
import { logInfo, logError } from "@/lib/logger";

const DRAFT_FROM = "rozliczenia@wynajemlasera.pl";

function bad(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

// TYMCZASOWA treść — sama instalacja/mechanizm ustalone z użytkownikiem
// najpierw, dokładne sformułowania do dopracowania w kolejnym kroku (patrz
// rozmowa: "jak już zakodujesz całość to ustalimy treść maila").
function reminderDueLine(paymentTo: string, overdue: number): string {
  const dueDate = fmtPlDate(new Date(`${paymentTo}T00:00:00`));
  if (overdue > 0) {
    const dayWord = overdue === 1 ? "dzień" : "dni";
    return `przypominamy o płatności za poniższą fakturę — termin płatności (${dueDate}) minął ${overdue} ${dayWord} temu.`;
  }
  if (overdue === 0) {
    return `przypominamy o płatności za poniższą fakturę — termin płatności upływa dziś (${dueDate}).`;
  }
  return `przypominamy o płatności za poniższą fakturę — termin płatności to ${dueDate}.`;
}

// Tworzy SZKIC maila z przypomnieniem o płatności (kontakt@wynajemlasera.pl,
// nadawca rozliczenia@) — ten sam mechanizm co create-draft/route.ts
// (faktura/PDF): apka NIGDY nie wysyła sama, biuro przegląda i wysyła
// ręcznie z Gmaila. Dostępne tylko dla faktur, które NIE są oznaczone jako
// zapłacone (FakturowniaPayment) — dla zapłaconych przypomnienie nie ma
// sensu.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return bad("Brak uprawnień.", 403);

  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId)) return bad("Nieprawidłowe ID faktury.");

  try {
    const paid = await prisma.fakturowniaPayment.findUnique({ where: { fakturowniaInvoiceId: invoiceId } });
    if (paid) return bad("Ta faktura jest już oznaczona jako zapłacona — przypomnienie nie ma sensu.");

    const contact = await resolveInvoiceContactEmail(invoiceId);
    if (!contact.ok) return bad(contact.message);

    const detail = await getInvoiceDetail(invoiceId);
    const overdue = daysPastDue(detail.paymentTo);
    const pdf = await getInvoicePdf(invoiceId);

    const draft = await createInvoiceEmailDraft({
      from: DRAFT_FROM,
      to: contact.email,
      subject: `WynajemLasera.pl – przypomnienie o płatności za fakturę ${detail.number}`,
      html: [
        p("Dzień dobry,"),
        p(reminderDueLine(detail.paymentTo, overdue)),
        p(`W załączeniu ponownie przesyłamy fakturę ${detail.number} w formacie PDF. Prosimy o uregulowanie należności w najbliższym możliwym terminie.`),
        p("Jeśli płatność została już dokonana, prosimy o zignorowanie tej wiadomości — z góry dziękujemy."),
        p("W razie pytań pozostajemy do dyspozycji."),
        p("Pozdrawiamy serdecznie,"),
        RECEIVABLES_SIGNATURE_HTML,
      ].join(""),
      attachment: { filename: `faktura-${detail.number.replace(/\//g, "-")}.pdf`, data: pdf },
    });

    logInfo("fakturownia_reminder_draft_created", { userId: session.user.id, invoiceId, overdue, draftId: draft.draftId });
    return NextResponse.json({ message: "Szkic przypomnienia utworzony w Gmailu (kontakt@wynajemlasera.pl → Szkice)." });
  } catch (err) {
    logError("fakturownia_reminder_draft_failed", err, { userId: session.user.id, invoiceId });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
