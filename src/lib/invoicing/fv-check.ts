// „FV bez faktury” — zakończone wynajmy z doliczonym VAT (RentalFinance.
// vatApplicable = znacznik „FV”), bez faktury wystawionej z panelu
// (fakturowniaInvoiceId) i bez faktury z Fakturowni powiązanej z wynajmem
// (ClientInvoice.rentalId). Dla każdego — podpowiedź prawdopodobnej faktury:
// ten sam klient albo NIP, data sprzedaży blisko wynajmu, urządzenie w
// pozycjach. Czysty moduł (vitest, bez Prismy i aliasu @/).

export const FV_MATCH_WINDOW_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export type FvInvoiceCandidate = {
  id: string;
  number: string;
  sellDate: Date;
  buyerName: string;
  buyerTaxNo: string | null;
  clientId: string | null;
  totalGross: string;
  positionsSummary: string | null;
};

export type FvRentalInput = {
  startsAt: Date;
  endsAt: Date;
  clientId: string | null;
  nip: string | null;
  deviceName: string;
};

export type FvSuggestion = {
  id: string;
  number: string;
  sellDate: string; // ISO
  buyerName: string;
  totalGross: string;
  reasons: string[]; // „ten sam klient”, „NIP”, „urządzenie w pozycjach”, „data ±N dni”
  score: number;
};

export function daysSince(date: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY));
}

// Słowa nazwy urządzenia, które coś znaczą w pozycji faktury („LightSheer
// Desire” → lightsheer, desire). Krótkie i ogólne słowa pomijamy.
function deviceWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function suggestInvoices(rental: FvRentalInput, invoices: FvInvoiceCandidate[], limit = 3): FvSuggestion[] {
  const from = rental.startsAt.getTime() - FV_MATCH_WINDOW_DAYS * DAY;
  const to = rental.endsAt.getTime() + FV_MATCH_WINDOW_DAYS * DAY;
  const words = deviceWords(rental.deviceName);
  const out: FvSuggestion[] = [];

  for (const inv of invoices) {
    const sameClient = !!rental.clientId && inv.clientId === rental.clientId;
    const sameNip = !!rental.nip && inv.buyerTaxNo === rental.nip;
    if (!sameClient && !sameNip) continue;
    const t = inv.sellDate.getTime();
    if (t < from || t > to) continue;

    const reasons: string[] = [];
    let score = 0;
    if (sameClient) {
      reasons.push("ten sam klient");
      score += 2;
    }
    if (sameNip) {
      reasons.push("ten sam NIP");
      score += 2;
    }
    const positions = fold(inv.positionsSummary ?? "");
    if (words.length && words.some((w) => positions.includes(w))) {
      reasons.push("urządzenie w pozycjach");
      score += 1;
    }
    const gap = t < rental.startsAt.getTime() ? rental.startsAt.getTime() - t : t > rental.endsAt.getTime() ? t - rental.endsAt.getTime() : 0;
    const gapDays = Math.round(gap / DAY);
    reasons.push(gapDays === 0 ? "data w trakcie wynajmu" : `data ±${gapDays} dni`);
    score += gapDays === 0 ? 1 : gapDays <= 3 ? 0.5 : 0;

    out.push({
      id: inv.id,
      number: inv.number,
      sellDate: inv.sellDate.toISOString(),
      buyerName: inv.buyerName,
      totalGross: inv.totalGross,
      reasons,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.sellDate.localeCompare(b.sellDate)).slice(0, limit);
}
