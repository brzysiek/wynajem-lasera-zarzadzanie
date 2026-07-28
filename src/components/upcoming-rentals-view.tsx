"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Device, Rental } from "@/components/rental-form";
import { BASE_PATH } from "@/lib/base-path";

type RawRental = Rental & { device: Device };

type Grouping = "none" | "device" | "week";

function addDays(date: Date, n: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + n);
  return result;
}

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = (result.getDay() + 6) % 7; // Monday = 0
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function formatRentalDate(iso: string, allDay: boolean): string {
  const date = new Date(iso);
  return allDay
    ? date.toLocaleDateString("pl-PL")
    : date.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const startStr = weekStart.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  const endStr = weekEnd.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
  return `${startStr} – ${endStr}`;
}

function RentalsTable({ rentals, onOpenEdit }: { rentals: RawRental[]; onOpenEdit: (rental: RawRental) => void }) {
  return (
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
          {rentals.map((rental) => (
            <tr key={rental.id} onClick={() => onOpenEdit(rental)} className="cursor-pointer hover:bg-gray-50">
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
        </tbody>
      </table>
    </div>
  );
}

export function UpcomingRentalsView({ devices }: { devices: Device[] }) {
  const router = useRouter();
  const [rentals, setRentals] = useState<RawRental[]>([]);
  const [isLoading, startLoading] = useTransition();
  const [grouping, setGrouping] = useState<Grouping>("none");
  const [clientFilter, setClientFilter] = useState("");

  function fetchRentals() {
    startLoading(async () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = addDays(from, 365 * 3);
      const res = await fetch(`${BASE_PATH}/api/rentals?from=${from.toISOString()}&to=${to.toISOString()}`);
      const data = await res.json().catch(() => null);
      setRentals(Array.isArray(data?.rentals) ? data.rentals : []);
    });
  }

  useEffect(() => {
    fetchRentals();
  }, []);

  function openEdit(rental: RawRental) {
    router.push(`/kalendarz/wynajem/${rental.id}?from=/nadchodzace`);
  }

  const now = useMemo(() => new Date(), []);
  const filteredRentals = useMemo(() => {
    const upcoming = rentals.filter((r) => new Date(r.endsAt) >= now);
    const query = clientFilter.trim().toLowerCase();
    if (!query) return upcoming;
    return upcoming.filter((r) => (r.contactNameCache || "").toLowerCase().includes(query));
  }, [rentals, now, clientFilter]);

  const sortedRentals = useMemo(
    () => [...filteredRentals].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [filteredRentals],
  );

  const groups = useMemo(() => {
    if (grouping === "none") {
      return [{ key: "all", label: null as string | null, rentals: sortedRentals }];
    }
    if (grouping === "device") {
      const byDevice = new Map<string, RawRental[]>();
      for (const rental of sortedRentals) {
        const list = byDevice.get(rental.deviceId) ?? [];
        list.push(rental);
        byDevice.set(rental.deviceId, list);
      }
      return devices
        .filter((d) => byDevice.has(d.id))
        .map((d) => ({ key: d.id, label: d.name, rentals: byDevice.get(d.id) ?? [] }));
    }
    // grouping === "week"
    const byWeek = new Map<string, RawRental[]>();
    for (const rental of sortedRentals) {
      const weekKey = startOfWeek(new Date(rental.startsAt)).toISOString();
      const list = byWeek.get(weekKey) ?? [];
      list.push(rental);
      byWeek.set(weekKey, list);
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekKey, weekRentals]) => ({
        key: weekKey,
        label: formatWeekLabel(new Date(weekKey)),
        rentals: weekRentals,
      }));
  }, [grouping, sortedRentals, devices]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          placeholder="Filtruj po kliencie…"
          className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
        />
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <span>Grupuj:</span>
          <div className="flex rounded-md border border-gray-300 text-xs">
            {(
              [
                { key: "none", label: "Brak" },
                { key: "device", label: "Po urządzeniu" },
                { key: "week", label: "Po tygodniu" },
              ] as { key: Grouping; label: string }[]
            ).map((opt, i, arr) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setGrouping(opt.key)}
                className={`px-2 py-1 font-medium ${i === 0 ? "rounded-l-md" : ""} ${
                  i === arr.length - 1 ? "rounded-r-md" : ""
                } ${grouping === opt.key ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && rentals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
          Ładowanie…
        </div>
      ) : sortedRentals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-400">
          {clientFilter.trim() ? "Brak wynajmów dla podanego klienta." : "Brak nadchodzących wynajmów."}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              {group.label && (
                <div className="border-b border-gray-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-gray-900">{group.label}</h3>
                </div>
              )}
              <RentalsTable rentals={group.rentals} onOpenEdit={openEdit} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
