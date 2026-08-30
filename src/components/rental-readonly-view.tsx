import Link from "next/link";
import { rentalDurationDays } from "@/lib/pricing/duration";
import { variantShortLabel } from "@/lib/pricing/variants";

export type ReadonlyRental = {
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  device: { name: string; color: string };
  deviceVariant: string | null;
  driverName: string | null;
  deliveryAddress: string | null;
  deliveryTime: string | null;
  pickupTime: string | null;
  transportPrice: string | null;
  contactNameCache: string | null;
  contactPhoneCache: string | null;
  contactCompanyCache: string | null;
  contactAddressCache: string | null;
};

function formatDate(iso: string, allDay: boolean): string {
  const date = new Date(iso);
  return allDay
    ? date.toLocaleDateString("pl-PL")
    : date.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

// „28 sie – 30 sie · 3 dni · podwójna głowica" — zakres skrócony, liczba dni
// (inclusive, jak pasek na kalendarzu), i etykieta wariantu tylko jeśli
// urządzenie ma go skonfigurowany.
function headerMeta(rental: ReadonlyRental): string {
  const start = new Date(rental.startsAt);
  const end = new Date(rental.endsAt);
  const day = (d: Date) => d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  const range = start.toDateString() === end.toDateString() ? day(start) : `${day(start)} – ${day(end)}`;

  const days = rentalDurationDays(start, end);
  const parts = [range, `${days} ${days === 1 ? "dzień" : "dni"}`];

  const variant = variantShortLabel(rental.deviceVariant);
  if (variant) parts.push(variant);

  return parts.join(" · ");
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[#EEF0F3] py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <span className="w-40 flex-none text-[13px] text-[#6B7280]">{label}</span>
      <span className="text-[13px] text-[#171A21]">{value?.trim() ? value : "—"}</span>
    </div>
  );
}

const CARD = "rounded-[14px] border border-[#E2E6EC] bg-white px-4 py-3.5";
const CARD_LABEL = "mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[#6B7280]";

// Read-only rental card shown to a KIEROWCA (driver). Trip details are
// read-only; the finance panel (`financeSlot`, rendered first) is the one
// place a driver can edit — payment confirmation, HS cap, pulse counters,
// driver notes. Styling follows docs/finanse-wynajmu/mockup-modul-finansowy.html.
export function RentalReadonlyView({
  rental,
  financeSlot,
}: {
  rental: ReadonlyRental;
  financeSlot?: React.ReactNode;
}) {
  return (
    <div className="-mx-4 -my-6 min-h-screen bg-[#F1F3F6] px-4 py-6">
      <div className="mx-auto flex max-w-md flex-col gap-3">
        <div>
          <Link href="/kalendarz" className="text-[13px] text-[#6B7280] transition-colors hover:text-[#171A21]">
            ← Wróć
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-[17px] font-bold tracking-[-0.01em] text-[#171A21]">
            <span
              className="h-2.5 w-2.5 flex-none rounded-full"
              style={{ backgroundColor: rental.device.color }}
            />
            {rental.device.name}
          </h1>
          <p className="mt-1 text-[13px] text-[#6B7280]">{headerMeta(rental)}</p>
        </div>

        {financeSlot}

        <div className={CARD}>
          <p className={CARD_LABEL}>Termin</p>
          <Row label="Początek" value={formatDate(rental.startsAt, rental.allDay)} />
          <Row label="Koniec" value={formatDate(rental.endsAt, rental.allDay)} />
        </div>

        <div className={CARD}>
          <p className={CARD_LABEL}>Dostawa</p>
          <Row label="Adres dostawy" value={rental.deliveryAddress} />
          <Row label="Godzina dostawy" value={rental.deliveryTime} />
          <Row label="Godzina odbioru" value={rental.pickupTime} />
          <Row label="Ustalona cena transportu" value={rental.transportPrice} />
        </div>

        <div className={CARD}>
          <p className={CARD_LABEL}>Kontakt</p>
          <Row label="Osoba" value={rental.contactNameCache} />
          <Row label="Telefon" value={rental.contactPhoneCache} />
          <Row label="Firma" value={rental.contactCompanyCache} />
          <Row label="Adres" value={rental.contactAddressCache} />
        </div>

        <div className={CARD}>
          <p className={CARD_LABEL}>Pozostałe</p>
          <Row label="Kierowca" value={rental.driverName} />
          <Row label="Opis" value={rental.description} />
        </div>
      </div>
    </div>
  );
}
