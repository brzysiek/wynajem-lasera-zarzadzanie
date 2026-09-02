import Link from "next/link";
import type { RentalEventType } from "@prisma/client";
import { rentalDurationDays } from "@/lib/pricing/duration";
import { variantShortLabel } from "@/lib/pricing/variants";

export type ReadonlyRental = {
  startsAt: string;
  endsAt: string;
  device: { name: string };
  deviceVariant: string | null;
  eventType: RentalEventType;
  deliveryAddress: string | null;
  deliveryTime: string | null;
  pickupTime: string | null;
  internalNotes: string | null;
  contactNameCache: string | null;
  contactPhoneCache: string | null;
  contactCompanyCache: string | null;
  contactAddressCache: string | null;
};

// Link do nawigacji Google Maps (otwiera apkę na telefonie).
function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
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

const CARD = "rounded-[14px] border border-[#E2E6EC] bg-white px-4 py-3.5";
const CARD_LABEL = "mb-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-[#9CA3AF]";

// Karta „Klientka" + „Uwaga z biura" wg mockup-master-finanse-wynajmu.html
// (widok kierowcy). Renderowana zaraz PO banerze płatności (patrz
// DriverFinancePanel.tripInfoSlot), przed rozbiciem kwoty — dlatego jest
// osobnym eksportem, nie częścią RentalReadonlyView.
export function DriverTripInfo({ rental }: { rental: ReadonlyRental }) {
  const phone = rental.contactPhoneCache?.trim();
  const company = rental.contactCompanyCache?.trim();
  // Adres nawigacji: dostawy jeśli podany, inaczej z kontaktu HubSpot.
  const address = rental.deliveryAddress?.trim() || rental.contactAddressCache?.trim();
  const times = [
    rental.deliveryTime?.trim() && `dostawa ${rental.deliveryTime.trim()}`,
    rental.pickupTime?.trim() && `odbiór ${rental.pickupTime.trim()}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const officeNote = rental.internalNotes?.trim();

  return (
    <>
      <div className={CARD}>
        <p className={CARD_LABEL}>Klientka</p>
        <p className="text-[15px] font-bold text-[#171A21]">{rental.contactNameCache?.trim() || "—"}</p>
        <div className="mt-2 flex flex-col gap-2 text-[13.5px]">
          {phone && (
            <a
              href={`tel:${phone.replace(/\s+/g, "")}`}
              className="flex items-center gap-2 font-semibold text-[#2F6FD1]"
            >
              <span aria-hidden>📞</span>
              {phone}
            </a>
          )}
          {address && (
            <a
              href={mapsUrl(address)}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 font-semibold text-[#2F6FD1]"
            >
              <span aria-hidden>📍</span>
              {address}
            </a>
          )}
          {company && (
            <div className="flex items-center gap-2 text-[#6B7280]">
              <span aria-hidden>🏢</span>
              {company}
            </div>
          )}
          {times && (
            <div className="flex items-center gap-2 text-[#6B7280]">
              <span aria-hidden>🕘</span>
              {times}
            </div>
          )}
        </div>
      </div>

      {officeNote && (
        <div className="flex gap-2 rounded-[9px] border border-[#F0E0B8] bg-[#FBF3E1] px-3 py-2.5 text-[12.5px] text-[#7A5A0E]">
          <span aria-hidden>💬</span>
          <span>
            <b className="font-bold">Uwaga z biura:</b> {officeNote}
          </span>
        </div>
      )}
    </>
  );
}

// Widok kierowcy: nagłówek (nazwa urządzenia + tag typu + zakres/dni/wariant)
// i sekcja finansowa (`financeSlot` = DriverFinancePanel, który sam renderuje
// baner, dane klienta przez tripInfoSlot, rozbicie, nakładkę, uwagi).
// Layout wg docs/panel zadania/panel kierowcy mobile/mockup-master-finanse-wynajmu.html.
export function RentalReadonlyView({
  rental,
  financeSlot,
}: {
  rental: ReadonlyRental;
  financeSlot?: React.ReactNode;
}) {
  const eventTag = rental.eventType === "SZKOLENIE" ? "Szkolenie" : "Wynajem";

  return (
    <div className="-mx-4 -my-6 min-h-screen bg-[#F1F3F6] px-4 py-6">
      <div className="mx-auto flex max-w-md flex-col gap-3">
        <div>
          <Link
            href="/kalendarz"
            aria-label="Wróć do kalendarza"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[#E2E6EC] bg-white text-[14px] text-[#6B7280]"
          >
            ←
          </Link>
          <span className="mt-2 inline-block rounded-full bg-[#EAF1FC] px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.05em] text-[#2F6FD1]">
            {eventTag}
          </span>
          <h1 className="mt-1.5 text-[21px] font-extrabold leading-[1.15] tracking-[-0.01em] text-[#171A21]">
            {rental.device.name}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-[14px] font-medium text-[#6B7280]">
            <span aria-hidden>📅</span>
            {headerMeta(rental)}
          </p>
        </div>

        {financeSlot}
      </div>
    </div>
  );
}
