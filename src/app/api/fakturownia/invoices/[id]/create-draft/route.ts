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

function fmtPlDate(d: Date): string {
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// "15.10.2026" dla jednodniowego wynajmu, "15–17.10.2026" (ten sam
// miesiąc/rok) albo "28.09.2026–02.10.2026" (różny miesiąc/rok) dla
// kilkudniowego — treść dopasowuje "w dniu"/"w terminie" do tego, czy to
// zakres, czy pojedynczy dzień (ustalone z użytkownikiem).
function formatRentalDateForEmail(startsAt: Date, endsAt: Date): { text: string; isRange: boolean } {
  if (startsAt.toDateString() === endsAt.toDateString()) {
    return { text: fmtPlDate(startsAt), isRange: false };
  }
  const sameMonthYear = startsAt.getMonth() === endsAt.getMonth() && startsAt.getFullYear() === endsAt.getFullYear();
  if (sameMonthYear) {
    const startDay = startsAt.toLocaleDateString("pl-PL", { day: "2-digit" });
    return { text: `${startDay}–${fmtPlDate(endsAt)}`, isRange: true };
  }
  return { text: `${fmtPlDate(startsAt)}–${fmtPlDate(endsAt)}`, isRange: true };
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

    const { text: rentalDate, isRange } = formatRentalDateForEmail(rentalFinance.rental.startsAt, rentalFinance.rental.endsAt);

    const detail = await getInvoiceDetail(invoiceId);
    const pdf = await getInvoicePdf(invoiceId);
    const draft = await createInvoiceEmailDraft({
      from: DRAFT_FROM,
      to: email,
      subject: `WynajemLasera.pl – faktura za wynajem ${rentalDate}`,
      html: [
        "<p>Dzień dobry,</p>",
        `<p>dziękujemy za skorzystanie z naszych usług ${isRange ? "w terminie" : "w dniu"} ${rentalDate}.</p>`,
        "<p>W załączeniu przesyłamy fakturę w formacie PDF, wystawioną w KSeF. Dane do płatności znajdą Państwo w dokumencie.</p>",
        "<p>W razie pytań pozostajemy do dyspozycji. Do zobaczenia przy kolejnym wynajmie! 🙂</p>",
        "<p>Pozdrawiamy serdecznie,<br>",
        "Zespół WynajemLasera.pl<br>",
        "tel: 533 333 778<br>",
        '<a href="mailto:kontakt@wynajemlasera.pl">kontakt@wynajemlasera.pl</a><br>',
        '<a href="https://www.wynajemlasera.pl">www.wynajemlasera.pl</a></p>',
        "<p>Twoje BEAUTY w rękach Profesjonalistów!</p>",
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
