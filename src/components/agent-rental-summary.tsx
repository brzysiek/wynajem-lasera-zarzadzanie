import Link from "next/link";
import { formatPln } from "@/lib/pricing/format";

// Podgląd wynajmu dla roli AGENT (tylko odczyt): rozliczenie, znacznik „FV”
// i stan faktury, uwagi kierowcy, SMS-y. Renderowany w RentalReadonlyView
// obok danych klientki (DriverTripInfo). Bez żadnej akcji zapisu.

const CARD = "rounded-[14px] border border-[#E2E6EC] bg-white px-4 py-3.5";
const CARD_LABEL = "mb-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-[#9CA3AF]";

export type AgentRentalInfo = {
  title: string;
  clientId: string | null;
  clientName: string | null;
  finance: {
    totalNet: string;
    totalGross: string;
    vatApplicable: boolean;
    paymentMethod: "CASH" | "TRANSFER";
    confirmedAt: string | null;
    invoiceNumber: string | null;
    invoiceError: string | null;
    deliveryNotes: string | null;
    pickupNotes: string | null;
  } | null;
  linkedInvoiceNumber: string | null; // faktura z Fakturowni powiązana z wynajmem (poza panelem)
  ended: boolean;
  messages: { id: string; sentAt: string; recipient: string; body: string; status: "SENT" | "FAILED" }[];
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-[13.5px]">
      <span className="text-[#6B7280]">{label}</span>
      <span className="text-right font-semibold text-[#171A21]">{children}</span>
    </div>
  );
}

export function AgentRentalSummary({ info, tripInfo }: { info: AgentRentalInfo; tripInfo: React.ReactNode }) {
  const f = info.finance;
  const invoice = f?.invoiceNumber ?? info.linkedInvoiceNumber;
  const invoiceLabel = !f
    ? "—"
    : !f.vatApplicable
      ? "nie dotyczy (bez FV)"
      : invoice
        ? invoice
        : info.ended
          ? "brak faktury"
          : "po zakończeniu";

  return (
    <>
      <p className="rounded-[9px] border border-[#E2E6EC] bg-white px-3 py-2 text-[12.5px] text-[#6B7280]">
        Podgląd tylko do odczytu · {info.title}
        {info.clientId && (
          <>
            {" · "}
            <Link href={`/klienci/${info.clientId}`} className="font-semibold text-[#2F6FD1]">
              {info.clientName ?? "karta klienta"} →
            </Link>
          </>
        )}
      </p>
      {tripInfo}
      <div className={CARD}>
        <p className={CARD_LABEL}>Rozliczenie</p>
        {f ? (
          <div className="flex flex-col gap-1.5">
            <Row label="Netto / brutto">
              {formatPln(f.totalNet)} / {formatPln(f.totalGross)}
            </Row>
            <Row label="Płatność">{f.paymentMethod === "CASH" ? "gotówka" : "przelew"}</Row>
            <Row label="FV (VAT)">{f.vatApplicable ? "tak" : "nie"}</Row>
            <Row label="Faktura">
              <span className={f.vatApplicable && !invoice && info.ended ? "text-[#D93025]" : undefined}>{invoiceLabel}</span>
            </Row>
            {f.invoiceError && <p className="text-[12px] text-[#D93025]">Ostatni błąd wystawienia: {f.invoiceError}</p>}
            <Row label="Raport kierowcy">{f.confirmedAt ? "potwierdzony" : "brak"}</Row>
          </div>
        ) : (
          <p className="text-[13px] text-[#9CA3AF]">Brak danych finansowych.</p>
        )}
      </div>
      {(f?.deliveryNotes || f?.pickupNotes) && (
        <div className={CARD}>
          <p className={CARD_LABEL}>Uwagi kierowcy</p>
          {f.deliveryNotes && <p className="text-[13px]">Dostawa: {f.deliveryNotes}</p>}
          {f.pickupNotes && <p className="text-[13px]">Odbiór: {f.pickupNotes}</p>}
        </div>
      )}
      {info.messages.length > 0 && (
        <div className={CARD}>
          <p className={CARD_LABEL}>SMS-y</p>
          <ul className="flex flex-col gap-2">
            {info.messages.map((m) => (
              <li key={m.id} className="text-[12.5px]">
                <span className="text-[#6B7280]">
                  {new Date(m.sentAt).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })} · {m.recipient}
                  {m.status === "FAILED" && <span className="text-[#D93025]"> · błąd</span>}
                </span>
                <p className="whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
