"use client";

import { useMemo, useState } from "react";
import {
  computeHeatmap,
  WEEKDAY_SHORT,
  type HeatDay,
  type HeatMetric,
} from "@/lib/revenue/heatmap";
import type { RevenueRow } from "@/lib/revenue/aggregate";

const C = {
  surface: "#FFFFFF",
  bg: "#F1F3F6",
  border: "#E2E6EC",
  text: "#171A21",
  muted: "#6B7280",
  faint: "#9CA3AF",
  brand: "#2F6FD1",
  brandSoft: "#EAF1FC",
  green: "#1E9E6B",
};

// Skala 5 poziomów z mockupu (heat-1..heat-5).
const HEAT: ({ bg: string; fg: string } | null)[] = [
  null,
  { bg: "#E3ECFA", fg: "#3B5C8C" },
  { bg: "#BFD4F3", fg: "#2C4A78" },
  { bg: "#8FB0E8", fg: "#1F3A66" },
  { bg: "#5685D9", fg: "#FFFFFF" },
  { bg: "#2F5FC4", fg: "#FFFFFF" },
];

type PeriodMeta = { mode: "month" | "range" | "season"; label: string; start: string; end: string };

function fmtPln(n: number): string {
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(Math.round(n))} zł`;
}
function compact(n: number): string {
  if (n <= 0) return "";
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  return `${k.toFixed(k >= 10 ? 0 : 1).replace(".", ",")}k`;
}

function cellText(d: HeatDay, metric: HeatMetric): string {
  if (metric === "occupancy") {
    if (d.occY == null) return "";
    if (d.occY === 1) return ""; // binarne — sam kolor (mockup)
    return `${d.occX}/${d.occY}`;
  }
  if (metric === "count") return d.value > 0 ? String(Math.round(d.value)) : "";
  return compact(d.value);
}

function cellTitle(d: HeatDay, metric: HeatMetric): string {
  if (!d.inPeriod) return "";
  if (metric === "occupancy") return d.occY ? `${d.key}: ${d.occX}/${d.occY} urządzeń zajętych` : d.key;
  if (metric === "count") return `${d.key}: ${Math.round(d.value)} wynajmów`;
  return `${d.key}: ${fmtPln(d.value)}`;
}

export function RevenueHeatmap({
  rows,
  devices,
  period,
}: {
  rows: RevenueRow[];
  devices: { id: string; name: string }[];
  period: PeriodMeta;
}) {
  const [metric, setMetric] = useState<HeatMetric>("revenue");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(devices.map((d) => d.id)));

  const heat = useMemo(
    () => computeHeatmap(rows, selected, period, metric),
    [rows, selected, period, metric],
  );

  const allSelected = selected.size === devices.length && devices.length > 0;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(devices.map((d) => d.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const maxWd = heat.weekdayAgg.reduce((m, w) => Math.max(m, w.value), 0);

  return (
    <>
      {/* ---- kontrolki ---- */}
      <div className="mx-7 mt-5 flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-full border p-[3px]"
          style={{ background: C.bg, borderColor: C.border }}
        >
          {(
            [
              ["revenue", "Przychód"],
              ["count", "Liczba wynajmów"],
              ["occupancy", "Obłożenie"],
            ] as const
          ).map(([m, lbl]) => {
            const active = metric === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold"
                style={active ? { background: C.surface, color: C.text, boxShadow: "0 1px 3px rgba(0,0,0,.08)" } : { color: C.muted }}
              >
                {lbl}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: C.faint }}>
          Mniej
          {[1, 2, 3, 4, 5].map((l) => (
            <span key={l} className="h-3.5 w-3.5 rounded-[3px]" style={{ background: HEAT[l]!.bg }} />
          ))}
          Więcej
        </div>
      </div>

      {/* ---- filtr urządzeń: płaski rząd checkboxów ---- */}
      <div className="mx-7 mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span className="flex-shrink-0 text-[12.5px] font-bold" style={{ color: C.muted }}>
          Urządzenia:
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {devices.map((d) => {
            const on = selected.has(d.id);
            return (
              <label
                key={d.id}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border py-[5px] pl-2 pr-3 text-[12.5px] font-semibold"
                style={
                  on
                    ? { background: C.brandSoft, borderColor: "#CFE0F8", color: C.brand }
                    : { background: C.surface, borderColor: C.border, color: C.muted }
                }
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(d.id)}
                  className="h-3.5 w-3.5"
                  style={{ accentColor: C.brand }}
                />
                {d.name}
              </label>
            );
          })}
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="ml-auto flex-shrink-0 text-[12px] font-semibold"
          style={{ color: C.brand }}
        >
          {allSelected ? "odznacz wszystkie" : "zaznacz wszystkie"}
        </button>
      </div>

      {/* ---- nota o metryce Obłożenie ---- */}
      {metric === "occupancy" && (
        <div
          className="mx-7 mt-3.5 rounded-[9px] border px-3.5 py-[11px] text-[12px] leading-[1.5]"
          style={{ background: "#F3EBFF", borderColor: "#E4D3FF", color: "#4C1D95" }}
        >
          <b style={{ color: "#7C3AED" }}>Obłożenie</b> liczy się inaczej niż pozostałe dwie metryki: dla każdego
          dnia sprawdza, ile z wybranych urządzeń było tego dnia fizycznie w trakcie wynajmu (cały zakres dat
          wynajmu, nie tylko dzień rozpoczęcia) — stąd „X/Y” zamiast kwoty. Kolor komórki zależy od{" "}
          <i>proporcji</i> (2 z 4 = 50%), nie od surowej liczby.
        </div>
      )}

      {/* ---- siatka ---- */}
      {heat.empty ? (
        <div className="px-7 py-14 text-center text-[13px]" style={{ color: C.faint }}>
          Wybierz co najmniej jedno urządzenie.
        </div>
      ) : heat.gridMode === "month" ? (
        <MonthGrid weeks={heat.weeks} metric={metric} />
      ) : (
        <ContinuousGrid weeks={heat.weeks} metric={metric} />
      )}

      {/* ---- pasek sum per dzień tygodnia ---- */}
      {!heat.empty && (
        <div className="px-7 pb-7 pt-6">
          <div className="mb-1.5 text-[13px] font-bold" style={{ color: C.muted }}>
            {metric === "occupancy"
              ? "Średnie obłożenie wg dnia tygodnia (cały okres)"
              : metric === "revenue"
                ? "Przychód wg dnia tygodnia (cały okres)"
                : "Liczba wynajmów wg dnia tygodnia (cały okres)"}
          </div>
          {heat.bestWeekdayText && (
            <div className="mb-3.5 text-[12.5px]" style={{ color: C.muted }}>
              {(() => {
                const [pre, post] = heat.bestWeekdayText.split(": ");
                const [name, rest] = post.split(" (");
                return (
                  <>
                    {pre}: <b style={{ color: C.brand }}>{name}</b> ({rest}
                  </>
                );
              })()}
            </div>
          )}
          <div className="grid grid-cols-7 items-end gap-2.5" style={{ height: 90 }}>
            {heat.weekdayAgg.map((w) => {
              const h = maxWd > 0 ? Math.max(2, Math.round((w.value / maxWd) * 100)) : 2;
              const valText =
                metric === "occupancy"
                  ? `${Math.round(w.value * 100)}%`
                  : metric === "revenue"
                    ? compact(w.value)
                    : String(Math.round(w.value));
              return (
                <div key={w.weekday} className="flex h-full flex-col items-center justify-end">
                  <div className="mb-1 text-[10.5px]" style={{ color: C.muted }}>
                    {valText}
                  </div>
                  <div
                    className="w-full rounded-t-[5px]"
                    style={{ height: `${h}%`, background: w.isBest ? C.green : C.brand }}
                  />
                  <div className="mt-1.5 text-[10.5px] font-semibold" style={{ color: C.faint }}>
                    {WEEKDAY_SHORT[w.weekday]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function MonthGrid({ weeks, metric }: { weeks: HeatDay[][]; metric: HeatMetric }) {
  return (
    <div className="px-7 pt-5">
      <div className="mb-1.5 grid grid-cols-7 gap-1.5">
        {WEEKDAY_SHORT.map((w) => (
          <span key={w} className="text-center text-[11px] font-bold uppercase" style={{ color: C.faint }}>
            {w}
          </span>
        ))}
      </div>
      {weeks.map((week, i) => (
        <div key={i} className="mb-1.5 grid grid-cols-7 gap-1.5">
          {week.map((d) => {
            const heat = d.level > 0 ? HEAT[d.level] : null;
            return (
              <div
                key={d.key}
                title={cellTitle(d, metric)}
                className="flex flex-col justify-between rounded-lg px-2 py-1.5"
                style={{
                  aspectRatio: "1.35",
                  background: d.inPeriod ? heat?.bg ?? C.bg : "transparent",
                }}
              >
                <span
                  className="text-[11px] font-semibold"
                  style={{
                    color: d.inPeriod ? heat?.fg ?? C.faint : C.faint,
                    opacity: d.inPeriod ? 1 : 0.4,
                  }}
                >
                  {d.dayNum}
                </span>
                {d.inPeriod && (
                  <span className="self-end text-[13px] font-bold" style={{ color: heat?.fg ?? C.text }}>
                    {cellText(d, metric)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ContinuousGrid({ weeks, metric }: { weeks: HeatDay[][]; metric: HeatMetric }) {
  const days = weeks.flat(); // kolejność: tydz0 Pon..Nd, tydz1 Pon..Nd, …
  return (
    <div className="px-7 pt-5">
      <div className="flex gap-2 overflow-x-auto pb-2">
        <div className="flex flex-shrink-0 flex-col gap-[3px] pt-[1px]">
          {WEEKDAY_SHORT.map((w) => (
            <span
              key={w}
              className="text-[9px] font-bold uppercase leading-[13px]"
              style={{ color: C.faint, height: 13 }}
            >
              {w}
            </span>
          ))}
        </div>
        <div
          className="grid flex-shrink-0 gap-[3px]"
          style={{ gridAutoFlow: "column", gridTemplateRows: "repeat(7, 13px)" }}
        >
          {days.map((d) => {
            const heat = d.level > 0 ? HEAT[d.level] : null;
            return (
              <div
                key={d.key}
                title={cellTitle(d, metric)}
                className="h-[13px] w-[13px] rounded-[3px]"
                style={{ background: d.inPeriod ? heat?.bg ?? C.bg : "transparent" }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
