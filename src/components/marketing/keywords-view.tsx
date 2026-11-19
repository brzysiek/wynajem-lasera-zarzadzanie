"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { RATING_LABEL, RATINGS, type Rating } from "@/lib/marketing/analysis-rules";
import type { RatingDto } from "@/lib/marketing/analysis";
import type { KeywordRow, Report } from "@/lib/marketing/report";
import { kwcKey, type TrafficMetricsDto } from "@/lib/traffic/ads";
import { Num, SignalList, type Pick } from "./signal-list";
import { TRAFFIC_COLS, TrafficCells, TrafficHeads } from "./traffic-cells";

// Marketing → Słowa kluczowe (wniosek 54, etap 1c): frazy, które wpisywali ludzie.
// Ocenę (działa / obserwuj / do wykluczenia) zapisuje Claude (MCP slowo_ocena_ustaw) —
// panel jej nie liczy; w dymku data i uzasadnienie.

const PLN = (n: number) => `${Math.round(n).toLocaleString("pl-PL")} zł`;
const dmy = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });

const TILE: Record<Rating, { box: string; head: string; sub: string }> = {
  dziala: { box: "border-green-200 bg-green-50", head: "text-green-800", sub: "przyniosły zapytanie lub rezerwację" },
  obserwuj: { box: "border-blue-200 bg-blue-50", head: "text-blue-900", sub: "są kliknięcia, za mało danych na ocenę" },
  do_wykluczenia: { box: "border-orange-200 bg-orange-50", head: "text-orange-900", sub: "koszt bez zapytań albo zły zamiar (praca, kurs, zakup)" },
};
const BADGE: Record<Rating, string> = { dziala: "bg-green-100 text-green-800", obserwuj: "bg-blue-100 text-blue-800", do_wykluczenia: "bg-orange-100 text-orange-800" };

export type KeywordRowView = KeywordRow & { rating: RatingDto | null };

// „+ Więcej kolumn” (wejścia i start formularza z licznika ruchu) — wybór w localStorage.
const STORE_KEY = "marketing.slowa.wiecej-kolumn";
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener("marketing-cols-slowa", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("marketing-cols-slowa", cb);
  };
};
const readMore = (): boolean => {
  try {
    return window.localStorage.getItem(STORE_KEY) === "1";
  } catch {
    return false;
  }
};

export function KeywordsView({
  rows,
  campaigns,
  selected,
  query,
  leads,
  withoutKeyword,
  hasCosts,
  traffic,
}: {
  rows: KeywordRowView[];
  campaigns: { key: string; label: string }[];
  selected: string | null;
  query: string;
  leads: Report["leads"];
  withoutKeyword: number;
  hasCosts: boolean;
  traffic?: TrafficMetricsDto;
}) {
  const [picked, setPicked] = useState<Pick | null>(null);
  const more = useSyncExternalStore(subscribe, readMore, () => false);
  const setMore = (v: boolean) => {
    try {
      window.localStorage.setItem(STORE_KEY, v ? "1" : "0");
    } catch {
      /* bez localStorage wybór nie zostanie zapamiętany */
    }
    window.dispatchEvent(new Event("marketing-cols-slowa"));
  };
  const tm = (r: KeywordRowView) => traffic?.byKey[kwcKey(r.campaignKey, r.keyword)];
  const counts = Object.fromEntries(RATINGS.map((r) => [r, rows.filter((x) => x.rating?.rating === r).length])) as Record<Rating, number>;
  const shown = selected ? rows.filter((r) => r.campaignKey === selected) : rows;
  const pill = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-[#1B4FD8] bg-[#E8EEFD] font-medium text-[#1B4FD8]" : "border-gray-300 bg-white text-gray-800 hover:border-[#1B4FD8]"}`;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {RATINGS.map((r) => (
          <div key={r} className={`rounded-xl border px-4 py-3 ${TILE[r].box}`}>
            <div className={`text-xs font-semibold ${TILE[r].head}`}>{RATING_LABEL[r]}</div>
            <div className={`mt-1 text-3xl font-bold ${TILE[r].head}`}>{counts[r]} fraz</div>
            <div className={`mt-1 text-xs ${TILE[r].head}`}>{TILE[r].sub}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="m-0 mr-auto text-base font-semibold text-gray-900">Frazy, które wpisywali ludzie</h2>
          <button type="button" onClick={() => setMore(!more)} aria-pressed={more} className="h-8 rounded-full border border-gray-300 bg-white px-3 text-sm text-gray-800 hover:border-[#1B4FD8]">
            {more ? "− Mniej kolumn" : "+ Więcej kolumn"}
          </button>
          <Link href={`/marketing/slowa?${query}`} className={pill(!selected)}>
            Wszystkie
          </Link>
          {campaigns.map((c) => (
            <Link key={c.key} href={`/marketing/slowa?kampania=${encodeURIComponent(c.key)}&${query}`} className={pill(selected === c.key)}>
              {c.label}
            </Link>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Fraza</th>
                <th className="px-2 py-2 text-left font-medium">Kampania</th>
                <th className="px-2 py-2 text-right font-medium">Koszt</th>
                <th className="px-2 py-2 text-right font-medium">Kliknięcia</th>
                <th className="px-2 py-2 text-right font-medium">Zapytania</th>
                <th className="px-2 py-2 text-right font-medium">Rezerwacje</th>
                {more && <TrafficHeads />}
                <th className="px-2 py-2 text-left font-medium">Ocena</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={more ? 7 + TRAFFIC_COLS : 7} className="px-3 py-8 text-center text-gray-400">
                    {hasCosts ? "Brak fraz w tym okresie." : "Brak fraz — zaimportuj koszty (Ustawienia pomiaru) albo poczekaj na zapytania z reklam ze znacznikiem utm_term."}
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <tr key={`${r.campaignKey}|${r.keyword}`} className="border-t border-gray-100">
                  <td className="px-3 py-2">{r.label}</td>
                  <td className="px-2 py-2 text-gray-700">{r.campaign}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{r.cost > 0 ? PLN(r.cost) : "[—]"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.clicks > 0 ? r.clicks.toLocaleString("pl-PL") : "[—]"}</td>
                  <td className="px-2 py-2 text-right tabular-nums"><Num value={r.leads} ids={r.leadIds} title={`${r.label} — zapytania`} onPick={setPicked} /></td>
                  <td className="px-2 py-2 text-right tabular-nums"><Num value={r.bookings} ids={r.bookingIds} title={`${r.label} — rezerwacje`} onPick={setPicked} /></td>
                  {more && <TrafficCells m={tm(r)} hasData={!!traffic?.hasData} className="px-2 py-2 text-right tabular-nums" />}
                  <td className="px-2 py-2">
                    {r.rating ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[r.rating.rating]}`}
                        title={`${RATING_LABEL[r.rating.rating]} — ${dmy(r.rating.ratedAt)}, ${r.rating.ratedByName}${r.rating.reason ? `\n${r.rating.reason}` : ""}`}
                      >
                        {RATING_LABEL[r.rating.rating]}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mb-0 mt-3 text-xs text-gray-500">
          Ocenę nadaje Claude przy cotygodniowej analizie. Zmiany w Google Ads (np. wykluczenie frazy) trafiają jako propozycja do zakładki Analiza — nic nie dzieje się automatycznie.
          {withoutKeyword > 0 ? ` ${withoutKeyword} ${withoutKeyword === 1 ? "zapytanie z Google Ads nie ma frazy" : "zapytań z Google Ads nie ma frazy"} (brak utm_term w danych z formularza).` : ""}
        </p>
      </section>

      {picked && <SignalList pick={picked} leads={leads} onClose={() => setPicked(null)} />}
    </div>
  );
}
