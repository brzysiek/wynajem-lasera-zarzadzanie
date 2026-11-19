"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";
import { LOST_REASON_LABEL, STAGE_LABEL, TYPE_LABEL } from "@/lib/leads/labels";
import type { LeadStageKey, LeadTypeKey } from "@/lib/leads/parse-deal";
import type { Node, Report } from "@/lib/marketing/report";

// Marketing → Kampanie (wniosek 54, etap 1b): raport kampanii z własnych danych.
// Poziomy rozwijane kanał → kampania → grupa → słowo; każda liczba jest klikalna
// i pokazuje sygnały, z których się składa.

const PLN = (n: number) => `${n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const INT = (n: number) => n.toLocaleString("pl-PL");
const NUM = (n: number | null) => (n == null ? "—" : n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });

type Pick = { title: string; ids: string[] };

function Num({ value, ids, title, onPick, dim }: { value: number; ids: string[] | undefined; title: string; onPick: (p: Pick) => void; dim?: boolean }) {
  if (!value || !ids?.length) return <span className="text-gray-300">{value || "—"}</span>;
  return (
    <button type="button" onClick={() => onPick({ title, ids })} className={`font-medium underline decoration-dotted underline-offset-2 hover:text-[#1B6FA8] ${dim ? "text-gray-500" : "text-gray-900"}`}>
      {value}
    </button>
  );
}

function Row({ n, onPick, open, toggle, isTotal }: { n: Node; onPick: (p: Pick) => void; open: boolean; toggle: () => void; isTotal?: boolean }) {
  const m = n.metrics;
  const hasKids = n.children.length > 0;
  const name = `${n.path.kanal}${n.path.kampania ? ` › ${n.path.kampania}` : ""}${n.path.grupa ? ` › ${n.path.grupa}` : ""}${n.path.slowo ? ` › ${n.path.slowo}` : ""}`;
  const t = (what: string) => `${isTotal ? "Razem" : name} — ${what}`;
  const lost = Object.entries(m.lostByReason);
  return (
    <tr className={`border-t border-gray-100 ${isTotal ? "bg-gray-50 font-semibold" : ""} ${n.depth === 0 ? "bg-white" : ""}`}>
      <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-3 py-1.5" style={{ paddingLeft: 12 + Math.max(n.depth, 0) * 16 }}>
        {hasKids ? (
          <button type="button" onClick={toggle} aria-expanded={open} className="mr-1.5 inline-block w-4 text-gray-500">
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="mr-1.5 inline-block w-4" />
        )}
        <span className={n.depth === 0 ? "font-medium text-gray-900" : "text-gray-800"}>{n.label}</span>
      </td>
      <td className="px-2 text-right tabular-nums text-gray-600">{m.impressions ? INT(m.impressions) : "—"}</td>
      <td className="px-2 text-right tabular-nums text-gray-600">{m.clicks ? INT(m.clicks) : "—"}</td>
      <td className="px-2 text-right tabular-nums">{m.cost ? PLN(m.cost) : "—"}</td>
      <td className="px-2 text-right tabular-nums"><Num value={m.leads.razem} ids={n.ids.leads} title={t("leady")} onPick={onPick} /></td>
      <td className="px-2 text-right tabular-nums"><Num value={m.leads.cennik} ids={n.ids.leads_cennik} title={t("cennik")} onPick={onPick} dim /></td>
      <td className="px-2 text-right tabular-nums"><Num value={m.leads.kontakt} ids={n.ids.leads_kontakt} title={t("kontakt")} onPick={onPick} dim /></td>
      <td className="px-2 text-right tabular-nums"><Num value={m.leads.rezerwacja} ids={n.ids.leads_rezerwacja} title={t("rezerwacja WWW")} onPick={onPick} dim /></td>
      <td className="px-2 text-right tabular-nums"><Num value={m.leads.szkolenie} ids={n.ids.leads_szkolenie} title={t("szkolenie")} onPick={onPick} dim /></td>
      <td className="px-2 text-right tabular-nums"><Num value={m.leads.inne} ids={n.ids.leads_inne} title={t("inne sygnały")} onPick={onPick} dim /></td>
      <td className="border-l border-gray-100 px-2 text-right tabular-nums"><Num value={m.returning} ids={n.ids.returning} title={t("stałe klientki")} onPick={onPick} dim /></td>
      <td className="border-l border-gray-100 px-2 text-right tabular-nums"><Num value={m.talked} ids={n.ids.talked} title={t("rozmowy")} onPick={onPick} /></td>
      <td className="px-2 text-right tabular-nums"><Num value={m.offers} ids={n.ids.offers} title={t("oferty")} onPick={onPick} /></td>
      <td className="px-2 text-right tabular-nums"><Num value={m.bookings} ids={n.ids.bookings} title={t("rezerwacje")} onPick={onPick} /></td>
      <td className="px-2 text-right tabular-nums"><Num value={m.wins} ids={n.ids.wins} title={t("wygrane")} onPick={onPick} /></td>
      <td className="px-2 text-right tabular-nums">{m.revenue ? PLN(m.revenue) : "—"}</td>
      <td className="border-l border-gray-100 px-2 text-right tabular-nums">{NUM(m.costPerLead)}</td>
      <td className="px-2 text-right tabular-nums">{NUM(m.costPerTalk)}</td>
      <td className="px-2 text-right tabular-nums">{NUM(m.costPerBooking)}</td>
      <td className="px-2 text-right tabular-nums">{NUM(m.revenueToCost)}</td>
      <td className="border-l border-gray-100 px-2 text-xs text-gray-600">
        {lost.length === 0
          ? "—"
          : lost.map(([r, c], i) => (
              <Fragment key={r}>
                {i > 0 && ", "}
                <button type="button" className="underline decoration-dotted hover:text-[#1B6FA8]" onClick={() => onPick({ title: t(`przegrane: ${LOST_REASON_LABEL[r as keyof typeof LOST_REASON_LABEL] ?? "bez powodu"}`), ids: n.ids[`lost_${r}`] ?? [] })}>
                  {LOST_REASON_LABEL[r as keyof typeof LOST_REASON_LABEL] ?? "bez powodu"} {c}
                </button>
              </Fragment>
            ))}
      </td>
    </tr>
  );
}

function Rows({ nodes, onPick, expanded, setExpanded }: { nodes: Node[]; onPick: (p: Pick) => void; expanded: Set<string>; setExpanded: (s: Set<string>) => void }) {
  return (
    <>
      {nodes.map((n) => {
        const id = `${n.depth}:${n.path.kanal}|${n.path.kampania ?? ""}|${n.path.grupa ?? ""}|${n.key}`;
        const open = expanded.has(id);
        return (
          <Fragment key={id}>
            <Row
              n={n}
              onPick={onPick}
              open={open}
              toggle={() => {
                const next = new Set(expanded);
                if (open) next.delete(id);
                else next.add(id);
                setExpanded(next);
              }}
            />
            {open && <Rows nodes={n.children} onPick={onPick} expanded={expanded} setExpanded={setExpanded} />}
          </Fragment>
        );
      })}
    </>
  );
}

export function CampaignReportView({ report, today, seasonFrom }: { report: Report; today: string; seasonFrom: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(report.from);
  const [to, setTo] = useState(report.to);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState("kampania");

  const go = (f: string, t: string) => router.push(`/marketing/kampanie?from=${f}&to=${t}`);
  const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const csvHref = `${BASE_PATH}/api/marketing/campaigns?from=${report.from}&to=${report.to}&format=csv&level=${level}`;
  const preset28 = report.from === addDays(today, -27) && report.to === today;
  const presetSeason = report.from === seasonFrom && report.to === today;
  const btn = (on: boolean) => `h-8 rounded-md border px-3 text-sm ${on ? "border-[#1B6FA8] bg-[#E8F2F9] font-semibold text-[#1B6FA8]" : "border-gray-300 bg-white text-gray-700 hover:border-[#1B6FA8]"}`;

  const rows = [report.total, ...report.channels];
  const th = "px-2 py-2 text-right font-medium";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn(preset28)} onClick={() => go(addDays(today, -27), today)}>
          Ostatnie 28 dni
        </button>
        <button type="button" className={btn(presetSeason)} onClick={() => go(seasonFrom, today)}>
          Sezon (od {seasonFrom.slice(8)}.{seasonFrom.slice(5, 7)})
        </button>
        <label className="ml-2 flex items-center gap-1 text-xs text-gray-500">
          od
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-md border border-gray-300 px-2 text-sm text-gray-900" />
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          do
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-md border border-gray-300 px-2 text-sm text-gray-900" />
        </label>
        <button type="button" className={btn(false)} disabled={!from || !to} onClick={() => go(from, to)}>
          Pokaż
        </button>
        <span className="ml-auto flex items-center gap-2">
          <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Poziom CSV" className="h-8 rounded-md border border-gray-300 px-2 text-sm">
            <option value="kanal">CSV: kanały</option>
            <option value="kampania">CSV: kampanie</option>
            <option value="grupa">CSV: grupy</option>
            <option value="slowo">CSV: słowa kluczowe</option>
          </select>
          <a href={csvHref} className={btn(false) + " inline-flex items-center"}>
            Pobierz CSV
          </a>
          <Link href="/marketing/koszty" className={btn(false) + " inline-flex items-center"}>
            Import kosztów
          </Link>
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[1500px] text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium">Kanał › kampania › grupa › słowo</th>
              <th className={th}>Wyśw.</th>
              <th className={th}>Klik.</th>
              <th className={th}>Koszt</th>
              <th className={th}>Leady</th>
              <th className={th} title="Pobranie cennika">Cennik</th>
              <th className={th}>Kontakt</th>
              <th className={th}>Rez. WWW</th>
              <th className={th}>Szkol.</th>
              <th className={th}>Inne</th>
              <th className={`${th} border-l border-gray-200`} title="Stałe klientki — poza kosztem pozyskania">Stałe</th>
              <th className={`${th} border-l border-gray-200`}>Rozmowy</th>
              <th className={th} title="Co najmniej etap Oferta">Oferty</th>
              <th className={th} title="Co najmniej etap Rezerwacja">Rezerw.</th>
              <th className={th}>Wygrane</th>
              <th className={th} title="Suma netto z rozliczeń powiązanych wynajmów">Przychód</th>
              <th className={`${th} border-l border-gray-200`}>Koszt/lead</th>
              <th className={th}>Koszt/rozm.</th>
              <th className={th}>Koszt/rez.</th>
              <th className={th}>Przych./koszt</th>
              <th className={`${th} border-l border-gray-200 text-left`}>Przegrane wg powodu</th>
            </tr>
          </thead>
          <tbody>
            <Row n={{ ...report.total, depth: -1 }} onPick={setPicked} open={false} toggle={() => undefined} isTotal />
            <Rows nodes={report.channels} onPick={setPicked} expanded={expanded} setExpanded={setExpanded} />
          </tbody>
        </table>
        {rows.length === 1 && <p className="p-8 text-center text-sm text-gray-400">Brak sygnałów w tym okresie.</p>}
      </div>

      {picked && <SignalList pick={picked} report={report} onClose={() => setPicked(null)} />}

      <details className="rounded-lg border border-gray-200 bg-white px-4 py-3" open={report.keywordsWithoutLeads.length > 0}>
        <summary className="cursor-pointer text-sm font-semibold text-gray-900">Słowa z kosztem i bez leadów ({report.keywordsWithoutLeads.length})</summary>
        {report.keywordsWithoutLeads.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Brak — albo nie zaimportowano kosztów, albo każde słowo z kosztem ma lead.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-xs uppercase text-gray-500">
              <tr>
                <th className="py-1 text-left font-medium">Słowo kluczowe</th>
                <th className="py-1 text-left font-medium">Kampania › grupa</th>
                <th className="py-1 text-right font-medium">Wyśw.</th>
                <th className="py-1 text-right font-medium">Klik.</th>
                <th className="py-1 text-right font-medium">Koszt</th>
              </tr>
            </thead>
            <tbody>
              {report.keywordsWithoutLeads.map((k, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-1">{k.keyword}</td>
                  <td className="py-1 text-gray-600">{k.campaign} › {k.group}</td>
                  <td className="py-1 text-right tabular-nums">{INT(k.impressions)}</td>
                  <td className="py-1 text-right tabular-nums">{INT(k.clicks)}</td>
                  <td className="py-1 text-right tabular-nums">{PLN(k.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <Trend report={report} onPick={setPicked} />

      <details className="rounded-lg border border-gray-200 bg-white px-4 py-3" open={report.unsourced.length > 0}>
        <summary className="cursor-pointer text-sm font-semibold text-gray-900">Leady bez źródła — do uzupełnienia ({report.unsourced.length})</summary>
        {report.unsourced.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Wszystkie sygnały z tego okresu mają źródło.</p>
        ) : (
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-sm">
            {report.unsourced.map((u) => {
              const l = report.leads[u.id];
              return (
                <li key={u.id} className="flex flex-wrap items-baseline gap-2 border-t border-gray-100 py-1 first:border-t-0">
                  <Link href={`/sygnaly?id=${u.id}`} className="font-medium text-[#1B6FA8] hover:underline">
                    {l?.title ?? u.id}
                  </Link>
                  <span className="text-xs text-gray-500">{l ? `${TYPE_LABEL[l.type as LeadTypeKey] ?? l.type} · ${fmtDay(l.createdAt)}` : ""}</span>
                  <span className="ml-auto text-xs text-gray-500">{u.channel}</span>
                </li>
              );
            })}
          </ul>
        )}
      </details>

      <ul className="m-0 list-disc pl-5 text-xs text-gray-500">
        {report.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

function SignalList({ pick, report, onClose }: { pick: Pick; report: Report; onClose: () => void }) {
  const unique = [...new Set(pick.ids)];
  return (
    <section className="rounded-lg border border-[#1B6FA8] bg-white" aria-label="Sygnały za liczbą">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2">
        <h2 className="m-0 text-sm font-semibold text-gray-900">
          {pick.title} — {unique.length}
        </h2>
        <button type="button" onClick={onClose} className="ml-auto text-xs font-semibold text-[#1B6FA8] hover:underline">
          zamknij
        </button>
      </div>
      <ul className="m-0 flex max-h-80 list-none flex-col overflow-y-auto p-0 text-sm">
        {unique.map((id) => {
          const l = report.leads[id];
          return (
            <li key={id} className="flex flex-wrap items-baseline gap-2 border-t border-gray-100 px-4 py-1.5 first:border-t-0">
              <Link href={`/sygnaly?id=${id}`} className="font-medium text-[#1B6FA8] hover:underline">
                {l?.title ?? id}
              </Link>
              {l && (
                <span className="text-xs text-gray-500">
                  {TYPE_LABEL[l.type as LeadTypeKey] ?? l.type} · {STAGE_LABEL[l.stage as LeadStageKey] ?? l.stage} · {fmtDay(l.createdAt)}
                </span>
              )}
              {l?.termFromFirst && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800" title="Ostatnie wejście miało tę samą kampanię, ale bez utm_term / utm_content — grupa i słowo z pierwszego wejścia">
                  hasło z pierwszego wejścia
                </span>
              )}
              {l && <span className="ml-auto text-xs text-gray-400">{l.channel}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Trend({ report, onPick }: { report: Report; onPick: (p: Pick) => void }) {
  const weeks = [...new Set(report.trend.map((t) => t.week))].sort();
  const channels = [...new Set(report.trend.map((t) => t.channel))];
  if (!weeks.length) return null;
  return (
    <details className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-gray-900">Trend tygodniowy według kanałów</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-xs uppercase text-gray-500">
            <tr>
              <th className="py-1 text-left font-medium">Tydzień od</th>
              <th className="py-1 text-left font-medium">Kanał</th>
              <th className="py-1 text-right font-medium">Leady</th>
              <th className="py-1 text-right font-medium">Rozmowy</th>
              <th className="py-1 text-right font-medium">Rezerwacje</th>
              <th className="py-1 text-right font-medium">Koszt</th>
            </tr>
          </thead>
          <tbody>
            {weeks.flatMap((w) =>
              channels
                .map((c) => report.trend.find((t) => t.week === w && t.channel === c))
                .filter((t): t is NonNullable<typeof t> => Boolean(t))
                .map((t) => (
                  <tr key={`${t.week}-${t.channel}`} className="border-t border-gray-100">
                    <td className="py-1">{fmtDay(`${t.week}T00:00:00Z`)}</td>
                    <td className="py-1 text-gray-700">{t.channel}</td>
                    <td className="py-1 text-right tabular-nums"><Num value={t.leads} ids={t.ids.leads} title={`${t.channel}, tydzień od ${t.week} — leady`} onPick={onPick} /></td>
                    <td className="py-1 text-right tabular-nums"><Num value={t.talked} ids={t.ids.talked} title={`${t.channel}, tydzień od ${t.week} — rozmowy`} onPick={onPick} /></td>
                    <td className="py-1 text-right tabular-nums"><Num value={t.bookings} ids={t.ids.bookings} title={`${t.channel}, tydzień od ${t.week} — rezerwacje`} onPick={onPick} /></td>
                    <td className="py-1 text-right tabular-nums">{t.cost ? PLN(t.cost) : "—"}</td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}
