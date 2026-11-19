"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { TYPE_LABEL } from "@/lib/leads/labels";
import type { LeadTypeKey } from "@/lib/leads/parse-deal";
import type { Node, Report } from "@/lib/marketing/report";
import { CH } from "@/lib/marketing/source";
import { nodeTrafficKey, type TrafficMetricsDto } from "@/lib/traffic/ads";
import { Num, SignalList, type Pick } from "./signal-list";
import { TRAFFIC_COLS, TrafficCells, TrafficHeads, totalMetrics } from "./traffic-cells";

// Marketing → Kampanie (wniosek 54, etap 1c): tabela kanałów (domyślnie 6 kolumn,
// reszta pod „+ Więcej kolumn”, wybór w localStorage), rozwijane kampanie Google Ads
// i Meta reklamy, leady bez źródła i trend tygodniowy.

const PLN = (n: number) => `${Math.round(n).toLocaleString("pl-PL")} zł`;
const INT = (n: number) => n.toLocaleString("pl-PL");

const ORDER: string[] = [CH.GOOGLE_ADS, CH.GOOGLE_ORG, CH.FACEBOOK, CH.INSTAGRAM, CH.META, CH.BING, CH.OTHER_SITE, CH.PHONE_EMAIL, CH.REFERRAL, CH.RETURNING, CH.OLX, CH.MESSENGER, CH.INSTAGRAM_DM, CH.NONE];
const FREE: string[] = [CH.GOOGLE_ORG, CH.FACEBOOK, CH.INSTAGRAM, CH.REFERRAL];
const PAID: string[] = [CH.GOOGLE_ADS, CH.META];

const STORE_KEY = "marketing.kampanie.wiecej-kolumn";
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener("marketing-cols", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("marketing-cols", cb);
  };
};
function readMore(): boolean {
  try {
    return window.localStorage.getItem(STORE_KEY) === "1";
  } catch {
    return false;
  }
}

function costPerBooking(n: Node, hasCosts: boolean): string {
  if (FREE.includes(n.label)) return "bezpłatne";
  if (PAID.includes(n.label)) {
    if (!hasCosts || n.metrics.cost <= 0) return "[po imporcie]";
    return n.metrics.bookings > 0 ? PLN(n.metrics.cost / n.metrics.bookings) : "brak rezerwacji";
  }
  return "—";
}

export function ChannelsView({ report, query, csvQuery, hasCosts, traffic }: { report: Report; query: string; csvQuery: string; hasCosts: boolean; traffic?: TrafficMetricsDto }) {
  const more = useSyncExternalStore(subscribe, readMore, () => false);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [open, setOpen] = useState<string | null>(CH.GOOGLE_ADS);
  const [openSub, setOpenSub] = useState<Set<string>>(new Set()); // rozwinięte kampanie / zestawy Mety
  const toggleSub = (k: string) =>
    setOpenSub((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const setMore = (v: boolean) => {
    try {
      window.localStorage.setItem(STORE_KEY, v ? "1" : "0");
    } catch {
      /* brak localStorage — wybór nie zostanie zapamiętany */
    }
    window.dispatchEvent(new Event("marketing-cols"));
  };

  const channels = [...report.channels]
    .filter((n) => n.metrics.leads.razem > 0 || n.metrics.bookings > 0 || n.metrics.cost > 0)
    .sort((a, b) => (ORDER.indexOf(a.label) === -1 ? 99 : ORDER.indexOf(a.label)) - (ORDER.indexOf(b.label) === -1 ? 99 : ORDER.indexOf(b.label)));
  const total = report.total;
  const th = "px-2 py-2 text-right font-medium whitespace-nowrap";
  const num = "px-2 py-2 text-right tabular-nums";
  const openNode = open ? channels.find((c) => c.label === open) : null;
  const returningCount = total.metrics.returning;
  // Wniosek 54: jakość ruchu z licznika (wejścia, % wyszli od razu, % przewinęło ≥ 50, telefon, start formularza).
  const hasTraffic = !!traffic?.hasData;
  const tm = (n: Node) => {
    const k = nodeTrafficKey(n.ckeys);
    return k ? traffic?.byKey[k] : undefined;
  };
  const tTotal = totalMetrics(traffic);

  const row = (n: Node, opts: { isTotal?: boolean } = {}) => {
    const m = n.metrics;
    const expandable = !opts.isTotal && PAID.includes(n.label) && n.children.length > 0;
    const unknown = n.label === CH.NONE;
    const t = (what: string) => `${opts.isTotal ? "Razem" : n.label} — ${what}`;
    return (
      <tr key={n.label} className={`border-t border-gray-100 ${unknown ? "bg-orange-50 text-[#8F3F0A]" : ""} ${opts.isTotal ? "bg-gray-50 font-semibold" : ""}`}>
        <td className="px-3 py-2">
          {expandable ? (
            <button type="button" onClick={() => setOpen(open === n.label ? null : n.label)} aria-expanded={open === n.label} className="text-left text-[#1B4FD8] underline">
              {open === n.label ? "▾" : "▸"} {n.label}
            </button>
          ) : (
            n.label
          )}
        </td>
        <td className={num}><Num value={m.leads.razem} ids={n.ids.leads} title={t("zapytania")} onPick={setPicked} /></td>
        <td className={num}><Num value={m.offers} ids={n.ids.offers} title={t("oferty")} onPick={setPicked} /></td>
        <td className={num}><Num value={m.bookings} ids={n.ids.bookings} title={t("rezerwacje")} onPick={setPicked} /></td>
        <td className={`${num} whitespace-nowrap`}>{PLN(m.revenue)}</td>
        {more && (
          <>
            <td className={num}><Num value={m.talked} ids={n.ids.talked} title={t("rozmowy")} onPick={setPicked} /></td>
            <td className={num}><Num value={m.wins} ids={n.ids.wins} title={t("wygrane")} onPick={setPicked} /></td>
            <td className={`${num} whitespace-nowrap text-gray-600`} title="oferty / zapytania · rezerwacje / oferty">
              {m.leads.razem > 0 ? `${Math.round((m.offers / m.leads.razem) * 100)}%` : "—"} · {m.offers > 0 ? `${Math.round((m.bookings / m.offers) * 100)}%` : "—"}
            </td>
            <td className={num}>{m.clicks ? INT(m.clicks) : "—"}</td>
            <td className={num}>{m.impressions ? INT(m.impressions) : "—"}</td>
            <td className={`${num} whitespace-nowrap`}>{m.cost ? PLN(m.cost) : "—"}</td>
            <td className={`${num} whitespace-nowrap`}>{m.cost > 0 && m.leads.razem > 0 ? PLN(m.cost / m.leads.razem) : "—"}</td>
            <TrafficCells m={opts.isTotal ? tTotal : tm(n)} hasData={hasTraffic} className={num} />
          </>
        )}
        <td className={`${num} whitespace-nowrap text-gray-600`}>{opts.isTotal ? "—" : costPerBooking(n, hasCosts)}</td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-base font-semibold text-gray-900">Kanały</h2>
          <span className="ml-auto flex items-center gap-2">
            <a href={`${BASE_PATH}/api/marketing/campaigns?${csvQuery}&format=csv&level=kampania`} className="inline-flex h-9 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 hover:border-[#1B6FA8]">
              Pobierz CSV
            </a>
            <button type="button" onClick={() => setMore(!more)} aria-pressed={more} className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 hover:border-[#1B6FA8]">
              {more ? "− Mniej kolumn" : "+ Więcej kolumn"}
            </button>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Kanał</th>
                <th className={th}>Zapytania</th>
                <th className={th}>Oferty</th>
                <th className={th}>Rezerwacje</th>
                <th className={th}>Przychód</th>
                {more && (
                  <>
                    <th className={th}>Rozmowy</th>
                    <th className={th} title="Wynajem zrealizowany (etap Wygrana)">Wygrane</th>
                    <th className={th} title="oferty / zapytania · rezerwacje / oferty">% kroków</th>
                    <th className={th}>Kliknięcia</th>
                    <th className={th}>Wyświetlenia</th>
                    <th className={th}>Koszt</th>
                    <th className={th}>Koszt / zapytanie</th>
                    <TrafficHeads />
                  </>
                )}
                <th className={th}>Koszt / rezerwację</th>
              </tr>
            </thead>
            <tbody>
              {channels.length === 0 && (
                <tr>
                  <td colSpan={more ? 9 + TRAFFIC_COLS : 6} className="px-3 py-8 text-center text-gray-400">
                    Brak zapytań w tym okresie.
                  </td>
                </tr>
              )}
              {channels.map((n) => row(n))}
              {channels.length > 0 && row(total, { isTotal: true })}
            </tbody>
          </table>
        </div>
        <p className="mb-0 mt-3 text-xs text-gray-500">
          „Więcej kolumn” dokłada: rozmowy, wygrane (wynajem zrealizowany), odsetek kroków, kliknięcia, wyświetlenia, koszt i koszt / zapytanie. Stałe klientki i dostawcy nie liczą się jako nowe zapytania
          {returningCount > 0 ? ` (pominięto ${returningCount} ${returningCount === 1 ? "stałą klientkę" : "stałych klientek"})` : ""}.
        </p>
      </section>

      {picked && <SignalList pick={picked} leads={report.leads} onClose={() => setPicked(null)} />}

      {openNode && (
        <section className="rounded-xl border border-gray-200 bg-white px-5 py-4">
          <h2 className="m-0 text-base font-semibold text-gray-900">{openNode.label} — kampanie</h2>
          <p className="mb-3 mt-0 text-xs text-gray-500">
            Rozwinięcie wiersza „{openNode.label}”.{openNode.label === CH.GOOGLE_ADS ? " Kliknij kampanię, żeby zobaczyć jej słowa kluczowe." : ""}{openNode.label === CH.META ? " Kliknij kampanię, żeby zobaczyć zestawy reklam, a zestaw — reklamy. Zapytania ze starymi znacznikami (sprzed 28.10) są w wierszu „Meta — bez przypisania do reklamy”." : ""}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Kampania</th>
                  <th className={th}>Koszt</th>
                  <th className={th}>Zapytania</th>
                  <th className={th}>Rezerwacje</th>
                  <th className={th}>Przychód</th>
                  <th className={th} title="Przychód ÷ koszt kampanii">Zwrot</th>
                  {more && <TrafficHeads />}
                </tr>
              </thead>
              <tbody>
                {openNode.children.flatMap((c) => {
                  const isMeta = openNode.label === CH.META;
                  const cells = (n: Node, label: string) => (
                    <>
                      <td className={`${num} whitespace-nowrap`}>{hasCosts && n.metrics.cost > 0 ? PLN(n.metrics.cost) : "[—]"}</td>
                      <td className={num}><Num value={n.metrics.leads.razem} ids={n.ids.leads} title={`${label} — zapytania`} onPick={setPicked} /></td>
                      <td className={num}><Num value={n.metrics.bookings} ids={n.ids.bookings} title={`${label} — rezerwacje`} onPick={setPicked} /></td>
                      <td className={`${num} whitespace-nowrap`}>{PLN(n.metrics.revenue)}</td>
                      <td className={num}>{n.metrics.revenueToCost != null ? `${n.metrics.revenueToCost.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}×` : "[—]"}</td>
                      {more && <TrafficCells m={tm(n)} hasData={hasTraffic} className={num} />}
                    </>
                  );
                  const rows = [
                    <tr key={c.key} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        {isMeta && c.children.length > 0 ? (
                          <button type="button" onClick={() => toggleSub(c.key)} aria-expanded={openSub.has(c.key)} className="text-left text-[#1B4FD8] underline">
                            {openSub.has(c.key) ? "▾" : "▸"} {c.label}
                          </button>
                        ) : openNode.label === CH.GOOGLE_ADS && c.key.indexOf("(") !== 0 ? (
                          <Link href={`/marketing/slowa?kampania=${encodeURIComponent(c.key)}&${query}`} className="text-[#1B4FD8] underline">
                            {c.label}
                          </Link>
                        ) : (
                          c.label
                        )}
                      </td>
                      {cells(c, c.label)}
                    </tr>,
                  ];
                  if (isMeta && openSub.has(c.key)) {
                    for (const z of c.children) {
                      const zk = `${c.key}|${z.key}`;
                      rows.push(
                        <tr key={zk} className="border-t border-gray-100 bg-gray-50/60">
                          <td className="py-2 pl-8 pr-3">
                            {z.children.length > 0 ? (
                              <button type="button" onClick={() => toggleSub(zk)} aria-expanded={openSub.has(zk)} className="text-left text-[#1B4FD8] underline" title="Zestaw reklam">
                                {openSub.has(zk) ? "▾" : "▸"} {z.label}
                              </button>
                            ) : (
                              z.label
                            )}
                          </td>
                          {cells(z, `${c.label} / ${z.label}`)}
                        </tr>,
                      );
                      if (openSub.has(zk)) {
                        for (const r of z.children) {
                          rows.push(
                            <tr key={`${zk}|${r.key}`} className="border-t border-gray-100 bg-gray-50/30">
                              <td className="py-2 pl-14 pr-3 text-gray-700" title="Reklama">{r.label}</td>
                              {cells(r, `${z.label} / ${r.label}`)}
                            </tr>,
                          );
                        }
                      }
                    }
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </div>
          <p className="mb-0 mt-3 text-xs text-gray-500">„Zwrot” = przychód z rezerwacji ÷ koszt kampanii. Wartości pojawią się po imporcie kosztów (Ustawienia pomiaru: Google Ads i Meta).</p>
        </section>
      )}

      <section id="bez-zrodla" className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <h2 className="m-0 text-base font-semibold text-gray-900">Leady bez źródła — do uzupełnienia ({report.unsourced.length})</h2>
        <p className="mb-2 mt-0 text-xs text-gray-500">Nowe zapytania, o których nie wiemy, skąd przyszły. Ania pyta przy kontakcie („skąd Pani o nas wie, co Pani wpisała w Google?”) i wpisuje źródło w karcie klienta.</p>
        {report.unsourced.length === 0 ? (
          <p className="m-0 text-sm text-gray-500">Wszystkie nowe zapytania z tego okresu mają źródło.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {report.unsourced.map((u) => {
              const l = report.leads[u.id];
              return (
                <li key={u.id} className="flex flex-wrap items-baseline gap-2 border-t border-gray-100 py-1 first:border-t-0">
                  <Link href={`/sygnaly?id=${u.id}`} className="font-medium text-[#1B6FA8] hover:underline">
                    {l?.title ?? u.id}
                  </Link>
                  <span className="text-xs text-gray-500">{l ? `${TYPE_LABEL[l.type as LeadTypeKey] ?? l.type} · ${new Date(l.createdAt).toLocaleDateString("pl-PL")}` : ""}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Trend report={report} onPick={setPicked} />
    </div>
  );
}

function Trend({ report, onPick }: { report: Report; onPick: (p: Pick) => void }) {
  const weeks = [...new Set(report.trend.map((t) => t.week))].sort();
  if (!weeks.length) return null;
  return (
    <details className="rounded-xl border border-gray-200 bg-white px-5 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-gray-900">Trend tygodniowy według kanałów</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="py-1 text-left font-medium">Tydzień od</th>
              <th className="py-1 text-left font-medium">Kanał</th>
              <th className="py-1 text-right font-medium">Zapytania</th>
              <th className="py-1 text-right font-medium">Rozmowy</th>
              <th className="py-1 text-right font-medium">Rezerwacje</th>
              <th className="py-1 text-right font-medium">Koszt</th>
            </tr>
          </thead>
          <tbody>
            {report.trend.map((t) => (
              <tr key={`${t.week}-${t.channel}`} className="border-t border-gray-100">
                <td className="py-1">{new Date(`${t.week}T00:00:00Z`).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })}</td>
                <td className="py-1 text-gray-700">{t.channel}</td>
                <td className="py-1 text-right tabular-nums"><Num value={t.leads} ids={t.ids.leads} title={`${t.channel}, tydzień od ${t.week} — zapytania`} onPick={onPick} /></td>
                <td className="py-1 text-right tabular-nums"><Num value={t.talked} ids={t.ids.talked} title={`${t.channel}, tydzień od ${t.week} — rozmowy`} onPick={onPick} /></td>
                <td className="py-1 text-right tabular-nums"><Num value={t.bookings} ids={t.ids.bookings} title={`${t.channel}, tydzień od ${t.week} — rezerwacje`} onPick={onPick} /></td>
                <td className="py-1 text-right tabular-nums">{t.cost ? PLN(t.cost) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
