"use client";

import { useMemo, useState } from "react";
import type { LeadRow } from "@/lib/leads/load";
import { LOST_REASON_LABEL, TYPE_LABEL, type LostReasonKey } from "@/lib/leads/labels";
import type { LeadTypeKey } from "@/lib/leads/parse-deal";
import { FIRST_CONTACT_SLA_HOURS, workDurationLabel } from "@/lib/leads/funnel";
import { countBy, firstContactBuckets, funnelSteps, inRange, reportKpis, type ReportRange, type ReportSource } from "@/lib/leads/report";
import { KpiBand, Seg, toFunnel } from "./funnel-views";

// Sygnały → Raport (wzór lejek-wzor.html, s5): tygodniowy obraz lejka.
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

export function ReportView({ rows, now }: { rows: LeadRow[]; now: Date }) {
  const [range, setRange] = useState<ReportRange>("2026");
  const [source, setSource] = useState<ReportSource>("all");
  // Stałe klientki poza lejkiem nowych (lejek v2, 3.3 pkt 4).
  const leads = useMemo(() => inRange(toFunnel(rows.filter((r) => !r.returningClient)) as unknown as (LeadRow & Parameters<typeof funnelSteps>[0][number])[], range, source, now), [rows, range, source, now]);
  const k = reportKpis(leads, now);
  const funnel = funnelSteps(leads);
  const buckets = firstContactBuckets(leads);
  const lost = countBy(
    leads.filter((l) => l.stage === "PRZEGRANA"),
    (l) => l.lostReason ?? "INNE",
  );
  const sources = countBy(leads, (l) => l.type);
  const label = range === "2026" ? "2026" : `${range} dni`;

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <Seg<ReportRange>
          value={range}
          onChange={setRange}
          options={[
            ["30", "30 dni"],
            ["90", "90 dni"],
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
          { label: `Sygnały ${label}`, value: String(k.total), sub: "wpłynęło w okresie" },
          { label: "Bez kontaktu", value: String(k.noContact), sub: k.noContactPct == null ? "—" : `${k.noContactPct}% sygnałów`, warn: k.noContact > 0 },
          { label: "Czas do 1. kontaktu", value: workDurationLabel(k.medianFirstContact), sub: "mediana z czekającymi", warn: (k.medianFirstContact ?? 0) > FIRST_CONTACT_SLA_HOURS },
          { label: "Wygrane", value: String(k.won), sub: `${k.wonPct ?? 0}% · tylko z wynajmem` },
          { label: "Oferty bez follow-upu", value: `${k.staleOffers} z ${k.offers}`, sub: "> 7 dni bez aktywności", warn: k.staleOffers > 0 },
        ]}
      />
      <div className="grid gap-[18px] xl:grid-cols-2">
        <Chart
          title={`Lejek ${label}`}
          labelWidth={100}
          bars={funnel.map((s) => ({ label: s.label, count: s.count, note: s.pctOfPrev == null ? "100%" : `${s.pctOfPrev}% z poprz.`, color: "#1B6FA8" }))}
          note="Liczone „kiedykolwiek osiągnęło etap” (także te, które potem przegrały). Wygrana — tylko z wynajmem w kalendarzu."
        />
        <Chart
          title={`Powody przegranych ${label}`}
          bars={lost.map((r) => ({ label: LOST_REASON_LABEL[r.key as LostReasonKey] ?? r.key, count: r.count }))}
          note={lost.length ? "Powód jest obowiązkowy przy przegranej." : "Brak przegranych w okresie."}
        />
      </div>
      <div className="grid gap-[18px] xl:grid-cols-2">
        <Chart
          title="Czas do pierwszego kontaktu"
          bars={buckets.map((b) => ({ label: b.label, count: b.count, color: b.tone === "ok" ? "#2F7A68" : b.tone === "warn" ? "#E08A5C" : "#2B5B82" }))}
          note="Zielony = w celu, terakota = wymaga uwagi. „Wciąż bez kontaktu” — otwarte sygnały bez rozmowy, SMS-a ani maila."
        />
        <Chart
          title={`Źródła sygnałów ${label}`}
          bars={sources.map((s) => ({ label: TYPE_LABEL[s.key as LeadTypeKey] ?? s.key, count: s.count }))}
          note="E-mail i telefon pojawiają się po założeniu sygnału z maila / telefonu (+ Sygnał z maila / telefonu)."
        />
      </div>
    </div>
  );
}
