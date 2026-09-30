"use client";

import { useMemo, useState } from "react";
import { PulseReportView } from "./pulse-report";
import type { LeadRow } from "@/lib/leads/load";
import { LOST_REASON_LABEL, type LostReasonKey } from "@/lib/leads/labels";
import { FIRST_CONTACT_SLA_HOURS, rotInfo, workDurationLabel, type FunnelLead } from "@/lib/leads/funnel";
import { LEAD_STAGE_COLORS } from "@/components/shell-tokens";
import { StageLegend } from "./plan-day";
import { SOURCE_TYPES, countBy, firstContactBuckets, funnelSteps, inRange, postponedByMonth, reportKpis, type ReportRange, type ReportSource } from "@/lib/leads/report";
import { KpiBand, Seg, toFunnel } from "./funnel-views";
import { REWARD_STEP, type Playbook } from "@/lib/leads/playbook";
import { SPRING_OUTCOME_LABEL, type SeasonGoal, type SpringOutcome } from "@/lib/leads/season-goal";

// Sygnały → Raport (wzór lejek-v2-wzor.html, s7): miesięczny obraz lejka,
// szybkość, powody przegranych, powroty odłożonych.
// Wykresy poziome, jedna seria = jeden kolor (niebieski); zielony tylko dla
// celu, terakota dla „wymaga uwagi”. Dymek na słupku, tabela na żądanie.

type Bar = { label: string; count: number; note?: string; color?: string };

function Chart({ title, bars, note, labelWidth = 150 }: { title: string; bars: Bar[]; note: string; labelWidth?: number }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...bars.map((b) => b.count));
  const total = bars.reduce((s, b) => s + b.count, 0);
  return (
    <div className="border border-[#E3E6E9] bg-white px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="m-0 inline-block border-b-2 border-[#E08A5C] pb-[2px] text-[16px] font-semibold text-[#0C3450]">{title}</h2>
        <button type="button" onClick={() => setTable((v) => !v)} className="text-[12px] text-[#1B6FA8] hover:underline">
          {table ? "Pokaż wykres" : "Pokaż tabelę"}
        </button>
      </div>
      {table ? (
        <table className="w-full border-collapse text-[12.5px]">
          <tbody>
            {bars.map((b) => (
              <tr key={b.label} className="border-b border-[#F0F1F2]">
                <td className="py-1">{b.label}</td>
                <td className="py-1 text-right tabular-nums text-[#0C3450]">{b.count}</td>
                <td className="py-1 pl-3 text-right text-[#5C6166]">{b.note ?? (total ? `${Math.round((b.count / total) * 100)}%` : "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        bars.map((b) => {
          const tip = `${b.label}: ${b.count}${b.note ? ` · ${b.note}` : total ? ` · ${Math.round((b.count / total) * 100)}%` : ""}`;
          return (
            <div key={b.label} className="my-[5px] grid items-center gap-2.5 text-[12.5px]" style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr) 110px` }} title={tip}>
              <span className="truncate">{b.label}</span>
              <div className="h-[14px]">
                <div className="h-full rounded-r-[4px]" style={{ width: `${(b.count / max) * 100}%`, minWidth: b.count ? 3 : 0, background: b.color ?? "#2B5B82" }} />
              </div>
              <span className="tabular-nums">
                <b className="font-medium text-[#0C3450]">{b.count}</b> {b.note && <span className="text-[11.5px] text-[#5C6166]">{b.note}</span>}
              </span>
            </div>
          );
        })
      )}
      <p className="mt-2 text-[11.5px] text-[#5C6166]">{note}</p>
    </div>
  );
}

const MONTHS = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
const PCT_OF = ["", "z zapytań", "z kontaktu", "z ofert", "z rezerwacji"];

// Kafel „Cel sezonu” (wniosek 21, pkt 5): wracający X/12, nowi Y/8 i lista
// gabinetów z wiosny z wynikiem.
function SeasonTile({ goal, playbook, onOpen }: { goal: SeasonGoal; playbook: Playbook; onOpen: (leadId: string) => void }) {
  const se = playbook.season;
  const tone: Record<SpringOutcome, string> = { BOOKED: "text-[#2F7A68] font-semibold", TALKING: "text-[#1B6FA8]", POSTPONED: "text-[#5C6166]", LOST: "text-[#B8612F]", RESIGNED: "text-[#B8612F]", DO_NOT_CONTACT: "text-[#B8612F]", TODO: "text-[#5C6166]" };
  return (
    <div className="border border-[#E3E6E9] bg-white px-4 py-3.5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 inline-block border-b-2 border-[#E08A5C] pb-[2px] text-[16px] font-semibold text-[#0C3450]">Cel sezonu</h2>
        <span className="text-[12px] text-[#5C6166]">
          {se.from.split("-").reverse().join(".")} – {se.to.split("-").reverse().join(".")} · nagroda co {REWARD_STEP}
        </span>
      </div>
      <div className="mb-2 flex flex-wrap gap-4 text-[13px]">
        <span>
          <b className="text-[18px] font-medium text-[#0C3450]">{goal.total}</b> z {se.target} gabinetów
        </span>
        <span>
          wracający <b className="text-[#0C3450]">{goal.returning}</b> / {se.returningTarget}
        </span>
        <span>
          nowi <b className="text-[#0C3450]">{goal.fresh}</b> / {se.newTarget}
        </span>
      </div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-[#5C6166]">
        Wracają z wiosny ({goal.spring.length}) · w puli {goal.pool}
      </div>
      <ul className="m-0 mt-1 grid list-none gap-x-4 p-0 text-[12.5px] sm:grid-cols-2">
        {goal.spring.map((r) => (
          <li key={r.clientId} className="flex items-baseline justify-between gap-2 border-b border-[#F0F1F2] py-1">
            {r.leadId ? (
              <button type="button" onClick={() => onOpen(r.leadId!)} className="min-w-0 truncate text-left text-[#0C3450] hover:text-[#1B6FA8]" title={r.name}>
                {r.name}
              </button>
            ) : (
              <span className="min-w-0 truncate text-[#0C3450]" title={r.name}>
                {r.name}
              </span>
            )}
            <span className={`flex-none ${tone[r.outcome]}`}>
              {SPRING_OUTCOME_LABEL[r.outcome]}
              {r.bookedAt ? ` · ${new Date(r.bookedAt).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReportView({
  rows,
  now,
  seasonGoal,
  playbook,
  onOpen,
  users = [],
  currentUserId = "",
}: {
  rows: LeadRow[];
  now: Date;
  seasonGoal: SeasonGoal;
  playbook: Playbook;
  onOpen: (leadId: string) => void;
  users?: { id: string; name: string }[];
  currentUserId?: string;
}) {
  const [range, setRange] = useState<ReportRange>("month");
  const [source, setSource] = useState<ReportSource>("all");
  // Stałe klientki poza lejkiem nowych (lejek v2, 3.3 pkt 4).
  const all = useMemo(() => toFunnel(rows.filter((r) => !r.returningClient)), [rows]);
  const leads = useMemo(() => inRange(all as unknown as (LeadRow & Parameters<typeof funnelSteps>[0][number])[], range, source, now), [all, range, source, now]);
  const k = reportKpis(leads, now);
  const funnel = funnelSteps(leads);
  const buckets = firstContactBuckets(leads);
  const lost = countBy(
    leads.filter((l) => l.stage === "PRZEGRANA"),
    (l) => l.lostReason ?? "INNE",
  );
  const postponed = postponedByMonth(all);
  const rotting = (leads as unknown as FunnelLead[]).filter((l) => rotInfo(l, now).rotting).length;
  const www = leads.filter((l) => SOURCE_TYPES.www.includes(l.type)).length;
  const phone = leads.filter((l) => l.type === "TELEFON").length;
  const offers = funnel.find((f) => f.key === "OFERTA")?.count ?? 0;
  const reservations = funnel.find((f) => f.key === "REZERWACJA")?.count ?? 0;
  const label = range === "2026" ? "2026" : range === "month" ? MONTHS[now.getMonth()].toLowerCase() : "30 dni";
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  // Wniosek 36: „puls” na górze, dotychczasowe wykresy lejka niżej, w „Szczegółach”.
  return (
    <div className="flex flex-col gap-[22px]">
      <PulseReportView users={users} currentUserId={currentUserId} onOpen={onOpen} />
      <details className="border border-[#E3E6E9] bg-white px-4 py-3">
        <summary className="cursor-pointer text-[14px] font-semibold text-[#0C3450]">Szczegóły — lejek według daty wpłynięcia zapytania (dotychczasowy raport)</summary>
        <div className="mt-3">
          {reportDetails()}
        </div>
      </details>
    </div>
  );

  function reportDetails() {
    return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <Seg<ReportRange>
          value={range}
          onChange={setRange}
          options={[
            ["30", "30 dni"],
            ["month", MONTHS[now.getMonth()]],
            ["2026", "2026"],
          ]}
        />
        <Seg<ReportSource>
          value={source}
          onChange={setSource}
          options={[
            ["all", "Wszystkie źródła"],
            ["www", "WWW"],
            ["phone", "Telefon"],
            ["email", "E-mail"],
          ]}
        />
      </div>
      <KpiBand
        items={[
          { label: "Zapytania", value: String(k.total), sub: `${www} WWW + ${phone} telefon${k.total - www - phone > 0 ? ` + ${k.total - www - phone} inne` : ""}` },
          { label: "Bez kontaktu", value: String(k.noContact), sub: k.noContactPct == null ? "—" : `${k.noContactPct}%`, warn: k.noContact > 0 },
          { label: "Czas do 1. kontaktu", value: workDurationLabel(k.medianFirstContact), sub: "mediana z czekającymi", warn: (k.medianFirstContact ?? 0) > FIRST_CONTACT_SLA_HOURS },
          { label: "Oferty", value: String(offers), sub: `${pct(offers, k.total)} zapytań` },
          { label: "Rezerwacje", value: String(reservations), sub: `${pct(reservations, offers)} ofert` },
          { label: "Gniją", value: String(rotting), sub: "ponad limit etapu", warn: rotting > 0 },
        ]}
      />
      <SeasonTile goal={seasonGoal} playbook={playbook} onOpen={onOpen} />
      <div className="grid gap-[18px] xl:grid-cols-2">
        <Chart
          title={`Lejek – ${label}`}
          labelWidth={110}
          bars={funnel.map((s, i) => ({
            label: s.label,
            count: s.count,
            note: i === 0 ? "100%" : s.key === "WYGRANA" && s.count === 0 ? "w toku (po wynajmie)" : s.pctOfPrev == null ? "—" : `${s.pctOfPrev}% ${PCT_OF[i]}`,
            color: LEAD_STAGE_COLORS[s.key as keyof typeof LEAD_STAGE_COLORS]?.dot ?? "#1B6FA8",
          }))}
          note="Liczone „kiedykolwiek osiągnął etap”. Kolory = kolory etapów na Tablicy. Wygrana — tylko z wynajmem w kalendarzu. Bez zapytań stałych klientek."
        />
        <Chart
          title="Szybkość pierwszego kontaktu"
          bars={buckets.map((b) => ({ label: b.label, count: b.count, color: b.tone === "ok" ? "#2F7A68" : b.tone === "warn" ? "#E08A5C" : "#2B5B82" }))}
          note="Zielony = w celu, terakota = wymaga uwagi. „Wciąż bez kontaktu” — otwarte sygnały bez rozmowy, SMS-a ani maila."
        />
      </div>
      <div className="grid gap-[18px] xl:grid-cols-2">
        <Chart
          title={`Powody przegranych (${label})`}
          bars={lost.map((r) => ({ label: LOST_REASON_LABEL[r.key as LostReasonKey] ?? r.key, count: r.count }))}
          note={lost.length ? "Powód jest obowiązkowy przy przegranej — „Inne” to wyjątek." : "Brak przegranych w okresie."}
        />
        <Chart
          title="Odłożone – kiedy wracają"
          bars={postponed.map((p) => ({ label: p.label, count: p.count }))}
          note={postponed.length ? "Lista do kampanii przed sezonem — każdy wraca na listę „Na dziś” w swoim dniu." : "Brak odłożonych („Odłóż do…” w karcie sygnału)."}
        />
      </div>
      <StageLegend />
    </div>
    );
  }
}
