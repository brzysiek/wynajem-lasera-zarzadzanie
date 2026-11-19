"use client";

import { useMemo, useState } from "react";
import type { TrafficReport } from "@/lib/traffic/report";

// Marketing → Ruch na stronie (wniosek 54, etap 2): dane z anonimowego licznika (bez ciasteczek) —
// liczy wszystkie wejścia, także osób, które odrzuciły baner. Układ jak w makiecie.

const INT = (n: number) => n.toLocaleString("pl-PL");
const DEV_LABEL: Record<string, string> = { telefon: "telefon", tablet: "tablet", komputer: "komputer", nieznane: "nieznane" };

function Kpi({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 text-3xl font-bold text-gray-900">{children}</div>
    </div>
  );
}

function Card({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white px-5 py-4 ${className}`}>
      <h2 className="m-0 text-base font-semibold text-gray-900">{title}</h2>
      {sub && <p className="m-0 mt-0.5 text-xs text-gray-500">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const th = "py-1 px-1.5 text-right font-medium";
const td = "py-1.5 px-1.5 text-right tabular-nums";

export type AdsComparison = { key: string; label: string; visits: number; formStarts: number; leads: number; leadsPer100Visits: number | null }[];

export function TrafficView({ report, comparison }: { report: TrafficReport; comparison: AdsComparison }) {
  const t = report.tiles;
  const devOf = (c: { byDev: Record<string, number> }) =>
    Object.entries(c.byDev)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${DEV_LABEL[k] ?? k} ${n}`)
      .join(" · ");
  const paths = useMemo(() => [...new Set([...report.clicks.points.map((p) => p.path), ...report.pages.map((p) => p.path)])], [report]);
  const [mapPath, setMapPath] = useState(paths[0] ?? "/");
  const [mapDev, setMapDev] = useState<"telefon" | "komputer">("telefon");
  const dots = report.clicks.points.filter((p) => p.path === mapPath && (mapDev === "telefon" ? p.dev !== "komputer" : p.dev === "komputer"));
  const mapHeight = Math.min(2400, Math.max(320, Math.round(Math.max(0, ...dots.map((p) => p.y)) + 80)));
  const bn = report.consents.banner;
  const en = report.consents.entries;
  const entriesTotal = en.s1m1 + en.s1m0 + en.s0m0 + en.brak;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Dane z naszego anonimowego licznika (bez ciasteczek) — liczy wszystkie wejścia, także osób, które odrzuciły baner. Bez zapisu adresu IP i danych urządzenia; wejścia z naszych urządzeń i automaty są pomijane.
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi title="Wejścia na stronę">{INT(t.visits)}</Kpi>
        <Kpi title="W tym z reklam">{INT(t.fromAds)}</Kpi>
        <Kpi title="Akceptują baner cookies">{t.bannerAcceptPct != null ? `${t.bannerAcceptPct} %` : "—"}</Kpi>
        <Kpi title="Formularz: zaczęte → wysłane">
          {INT(t.formStarted)} → {INT(t.formSent)}
        </Kpi>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Skąd wchodzą" sub="Początki wizyt wg kanału i urządzenia">
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {report.channels.map((c) => (
              <li key={c.channel} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  {c.channel}
                  <span className="ml-2 text-xs text-gray-500">{devOf(c)}</span>
                </span>
                <b className="tabular-nums">{INT(c.visits)}</b>
              </li>
            ))}
            {report.channels.length === 0 && <li className="text-gray-400">Brak wejść.</li>}
          </ul>
          {report.campaigns.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-sm font-semibold text-gray-900">Reklamy wg kampanii</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                {report.campaigns.map((c) => (
                  <li key={`${c.channel}|${c.key}`} className="flex justify-between gap-2">
                    <span>
                      {c.label} <span className="text-xs text-gray-500">({c.channel})</span>
                    </span>
                    <span className="tabular-nums">
                      {INT(c.visits)} <span className="text-xs text-gray-500">· start formularza {INT(c.formStarts)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title="Zgody" sub="Wybór w banerze i stan zgody przy wejściach">
          <table className="w-full text-sm">
            <tbody>
              <tr><td className="py-1">Baner pokazany</td><td className={td}>{INT(bn.shown)}</td></tr>
              <tr><td className="py-1">Akceptuję wszystkie</td><td className={td}>{INT(bn.wszystkie)}</td></tr>
              <tr><td className="py-1">Wybór własny</td><td className={td}>{INT(bn.wlasny)}</td></tr>
              <tr><td className="py-1">Odrzucam</td><td className={td}>{INT(bn.odrzucam)}</td></tr>
            </tbody>
          </table>
          <h3 className="mb-1 mt-3 text-sm font-semibold text-gray-900">Stan zgody przy wejściach</h3>
          <table className="w-full text-sm">
            <tbody>
              {[
                ["statystyka + marketing", en.s1m1],
                ["tylko statystyka", en.s1m0],
                ["bez zgód", en.s0m0],
                ["brak informacji", en.brak],
              ].map(([l, v]) => (
                <tr key={l as string}>
                  <td className="py-1">{l as string}</td>
                  <td className={td}>
                    {INT(v as number)} {entriesTotal > 0 && <span className="text-xs text-gray-500">({Math.round(((v as number) / entriesTotal) * 100)}%)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Strony: wejścia i wyjścia" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="py-1 text-left font-medium">Strona</th>
                  <th className={th} title="Odsłony strony">Wejścia</th>
                  <th className={th} title="Od tej strony zaczęła się wizyta">Strona wejścia</th>
                  <th className={th} title="Wyszli z witryny z tej strony">Wyjścia</th>
                  <th className={th}>Przewinięte</th>
                  <th className={th}>Czas (najczęściej)</th>
                  <th className={th}>Wyszli od razu</th>
                </tr>
              </thead>
              <tbody>
                {report.pages.map((p) => {
                  const top = Object.entries(p.time).sort((a, b) => b[1] - a[1])[0];
                  return (
                    <tr key={p.path} className="border-t border-gray-100">
                      <td className="py-1.5 pr-2">{p.path}</td>
                      <td className={td}>{INT(p.views)}</td>
                      <td className={td}>{INT(p.landings)}</td>
                      <td className={td}>{INT(p.exits)}</td>
                      <td className={td}>{p.avgScroll != null ? `${p.avgScroll} %` : "—"}</td>
                      <td className={td}>{top ? top[0] : "—"}</td>
                      <td className={td}>{p.bouncedPct != null ? `${p.bouncedPct} %` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Przejścia między stronami" sub="Z jakiej strony na jaką">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {report.transitions.slice(0, 15).map((x) => (
              <li key={`${x.from}>${x.to}`} className="flex justify-between gap-2">
                <span>
                  {x.from} <span className="text-gray-400">→</span> {x.to}
                </span>
                <b className="tabular-nums">{INT(x.count)}</b>
              </li>
            ))}
            {report.transitions.length === 0 && <li className="text-gray-400">Brak przejść.</li>}
          </ul>
        </Card>

        <Card title="Gdzie rezygnują w formularzu" sub="Lejek i ostatnie pole przed porzuceniem">
          {report.forms.length === 0 ? (
            <p className="m-0 text-sm text-gray-400">Brak zdarzeń formularzy.</p>
          ) : (
            report.forms.map((f) => (
              <div key={f.form} className="mb-3 last:mb-0">
                <div className="text-sm font-semibold text-gray-900">
                  Formularz {f.form} <span className="text-xs font-normal text-gray-500">({f.paths.join(", ")})</span>
                </div>
                <div className="text-sm text-gray-700">
                  wyświetlenia {INT(f.views)} → start {INT(f.started)} → próba {INT(f.tried)} → wysłany <b>{INT(f.sent)}</b>
                </div>
                {f.abandoned.length > 0 && (
                  <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-sm text-gray-700">
                    {f.abandoned.map((a) => (
                      <li key={a.field} className="flex justify-between gap-2">
                        <span>porzucili na polu „{a.field}”</span>
                        <span className="tabular-nums">{a.count} osób · błędów śr. {a.errorsAvg}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {f.errors.length > 0 && <div className="mt-1 text-xs text-gray-500">Najczęstsze błędy: {f.errors.map((e) => `${e.field} ${e.count}`).join(", ")}</div>}
              </div>
            ))
          )}
        </Card>

        <Card title="Gdzie klikają" sub="Najczęściej klikane elementy; telefon wg strony" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="py-1 text-left font-medium">Element</th>
                    <th className="py-1 text-left font-medium">Strona</th>
                    <th className="py-1 text-left font-medium">Urządz.</th>
                    <th className={th}>Kliknięć</th>
                  </tr>
                </thead>
                <tbody>
                  {report.clicks.top.slice(0, 15).map((c, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-1.5">
                        <span className="text-xs text-gray-500">{c.rodzaj}</span> {c.etyk || "—"}
                      </td>
                      <td className="py-1.5">{c.path}</td>
                      <td className="py-1.5">{DEV_LABEL[c.dev] ?? c.dev}</td>
                      <td className={td}>{INT(c.count)}</td>
                    </tr>
                  ))}
                  {report.clicks.top.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-gray-400">
                        Brak kliknięć.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {report.clicks.phoneByPath.length > 0 && (
                <p className="mb-0 mt-2 text-sm text-gray-700">
                  Kliknięcia w telefon: {report.clicks.phoneByPath.map((p) => `${p.path} ${p.count}`).join(" · ")}
                </p>
              )}
            </div>
            <div>
              <div className="mb-2 flex flex-wrap gap-2">
                <select value={mapPath} onChange={(e) => setMapPath(e.target.value)} aria-label="Strona mapy" className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm">
                  {paths.map((p) => (
                    <option key={p} value={p}>
                      Strona: {p}
                    </option>
                  ))}
                </select>
                <select value={mapDev} onChange={(e) => setMapDev(e.target.value as "telefon" | "komputer")} aria-label="Urządzenie mapy" className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm">
                  <option value="telefon">telefon</option>
                  <option value="komputer">komputer</option>
                </select>
              </div>
              <div className="relative w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100" style={{ height: mapHeight }} aria-label="Mapa kliknięć">
                {dots.map((p, i) => (
                  <span key={i} className="absolute -ml-1 -mt-1 inline-block h-2 w-2 rounded-full bg-red-600/60" style={{ left: `${p.x}%`, top: p.y }} />
                ))}
                {dots.length === 0 && <div className="flex h-full items-center justify-center text-sm text-gray-500">Brak kliknięć na tej stronie i urządzeniu.</div>}
              </div>
              <p className="mb-0 mt-1 text-xs text-gray-500">Kropki: miejsce kliknięcia (x w % szerokości, y w pikselach od góry strony).</p>
            </div>
          </div>
        </Card>

        <Card title="Reklamy Google: wejścia a leady wg kampanii" sub="Wejścia z licznika vs zapytania z tej kampanii w tym samym okresie" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="py-1 text-left font-medium">Kampania</th>
                  <th className={th}>Wejścia</th>
                  <th className={th} title="Tylko gdy formularz jest na stronie wejścia">Start formularza</th>
                  <th className={th}>Zapytania</th>
                  <th className={th}>Zapytań na 100 wejść</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((c) => (
                  <tr key={c.key} className="border-t border-gray-100">
                    <td className="py-1.5">{c.label}</td>
                    <td className={td}>{INT(c.visits)}</td>
                    <td className={td}>{INT(c.formStarts)}</td>
                    <td className={td}>{INT(c.leads)}</td>
                    <td className={td}>{c.leadsPer100Visits != null ? c.leadsPer100Visits.toLocaleString("pl-PL") : "—"}</td>
                  </tr>
                ))}
                {comparison.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-gray-400">
                      Brak kampanii Google Ads w tym okresie.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mb-0 mt-2 text-xs text-gray-500">Start formularza liczymy tylko, gdy formularz jest na stronie wejścia — wizyt nie łączymy między stronami (bez identyfikatora wizyty).</p>
        </Card>
      </div>
    </div>
  );
}
