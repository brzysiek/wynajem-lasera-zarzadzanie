"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import type { PulseCheck, PulseEvent, PulseKpis, PulseReport } from "@/lib/leads/pulse";
import type { PulsePeriod } from "@/lib/leads/pulse-rules";

// Wniosek 36 (wzór raport-sprzedazy.html): Sygnały → Raport jako „puls” dla
// właściciela — 1) czy coś nam ucieka, 2) ile pracy (okres vs poprzedni,
// według dat zdarzeń), 3) czy to daje efekt, 4) co się działo (kronika).
// Okres i osoba wspólne dla całej zakładki. Klik w sprawę otwiera kartę sygnału.

const KIND_LABEL: Record<PulseEvent["kind"], string> = { kontakt: "kontakt", oferta: "oferta", rez: "rezerwacja", przegrana: "przegrana", odlozone: "odłożone", porzadki: "porządki" };
const KIND_CLS: Record<PulseEvent["kind"], string> = {
  kontakt: "bg-[#EAF4FB] text-[#1B6FA8]",
  oferta: "bg-[#EFEBFA] text-[#5A4B9A]",
  rez: "bg-[#E6F2EE] text-[#2F7A68]",
  przegrana: "bg-[#FBF0E7] text-[#B8612F]",
  odlozone: "bg-[#EEF1F4] text-[#5C6166]",
  porzadki: "bg-[#EEF1F4] text-[#8A939B]",
};
const DAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
const CARD = "border border-[#E3E6E9] bg-white p-4";
const H2 = "m-0 text-[19px] font-semibold text-[#0C3450]";
const EYEBROW = "text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#5C6166]";
const time = (iso: string) => new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <span className="inline-flex overflow-hidden rounded-[6px] border border-[#E3E6E9] bg-white" role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={`px-[11px] py-[5px] text-[13px] ${value === k ? "bg-[#0C3450] text-white" : "text-[#5C6166] hover:bg-[#F4F6F8]"}`}>
          {l}
        </button>
      ))}
    </span>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (now === before) return <span className="text-[12.5px] font-semibold text-[#5C6166]">{before ? `tak samo (${before})` : "wcześniej 0"}</span>;
  return <span className={`text-[12.5px] font-semibold ${now > before ? "text-[#2F7A68]" : "text-[#B8612F]"}`}>{now > before ? "↑" : "↓"} z {before}</span>;
}

export function PulseReportView({ users, currentUserId, onOpen }: { users: { id: string; name: string }[]; currentUserId: string; onOpen: (leadId: string) => void }) {
  const [period, setPeriod] = useState<PulsePeriod>("week");
  const [person, setPerson] = useState<string>("");
  const [data, setData] = useState<{ key: string; report: PulseReport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${period}|${person}`;
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ okres: period, ...(person ? { osoba: person } : {}) });
    fetch(`${BASE_PATH}/api/leads/pulse?${q.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: PulseReport) => alive && (setData({ key: `${period}|${person}`, report: d }), setError(null)))
      .catch(() => alive && setError("Nie udało się wczytać raportu."));
    return () => {
      alive = false;
    };
  }, [period, person]);
  const r = data?.report ?? null;
  const loading = data?.key !== key;
  const office = users.filter((u) => ["Ania", "Tomek"].includes(u.name));
  void currentUserId;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-center gap-2">
        <Seg<PulsePeriod>
          label="Okres"
          value={period}
          onChange={setPeriod}
          options={[
            ["week", "Ten tydzień"],
            ["7", "7 dni"],
            ["14", "14 dni"],
            ["30", "30 dni"],
          ]}
        />
        <Seg<string> label="Osoba" value={person} onChange={setPerson} options={[["", "Wszyscy"], ...office.map((u) => [u.id, u.name] as [string, string])]} />
        {loading && <span className="text-[12.5px] text-[#5C6166]">wczytuję…</span>}
        {error && <span className="text-[12.5px] text-[#B8612F]">{error}</span>}
      </div>
      {r && (
        <>
          <PulseSection checks={r.pulse.checks} bad={r.pulse.bad} onOpen={onOpen} />
          <WorkSection r={r} />
          <EffectSection r={r} />
          <Chronicle events={r.events} person={person} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}

function PulseSection({ checks, bad, onOpen }: { checks: PulseCheck[]; bad: number; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = checks.find((c) => c.key === open);
  const good = bad === 0;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="h-pulse">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="h-pulse" className={H2}>
          Czy coś nam ucieka?
        </h2>
        <span className="text-[13px] text-[#5C6166]">sprawdzane na bieżąco</span>
      </div>
      <div role="status" className={`flex flex-col gap-3 border px-4 py-3.5 ${good ? "border-[#CFE3DA] bg-[#E6F2EE]" : "border-[#E6CDB8] bg-[#FBF0E7]"}`}>
        <div className={`flex items-center gap-2.5 text-[17px] font-bold ${good ? "text-[#2F7A68]" : "text-[#B8612F]"}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${good ? "bg-[#2F7A68]" : "bg-[#B8612F]"}`} />
          {good ? "Wszystko gra ✓" : `${bad} ${bad === 1 ? "sprawa" : bad < 5 ? "sprawy" : "spraw"} po terminie – reszta gra`}
        </div>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
          {checks.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={!c.items.length}
              aria-expanded={open === c.key}
              onClick={() => setOpen(open === c.key ? null : c.key)}
              className={`flex min-w-0 items-start gap-2.5 border bg-white px-3 py-2 text-left disabled:cursor-default ${c.level === "bad" ? "border-[#E6CDB8]" : "border-[#E3E6E9]"} ${open === c.key ? "ring-2 ring-[#1B6FA8]" : ""}`}
            >
              <span className={`w-[18px] flex-none text-center font-bold ${c.level === "ok" ? "text-[#2F7A68]" : c.level === "bad" ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>{c.level === "ok" ? "✓" : c.level === "bad" ? "!" : "i"}</span>
              <span className="min-w-0">
                <b className="block text-[14px] text-[#0C3450]">{c.title}</b>
                {c.sub && <span className="text-[13px] text-[#5C6166]">{c.sub}</span>}
              </span>
            </button>
          ))}
        </div>
        {current && current.items.length > 0 && (
          <div className="border border-[#E6CDB8] bg-white px-3 py-2">
            <div className="mb-1 text-[14px] font-semibold text-[#0C3450]">{current.title}</div>
            <ul className="m-0 grid list-none gap-x-4 gap-y-1 p-0 text-[13.5px] [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
              {current.items.map((i, n) => (
                <li key={`${i.leadId ?? i.rentalId}-${n}`} className="min-w-0 truncate">
                  {i.leadId ? (
                    <button type="button" className="text-[#1B6FA8] hover:underline" onClick={() => onOpen(i.leadId!)}>
                      {i.name}
                    </button>
                  ) : (
                    <Link href={`/kalendarz?wynajem=${i.rentalId}`} className="text-[#1B6FA8] hover:underline">
                      {i.name}
                    </Link>
                  )}{" "}
                  <span className="text-[#5C6166]">· {i.note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function WorkSection({ r }: { r: PulseReport }) {
  const k = r.work.kpis;
  const p = r.work.prev;
  const tiles: { key: keyof PulseKpis; label: string; cls: string }[] = [
    { key: "kontakt", label: "kontakty z klientkami", cls: "border-[#1B6FA8]" },
    { key: "oferta", label: "oferty wysłane", cls: "border-[#7A6BB8]" },
    { key: "rez", label: "nowe rezerwacje", cls: "border-[#2F7A68]" },
    { key: "przegrana", label: "przegrane (z powodem)", cls: "border-[#B8612F]" },
    { key: "odlozone", label: "odłożone z datą", cls: "border-[#E3E6E9]" },
  ];
  const range = `${new Date(r.period.from).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}–${new Date(r.period.to).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}`;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="h-work">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="h-work" className={H2}>
          Ile pracy jest robione
        </h2>
        <span className="text-[13px] text-[#5C6166]">
          {r.period.label} ({range}) vs poprzedni okres · według dat zdarzeń
        </span>
      </div>
      <div className={CARD}>
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
          {tiles.map((t) => (
            <div key={t.key} className={`min-w-0 border-l-[3px] py-1 pl-3 ${t.cls}`}>
              <div className="text-[28px] font-bold leading-tight tabular-nums text-[#0C3450]">{k[t.key]}</div>
              <div className="text-[13px] text-[#5C6166]">{t.label}</div>
              <Delta now={k[t.key]} before={p[t.key]} />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={EYEBROW}>Dzień po dniu (10 dni)</span>
            <span className="flex gap-3 text-[12.5px] text-[#5C6166]">
              <span>
                <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#1B6FA8] align-[-1px]" />
                kontakty
              </span>
              <span>
                <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#7A6BB8] align-[-1px]" />
                oferty
              </span>
              <span>
                <i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#2F7A68] align-[-1px]" />
                rezerwacje
              </span>
            </span>
          </div>
          <DayChart daily={r.work.daily} />
        </div>
        <div className={`${CARD} flex flex-col gap-2.5`}>
          <span className={EYEBROW}>Kto ({r.period.label})</span>
          {r.work.byPerson.length === 0 && <span className="text-[13px] text-[#5C6166]">Brak wpisów w tym okresie.</span>}
          {r.work.byPerson.map((x) => (
            <div key={x.userId ?? x.name} className="flex items-baseline justify-between gap-2 border-b border-[#E3E6E9] pb-2 last:border-0">
              <span>{x.name}</span>
              <span className="text-right text-[13.5px] tabular-nums">
                <b>{x.kontakt}</b> kontakt{x.kontakt === 1 ? "" : "y"}
                {x.oferta ? ` · ${x.oferta} ofert${x.oferta === 1 ? "a" : "y"}` : ""}
                {x.przegrana ? ` · ${x.przegrana} przegran${x.przegrana === 1 ? "a" : "e"}` : ""}
              </span>
            </div>
          ))}
          <div className="rounded-[6px] bg-[#EEF1F4] px-2.5 py-2 text-[13px] text-[#5C6166]">
            Porządki / automatyczne (agent, system, auto, cennik) liczone osobno, poza „pracą”: <b className="text-[#0C3450]">{r.work.auto}</b> wpisów w tym okresie.
          </div>
        </div>
      </div>
    </section>
  );
}

function DayChart({ daily }: { daily: PulseReport["work"]["daily"] }) {
  const W = 640;
  const H = 210;
  const L = 34;
  const R = 10;
  const T = 12;
  const B = 34;
  const max = Math.max(5, ...daily.map((d) => d.kontakt));
  const top = Math.ceil(max / 5) * 5;
  const cw = (W - L - R) / daily.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520 }} role="img" aria-label="Kontakty, oferty i rezerwacje dzień po dniu">
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#E3E6E9" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#5C6166">
              {v}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = L + i * cw;
          const bw = cw * 0.42;
          const bx = x + cw * 0.12;
          const dt = new Date(`${d.day}T12:00:00`);
          const weekend = dt.getDay() % 6 === 0;
          const dots = [...Array(d.oferta).fill("#7A6BB8"), ...Array(d.rez).fill("#2F7A68")] as string[];
          return (
            <g key={d.day}>
              {weekend && <rect x={x} y={T} width={cw} height={H - T - B} fill="#F4F6F8" />}
              <rect x={bx} y={y(d.kontakt)} width={bw} height={y(0) - y(d.kontakt)} fill="#1B6FA8" rx="2">
                <title>{`${d.day.slice(8)}.${d.day.slice(5, 7)}: ${d.kontakt} kontaktów, ${d.oferta} ofert, ${d.rez} rezerwacji`}</title>
              </rect>
              {d.kontakt > 0 && (
                <text x={bx + bw / 2} y={y(d.kontakt) - 4} textAnchor="middle" fontSize="11" fill="#0C3450">
                  {d.kontakt}
                </text>
              )}
              {dots.map((c, j) => (
                <circle key={j} cx={bx + bw + 9} cy={y(0) - 6 - j * 11} r="4" fill={c} />
              ))}
              <text x={x + cw / 2} y={H - B + 15} textAnchor="middle" fontSize="11" fill={weekend ? "#8A939B" : "#2A3540"}>
                {`${d.day.slice(8)}.${d.day.slice(5, 7)}`}
              </text>
              <text x={x + cw / 2} y={H - B + 28} textAnchor="middle" fontSize="10" fill="#8A939B">
                {DAYS[dt.getDay()].slice(0, 2)}
              </text>
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#5C6166" />
      </svg>
    </div>
  );
}

function EffectSection({ r }: { r: PulseReport }) {
  const e = r.effect;
  const first = e.funnel[0]?.count || 0;
  const s = e.season;
  const med = e.medianFirstContactH;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="h-effect">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="h-effect" className={H2}>
          Czy to daje efekt
        </h2>
        <span className="text-[13px] text-[#5C6166]">{r.period.label}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={CARD}>
          <span className={EYEBROW}>Nowe zapytania z okresu (bez wracających) – dokąd doszły</span>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {e.funnel.map((f, i) => (
              <div key={f.key} className="grid items-center gap-2.5 text-[14px] [grid-template-columns:130px_minmax(0,1fr)_80px]">
                <span>{f.label}</span>
                <div className="h-[18px] min-w-[4px] rounded-[3px] bg-[#1B6FA8]" style={{ width: first ? `${(f.count / first) * 100}%` : "4px" }} />
                <span className="tabular-nums">
                  {f.count} {i > 0 && e.funnel[i - 1].count ? <span className="text-[12.5px] text-[#5C6166]">{Math.round((f.count / e.funnel[i - 1].count) * 100)}%</span> : null}
                </span>
              </div>
            ))}
          </div>
          <p className="mb-0 mt-2 text-[13px] text-[#5C6166]">
            Pierwszy kontakt (mediana):{" "}
            <b className={med != null && med > e.firstContactTargetH ? "text-[#B8612F]" : "text-[#0C3450]"}>{med != null ? `${med.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} h rob.` : "—"}</b> · cel {e.firstContactTargetH} h
          </p>
        </div>
        <div className={`${CARD} flex flex-col gap-3.5`}>
          <span className={EYEBROW}>
            Cel sezonu: {s.target} gabinetów ({s.total})
          </span>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
            {[
              { n: s.returning, of: s.returningTarget, label: "wracających", note: `kamień milowy ${new Date(s.milestone).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}` },
              { n: s.fresh, of: s.freshTarget, label: "nowych", note: "" },
            ].map((g) => (
              <div key={g.label}>
                <div className="tabular-nums">
                  <b className="text-[20px] text-[#0C3450]">{g.n}</b> z {g.of} {g.label}
                </div>
                <div className="h-2 overflow-hidden rounded bg-[#EEF1F4]">
                  <i className="block h-full bg-[#2F7A68]" style={{ width: `${Math.min(100, (g.n / Math.max(1, g.of)) * 100)}%` }} />
                </div>
                {g.note && <div className="text-[12.5px] text-[#5C6166]">{g.note}</div>}
              </div>
            ))}
          </div>
          <div>
            <span className={EYEBROW}>Powody przegranych ({r.period.label})</span>
            {e.lostReasons.length ? (
              <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0 text-[13.5px]">
                {e.lostReasons.map((x) => (
                  <li key={x.reason} className="flex justify-between gap-2">
                    <span>{x.reason}</span>
                    <span className="tabular-nums">{x.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-1 text-[13px] text-[#5C6166]">Brak przegranych w tym okresie.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

type Filter = "all" | "kontakt" | "oferta" | "rez" | "przegrana";

function Chronicle({ events, person, onOpen }: { events: PulseEvent[]; person: string; onOpen: (id: string) => void }) {
  const [days, setDays] = useState<"3" | "7" | "14">("3");
  const [filter, setFilter] = useState<Filter>("all");
  const [auto, setAuto] = useState(false);
  const list = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (Number(days) - 1)).toISOString();
    return events.filter(
      (e) =>
        e.at >= from &&
        (auto || e.kind !== "porzadki") &&
        (!person || e.userId === person) &&
        (filter === "all" || e.kind === filter || (filter === "przegrana" && e.kind === "odlozone")),
    );
  }, [events, days, filter, auto, person]);
  const byDay = new Map<string, PulseEvent[]>();
  for (const e of list) byDay.set(localDay(e.at), [...(byDay.get(localDay(e.at)) ?? []), e]);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="h-log">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="h-log" className={H2}>
          Co się działo
        </h2>
        <Seg<"3" | "7" | "14">
          label="Okres kroniki"
          value={days}
          onChange={setDays}
          options={[
            ["3", "3 dni"],
            ["7", "7 dni"],
            ["14", "14 dni"],
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rodzaj">
        {(
          [
            ["all", "Wszystko"],
            ["kontakt", "Kontakty"],
            ["oferta", "Oferty"],
            ["rez", "Rezerwacje"],
            ["przegrana", "Przegrane i odłożone"],
          ] as [Filter, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`rounded-full border px-[11px] py-[3px] text-[13px] ${filter === k ? "border-[#0C3450] bg-[#0C3450] text-white" : "border-[#E3E6E9] bg-white text-[#2A3540]"}`}>
            {l}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-[13px] text-[#5C6166]">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> pokaż porządki
        </label>
      </div>
      <div className={CARD}>
        {byDay.size === 0 && <div className="py-3 text-[14px] text-[#5C6166]">Brak zdarzeń tego rodzaju w wybranym okresie.</div>}
        {[...byDay.entries()].map(([day, evs]) => {
          const dt = new Date(`${day}T12:00:00`);
          const c = { kontakt: evs.filter((e) => e.kind === "kontakt").length, oferta: evs.filter((e) => e.kind === "oferta").length, rez: evs.filter((e) => e.kind === "rez").length };
          const sum = [c.kontakt && `${c.kontakt} kontaktów`, c.oferta && `${c.oferta} ofert`, c.rez && `${c.rez} rezerwacji`].filter(Boolean).join(" · ");
          return (
            <div key={day}>
              <h3 className="m-0 mb-1 mt-3.5 flex items-baseline gap-2.5 text-[14px] text-[#0C3450] first:mt-0">
                {DAYS[dt.getDay()]}, {day.slice(8)}.{day.slice(5, 7)}
                <small className="text-[12.5px] font-normal text-[#5C6166]">{sum}</small>
              </h3>
              {evs.map((e, i) => (
                <button
                  key={`${e.at}-${i}`}
                  type="button"
                  onClick={() => e.leadId && onOpen(e.leadId)}
                  className="grid w-full items-start gap-2.5 border-t border-[#E3E6E9] px-1 py-1.5 text-left text-[14px] hover:bg-[#EEF1F4] [grid-template-columns:44px_92px_minmax(0,1fr)] max-sm:[grid-template-columns:40px_minmax(0,1fr)]"
                >
                  <time className="pt-0.5 text-[12.5px] tabular-nums text-[#5C6166]">{time(e.at)}</time>
                  <span className="pt-0.5 max-sm:hidden">
                    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em] ${KIND_CLS[e.kind]}`}>{KIND_LABEL[e.kind]}</span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-px">
                    <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
                      <span className="min-w-0 truncate font-semibold text-[#0C3450]">{e.name}</span>
                      {e.spring && <span className="flex-none text-[11px] font-semibold text-[#2F7A68]">wraca z wiosny</span>}
                      <span className="ml-auto flex-none text-[12px] text-[#5C6166]">{e.who}</span>
                    </span>
                    {e.body && <span className="line-clamp-2 text-[13.5px] leading-snug text-[#2A3540] [overflow-wrap:anywhere]">{e.body}</span>}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
