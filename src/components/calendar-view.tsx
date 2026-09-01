"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Device, Rental } from "@/components/rental-form";
import { BASE_PATH } from "@/lib/base-path";
import { withDeliveryTimePrefix } from "@/lib/rental-title";
import { CalendarAlerts } from "@/components/calendar-alerts";
import type { RentalAlert } from "@/lib/rental-alerts";

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

// WCAG relative luminance: picks black or white text, whichever contrasts
// better against a given device color — pastel swatches need dark text,
// saturated ones need white.
function readableTextColor(hex: string): string {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return "#ffffff";
  const [r, g, b] = match.slice(1).map((c) => {
    const channel = parseInt(c, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "#1f2937" : "#ffffff";
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
  alertIds,
  monthContext,
  variant,
  canEdit,
  dragOverDay,
  onDragOverDay,
  onDragLeaveRow,
  onDropDay,
  onOpenCreate,
  onOpenEdit,
}: {
  weekDays: Date[];
  rentals: RawRental[];
  alertIds: Set<string>;
  monthContext?: Date;
  variant: "month" | "week";
  canEdit: boolean;
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
      className="relative grid flex-1 grid-cols-7"
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault();
              onDragOverDay(resolveDay(e));
            }
          : undefined
      }
      onDragLeave={
        canEdit
          ? (e) => {
              const related = e.relatedTarget as Node | null;
              if (!related || !e.currentTarget.contains(related)) onDragLeaveRow();
            }
          : undefined
      }
      onDrop={
        canEdit
          ? (e) => {
              e.preventDefault();
              onDropDay(resolveDay(e), e);
            }
          : undefined
      }
    >
      {weekDays.map((day) => {
        const inMonth = monthContext ? day.getMonth() === monthContext.getMonth() : true;
        const isToday = isSameDay(day, new Date());
        const isOver = dragOverDay === day.toISOString();
        return (
          <div
            key={day.toISOString()}
            onClick={canEdit ? () => onOpenCreate(day) : undefined}
            title={canEdit ? "Nowa rezerwacja" : undefined}
            className={`border-b border-r border-gray-300 p-1.5 pt-1 ${canEdit ? "cursor-pointer hover:bg-gray-50" : ""} ${
              isOver
                ? "bg-blue-50"
                : isToday
                  ? "bg-amber-50"
                  : isPastDay(day)
                    ? "bg-gray-200"
                    : !inMonth
                      ? "bg-gray-50"
                      : ""
            }`}
            style={{ minHeight: cellMinHeight }}
          >
            <span className={`text-xs ${isToday ? "font-bold text-gray-900" : "text-gray-400"}`}>
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
            draggable={canEdit}
            onDragStart={
              canEdit
                ? (e) => {
                    e.dataTransfer.setData("text/plain", s.rental.id);
                    e.dataTransfer.effectAllowed = "move";
                  }
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              onOpenEdit(s.rental);
            }}
            className={`pointer-events-auto absolute flex items-center gap-1 overflow-hidden rounded px-1.5 text-left text-xs shadow-sm ${
              alertIds.has(s.rental.id) ? "ring-2 ring-inset ring-red-600" : ""
            }`}
            style={{
              left: `calc(${(s.startCol / 7) * 100}% + 2px)`,
              width: `calc(${(s.span / 7) * 100}% - 4px)`,
              top: s.lane * (WEEK_ROW_BAR_HEIGHT + WEEK_ROW_BAR_GAP),
              height: WEEK_ROW_BAR_HEIGHT,
              backgroundColor: s.rental.device.color,
              color: readableTextColor(s.rental.device.color),
            }}
            title={withDeliveryTimePrefix(s.rental.title, s.rental.deliveryTime)}
          >
            {alertIds.has(s.rental.id) && (
              <span className="flex-none font-bold" title="Brak kierowcy / kontaktu / telefonu">
                ⚠
              </span>
            )}
            {s.rental.hubspotContactId && <ContactBadge name={s.rental.contactNameCache} />}
            {s.rental.driver && <DriverBadge name={s.rental.driver.name} />}
            <span className="truncate">
              {variant === "week" && !s.rental.allDay
                ? `${formatTime(s.rental.startsAt)}–${formatTime(s.rental.endsAt)} ${withDeliveryTimePrefix(s.rental.title, s.rental.deliveryTime)}`
                : withDeliveryTimePrefix(s.rental.title, s.rental.deliveryTime)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ContactBadge({ name }: { name?: string | null }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 flex-none">
      <title>{name?.trim() ? `Kontakt: ${name.trim()}` : "Przypisany kontakt"}</title>
      <path d="M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.31 0-6 2.24-6 5v1h12v-1c0-2.76-2.69-5-6-5Z" />
    </svg>
  );
}

// Steering-wheel icon; the SVG <title> is the hover tooltip (same native
// mechanism as ContactBadge) and names the assigned driver.
function DriverBadge({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 flex-none">
      <title>{`Kierowca: ${name}`}</title>
      <path
        fillRule="evenodd"
        d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM3.06 9.25a7 7 0 0 1 13.88 0h-3.2a3.75 3.75 0 0 0-7.48 0h-3.2Zm6.19 1.5a3.75 3.75 0 0 0 .75 1.9v3.28a7 7 0 0 1-5.6-5.18h4.85Zm1.5 5.18v-3.28a3.75 3.75 0 0 0 .75-1.9h4.85a7 7 0 0 1-5.6 5.18ZM10 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-4 w-4 flex-none transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Remembers the month/week the calendar was showing so that opening a rental
// and coming back (Anuluj, Zapisz, browser back) returns to the same place
// instead of snapping to today. Per-tab, cleared when the tab closes.
const VIEW_STATE_KEY = "kalendarz:view";

export function CalendarView({
  devices,
  canEdit = true,
  alerts = [],
}: {
  devices: Device[];
  canEdit?: boolean;
  alerts?: RentalAlert[];
}) {
  const router = useRouter();
  const alertIds = useMemo(() => new Set(alerts.map((a) => a.id)), [alerts]);
  const [mode, setMode] = useState<"month" | "week">("month");
  const [current, setCurrent] = useState(() => new Date());
  const viewStateRestored = useRef(false);

  // Restore once on mount (not in a lazy initializer — that would diverge
  // from the server-rendered markup and warn about a hydration mismatch).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(VIEW_STATE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { mode?: unknown; current?: unknown };
        if (saved.mode === "month" || saved.mode === "week") setMode(saved.mode);
        if (typeof saved.current === "number" && Number.isFinite(saved.current)) {
          setCurrent(new Date(saved.current));
        }
      }
    } catch {
      // sessionStorage unavailable or malformed — fall back to defaults.
    }
    viewStateRestored.current = true;
  }, []);

  useEffect(() => {
    if (!viewStateRestored.current) return;
    try {
      sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ mode, current: current.getTime() }));
    } catch {
      // Ignore (private mode, quota, etc.) — navigation still works.
    }
  }, [mode, current]);
  const [checkedDeviceIds, setCheckedDeviceIds] = useState<Set<string>>(() => new Set(devices.map((d) => d.id)));
  const [rentals, setRentals] = useState<RawRental[]>([]);
  const [isLoading, startLoading] = useTransition();
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [mobileDeviceFilterOpen, setMobileDeviceFilterOpen] = useState(false);

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
      const res = await fetch(`${BASE_PATH}/api/rentals?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`, {
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

  function navigate(step: number) {
    setCurrent((prev) => (mode === "month" ? new Date(prev.getFullYear(), prev.getMonth() + step, 1) : addDays(prev, step * 7)));
  }

  function openEdit(rental: RawRental) {
    router.push(`/kalendarz/wynajem/${rental.id}`);
  }

  function openCreate(day?: Date) {
    const params = day ? `?date=${encodeURIComponent(day.toISOString())}` : "";
    router.push(`/kalendarz/wynajem/nowy${params}`);
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
    const res = await fetch(`${BASE_PATH}/api/rentals/${rentalId}`, {
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

  const deviceList = (
    <>
      {devices.map((device) => (
        <label key={device.id} className="flex items-center gap-1.5 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={checkedDeviceIds.has(device.id)}
            onChange={() => toggleDevice(device.id)}
          />
          <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: device.color }} />
          <span className="truncate">{device.name}</span>
          {!device.active && <span className="flex-none text-xs text-gray-400">(wycofane)</span>}
        </label>
      ))}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Desktop sidebar — Google Calendar-style device list */}
      <aside className="hidden w-60 flex-none flex-col gap-4 border-r border-gray-200 bg-white p-4 lg:flex">
        {canEdit && (
          <button
            type="button"
            onClick={() => openCreate()}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            + Nowa rezerwacja
          </button>
        )}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Urządzenia</p>
          {deviceList}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
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
            {canEdit && (
              <button
                type="button"
                onClick={() => openCreate()}
                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 lg:hidden"
              >
                Nowa rezerwacja
              </button>
            )}
          </div>
        </div>

        {/* Mobile/tablet device filter — sidebar takes over on lg+ */}
        <div className="border-b border-gray-200 bg-white lg:hidden">
          <button
            type="button"
            onClick={() => setMobileDeviceFilterOpen((v) => !v)}
            aria-expanded={mobileDeviceFilterOpen}
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-700"
          >
            Filtruj urządzenia
            <ChevronIcon open={mobileDeviceFilterOpen} />
          </button>
          {mobileDeviceFilterOpen && (
            <div className="flex flex-wrap gap-3 border-t border-gray-200 p-3">{deviceList}</div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
          <CalendarAlerts alerts={alerts} />
          {isLoading && <p className="mb-2 text-sm text-gray-400">Ładowanie…</p>}
          {dragError && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>{dragError}</span>
              <button type="button" onClick={() => setDragError(null)} className="text-red-500 hover:text-red-700">
                ✕
              </button>
            </div>
          )}

          <div className="flex min-h-0 min-w-[640px] flex-1 flex-col">
            {mode === "month" ? (
              <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-500">
                  {WEEKDAY_LABELS.map((label) => (
                    <div key={label} className="px-2 py-2">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="flex flex-1 flex-col">
                  {weeksOf(monthGridDays(current)).map((weekDays) => (
                    <CalendarWeekRow
                      key={weekDays[0].toISOString()}
                      weekDays={weekDays}
                      rentals={visibleRentals.filter((r) => weekDays.some((d) => rentalTouchesDay(r, d)))}
                      alertIds={alertIds}
                      monthContext={current}
                      variant="month"
                      canEdit={canEdit}
                      dragOverDay={dragOverDay}
                      onDragOverDay={(day) => setDragOverDay(day.toISOString())}
                      onDragLeaveRow={() => setDragOverDay(null)}
                      onDropDay={handleDropOnDay}
                      onOpenCreate={openCreate}
                      onOpenEdit={openEdit}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
                <CalendarWeekRow
                  weekDays={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(current), i))}
                  rentals={visibleRentals}
                  alertIds={alertIds}
                  variant="week"
                  canEdit={canEdit}
                  dragOverDay={dragOverDay}
                  onDragOverDay={(day) => setDragOverDay(day.toISOString())}
                  onDragLeaveRow={() => setDragOverDay(null)}
                  onDropDay={handleDropOnDay}
                  onOpenCreate={openCreate}
                  onOpenEdit={openEdit}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
