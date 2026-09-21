"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import { RevenueHeatmap } from "@/components/revenue-heatmap";
import {
  bestWorstClientAvg,
  bestWorstUtilization,
  computeClientBreakdown,
  computeConfirmationSplit,
  computeDeviceBreakdown,
  computeDurationHistogram,
  computeKpis,
  computePaymentSplit,
  pendingPriceCount,
  trendPct,
  type ClientRow,
  type ConfirmationSplit,
  type RevenueRow,
  type UnpricedRental,
} from "@/lib/revenue/aggregate";

type PeriodMeta = {
  mode: "month" | "range" | "season";
  label: string;
  dayCount: number;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
};

type Comparison = {
  label: string;
  revenueNet: number;
  rentalCount: number;
  avgValue: number | null;
} | null;

// ---- paleta premium (src/components/shell-tokens.ts, ta sama co
// wynajemlasera.pl) — zastępuje dawną kolorystykę mockup-dashboard-przychodow.html
// (jaśniejszy, bardziej "generyczny SaaS" niebieski #2F6FD1). ----
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
  amberSoft: "#FBF3E1",
  amberText: "#7A5A0E",
  amberBorder: "#F0E0B8",
  gold: "#B5851E",
};

function fmtPln(n: number): string {
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(Math.round(n))} zł`;
}
function fmtNum(n: number): string {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(Math.round(n));
}

function TrendChip({ value, vsLabel }: { value: number | null; vsLabel: string }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <div
      className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold"
      style={{ color: up ? C.green : C.red }}
    >
      {up ? "▲" : "▼"} {up ? "+" : ""}
      {value}%
      <span className="font-medium" style={{ color: C.faint }}>
        vs {vsLabel}
      </span>
    </div>
  );
}

export function RevenueDashboard({
  period,
  rows,
  deviceList,
  unpriced,
  newClientIds,
  comparison,
}: {
  period: PeriodMeta;
  rows: RevenueRow[];
  deviceList: { id: string; name: string }[];
  unpriced: UnpricedRental[];
  newClientIds: string[];
  comparison: Comparison;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"urzadzenia" | "klienci" | "heatmap">("urzadzenia");

  const kpis = useMemo(() => computeKpis(rows), [rows]);
  const confirmation = useMemo(() => computeConfirmationSplit(rows), [rows]);
  const devices = useMemo(() => computeDeviceBreakdown(rows, period.dayCount), [rows, period.dayCount]);
  const insight = useMemo(() => bestWorstUtilization(devices), [devices]);
  const durations = useMemo(() => computeDurationHistogram(rows), [rows]);
  const payments = useMemo(() => computePaymentSplit(rows), [rows]);
  const pending = useMemo(() => pendingPriceCount(rows), [rows]);

  const newClientSet = useMemo(() => new Set(newClientIds), [newClientIds]);
  const clients = useMemo(() => computeClientBreakdown(rows, newClientSet), [rows, newClientSet]);
  const clientInsight = useMemo(() => bestWorstClientAvg(clients), [clients]);
  const avgPerClient = kpis.uniqueClients > 0 ? kpis.revenueNet / kpis.uniqueClients : null;

  const showTrend = period.mode !== "range" && comparison !== null;

  // ---- nawigacja okresu (zmienia searchParams → serwer przelicza) ----
  const go = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    router.push(`${BASE_PATH}/finanse/przychody?${qs}`);
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

  return (
    <div>
      <div
        className="overflow-hidden rounded-[14px] border"
        style={{ borderColor: C.border, background: C.surface }}
      >
        {/* ---- header ---- */}
        <div className="px-4 pt-[22px] sm:px-7">
          <h1 className="m-0 mb-[18px] text-[21px] font-normal italic" style={{ color: C.accent }}>
            Finanse — Przychody
          </h1>
          <div
            className="inline-flex rounded-full border p-[3px]"
            style={{ background: C.bg, borderColor: C.border }}
          >
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
                  style={
                    active
                      ? { background: C.surface, color: C.text, boxShadow: "0 1px 3px rgba(0,0,0,.08)" }
                      : { color: C.muted }
                  }
                >
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- nawigator okresu ---- */}
        <div className="my-5 flex items-center justify-center gap-[22px]">
          {period.mode === "range" ? (
            <div className="flex items-center gap-3 text-[13px]" style={{ color: C.muted }}>
              <label className="flex items-center gap-1.5">
                Od
                <input
                  type="date"
                  defaultValue={period.start}
                  onChange={(e) =>
                    e.target.value && go({ mode: "range", from: e.target.value, to: period.end })
                  }
                  className="rounded-md border px-2 py-1 text-[13px]"
                  style={{ borderColor: C.border, color: C.text }}
                />
              </label>
              <label className="flex items-center gap-1.5">
                Do
                <input
                  type="date"
                  defaultValue={period.end}
                  onChange={(e) =>
                    e.target.value && go({ mode: "range", from: period.start, to: e.target.value })
                  }
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

        {/* ---- pasek KPI ---- */}
        <div className="grid grid-cols-2 gap-px md:grid-cols-4" style={{ background: C.border }}>
          <KpiCard
            label="Przychód netto"
            amount={fmtPln(kpis.revenueNet)}
            trend={showTrend ? <TrendChip value={trendPct(kpis.revenueNet, comparison!.revenueNet)} vsLabel={comparison!.label} /> : null}
          />
          <KpiCard
            label="Liczba wynajmów"
            amount={fmtNum(kpis.rentalCount)}
            sub={kpis.trainingCount > 0 ? `w tym ${kpis.trainingCount} ${szkolenia(kpis.trainingCount)}` : undefined}
            trend={showTrend ? <TrendChip value={trendPct(kpis.rentalCount, comparison!.rentalCount)} vsLabel={comparison!.label} /> : null}
          />
          <KpiCard
            label="Śr. wartość wynajmu"
            amount={kpis.avgValue === null ? "—" : fmtPln(kpis.avgValue)}
            trend={
              showTrend && kpis.avgValue !== null && comparison!.avgValue
                ? <TrendChip value={trendPct(kpis.avgValue, comparison!.avgValue)} vsLabel={comparison!.label} />
                : null
            }
          />
          <KpiCard label="Unikalni klienci" amount={fmtNum(kpis.uniqueClients)} sub="&nbsp;" />
        </div>

        {/* ---- rzeczywiste vs preliminowane (potwierdzenie odbioru) ---- */}
        <ConfirmationBar split={confirmation} />

        {/* ---- jeden komunikat pod liczbami: co obniża/uzupełnia sumę ---- */}
        <RevenueNotice pending={pending} unpriced={unpriced} />

        {/* ---- zakładki treści ---- */}
        <div className="mx-4 mt-6 flex gap-1 border-b sm:mx-7" style={{ borderColor: C.border }}>
          {(
            [
              ["urzadzenia", "Urządzenia"],
              ["klienci", "Klienci"],
              ["heatmap", "Mapa cieplna"],
            ] as const
          ).map(([key, lbl]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="-mb-px border-b-2 px-4 py-2.5 text-[13.5px] font-semibold"
                style={{
                  color: active ? C.brand : C.muted,
                  borderBottomColor: active ? C.brand : "transparent",
                }}
              >
                {lbl}
              </button>
            );
          })}
        </div>

        {tab === "urzadzenia" && (
          <UrzadzeniaTab insight={insight} devices={devices} durations={durations} payments={payments} />
        )}
        {tab === "klienci" && (
          <KlienciTab
            clients={clients}
            insight={clientInsight}
            avgPerClient={avgPerClient}
            revenueNet={kpis.revenueNet}
            uniqueClients={kpis.uniqueClients}
          />
        )}
        {tab === "heatmap" && <RevenueHeatmap rows={rows} devices={deviceList} period={period} />}
      </div>
    </div>
  );
}

function szkolenia(n: number): string {
  if (n === 1) return "szkolenie";
  return "szkolenia";
}
function wynajmy(n: number): string {
  if (n === 1) return "wynajem";
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? "wynajmy" : "wynajmów";
}
function maja(n: number): string {
  return n === 1 ? "ma" : "mają";
}

// Pasek "rzeczywiste vs preliminowane" — dzieli Przychód netto z paska KPI
// wyżej na część POTWIERDZONĄ przez kierowcę (RentalFinance.confirmedAt,
// przycisk "Potwierdzam odbiór" w panelu kierowcy) i PRELIMINOWANĄ (cena z
// rezerwacji, wynajem się jeszcze nie odbył albo kierowca nie potwierdził).
// Suma obu = Przychód netto, nic tu nie odejmuje ani nie dodaje do KPI —
// to tylko rozbicie tej samej liczby. Brak = ukryty (0 wynajmów w okresie).
function ConfirmationBar({ split }: { split: ConfirmationSplit }) {
  if (split.totalNet <= 0) return null;
  return (
    <div className="mx-4 mt-4 sm:mx-7">
      <div className="flex items-baseline justify-between text-[12.5px]" style={{ color: C.muted }}>
        <span>Rzeczywiste vs preliminowane</span>
        <span className="font-semibold">{split.confirmedPct}% potwierdzone</span>
      </div>
      <div className="mt-1.5 flex h-3 overflow-hidden rounded-full" style={{ background: C.border }}>
        <div style={{ width: `${split.confirmedPct}%`, background: C.green }} />
        <div style={{ width: `${100 - split.confirmedPct}%`, background: "#F0C674" }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]" style={{ color: C.text }}>
        <span>
          <b className="font-bold" style={{ color: C.green }}>
            {fmtPln(split.confirmedNet)}
          </b>{" "}
          rzeczywiste — kierowca potwierdził odbiór
        </span>
        <span>
          <b className="font-bold" style={{ color: C.amberText }}>
            {fmtPln(split.preliminaryNet)}
          </b>{" "}
          preliminowane
        </span>
      </div>
    </div>
  );
}

// Jeden komunikat tuż pod paskiem KPI — mówi, dlaczego pokazana suma może
// nie być ostateczna. Zwinięty = jedna linia z podsumowaniem; rozwinięty =
// wyjaśnienie cen tymczasowych + lista wynajmów bez kwoty (linki).
function RevenueNotice({ pending, unpriced }: { pending: number; unpriced: UnpricedRental[] }) {
  const [open, setOpen] = useState(false);
  const nUn = unpriced.length;
  if (pending === 0 && nUn === 0) return null;

  const bits: string[] = [];
  if (pending > 0) bits.push(`${pending} z ceną tymczasową`);
  if (nUn > 0) bits.push(`${nUn} bez wpisanej kwoty`);

  return (
    <div
      className="mx-4 mt-4 overflow-hidden rounded-[9px] border text-[12.5px] sm:mx-7"
      style={{ background: C.amberSoft, borderColor: C.amberBorder, color: C.amberText }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-[14px] py-[9px] text-left"
      >
        <span aria-hidden>⚠️</span>
        <span className="flex-1">
          Suma może być niepełna — <b className="font-bold">{bits.join(" · ")}</b>.
        </span>
        <span className="flex-none font-semibold underline">{open ? "ukryj" : "szczegóły"}</span>
        <span className={`flex-none text-[11px] transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="border-t px-[14px] py-2.5" style={{ borderColor: C.amberBorder }}>
          {pending > 0 && (
            <p className={nUn > 0 ? "mb-3" : ""}>
              <b className="font-bold">
                {pending} {wynajmy(pending)}
              </b>{" "}
              {maja(pending)} cenę tymczasową (czekają na odczyt liczników impulsów przez kierowcę) — kwota jest
              szacunkowa i może się jeszcze zmienić.
            </p>
          )}
          {nUn > 0 && (
            <>
              <p className="mb-1">
                <b className="font-bold">
                  {nUn} {wynajmy(nUn)}
                </b>{" "}
                nie {nUn === 1 ? "ma" : "mają"} wpisanej kwoty — {nUn === 1 ? "nie wchodzi" : "nie wchodzą"} do
                sumy przychodu:
              </p>
              <ul>
                {unpriced.map((r) => (
                  <li key={r.id} className="border-b last:border-b-0" style={{ borderColor: "#EFE3C0" }}>
                    <Link
                      href={`/kalendarz/wynajem/${r.id}`}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 hover:underline"
                    >
                      <span className="font-semibold tabular-nums">
                        {new Date(r.startsAt).toLocaleDateString("pl-PL", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                      <span>{r.deviceName}</span>
                      <span style={{ color: "#9A7A2E" }}>{r.title}</span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.03em]"
                        style={{ background: "#EFE3C0" }}
                      >
                        {r.eventType === "SZKOLENIE" ? "Szkolenie" : "Wynajem"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  amount,
  sub,
  trend,
}: {
  label: string;
  amount: string;
  sub?: string;
  trend?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-4 sm:px-[22px] sm:py-5" style={{ background: C.surface }}>
      <div className="text-[11.5px] font-bold uppercase tracking-[0.03em]" style={{ color: C.faint }}>
        {label}
      </div>
      <div className="mt-1.5 text-[26px] font-extrabold tracking-[-0.01em]" style={{ color: C.text }}>
        {amount}
      </div>
      {sub && (
        <div className="mt-[3px] text-[12px]" style={{ color: C.muted }} dangerouslySetInnerHTML={{ __html: sub }} />
      )}
      {trend}
    </div>
  );
}

// ---------------- zakładka Urządzenia ----------------
function UrzadzeniaTab({
  insight,
  devices,
  durations,
  payments,
}: {
  insight: ReturnType<typeof bestWorstUtilization>;
  devices: ReturnType<typeof computeDeviceBreakdown>;
  durations: ReturnType<typeof computeDurationHistogram>;
  payments: ReturnType<typeof computePaymentSplit>;
}) {
  const durTotal = durations.reduce((s, d) => s + d.count, 0);
  const payTotal = payments.reduce((s, p) => s + p.sum, 0);

  return (
    <>
      {insight && (
        <div className="mx-4 mt-5 sm:mx-7 grid grid-cols-1 gap-[14px] sm:grid-cols-2">
          <InsightBox
            kind="best"
            title="Najlepiej wykorzystane"
            device={insight.best.name}
            pct={`${insight.best.utilizationPct}% dni w okresie`}
          />
          <InsightBox
            kind="worst"
            title="Najsłabiej wykorzystane"
            device={insight.worst.name}
            pct={`${insight.worst.utilizationPct}% dni w okresie`}
          />
        </div>
      )}

      <div className="px-4 pb-2 pt-6 sm:px-7">
        <div className="mb-[14px] text-[13px] font-bold" style={{ color: C.muted }}>
          Rozbicie na urządzenia
        </div>
        {devices.length === 0 ? (
          <p className="py-6 text-[13px]" style={{ color: C.faint }}>
            Brak przychodu w wybranym okresie.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                {["Urządzenie", "Przychód", "Udział", "Wynajmy", "Śr. wartość", "Wykorzystanie"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-2.5 pb-2 text-[10.5px] font-bold uppercase tracking-[0.03em] ${i === 0 ? "text-left" : "text-right"}`}
                    style={{ color: C.faint, borderBottom: `1px solid ${C.border}` }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td
                    className="px-2.5 py-[11px] text-[13.5px]"
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      fontWeight: d.isTraining ? 500 : 600,
                      fontStyle: d.isTraining ? "italic" : "normal",
                      color: d.isTraining ? C.muted : C.text,
                    }}
                  >
                    {d.name}
                  </td>
                  <td className="px-2.5 py-[11px] text-right text-[13.5px] tabular-nums" style={cell()}>
                    {fmtPln(d.revenueNet)}
                  </td>
                  <td className="px-2.5 py-[11px] text-right text-[12px] tabular-nums" style={cell(C.faint)}>
                    {d.sharePct}%
                  </td>
                  <td className="px-2.5 py-[11px] text-right text-[13.5px] tabular-nums" style={cell()}>
                    {d.rentalCount}
                  </td>
                  <td className="px-2.5 py-[11px] text-right text-[13.5px] tabular-nums" style={cell()}>
                    {fmtPln(d.avgValue)}
                  </td>
                  <td className="px-2.5 py-[11px] text-right text-[13.5px]" style={cell()}>
                    {d.utilizationPct === null ? (
                      <span style={{ color: C.faint }}>—</span>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <div
                          className="h-[7px] w-[60px] overflow-hidden rounded-full"
                          style={{ background: C.bg }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${d.utilizationPct}%`,
                              background: d.utilizationPct < 40 ? C.faint : C.brand,
                            }}
                          />
                        </div>
                        <span className="tabular-nums">{d.utilizationPct}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 px-4 pb-7 pt-[26px] sm:grid-cols-2 sm:px-7">
        <MiniPanel heading="Długość wynajmu">
          {durations.map((d) => (
            <MiniRow
              key={d.days}
              name={d.days === 1 ? "1 dzień" : `${d.days} dni`}
              pct={durTotal > 0 ? Math.round((d.count / durTotal) * 100) : 0}
              fill={C.brand}
              value={
                <>
                  <b className="font-bold">{d.count}</b> · {d.pct}%
                </>
              }
            />
          ))}
          {durTotal === 0 && <EmptyMini />}
        </MiniPanel>

        <MiniPanel heading="Sposób płatności">
          {payments.map((p) => (
            <MiniRow
              key={p.method}
              name={p.method === "CASH" ? "Gotówka" : "Przelew"}
              pct={payTotal > 0 ? Math.round((p.sum / payTotal) * 100) : 0}
              fill={C.gold}
              value={
                <>
                  <b className="font-bold">{fmtPln(p.sum)}</b> · {p.pct}%
                </>
              }
            />
          ))}
          {payTotal === 0 && <EmptyMini />}
        </MiniPanel>
      </div>
    </>
  );
}

function cell(color?: string): React.CSSProperties {
  return { borderBottom: `1px solid ${C.border}`, color: color ?? C.text };
}

// ---------------- zakładka Klienci ----------------
function deviceCountLabel(n: number | null): string {
  if (n === null) return "—";
  return n === 1 ? "1" : `${n} różne`;
}

// Wiersz tabeli klientów. `sub` = pojedynczy klient rozwinięty spod
// „pozostali klienci". `onToggle`/`open` = tryb wiersza zbiorczego (klik rozwija).
function ClientTr({
  row,
  sub,
  onToggle,
  open,
}: {
  row: ClientRow;
  sub?: boolean;
  onToggle?: () => void;
  open?: boolean;
}) {
  const aggregate = row.kind !== "named";
  return (
    <tr style={sub ? { background: "#FAFBFC" } : undefined}>
      <td
        className={`py-[11px] text-[13.5px] ${sub ? "pl-7 pr-2.5" : "px-2.5"}`}
        style={{
          borderBottom: `1px solid ${C.border}`,
          fontWeight: aggregate ? 500 : 600,
          color: aggregate ? C.muted : C.text,
        }}
      >
        {onToggle ? (
          <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-left">
            <span className={`text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
            <span className="underline">{row.name}</span>
          </button>
        ) : (
          row.name
        )}
        {row.isNew && (
          <span
            className="ml-[7px] inline-block rounded-full px-[7px] py-0.5 align-middle text-[10px] font-bold"
            style={{ background: "#F3EBFF", color: "#7C3AED" }}
          >
            Nowy
          </span>
        )}
      </td>
      <td className="px-2.5 py-[11px] text-right text-[13.5px] tabular-nums" style={cell()}>
        {fmtPln(row.revenueNet)}
      </td>
      <td className="px-2.5 py-[11px] text-right text-[12px] tabular-nums" style={cell(C.faint)}>
        {row.sharePct}%
      </td>
      <td className="px-2.5 py-[11px] text-right text-[13.5px] tabular-nums" style={cell()}>
        {row.rentalCount}
      </td>
      <td className="px-2.5 py-[11px] text-right text-[13.5px] tabular-nums" style={cell()}>
        {fmtPln(row.avgValue)}
      </td>
      <td className="px-2.5 py-[11px] text-right text-[12px]" style={cell(C.faint)}>
        {deviceCountLabel(row.deviceCount)}
      </td>
    </tr>
  );
}

function KlienciTab({
  clients,
  insight,
  avgPerClient,
  revenueNet,
  uniqueClients,
}: {
  clients: ClientRow[];
  insight: ReturnType<typeof bestWorstClientAvg>;
  avgPerClient: number | null;
  revenueNet: number;
  uniqueClients: number;
}) {
  const [restOpen, setRestOpen] = useState(false);
  return (
    <>
      {avgPerClient !== null && (
        <div
          className="mx-4 mt-5 sm:mx-7 flex items-baseline gap-2.5 rounded-[9px] border px-5 py-4"
          style={{ background: C.bg, borderColor: C.border }}
        >
          <span className="text-[24px] font-extrabold" style={{ color: C.text }}>
            {fmtPln(avgPerClient)}
          </span>
          <span className="text-[13px]" style={{ color: C.muted }}>
            średni przychód na klienta w tym okresie ({fmtPln(revenueNet)} / {fmtNum(uniqueClients)}{" "}
            {uniqueClients === 1 ? "klient" : "klientów"})
          </span>
        </div>
      )}

      {insight && (
        <div className="mx-4 mt-5 sm:mx-7 grid grid-cols-1 gap-[14px] sm:grid-cols-2">
          <InsightBox
            kind="best"
            title="Najwyższa śr. wartość wynajmu"
            device={insight.best.name}
            pct={`${fmtPln(insight.best.avgValue)} średnio na wynajem`}
          />
          <InsightBox
            kind="worst"
            title="Najniższa śr. wartość wynajmu"
            device={insight.worst.name}
            pct={`${fmtPln(insight.worst.avgValue)} średnio na wynajem`}
          />
        </div>
      )}

      <div className="px-4 pb-8 pt-6 sm:px-7">
        <div className="mb-[14px] text-[13px] font-bold" style={{ color: C.muted }}>
          Rozbicie na klientów
        </div>
        {clients.length === 0 ? (
          <p className="py-6 text-[13px]" style={{ color: C.faint }}>
            Brak przychodu w wybranym okresie.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                {["Klient", "Przychód", "Udział", "Wynajmy", "Śr. wartość", "Urządzenia"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-2.5 pb-2 text-[10.5px] font-bold uppercase tracking-[0.03em] ${i === 0 ? "text-left" : "text-right"}`}
                    style={{ color: C.faint, borderBottom: `1px solid ${C.border}` }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((c) =>
                c.kind === "rest" && c.hidden && c.hidden.length > 0 ? (
                  <Fragment key={c.id}>
                    <ClientTr row={c} onToggle={() => setRestOpen((v) => !v)} open={restOpen} />
                    {restOpen && c.hidden.map((h) => <ClientTr key={h.id} row={h} sub />)}
                  </Fragment>
                ) : (
                  <ClientTr key={c.id} row={c} />
                ),
              )}
            </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function InsightBox({
  kind,
  title,
  device,
  pct,
}: {
  kind: "best" | "worst";
  title: string;
  device: string;
  pct: string;
}) {
  const accent = kind === "best" ? C.green : C.red;
  return (
    <div
      className="flex items-center gap-3 rounded-[9px] px-4 py-[13px]"
      style={{ background: kind === "best" ? C.greenSoft : C.redSoft }}
    >
      <span className="text-[20px]" aria-hidden>
        {kind === "best" ? "🏆" : "📉"}
      </span>
      <div>
        <div className="text-[11.5px] font-bold uppercase tracking-[0.03em]" style={{ color: accent }}>
          {title}
        </div>
        <div className="mt-0.5 text-[14px] font-bold" style={{ color: C.text }}>
          {device}
        </div>
        <div className="mt-px text-[12.5px]" style={{ color: C.muted }}>
          {pct}
        </div>
      </div>
    </div>
  );
}

function MiniPanel({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[14px] text-[13px] font-bold" style={{ color: C.muted }}>
        {heading}
      </div>
      {children}
    </div>
  );
}

function MiniRow({
  name,
  pct,
  fill,
  value,
}: {
  name: string;
  pct: number;
  fill: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-[7px]">
      <div className="w-20 flex-shrink-0 text-[13px] font-semibold" style={{ color: C.text }}>
        {name}
      </div>
      <div className="h-[9px] flex-1 overflow-hidden rounded-full" style={{ background: C.bg }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: fill }} />
      </div>
      <div className="w-[78px] flex-shrink-0 text-right text-[12.5px]" style={{ color: C.text }}>
        {value}
      </div>
    </div>
  );
}

function EmptyMini() {
  return (
    <p className="py-2 text-[12.5px]" style={{ color: C.faint }}>
      Brak danych w tym okresie.
    </p>
  );
}
