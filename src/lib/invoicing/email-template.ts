// Wspólne kawałki szablonu maili faktur (szkic faktury + przypomnienie o
// płatności) — żeby nie dublować stopki/formatowania dat między dwoma
// route'ami w src/app/api/fakturownia/invoices/[id]/*.

// Jawny margines na każdym akapicie — Gmail (przy szkicach tworzonych przez
// API, nie przez własne okno pisania) potrafi zignorować domyślny margines
// przeglądarki na gołym <p>, przez co treść się skleja bez odstępów.
export function p(inner: string): string {
  return `<p style="margin:0 0 16px;">${inner}</p>`;
}

export function fmtPlDate(d: Date): string {
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// "15.10.2026" dla jednodniowego wynajmu, "15–17.10.2026" (ten sam
// miesiąc/rok) albo "28.09.2026–02.10.2026" (różny miesiąc/rok) dla
// kilkudniowego — treść dopasowuje "w dniu"/"w terminie" do tego, czy to
// zakres, czy pojedynczy dzień (ustalone z użytkownikiem).
export function formatRentalDateForEmail(startsAt: Date, endsAt: Date): { text: string; isRange: boolean } {
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

// Liczba dni po terminie płatności — dodatnia gdy termin już minął, ujemna
// gdy jeszcze przed terminem. `paymentTo` to data kalendarzowa (YYYY-MM-DD,
// bez strefy/godziny) z Fakturowni, więc porównujemy same daty kalendarzowe,
// nie znaczniki czasu.
export function daysPastDue(paymentTo: string, now: Date = new Date()): number {
  const due = new Date(`${paymentTo}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

// Stopka HTML dostarczona przez użytkownika (stopka_rozliczenia_snippet_1) —
// logo hostowane na wynajemlasera.pl (zewnętrzny https URL, nie załącznik),
// więc bez potrzeby osadzania obrazka w wiadomości.
export const RECEIVABLES_SIGNATURE_HTML = `<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; border-collapse: collapse;">
  <tr>
    <td style="vertical-align: middle; padding-right: 28px;">
      <a href="https://www.wynajemlasera.pl">
        <img src="https://wynajemlasera.pl/wp-content/uploads/2025/02/wynajem-lasera-logo.png" alt="WynajemLasera.pl" height="56" style="display: block; height: 56px; border: 0;">
      </a>
    </td>

    <td style="vertical-align: middle; padding: 0 28px 0 0; border-left: 2px solid #BA7517;">
      <div style="padding-left: 28px;">
        <div style="font-size: 11px; color: #BA7517; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px;">Dział rozliczeń</div>
        <div style="font-size: 13px; line-height: 1.7; color: #1a1a1a;">
          <a href="tel:+48531574115" style="color: #1a1a1a; text-decoration: none;">(+48) 531 574 115</a><br>
          <a href="mailto:rozliczenia@wynajemlasera.pl" style="color: #185FA5; text-decoration: none;">rozliczenia@wynajemlasera.pl</a>
        </div>
      </div>
    </td>
  </tr>

  <tr>
    <td colspan="2" style="padding-top: 22px;">
      <div style="font-size: 11px; color: #999999; line-height: 1.6;">
        EsteGH Sp. z o.o. &middot; ul. Pobory 29A, 32-050 Skawina &middot; NIP 9442285599 &middot; KRS 0001071483
      </div>
    </td>
  </tr>
</table>`;
