// Parser faktur paliwowych — format XML eksportowany z Fakturowni (nie
// surowy schemat rządowego KSeF FA(2)/FA(3), płaski dialekt à la Rails
// `to_xml`, np. <price-net type="decimal">266.06</price-net>). Regex, nie
// prawdziwy parser XML — świadomie: format jest płaski, bez zagnieżdżeń tych
// samych nazw tagów na różnych poziomach, więc regex wystarcza i nie
// dokłada zależności. Czyste funkcje — łatwe do przetestowania na realnym
// przykładzie (patrz fuel-invoice-parse.test.ts).
//
// Karty paliwowe są WSPÓLNE dla całej floty (jedno konto), ale stacja pyta o
// numer rejestracyjny przy tankowaniu — trafia na fakturę jako osobna
// pozycja w <descriptions>, <kind>Nr. Pojazdu</kind>. Stąd dopasowanie do
// pojazdu po numerze rejestracyjnym, nie po koncie/karcie.

export type ParsedFuelInvoice = {
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD, jak w źródle (walidacja daty zostaje wywołującemu)
  sellerName: string | null;
  amountNet: number | null;
  amountGross: number | null;
  currency: string | null;
  // Surowa treść pola "Nr. Pojazdu" (np. "DW9FF41"), PRZED normalizacją —
  // do wglądu w UI, gdy dopasowanie się nie uda.
  vehiclePlateRaw: string | null;
};

// Wyciąga treść PIERWSZEGO wystąpienia <name ...>treść</name> — self-closing
// (`<tag .../>`, używane dla pól `nil="true"`) celowo nie pasuje -> null.
function extractTag(xml: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  if (!m) return null;
  const v = m[1].trim();
  return v === "" ? null : v;
}

function extractNumberTag(xml: string, name: string): number | null {
  const raw = extractTag(xml, name);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseFuelInvoiceXml(xml: string): ParsedFuelInvoice {
  const invoiceNumber = extractTag(xml, "number");
  const invoiceDate = extractTag(xml, "issue-date");
  const sellerName = extractTag(xml, "seller-name");
  const currency = extractTag(xml, "currency");
  const amountNet = extractNumberTag(xml, "price-net");
  const amountGross = extractNumberTag(xml, "price-gross");

  // Pole "Nr. Pojazdu" leży w jednym z bloków <description type="InvoiceAdditionalDescription">
  // — dopasowanie po <kind> zawierającym "pojazdu" (case-insensitive, żeby
  // przetrwać drobne różnice etykiety), nie po pozycji w tablicy.
  let vehiclePlateRaw: string | null = null;
  const blockRe = /<description type="InvoiceAdditionalDescription">([\s\S]*?)<\/description>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml))) {
    const block = m[1];
    const kind = extractTag(block, "kind");
    if (kind && /pojazdu/i.test(kind)) {
      const content = extractTag(block, "content");
      if (content) {
        // "DW9FF41 (PV 73076K3/4493/26)" -> "DW9FF41". Split na "(", NIE na
        // spacji — tablice bywają zapisywane ze spacją (np. "KR 12345"),
        // normalizePlate() i tak ją usunie przy porównaniu.
        const plate = content.split("(")[0].trim();
        if (plate) vehiclePlateRaw = plate;
      }
      break;
    }
  }

  return { invoiceNumber, invoiceDate, sellerName, amountNet, amountGross, currency, vehiclePlateRaw };
}

// Normalizacja do porównania: wielkie litery, bez spacji/myślników — tablice
// bywają zapisane różnie w różnych miejscach (z/bez spacji po prefiksie).
export function normalizePlate(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, "");
}

// Dopasowanie 1:1 po znormalizowanym numerze — brak dopasowania (0 lub
// wieloznaczne, choć realnie każdy pojazd ma unikalną tablicę) -> null,
// niech admin poprawi ręcznie w UI zamiast zgadywać.
export function matchVehicleByPlate(
  plateRaw: string | null,
  vehicles: { id: string; plateNumber: string }[],
): string | null {
  if (!plateRaw) return null;
  const norm = normalizePlate(plateRaw);
  if (!norm) return null;
  const match = vehicles.find((v) => normalizePlate(v.plateNumber) === norm);
  return match ? match.id : null;
}
