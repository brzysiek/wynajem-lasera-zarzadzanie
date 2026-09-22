import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getInvoiceDetail, getInvoicePdf } from "@/lib/integrations/fakturownia";
import { createInvoiceEmailDraft } from "@/lib/integrations/gmail";
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
    // Adres e-mail bierzemy WYŁĄCZNIE z HubSpota (Rental.contactEmailCache),
    // nigdy z karty kontrahenta w Fakturowni — ustalone z użytkownikiem:
    // Fakturownia bywa nieaktualna/wpisywana ręcznie, HubSpot jest źródłem
    // prawdy dla danych kontaktowych. Wymaga więc, żeby ta faktura była
    // powiązana z wynajmem w tej apce (RentalFinance.fakturowniaInvoiceId) —
    // starsze faktury wystawione ręcznie w Fakturowni z pominięciem apki nie
    // mają takiego powiązania i szkic się dla nich nie utworzy.
    const rentalFinance = await prisma.rentalFinance.findFirst({
      where: { fakturowniaInvoiceId: invoiceId },
      include: { rental: true },
    });
    if (!rentalFinance) {
      return bad("Ta faktura nie jest powiązana z wynajmem w tej apce — nie znamy adresu e-mail z HubSpota.");
    }
    const email = rentalFinance.rental.contactEmailCache?.trim();
    if (!email) {
      return bad(
        "Kontakt HubSpot dla tego wynajmu nie ma zapisanego adresu e-mail — uzupełnij w HubSpot i odśwież kontakt na wynajmie.",
      );
    }

    const detail = await getInvoiceDetail(invoiceId);
    const pdf = await getInvoicePdf(invoiceId);
    const draft = await createInvoiceEmailDraft({
      from: DRAFT_FROM,
      to: email,
      subject: `Faktura ${detail.number} — WynajemLasera.pl`,
      html: `<p>Dzień dobry,</p><p>W załączeniu przesyłamy fakturę ${detail.number}.</p><p>Pozdrawiamy,<br>WynajemLasera.pl</p>`,
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
