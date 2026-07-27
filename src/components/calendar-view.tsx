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

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function isPastDay(day: Date): boolean {
  return day < startOfToday();
}

function monthGridDays(reference: Date): Date[] {
  const firstOfMonth = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

function weeksOf(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
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

function rentalTouchesDay(rental: RawRental, day: Date): boolean {
  const start = new Date(rental.startsAt);
  const end = new Date(rental.endsAt);
  return start < addDays(day, 1) && end >= day;
}

type WeekSpan = { rental: RawRental; startCol: number; span: number; lane: number };

// Greedy interval-scheduling: sorts by start (then longest first) and packs each
// rental into the first lane whose last-occupied column doesn't overlap it, so
// multi-day rentals render as one continuous bar instead of per-day chips.
function computeWeekSpans(weekDays: Date[], rentals: RawRental[]): WeekSpan[] {
  const items = rentals
    .map((rental) => {
      let startCol = -1;
      let endCol = -1;
      weekDays.forEach((day, i) => {
        if (rentalTouchesDay(rental, day)) {
          if (startCol === -1) startCol = i;
          endCol = i;
        }
      });
      return { rental, startCol, endCol };
    })
    .filter((item) => item.startCol !== -1)
    .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));

  const laneEnds: number[] = [];
  return items.map((item) => {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= item.startCol) lane++;
    laneEnds[lane] = item.endCol;
    return { rental: item.rental, startCol: item.startCol, span: item.endCol - item.startCol + 1, lane };
  });
}

const WEEK_ROW_HEADER_HEIGHT = 20;
const WEEK_ROW_BAR_HEIGHT = 20;
const WEEK_ROW_BAR_GAP = 3;

function CalendarWeekRow({
  weekDays,
  rentals,
  monthContext,
  variant,
  dragOverDay,
  onDragOverDay,
  onDragLeaveRow,
  onDropDay,
  onOpenCreate,
  onOpenEdit,
}: {
  weekDays: Date[];
  rentals: RawRental[];
  monthContext?: Date;
  variant: "month" | "week";
  dragOverDay: string | null;
  onDragOverDay: (day: Date) => void;
  onDragLeaveRow: () => void;
  onDropDay: (day: Date, event: React.DragEvent) => void;
  onOpenCreate: (day: Date) => void;
  onOpenEdit: (rental: RawRental) => void;
}) {
  const spans = useMemo(() => computeWeekSpans(weekDays, rentals), [weekDays, rentals]);
  const laneCount = spans.reduce((max, s) => Math.max(max, s.lane + 1), 0);
  const barsAreaHeight = laneCount * (WEEK_ROW_BAR_HEIGHT + WEEK_ROW_BAR_GAP);
  const cellMinHeight =
    variant === "month"
      ? Math.max(96, WEEK_ROW_HEADER_HEIGHT + barsAreaHeight + 8)
      : Math.max(256, WEEK_ROW_HEADER_HEIGHT + barsAreaHeight + 8);

  function resolveDay(event: React.DragEvent<HTMLDivElement>): Date {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const idx = Math.min(6, Math.max(0, Math.floor(ratio * 7)));
    return weekDays[idx];
  }

  return (
    <div
      className="relative grid grid-cols-7"
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverDay(resolveDay(e));
      }}
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        if (!related || !e.currentTarget.contains(related)) onDragLeaveRow();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropDay(resolveDay(e), e);
      }}
    >
      {weekDays.map((day) => {
        const inMonth = monthContext ? day.getMonth() === monthContext.getMonth() : true;
        const isToday = isSameDay(day, new Date());
        const isOver = dragOverDay === day.toISOString();
        return (
          <div
            key={day.toISOString()}
            onClick={() => onOpenCreate(day)}
            title="Nowa rezerwacja"
            className={`cursor-pointer border-b border-r border-gray-100 p-1.5 pt-1 hover:bg-gray-50 ${
              isOver
                ? "bg-blue-50"
                : isToday
                  ? "bg-amber-50"
                  : isPastDay(day)
                    ? "bg-gray-100"
                    : !inMonth
                      ? "bg-gray-50"
                      : ""
            }`}
            style={{ minHeight: cellMinHeight }}
          >
            <span
              className={`text-xs ${isToday ? "font-bold text-gray-900" : isPastDay(day) ? "text-gray-300" : "text-gray-400"}`}
            >
              {variant === "week" ? `${WEEKDAY_LABELS[(day.getDay() + 6) % 7]} ${day.getDate()}` : day.getDate()}
            </span>
          </div>
        );
      })}
      <div className="pointer-events-none absolute inset-x-0" style={{ top: WEEK_ROW_HEADER_HEIGHT }}>
        {spans.map((s) => (
          <button
            key={s.rental.id}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", s.rental.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenEdit(s.rental);
            }}
            className="pointer-events-auto absolute flex items-center gap-1 overflow-hidden rounded px-1.5 text-left text-xs text-white shadow-sm"
            style={{
              left: `calc(${(s.startCol / 7) * 100}% + 2px)`,
              width: `calc(${(s.span / 7) * 100}% - 4px)`,
              top: s.lane * (WEEK_ROW_BAR_HEIGHT + WEEK_ROW_BAR_GAP),
              height: WEEK_ROW_BAR_HEIGHT,
              backgroundColor: s.rental.device.color,
            }}
            title={s.rental.title}
          >
            {s.rental.hubspotContactId && <ContactBadge />}
            <span className="truncate">
              {variant === "week" && !s.rental.allDay
                ? `${formatTime(s.rental.startsAt)}–${formatTime(s.rental.endsAt)} ${s.rental.title}`
                : s.rental.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
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
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

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

  function navigate(step: number) {
    setCurrent((prev) => (mode === "month" ? new Date(prev.getFullYear(), prev.getMonth() + step, 1) : addDays(prev, step * 7)));
  }

  function openEdit(rental: RawRental) {
    setModalState({ rental });
  }

  function openCreate(day?: Date) {
    setModalState({ rental: null, defaultDate: day });
  }

  async function handleDropOnDay(day: Date, event: React.DragEvent) {
    event.preventDefault();
    setDragOverDay(null);

    const rentalId = event.dataTransfer.getData("text/plain");
    if (!rentalId) return;
    const rental = rentals.find((r) => r.id === rentalId);
    if (!rental) return;

    const originalStartDay = new Date(rental.startsAt);
    originalStartDay.setHours(0, 0, 0, 0);
    const targetDay = new Date(day);
    targetDay.setHours(0, 0, 0, 0);
    const deltaDays = Math.round((targetDay.getTime() - originalStartDay.getTime()) / 86_400_000);
    if (deltaDays === 0) return;

    const newStart = addDays(new Date(rental.startsAt), deltaDays);
    const newEnd = addDays(new Date(rental.endsAt), deltaDays);

    setDragError(null);
    const res = await fetch(`/wynajem/api/rentals/${rentalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startsAt: newStart.toISOString(), endsAt: newEnd.toISOString() }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setDragError(data?.message || "Nie udało się przenieść rezerwacji.");
      return;
    }
    refreshQuietly();
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
      {dragError && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{dragError}</span>
          <button type="button" onClick={() => setDragError(null)} className="text-red-500 hover:text-red-700">
            ✕
          </button>
        </div>
      )}

      {mode === "month" ? (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-500">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="px-2 py-2">
                {label}
              </div>
            ))}
          </div>
          {weeksOf(monthGridDays(current)).map((weekDays) => (
            <CalendarWeekRow
              key={weekDays[0].toISOString()}
              weekDays={weekDays}
              rentals={visibleRentals.filter((r) => weekDays.some((d) => rentalTouchesDay(r, d)))}
              monthContext={current}
              variant="month"
              dragOverDay={dragOverDay}
              onDragOverDay={(day) => setDragOverDay(day.toISOString())}
              onDragLeaveRow={() => setDragOverDay(null)}
              onDropDay={handleDropOnDay}
              onOpenCreate={openCreate}
              onOpenEdit={openEdit}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <CalendarWeekRow
            weekDays={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(current), i))}
            rentals={visibleRentals}
            variant="week"
            dragOverDay={dragOverDay}
            onDragOverDay={(day) => setDragOverDay(day.toISOString())}
            onDragLeaveRow={() => setDragOverDay(null)}
            onDropDay={handleDropOnDay}
            onOpenCreate={openCreate}
            onOpenEdit={openEdit}
          />
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
