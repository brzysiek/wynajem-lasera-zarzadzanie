"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DevicePricingCategory } from "@prisma/client";
import { BASE_PATH } from "@/lib/base-path";
import {
  PRICING_CATEGORY_LABELS,
  PRICING_CATEGORY_VALUES,
  VARIANT_OPTIONS_BY_CATEGORY,
  categoryHasVariants,
} from "@/lib/pricing/variants";

type UpcomingRental = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  contactNameCache: string | null;
  contactCompanyCache: string | null;
};

type Device = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  googleCalendarId: string;
  active: boolean;
  pricingCategory: DevicePricingCategory | null;
  variantOptions: string[];
  rentalCount: number;
  lastSync: { status: "OK" | "ERROR"; createdAt: string } | null;
  upcomingRentals: UpcomingRental[];
};

function googleCalendarUrl(calendarId: string): string {
  // "u/0" = pierwsze konto zalogowane w przeglądarce; cid to base64 ID kalendarza.
  return `https://calendar.google.com/calendar/u/0/r?cid=${btoa(calendarId)}`;
}

type GoogleCalendarOption = { id: string; summary: string };

async function api(url: string, init?: RequestInit) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

function formatRentalRange(rental: UpcomingRental) {
  if (rental.allDay) {
    return new Date(rental.startsAt).toLocaleDateString("pl-PL");
  }
  const start = formatDateTime(rental.startsAt);
  const end = formatDateTime(rental.endsAt);
  return `${start} – ${end}`;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className={`h-4 w-4 flex-none text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
    >
      <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeviceForm({
  device,
  onSaved,
  onCancel,
}: {
  device: Device | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(device?.name ?? "");
  const [shortName, setShortName] = useState(device?.shortName ?? "");
  const [color, setColor] = useState(device?.color ?? "#2563eb");
  const [googleCalendarId, setGoogleCalendarId] = useState(device?.googleCalendarId ?? "");
  const [pricingCategory, setPricingCategory] = useState<DevicePricingCategory | "">(device?.pricingCategory ?? "");
  const [variantOptions, setVariantOptions] = useState<Set<string>>(() => new Set(device?.variantOptions ?? []));
  const [calendars, setCalendars] = useState<GoogleCalendarOption[] | null>(null);
  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedCalendars, setLoadedCalendars] = useState(false);

  async function loadCalendars() {
    if (loadedCalendars) return;
    setLoadedCalendars(true);
    const { ok, data } = await api("/api/integrations/google-calendar/calendars");
    if (ok && Array.isArray(data?.calendars)) {
      setCalendars(data.calendars);
    } else {
      setCalendarsError(data?.message || "Nie udało się pobrać listy kalendarzy — wpisz ID ręcznie.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const withVariants = pricingCategory !== "" && categoryHasVariants(pricingCategory);
    const body = {
      name,
      shortName,
      color,
      googleCalendarId,
      pricingCategory: pricingCategory === "" ? null : pricingCategory,
      variantOptions: withVariants ? [...variantOptions] : null,
    };
    const { ok, data } = device
      ? await api(`/api/devices/${device.id}`, { method: "PATCH", body: JSON.stringify(body) })
      : await api("/api/devices", { method: "POST", body: JSON.stringify(body) });

    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się zapisać urządzenia.");
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Nazwa
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Skrót (w kalendarzu)
          <input
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            required
            maxLength={12}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Kolor
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-full rounded-md border border-gray-300"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Kalendarz Google
          {calendars ? (
            <select
              value={googleCalendarId}
              onChange={(e) => setGoogleCalendarId(e.target.value)}
              required
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            >
              <option value="">— wybierz —</option>
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.summary}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={googleCalendarId}
              onChange={(e) => setGoogleCalendarId(e.target.value)}
              onFocus={loadCalendars}
              required
              placeholder="np. xxxx@group.calendar.google.com"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            />
          )}
          {calendarsError && <span className="text-xs text-amber-700">{calendarsError}</span>}
        </label>
      </div>

      <div className="mt-4 border-t border-gray-200 pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Cennik</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Kategoria cennika
            <select
              value={pricingCategory}
              onChange={(e) => {
                setPricingCategory(e.target.value as DevicePricingCategory | "");
                setVariantOptions(new Set());
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            >
              <option value="">— nieskonfigurowana —</option>
              {PRICING_CATEGORY_VALUES.map((cat) => (
                <option key={cat} value={cat}>
                  {PRICING_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </label>

          {pricingCategory !== "" && categoryHasVariants(pricingCategory) && (
            <fieldset className="flex flex-col gap-1 text-sm text-gray-700">
              <legend className="mb-1">Dostępne warianty głowicy</legend>
              <div className="flex flex-col gap-1.5">
                {VARIANT_OPTIONS_BY_CATEGORY[pricingCategory].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={variantOptions.has(opt.value)}
                      onChange={(e) => {
                        setVariantOptions((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(opt.value);
                          else next.delete(opt.value);
                          return next;
                        });
                      }}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <span className="mt-1 text-xs text-gray-400">
                Zaznacz tylko te, które ten egzemplarz fizycznie ma (np. LIGHT nigdy nie ma podwójnej głowicy).
              </span>
            </fieldset>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isSaving ? "Zapisywanie…" : "Zapisz"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}

function UpcomingRentalsList({ rentals }: { rentals: UpcomingRental[] }) {
  if (rentals.length === 0) {
    return <p className="text-sm text-gray-400">Brak nadchodzących rezerwacji.</p>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {rentals.map((rental) => (
        <li key={rental.id} className="py-2">
          <p className="text-sm font-medium text-gray-900">{rental.title}</p>
          <p className="text-xs text-gray-500">
            {formatRentalRange(rental)}
            {rental.contactNameCache && ` · ${rental.contactNameCache}`}
            {rental.contactCompanyCache && ` (${rental.contactCompanyCache})`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DeviceRow({ device, isAdmin, onChanged }: { device: Device; isAdmin: boolean; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function handleSync() {
    setIsSyncing(true);
    setSyncMessage(null);
    const { ok, data } = await api(`/api/devices/${device.id}/sync`, { method: "POST" });
    setIsSyncing(false);
    setSyncMessage(data?.message || (ok ? "Zsynchronizowano." : "Błąd synchronizacji."));
    if (ok) onChanged();
  }

  async function handleToggleActive() {
    const { ok } = await api(`/api/devices/${device.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !device.active }),
    });
    if (ok) onChanged();
  }

  const nextRental = device.upcomingRentals[0] ?? null;

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center gap-3 rounded-md py-2 text-left hover:bg-gray-50"
      >
        <span
          className="h-4 w-4 flex-none rounded-full border border-gray-300"
          style={{ backgroundColor: device.color }}
        />
        <div className="min-w-[10rem] flex-1">
          <p className="text-sm font-medium text-gray-900">
            {device.name} <span className="text-gray-400">({device.shortName})</span>
            {!device.active && (
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                wycofane
              </span>
            )}
          </p>
          <p className="text-xs text-gray-500">
            {device.rentalCount} rezerwacji ·{" "}
            {nextRental ? (
              <>
                najbliższa: {nextRental.title} · {formatRentalRange(nextRental)}
              </>
            ) : (
              "brak nadchodzących"
            )}
          </p>
        </div>
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        <div className="ml-7 border-l border-gray-100 py-3 pl-4">
          {isEditing ? (
            <DeviceForm
              device={device}
              onSaved={() => {
                setIsEditing(false);
                onChanged();
              }}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-gray-600">
                  <p>
                    Kalendarz Google: <span className="font-mono">{device.googleCalendarId}</span>{" "}
                    <a
                      href={googleCalendarUrl(device.googleCalendarId)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-blue-600 hover:underline"
                    >
                      otwórz ↗
                    </a>
                  </p>
                  <p>
                    Cennik:{" "}
                    {device.pricingCategory ? (
                      <span className="text-gray-800">
                        {PRICING_CATEGORY_LABELS[device.pricingCategory]}
                        {device.variantOptions.length > 0 && ` · ${device.variantOptions.length} wariant(y)`}
                      </span>
                    ) : (
                      <span className="font-medium text-amber-700">nieskonfigurowany</span>
                    )}
                  </p>
                  {device.lastSync ? (
                    <span className={device.lastSync.status === "OK" ? "text-green-700" : "text-red-700"}>
                      Sync: {device.lastSync.status === "OK" ? "OK" : "błąd"} ·{" "}
                      {formatDateTime(device.lastSync.createdAt)}
                    </span>
                  ) : (
                    <span className="text-gray-400">Brak synchronizacji</span>
                  )}
                  {syncMessage && <p className="mt-1 text-gray-500">{syncMessage}</p>}
                </div>

                <div className="flex flex-none gap-2">
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {isSyncing ? "Synchronizowanie…" : "Synchronizuj teraz"}
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Edytuj
                      </button>
                      <button
                        type="button"
                        onClick={handleToggleActive}
                        className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                      >
                        {device.active ? "Wycofaj" : "Przywróć"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Nadchodzące rezerwacje
                </h3>
                <UpcomingRentalsList rentals={device.upcomingRentals} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function DevicesPanel({ devices, isAdmin }: { devices: Device[]; isAdmin: boolean }) {
  const [isAdding, setIsAdding] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncAllMessage, setSyncAllMessage] = useState<string | null>(null);
  const router = useRouter();

  function reload() {
    router.refresh();
  }

  async function handleSyncAll() {
    setIsSyncingAll(true);
    setSyncAllMessage(null);
    const { ok, data } = await api("/api/devices/sync-all", { method: "POST" });
    setIsSyncingAll(false);
    setSyncAllMessage(data?.message || (ok ? "Zsynchronizowano." : "Błąd synchronizacji."));
    if (ok) reload();
  }

  return (
    <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Urządzenia ({devices.length})</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncAll}
            disabled={isSyncingAll}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isSyncingAll ? "Synchronizowanie…" : "Synchronizuj wszystkie urządzenia"}
          </button>
          {isAdmin && !isAdding && (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              Dodaj urządzenie
            </button>
          )}
        </div>
      </div>
      {syncAllMessage && <p className="mb-3 text-xs text-gray-500">{syncAllMessage}</p>}

      {isAdmin && devices.some((d) => d.pricingCategory === null) && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Niektóre urządzenia nie mają skonfigurowanego cennika — wynajem takiego urządzenia będzie wymagał
          ręcznego wpisania ceny. Rozwiń urządzenie i uzupełnij „Kategorię cennika”.
        </p>
      )}

      {isAdding && (
        <div className="mb-4">
          <DeviceForm
            device={null}
            onSaved={() => {
              setIsAdding(false);
              reload();
            }}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} isAdmin={isAdmin} onChanged={reload} />
        ))}
        {devices.length === 0 && <p className="py-6 text-center text-sm text-gray-400">Brak urządzeń.</p>}
      </div>
    </div>
  );
}
