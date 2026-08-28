import Link from "next/link";
import { withDeliveryTimePrefix } from "@/lib/rental-title";

export type ReadonlyRental = {
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  device: { name: string; color: string };
  driverName: string | null;
  deliveryAddress: string | null;
  deliveryTime: string | null;
  pickupTime: string | null;
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

function BackArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M17 10a.75.75 0 0 1-.75.75H5.56l4.22 4.22a.75.75 0 1 1-1.06 1.06l-5.5-5.5a.75.75 0 0 1 0-1.06l5.5-5.5a.75.75 0 1 1 1.06 1.06L5.56 9.25H16.25A.75.75 0 0 1 17 10Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-gray-100 py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <span className="w-40 flex-none text-sm text-gray-500">{label}</span>
      <span className="text-sm text-gray-900">{value?.trim() ? value : "—"}</span>
    </div>
  );
}

// Read-only rental card shown to a KIEROWCA (driver) — no inputs, no actions,
// no SMS/reminders. Just the trip details a driver needs on the road.
export function RentalReadonlyView({ rental }: { rental: ReadonlyRental }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href="/kalendarz"
          aria-label="Powrót do kalendarza"
          title="Powrót do kalendarza"
          className="flex-none rounded-md border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
        >
          <BackArrowIcon />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {withDeliveryTimePrefix(rental.title, rental.deliveryTime)}
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: rental.device.color }} />
            {rental.device.name}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="mb-2 text-sm font-medium text-gray-700">Termin</p>
        <Row label="Początek" value={formatDate(rental.startsAt, rental.allDay)} />
        <Row label="Koniec" value={formatDate(rental.endsAt, rental.allDay)} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="mb-2 text-sm font-medium text-gray-700">Dostawa</p>
        <Row label="Adres dostawy" value={rental.deliveryAddress} />
        <Row label="Godzina dostawy" value={rental.deliveryTime} />
        <Row label="Godzina odbioru" value={rental.pickupTime} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="mb-2 text-sm font-medium text-gray-700">Kontakt</p>
        <Row label="Osoba" value={rental.contactNameCache} />
        <Row label="Telefon" value={rental.contactPhoneCache} />
        <Row label="Firma" value={rental.contactCompanyCache} />
        <Row label="Adres" value={rental.contactAddressCache} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="mb-2 text-sm font-medium text-gray-700">Pozostałe</p>
        <Row label="Kierowca" value={rental.driverName} />
        <Row label="Opis" value={rental.description} />
      </div>
    </div>
  );
}
