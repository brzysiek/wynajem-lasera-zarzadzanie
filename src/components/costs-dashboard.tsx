"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";
import type {
  CategoryRow,
  DeviceCostRow,
  DriverRow,
  MonthlyCostPoint,
  TrendInsight,
  VehicleRowWithActual,
} from "@/lib/costs/dashboard-aggregate";

type PeriodMeta = {
  mode: "month" | "range" | "season";
  label: string;
  start: string;
  end: string;
};

type Kpis = {
  totalAll: number;
  general: number;
  vehicle: number;
  device: number;
  costPerRental: number | null;
  rentalCount: number;
};

// ---- kolory z mockup-dashboard-kosztow.html ----
// Paleta premium (src/components/shell-tokens.ts, ta sama co wynajemlasera.pl)
// — zastępuje dawną kolorystykę mockup-dashboard-kosztow.html.
const C = {
  bg: "#F2F4F6",
  surface: "#FFFFFF",
  border: "#E9EDF1",
  text: "#4A4A4A",
  muted: "#6F7378",
  faint: "#9AA1A8",
  brand: "#1B6FA8",
  brandSoft: "#EAF4FB",
  accent: "#E08A5C",
  accentSoft: "#FBF0E7",
  green: "#1E9E6B",
  greenSoft: "#E7F7F0",
  red: "#D93025",
  redSoft: "#FCE8E6",
  purple: "#7C3AED",
  purpleSoft: "#F3EBFF",
  gold: "#B5851E",
  goldSoft: "#FBF3E1",
};

function fmtPln(n: number): string {
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(Math.round(n))} zł`;
}
function fmtPln2(n: number): string {
  return `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} zł`;
}
function fmtNum(n: number): string {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(Math.round(n));
}
function Dash() {
  return <span style={{ color: C.faint }}>—</span>;
}

// Odwrócona kolorystyka względem dashboardu przychodów (sekcja 4, punkt 4):
// tu wzrost wydatków = źle = czerwony, spadek = dobrze = zielony.
function CostTrendChip({ value, vsLabel }: { value: number | null; vsLabel: string }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <div className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold" style={{ color: up ? C.red : C.green }}>
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {value}%
      <span className="font-medium" style={{ color: C.faint }}>
        vs {vsLabel}
      </span>
    </div>
  );
}

function KpiCard({ label, amount, sub, trend }: { label: string; amount: string; sub?: string; trend?: React.ReactNode }) {
  return (
    <div className="px-4 py-4 sm:px-[18px] sm:py-[18px]" style={{ background: C.surface }}>
      <div className="text-[11px] font-bold uppercase tracking-[0.03em]" style={{ color: C.faint }}>
        {label}
      </div>
      <div className="mt-1.5 text-[22px] font-extrabold tracking-[-0.01em]" style={{ color: C.text }}>
        {amount}
      </div>
      {sub && (
        <div className="mt-[3px] text-[11.5px]" style={{ color: C.muted }}>
          {sub}
        </div>
      )}
      {trend}
    </div>
  );
}

const SCOPE_TAG: Record<"GENERAL" | "VEHICLE" | "DEVICE", { label: string; bg: string; fg: string }> = {
  GENERAL: { label: "Ogólne", bg: C.brandSoft, fg: C.brand },
  VEHICLE: { label: "Pojazd", bg: C.goldSoft, fg: C.gold },
  DEVICE: { label: "Urządzenie", bg: C.purpleSoft, fg: C.purple },
};

function ScopeTag({ scope }: { scope: "GENERAL" | "VEHICLE" | "DEVICE" }) {
  const t = SCOPE_TAG[scope];
  return (
    <span className="ml-2 rounded-full px-2 py-[2px] text-[10.5px] font-bold" style={{ background: t.bg, color: t.fg }}>
      {t.label}
    </span>
  );
}

function AutoBadge() {
  return (
    <span className="ml-1.5 rounded-full px-[7px] py-[2px] text-[10px] font-bold" style={{ background: C.purpleSoft, color: C.purple }}>
      ⚙ auto
    </span>
  );
}

export function CostsDashboard({
  period,
  kpis,
  trend,
  months,
  insight,
  categories,
  vehicles,
  unassignedFuelInvoiceNet,
  devices,
  drivers,
}: {
  period: PeriodMeta;
  kpis: Kpis;
  trend: { value: number | null; label: string } | null;
  months: MonthlyCostPoint[];
  insight: TrendInsight;
  categories: CategoryRow[];
  vehicles: VehicleRowWithActual[];
  // Suma faktur paliwowych w okresie NIE dopasowanych do żadnego pojazdu —
  // liczy się do floty, nie pasuje do żadnego wiersza tabeli (admin jeszcze
  // nie poprawił ręcznie w /finanse/koszty/faktury-paliwa).
  unassignedFuelInvoiceNet: number;
  devices: DeviceCostRow[];
  drivers: DriverRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"kategorie" | "pojazdy" | "urzadzenia" | "kierowcy">("kategorie");

  const go = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    router.push(`${BASE_PATH}/finanse/koszty?${qs}`);
  };

  const [sy, sm] = period.start.split("-").map(Number);
  const stepMonth = (dir: -1 | 1) => {
    let y = sy;
    let m = sm + dir;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    go({ mode: "month", m: `${y}-${String(m).padStart(2, "0")}` });
  };
  const stepSeason = (dir: -1 | 1) => go({ mode: "season", s: String(sy + dir) });

  const maxMonthTotal = useMemo(() => Math.max(1, ...months.map((m) => m.total)), [months]);
  const categoriesTotal = useMemo(() => categories.reduce((s, c) => s + c.amount, 0), [categories]);

  return (
    <div>
      <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: C.border, background: C.surface }}>
        {/* ---- nagłówek + tryb okresu ---- */}
        <div className="px-4 pt-[22px] sm:px-7">
          <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
            <h1 className="m-0 text-[21px] font-normal italic" style={{ color: C.accent }}>
              Finanse — Koszty
            </h1>
          </div>
          <div className="inline-flex rounded-full border p-[3px]" style={{ background: C.bg, borderColor: C.border }}>
            {(
              [
                ["month", "Miesiąc"],
                ["range", "Zakres"],
                ["season", "Sezon"],
              ] as const
            ).map(([m, lbl]) => {
              const active = period.mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => go({ mode: m })}
                  className="rounded-full px-[18px] py-2 text-[13.5px] font-semibold"
                  style={active ? { background: C.surface, color: C.text, boxShadow: "0 1px 3px rgba(0,0,0,.08)" } : { color: C.muted }}
                >
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>

        <div className="my-5 flex items-center justify-center gap-[22px]">
          {period.mode === "range" ? (
            <div className="flex items-center gap-3 text-[13px]" style={{ color: C.muted }}>
              <label className="flex items-center gap-1.5">
                Od
                <input
                  type="date"
                  defaultValue={period.start}
                  onChange={(e) => e.target.value && go({ mode: "range", from: e.target.value, to: period.end })}
                  className="rounded-md border px-2 py-1 text-[13px]"
                  style={{ borderColor: C.border, color: C.text }}
                />
              </label>
              <label className="flex items-center gap-1.5">
                Do
                <input
                  type="date"
                  defaultValue={period.end}
                  onChange={(e) => e.target.value && go({ mode: "range", from: period.start, to: e.target.value })}
                  className="rounded-md border px-2 py-1 text-[13px]"
                  style={{ borderColor: C.border, color: C.text }}
                />
              </label>
            </div>
          ) : (
            <>
              <button
                type="button"
                aria-label="Poprzedni"
                onClick={() => (period.mode === "season" ? stepSeason(-1) : stepMonth(-1))}
                className="flex h-8 w-8 items-center justify-center rounded-full border text-[15px]"
                style={{ borderColor: C.border, background: C.surface, color: C.muted }}
              >
                ‹
              </button>
              <div className="min-w-[200px] text-center text-[16px] font-bold" style={{ color: C.text }}>
                {period.label}
              </div>
              <button
                type="button"
                aria-label="Następny"
                onClick={() => (period.mode === "season" ? stepSeason(1) : stepMonth(1))}
                className="flex h-8 w-8 items-center justify-center rounded-full border text-[15px]"
                style={{ borderColor: C.border, background: C.surface, color: C.muted }}
              >
                ›
              </button>
            </>
          )}
        </div>

        <hr className="border-0 border-t" style={{ borderColor: C.border }} />

        {/* ---- pasek 5 KPI ---- */}
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 md:grid-cols-5" style={{ background: C.border }}>
          <KpiCard
            label="Koszty łącznie"
            amount={fmtPln(kpis.totalAll)}
            trend={trend ? <CostTrendChip value={trend.value} vsLabel={trend.label} /> : null}
          />
          <KpiCard label="Ogólne" amount={fmtPln(kpis.general)} />
          <KpiCard label="Pojazdy" amount={fmtPln(kpis.vehicle)} />
          <KpiCard label="Urządzenia" amount={fmtPln(kpis.device)} />
          <KpiCard
            label="Koszt na wynajem"
            amount={kpis.costPerRental === null ? "—" : fmtPln(kpis.costPerRental)}
            sub={kpis.rentalCount > 0 ? `${fmtPln(kpis.totalAll)} / ${fmtNum(kpis.rentalCount)} wynajmy` : undefined}
          />
        </div>

        {/* ---- trend miesięczny ---- */}
        <div className="border-b px-4 py-6 sm:px-7" style={{ borderColor: C.border }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] font-bold" style={{ color: C.muted }}>
              Trend miesięczny — ostatnie 6 miesięcy
            </div>
            <div className="flex gap-3.5 text-[11.5px]" style={{ color: C.muted }}>
              <span>
                <span className="mr-1 inline-block h-[9px] w-[9px] rounded-[2px]" style={{ background: C.brand }} />
                Ogólne
              </span>
              <span>
                <span className="mr-1 inline-block h-[9px] w-[9px] rounded-[2px]" style={{ background: C.gold }} />
                Pojazdy
              </span>
              <span>
                <span className="mr-1 inline-block h-[9px] w-[9px] rounded-[2px]" style={{ background: C.purple }} />
                Urządzenia
              </span>
            </div>
          </div>

          <div className="grid grid-cols-6 items-end gap-2 sm:gap-4" style={{ height: 190 }}>
            {months.map((m) => {
              const heightPct = Math.max(2, (m.total / maxMonthTotal) * 100);
              return (
                <div key={m.key} className="flex h-full flex-col items-center justify-end">
                  <div className="mb-1.5 text-[11px] font-semibold" style={{ color: C.faint }}>
                    {fmtNum(m.total)}
                  </div>
                  <div
                    className="flex w-full max-w-[52px] flex-col-reverse overflow-hidden rounded-t-[5px]"
                    style={{ height: `${heightPct}%` }}
                  >
                    <div style={{ flexGrow: Math.max(m.general, 0.001), background: C.brand }} />
                    <div style={{ flexGrow: Math.max(m.vehicle, 0.001), background: C.gold }} />
                    <div style={{ flexGrow: Math.max(m.device, 0.001), background: C.purple }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 grid grid-cols-6 gap-2 sm:gap-4">
            {months.map((m) => (
              <div
                key={m.key}
                className="text-center text-[11.5px] font-semibold"
                style={m.isCurrent ? { color: C.text, fontWeight: 800 } : { color: C.faint }}
              >
                {m.label}
              </div>
            ))}
          </div>

          {insight && (
            <div
              className="mt-4 flex items-center gap-2 rounded-[9px] px-3.5 py-2.5 text-[12.5px]"
              style={{ background: C.redSoft, color: C.red }}
            >
              <span>⚠️</span>
              <span>
                {insight.monthLabel}: skok kosztów „{insight.segmentLabel}” o <b>{fmtPln(insight.increase)}</b>
                {insight.dominantNote ? ` — głównie ${insight.dominantNote}.` : "."}
              </span>
            </div>
          )}
        </div>

        {/* ---- zakładki treści ---- */}
        <div className="mx-4 mt-1 flex gap-1 border-b sm:mx-7" style={{ borderColor: C.border }}>
          {(
            [
              ["kategorie", "Kategorie"],
              ["pojazdy", "Pojazdy"],
              ["urzadzenia", "Urządzenia"],
              ["kierowcy", "Kierowcy"],
            ] as const
          ).map(([key, lbl]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="-mb-px border-b-2 px-4 py-2.5 text-[13.5px] font-semibold"
                style={{ color: active ? C.brand : C.muted, borderBottomColor: active ? C.brand : "transparent" }}
              >
                {lbl}
              </button>
            );
          })}
        </div>

        {tab === "kategorie" && (
          <div className="px-4 py-6 sm:px-7">
            <p className="mb-3.5 text-[13px] font-bold" style={{ color: C.muted }}>
              Rozbicie na kategorie — wszystkie zakresy razem, posortowane malejąco
            </p>
            <Table
              head={["Kategoria", "Kwota"]}
              rows={categories.map((c) => [
                <span key="n">
                  {c.name}
                  <ScopeTag scope={c.scope} />
                  {c.auto && <AutoBadge />}
                </span>,
                fmtPln(c.amount),
              ])}
              totalRow={["Razem", fmtPln(categoriesTotal)]}
              empty="Brak kosztów w tym okresie."
            />
          </div>
        )}

        {tab === "pojazdy" && (
          <div className="px-4 py-6 sm:px-7">
            <p className="mb-3.5 text-[13px] font-bold" style={{ color: C.muted }}>
              Rozbicie na pojazdy
            </p>
            <Table
              head={[
                "Pojazd",
                <span key="f">
                  Paliwo (szacowane)
                  <AutoBadge />
                </span>,
                "Paliwo (faktury)",
                "Różnica",
                "Inne koszty",
                "Razem",
                <span key="k">
                  Koszt/km
                  <AutoBadge />
                </span>,
              ]}
              rows={vehicles.map((v) => {
                const delta = v.actualFuelNet === null ? null : v.actualFuelNet - v.fuelNet;
                return [
                  v.vehicleName,
                  fmtPln(v.fuelNet),
                  v.actualFuelNet === null ? <Dash key="a" /> : fmtPln(v.actualFuelNet),
                  delta === null ? (
                    <Dash key="delta" />
                  ) : (
                    <span key="delta" style={{ color: Math.abs(delta) < 1 ? C.muted : delta > 0 ? C.red : C.green }}>
                      {delta > 0 ? "+" : ""}
                      {fmtPln(delta)}
                    </span>
                  ),
                  fmtPln(v.otherNet),
                  <span key="t" style={{ fontWeight: 700 }}>
                    {fmtPln(v.totalNet)}
                  </span>,
                  v.costPerKmValue === null ? <Dash key="d" /> : fmtPln2(v.costPerKmValue),
                ];
              })}
              totalRow={[
                "Razem",
                fmtPln(vehicles.reduce((s, v) => s + v.fuelNet, 0)),
                <Dash key="a" />,
                <Dash key="delta" />,
                fmtPln(vehicles.reduce((s, v) => s + v.otherNet, 0)),
                fmtPln(vehicles.reduce((s, v) => s + v.totalNet, 0)),
                <Dash key="d" />,
              ]}
              empty="Brak kosztów pojazdów w tym okresie."
            />
            <p className="mt-3 text-[12px]" style={{ color: C.muted }}>
              „Koszt/km” = (paliwo + inne koszty pojazdu w okresie) ÷ suma km w okresie — całkowity koszt eksploatacji na
              kilometr, nie tylko sam koszt paliwa. „Paliwo (faktury)” = suma wgranych i dopasowanych faktur
              (Finanse → Koszty → Faktury paliwa) — puste, gdy dla tego pojazdu jeszcze żadnej nie wgrano.
            </p>
            {unassignedFuelInvoiceNet > 0 && (
              <p className="mt-2 rounded-md px-3 py-2 text-[12px]" style={{ background: C.purpleSoft, color: C.purple }}>
                + {fmtPln(unassignedFuelInvoiceNet)} z faktur paliwowych w tym okresie nie jest dopasowanych do
                żadnego pojazdu —{" "}
                <a href={`${BASE_PATH}/finanse/koszty/faktury-paliwa`} className="underline">
                  popraw w Fakturach paliwa
                </a>
                .
              </p>
            )}
          </div>
        )}

        {tab === "urzadzenia" && (
          <div className="px-4 py-6 sm:px-7">
            <p className="mb-3.5 text-[13px] font-bold" style={{ color: C.muted }}>
              Rozbicie na urządzenia
            </p>
            <Table
              head={[
                "Urządzenie",
                "Koszty w okresie",
                <span key="p">
                  Koszt na impuls
                  <AutoBadge />
                </span>,
              ]}
              rows={devices.map((d) => [
                d.deviceName,
                fmtPln(d.totalNet),
                d.costPerPulseValue === null ? <Dash key="d" /> : `${fmtPln2(d.costPerPulseValue)} / impuls`,
              ])}
              totalRow={["Razem", fmtPln(devices.reduce((s, d) => s + d.totalNet, 0)), <Dash key="d" />]}
              empty="Brak kosztów urządzeń w tym okresie."
            />
          </div>
        )}

        {tab === "kierowcy" && (
          <div className="px-4 py-6 sm:px-7">
            <p className="mb-3.5 text-[13px] font-bold" style={{ color: C.muted }}>
              Rozbicie na kierowców — koszt pracy (wyliczony)
            </p>
            <Table
              head={[
                "Kierowca",
                "Wynajmy obsłużone",
                "Łączny czas",
                <span key="c">
                  Koszt pracy
                  <AutoBadge />
                </span>,
              ]}
              rows={drivers.map((d) => [
                d.driverName,
                fmtNum(d.rentalCount),
                `${(d.totalMinutes / 60).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} godz.`,
                d.laborCost === null ? <Dash key="d" /> : fmtPln(d.laborCost),
              ])}
              totalRow={[
                "Razem",
                fmtNum(drivers.reduce((s, d) => s + d.rentalCount, 0)),
                `${(drivers.reduce((s, d) => s + d.totalMinutes, 0) / 60).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} godz.`,
                fmtPln(drivers.reduce((s, d) => s + (d.laborCost ?? 0), 0)),
              ]}
              empty="Brak zarejestrowanego czasu pracy kierowców w tym okresie."
            />
            <p className="mt-3 text-[12px]" style={{ color: C.muted }}>
              Ta zakładka jest widoczna wyłącznie dla ADMINA. Suma kosztu pracy nie wchodzi do KPI „Koszty łącznie” — pokazana
              tu osobno jako wgląd poglądowy.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Table({
  head,
  rows,
  totalRow,
  empty,
}: {
  head: React.ReactNode[];
  rows: React.ReactNode[][];
  totalRow: React.ReactNode[];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-[13.5px]" style={{ color: C.muted }}>
        {empty}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="border-b px-2.5 pb-2 text-left text-[10.5px] font-bold uppercase tracking-[0.03em]"
                style={{ borderColor: C.border, color: C.faint, textAlign: i === 0 ? "left" : "right" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, ci) => (
                <td
                  key={ci}
                  className="border-b px-2.5 py-[11px] text-[13.5px]"
                  style={{ borderColor: C.border, textAlign: ci === 0 ? "left" : "right", fontWeight: ci === 0 ? 600 : 400 }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            {totalRow.map((cell, ci) => (
              <td
                key={ci}
                className="px-2.5 py-[11px] text-[13.5px] font-extrabold"
                style={{ borderTop: `2px solid ${C.border}`, textAlign: ci === 0 ? "left" : "right" }}
              >
                {cell}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
