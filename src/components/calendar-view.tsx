"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { RentalModal, type Device, type Rental } from "@/components/rental-modal";

type RawRental = Rental & { device: Device };

const WEEKDAY_LABELS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
const MONTH_LABELS = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = (result.getDay() + 6) % 7; // Monday = 0
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, n: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + n);
  return result;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthGridDays(reference: Date): Date[] {
  const firstOfMonth = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

function formatRentalDate(iso: string, allDay: boolean): string {
  const date = new Date(iso);
  return allDay
    ? date.toLocaleDateString("pl-PL")
    : date.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

function ContactBadge() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3 w-3 flex-none"
      aria-hidden="true"
    >
      <title>Przypisany kontakt</title>
      <path d="M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.31 0-6 2.24-6 5v1h12v-1c0-2.76-2.69-5-6-5Z" />
    </svg>
  );
}

export function CalendarView({ devices }: { devices: Device[] }) {
  const [mode, setMode] = useState<"month" | "week">("month");
  const [current, setCurrent] = useState(() => new Date());
  const [checkedDeviceIds, setCheckedDeviceIds] = useState<Set<string>>(() => new Set(devices.map((d) => d.id)));
  const [rentals, setRentals] = useState<RawRental[]>([]);
  const [isLoading, startLoading] = useTransition();
  const [modalState, setModalState] = useState<{ rental: Rental | null; defaultDeviceId?: string; defaultDate?: Date } | null>(
    null,
  );

  const rangeStart = useMemo(
    () => (mode === "month" ? monthGridDays(current)[0] : startOfWeek(current)),
    [mode, current],
  );
  const rangeEnd = useMemo(
    () => addDays(rangeStart, mode === "month" ? 42 : 7),
    [rangeStart, mode],
  );

  const fetchRentals = useCallback(
    async (signal?: AbortSignal) => {
      const res = await fetch(`/wynajem/api/rentals?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`, {
        signal,
      });
      const data = await res.json();
      setRentals(Array.isArray(data?.rentals) ? data.rentals : []);
    },
    [rangeStart, rangeEnd],
  );

  useEffect(() => {
    const controller = new AbortController();
    startLoading(async () => {
      try {
        await fetchRentals(controller.signal);
      } catch {
        // Aborted or transient — the next effect run (or reload()) will retry.
      }
    });
    return () => controller.abort();
  }, [fetchRentals]);

  function reload() {
    setModalState(null);
    startLoading(() => fetchRentals());
  }

  function refreshQuietly() {
    startLoading(() => fetchRentals());
  }

  function toggleDevice(id: string) {
    setCheckedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleRentals = rentals.filter((r) => checkedDeviceIds.has(r.deviceId));
  const sortedRentals = [...visibleRentals].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  function rentalsForDay(day: Date): RawRental[] {
    return visibleRentals
      .filter((r) => {
        const start = new Date(r.startsAt);
        const end = new Date(r.endsAt);
        return start < addDays(day, 1) && end >= day;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }

  function navigate(step: number) {
    setCurrent((prev) => (mode === "month" ? new Date(prev.getFullYear(), prev.getMonth() + step, 1) : addDays(prev, step * 7)));
  }

  function openEdit(rental: RawRental) {
    setModalState({ rental });
  }

  function openCreate(day?: Date) {
    setModalState({ rental: null, defaultDate: day });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setCurrent(new Date())}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Dziś
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            →
          </button>
          <h2 className="ml-2 text-lg font-semibold text-gray-900">
            {mode === "month"
              ? `${MONTH_LABELS[current.getMonth()]} ${current.getFullYear()}`
              : `Tydzień od ${startOfWeek(current).toLocaleDateString("pl-PL")}`}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-gray-300 overflow-hidden">
            <button
              type="button"
              onClick={() => setMode("month")}
              className={`px-3 py-2 text-sm font-medium ${mode === "month" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              Miesiąc
            </button>
            <button
              type="button"
              onClick={() => setMode("week")}
              className={`px-3 py-2 text-sm font-medium ${mode === "week" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              Tydzień
            </button>
          </div>
          <button
            type="button"
            onClick={() => openCreate()}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Nowa rezerwacja
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-3">
        {devices.map((device) => (
          <label key={device.id} className="flex items-center gap-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={checkedDeviceIds.has(device.id)}
              onChange={() => toggleDevice(device.id)}
            />
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: device.color }} />
            {device.name}
            {!device.active && <span className="text-xs text-gray-400">(wycofane)</span>}
          </label>
        ))}
      </div>

      {isLoading && <p className="mb-2 text-sm text-gray-400">Ładowanie…</p>}

      {mode === "month" ? (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-500">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="px-2 py-2">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthGridDays(current).map((day) => {
              const dayRentals = rentalsForDay(day);
              const inMonth = day.getMonth() === current.getMonth();
              return (
                <div
                  key={day.toISOString()}
                  className={`min-h-[6rem] border-b border-r border-gray-100 p-1.5 ${inMonth ? "" : "bg-gray-50"}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`text-xs ${isSameDay(day, new Date()) ? "font-bold text-gray-900" : "text-gray-400"}`}>
                      {day.getDate()}
                    </span>
                    <button
                      type="button"
                      onClick={() => openCreate(day)}
                      className="text-xs text-gray-300 hover:text-gray-600"
                      title="Nowa rezerwacja"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {dayRentals.map((rental) => (
                      <button
                        key={rental.id}
                        type="button"
                        onClick={() => openEdit(rental)}
                        className="flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-xs text-white"
                        style={{ backgroundColor: rental.device.color }}
                        title={rental.title}
                      >
                        {rental.hubspotContactId && <ContactBadge />}
                        <span className="truncate">{rental.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="grid grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(current), i)).map((day) => {
              const dayRentals = rentalsForDay(day);
              return (
                <div key={day.toISOString()} className="min-h-[16rem] border-r border-gray-100 p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <p className={`text-sm font-medium ${isSameDay(day, new Date()) ? "text-gray-900" : "text-gray-500"}`}>
                      {WEEKDAY_LABELS[(day.getDay() + 6) % 7]} {day.getDate()}
                    </p>
                    <button
                      type="button"
                      onClick={() => openCreate(day)}
                      className="text-xs text-gray-300 hover:text-gray-600"
                      title="Nowa rezerwacja"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {dayRentals.map((rental) => (
                      <button
                        key={rental.id}
                        type="button"
                        onClick={() => openEdit(rental)}
                        className="flex flex-col gap-0.5 rounded px-2 py-1 text-left text-xs text-white"
                        style={{ backgroundColor: rental.device.color }}
                      >
                        <span className="flex items-center gap-1">
                          {rental.hubspotContactId && <ContactBadge />}
                          <span className="font-medium">
                            {rental.allDay ? "Cały dzień" : `${formatTime(rental.startsAt)}–${formatTime(rental.endsAt)}`}
                          </span>
                        </span>
                        <span className="truncate">{rental.title}</span>
                      </button>
                    ))}
                    {dayRentals.length === 0 && <p className="text-xs text-gray-300">—</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Zaplanowane wynajmy</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500">
              <tr>
                <th className="px-3 py-2">Urządzenie</th>
                <th className="px-3 py-2">Rozpoczęcie</th>
                <th className="px-3 py-2">Zakończenie</th>
                <th className="px-3 py-2">Kontakt</th>
                <th className="px-3 py-2">Firma</th>
                <th className="px-3 py-2">Adres dostawy (wkrótce)</th>
                <th className="px-3 py-2">Data dostawy (wkrótce)</th>
                <th className="px-3 py-2">Data odbioru (wkrótce)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedRentals.map((rental) => (
                <tr
                  key={rental.id}
                  onClick={() => openEdit(rental)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5 font-medium text-gray-900">
                      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: rental.device.color }} />
                      {rental.device.name}
                    </span>
                    <span className="text-xs text-gray-400">{rental.title}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {formatRentalDate(rental.startsAt, rental.allDay)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {formatRentalDate(rental.endsAt, rental.allDay)}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{rental.contactNameCache || "—"}</td>
                  <td className="px-3 py-2 text-gray-700">{rental.contactCompanyCache || "—"}</td>
                  <td className="px-3 py-2 text-gray-300">—</td>
                  <td className="px-3 py-2 text-gray-300">—</td>
                  <td className="px-3 py-2 text-gray-300">—</td>
                </tr>
              ))}
              {sortedRentals.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                    Brak zaplanowanych wynajmów w tym okresie.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalState && (
        <RentalModal
          devices={devices}
          rental={modalState.rental}
          defaultDeviceId={modalState.defaultDeviceId}
          defaultDate={modalState.defaultDate}
          onClose={() => setModalState(null)}
          onSaved={reload}
          onDeleted={reload}
          onContactChanged={refreshQuietly}
        />
      )}
    </div>
  );
}
