import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { getInvoiceDetail, getInvoicePdf } from "@/lib/integrations/fakturownia";
import { createInvoiceEmailDraft } from "@/lib/integrations/gmail";
import { resolveInvoiceContactEmail } from "@/lib/invoicing/contact-email";
import { p, formatRentalDateForEmail, RECEIVABLES_SIGNATURE_HTML } from "@/lib/invoicing/email-template";
import { logInfo, logError } from "@/lib/logger";

// Nadawca "wyślij jako" — alias już skonfigurowany w Gmailu konta
// kontakt@wynajemlasera.pl (GOOGLE_IMPERSONATED_USER), ustalone z
// użytkownikiem. Nie wystawiamy tego jako zmienną .env — to stała decyzja
// biznesowa (który adres wysyła faktury), nie dane dostępowe integracji.
const DRAFT_FROM = "rozliczenia@wynajemlasera.pl";

function bad(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

// Tworzy SZKIC maila z fakturą PDF w Gmailu (kontakt@wynajemlasera.pl,
// nadawca rozliczenia@) — apka NIGDY nie wysyła sama, biuro przegląda i
// wysyła ręcznie z Gmaila. Zastępuje wcześniejszą wysyłkę przez Fakturownię
// (sendInvoiceByEmail) — ustalone z użytkownikiem: wysyłka ma iść z ich
// własnej skrzynki Workspace, nie z Fakturowni.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return bad("Brak uprawnień.", 403);

  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId)) return bad("Nieprawidłowe ID faktury.");

  try {
    const contact = await resolveInvoiceContactEmail(invoiceId);
    if (!contact.ok) return bad(contact.message);

    const { text: rentalDate, isRange } = formatRentalDateForEmail(contact.startsAt, contact.endsAt);

    const detail = await getInvoiceDetail(invoiceId);
    const pdf = await getInvoicePdf(invoiceId);
    const draft = await createInvoiceEmailDraft({
      from: DRAFT_FROM,
      to: contact.email,
      subject: `WynajemLasera.pl – faktura za wynajem ${rentalDate}`,
      html: [
        p("Dzień dobry,"),
        p(`dziękujemy za skorzystanie z naszych usług ${isRange ? "w terminie" : "w dniu"} ${rentalDate}.`),
        p("W załączeniu przesyłamy fakturę w formacie PDF, wystawioną w KSeF. Dane do płatności znajdą Państwo w dokumencie."),
        p("W razie pytań pozostajemy do dyspozycji. Do zobaczenia przy kolejnym wynajmie! 🙂"),
        p("Pozdrawiamy serdecznie,"),
        RECEIVABLES_SIGNATURE_HTML,
      ].join(""),
      attachment: { filename: `faktura-${detail.number.replace(/\//g, "-")}.pdf`, data: pdf },
    });

    logInfo("fakturownia_email_draft_created", { userId: session.user.id, invoiceId, draftId: draft.draftId });
    return NextResponse.json({ message: "Szkic utworzony w Gmailu (kontakt@wynajemlasera.pl → Szkice)." });
  } catch (err) {
    logError("fakturownia_email_draft_failed", err, { userId: session.user.id, invoiceId });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
