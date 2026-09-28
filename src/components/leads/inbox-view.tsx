"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DayProgress, LeadRow } from "@/lib/leads/load";
import { POSTPONE_REASON_LABEL, TYPE_LABEL, type PostponeReasonKey } from "@/lib/leads/labels";
import { formatPhone } from "@/lib/clients/labels";
import { FIRST_CONTACT_SLA_HOURS, NEXT_STEP_LABEL, buildInbox, endOfDay, rotInfo, type NextStepType } from "@/lib/leads/funnel";
import { seasonReservations, type Playbook } from "@/lib/leads/playbook";
import Link from "next/link";
import { Avatar, Dots, Seg, toFunnel, type LinkSuggestion } from "./funnel-views";
import { StageChip } from "./lead-ui";
import type { CardIntent } from "./lead-card";

// Sygnały → Skrzynka (lejek v2, wzór lejek-v2-wzor.html s1) — domyślny widok:
// Nowe z SLA, Do zrobienia dziś, Gniją, Wracają (Odłożone). Jedno kliknięcie
// = wynik kontaktu. Reguły: src/lib/leads/funnel.ts (buildInbox, rotInfo).

type Row = ReturnType<typeof toFunnel>[number];
type Owner = "me" | "all";

const BTN_SM = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
const GRID = "22px minmax(0,1.5fr) minmax(0,1.2fr) 120px 140px 250px";
const GRID_HALF = "22px minmax(0,1.8fr) 120px 110px 96px";

const d2 = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const hm = (d: Date) => d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
const weekend = (d: Date) => (d.getDay() === 0 ? " (niedz.)" : d.getDay() === 6 ? " (sob.)" : "");
const who = (r: LeadRow) => r.clientName ?? r.person ?? r.email ?? r.title;

function H2({ children, tag }: { children: ReactNode; tag?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h2 className="m-0 inline-block border-b-2 border-[#E08A5C] pb-[2px] text-[16px] font-semibold text-[#0C3450]">{children}</h2>
      {tag}
    </div>
  );
}

function When({ at, now, prefix = "" }: { at: Date | null; now: Date; prefix?: string }) {
  if (!at) return <span className="text-[12px] text-[#5C6166]">—</span>;
  const sameDay = at.toDateString() === now.toDateString();
  const late = at < now && !sameDay;
  const text = late ? `${prefix}zaległe od ${d2(at)}` : sameDay ? `${prefix}dziś${at.getHours() >= 11 || at.getMinutes() ? ` ${hm(at)}` : ""}` : `${prefix}${d2(at)}`;
  return <span className={`text-[12px] tabular-nums ${late ? "font-semibold text-[#B8612F]" : sameDay ? "font-semibold text-[#1B6FA8]" : "text-[#5C6166]"}`}>{text}</span>;
}

function Line({ grid, r, selected, onOpen, children }: { grid: string; r: Row; selected: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={`grid cursor-pointer items-center gap-3 border-b border-[#F0F1F2] px-3.5 py-[9px] last:border-0 hover:bg-[#F7F9FB] ${selected ? "bg-[#EAF4FB]" : ""}`}
      style={{ gridTemplateColumns: grid }}
    >
      <Avatar name={r.ownerName} />
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="border border-[#E3E6E9] bg-white px-4 py-3 text-[13px] text-[#5C6166]">{children}</p>;
}

export function InboxView({
  rows,
  now,
  currentUserId,
  selectedId,
  readOnly,
  onOpen,
  onQuick,
  onLost,
  onSerial,
  suggestions,
  onLink,
  callStats,
  progress,
  playbook,
}: {
  rows: LeadRow[];
  now: Date;
  currentUserId: string;
  selectedId: string | null;
  readOnly: boolean;
  onOpen: (id: string, intent?: CardIntent) => void;
  onQuick: (id: string, outcome: "talked" | "no_answer") => Promise<void>;
  onLost: (id: string) => void;
  onSerial: () => void;
  suggestions: Record<string, LinkSuggestion>;
  onLink: (leadId: string, rentalId: string) => void;
  callStats: { talked: number; noAnswer: number };
  progress: DayProgress;
  playbook: Playbook;
}) {
  const [owner, setOwner] = useState<Owner>("me");
  const [moreFresh, setMoreFresh] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const all = useMemo(() => toFunnel(rows), [rows]);
  const scoped = owner === "all" ? all : all.filter((r) => r.ownerId === currentUserId);
  const b = buildInbox(scoped, now);
  const fresh = moreFresh ? b.fresh : b.fresh.slice(0, 12);
  const season = seasonReservations(all, playbook.season);
  // „Brawo!” — rezerwacja z lejka (nie stała klientka) z ostatnich 48 h.
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage dostępny dopiero w przeglądarce
      setDismissed(JSON.parse(localStorage.getItem("wl_wins_seen") ?? "[]"));
    } catch {
      // brak localStorage — komunikat pokaże się do zamknięcia
    }
  }, []);
  const win = all
    .filter((l) => !l.returningClient && (l.stage === "REZERWACJA" || l.stage === "WYGRANA") && now.getTime() - l.stageChangedAt.getTime() < 48 * 3_600_000 && !dismissed.includes(l.id))
    .sort((x, y) => y.stageChangedAt.getTime() - x.stageChangedAt.getTime())[0];
  const dismissWin = (id: string) =>
    setDismissed((d) => {
      const n = [...d, id].slice(-50);
      try {
        localStorage.setItem("wl_wins_seen", JSON.stringify(n));
      } catch {
        // tylko do odświeżenia
      }
      return n;
    });

  async function quick(id: string, outcome: "talked" | "no_answer") {
    setBusy(id);
    await onQuick(id, outcome);
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <Seg<Owner>
          value={owner}
          onChange={setOwner}
          options={[
            ["me", "Moje"],
            ["all", "Wszyscy"],
          ]}
        />
        {!readOnly && (
          <button type="button" onClick={onSerial} className={`${BTN_SM} h-[28px]`} title="Otwiera po kolei kontakty do obdzwonienia (nowe i telefony na dziś)">
            Dzwoń po kolei
          </button>
        )}
        <span className="text-[12px] text-[#5C6166]">
          dziś: {callStats.talked} {callStats.talked === 1 ? "rozmowa" : callStats.talked % 10 >= 2 && callStats.talked % 10 <= 4 && (callStats.talked % 100 < 12 || callStats.talked % 100 > 14) ? "rozmowy" : "rozmów"} · {callStats.noAnswer} nieodebrane
        </span>
      </div>

      <PlanBand b={b} now={now} progress={progress} playbook={playbook} season={season} />
      {win && (
        <div className="flex flex-wrap items-center gap-2.5 self-start border border-[#CFE3DA] bg-[#EEF6F2] px-3.5 py-2 text-[13px] font-semibold text-[#2F7A68]">
          ✓ Brawo! Rezerwacja z lejka: {who(win)}
          {win.rentalDevice ? ` (${win.rentalDevice}${win.rentalStartsAt ? ` ${d2(new Date(win.rentalStartsAt))}` : ""})` : ""} · cel sezonu {season} z {playbook.season.target} – {playbook.season.reward.replace(/\s*\p{Extended_Pictographic}+$/u, "")} coraz bliżej
          <button type="button" onClick={() => dismissWin(win.id)} className="font-normal text-[#5C6166] hover:text-[#0C3450]" aria-label="Zamknij">
            ✕
          </button>
        </div>
      )}

      <section id="plan-2" className="scroll-mt-4">
        <H2 tag={<span className="bg-[#1B6FA8] px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.1em] text-white">SLA {FIRST_CONTACT_SLA_HOURS} h rob.</span>}>2 · Nowe – czekają na pierwszy kontakt</H2>
        {b.fresh.length === 0 ? (
          <p className="border border-[#CFE3DA] bg-[#EEF6F2] px-4 py-3 text-[13px] font-semibold text-[#2F7A68]">✓ Wszystkie nowe obsłużone — każde zapytanie ma pierwszy kontakt.</p>
        ) : (
          <div className="border border-[#E3E6E9] bg-white">
            {fresh.map((r) => {
              const rot = rotInfo(r, now);
              const today = r.nextActionAt && r.nextActionAt.toDateString() === now.toDateString();
              const due =
                r.attempts > 0 && r.nextActionAt
                  ? { text: `${r.attempts + 1}. próba – ${today ? "dziś" : d2(r.nextActionAt)}`, late: r.nextActionAt <= now || !!today }
                  : rot.rotting
                    ? { text: rot.label!, late: true }
                    : { text: "dziś", late: false };
              return (
                <Line key={r.id} grid={GRID} r={r} selected={selectedId === r.id} onOpen={() => onOpen(r.id)}>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#0C3450]">{who(r)}</div>
                    <div className="truncate text-[12px] text-[#5C6166]">
                      {TYPE_LABEL[r.type]} · wpłynęło {d2(r.createdAt)}
                      {weekend(r.createdAt)}
                      {r.phone ? ` · tel. ${formatPhone(r.phone)}` : ""}
                      {r.attempts > 0 && (
                        <>
                          {" · "}
                          <Dots attempts={r.attempts} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="truncate text-[12px] text-[#5C6166]" title={r.nextStepNote ?? r.message ?? undefined}>
                    {r.nextStepNote && r.nextStepType !== "PIERWSZY_KONTAKT" ? r.nextStepNote : (r.message?.slice(0, 90) ?? (r.clientStatus ? "" : "nowy kontakt · brak historii"))}
                  </div>
                  <div>
                    <StageChip stage={r.stage} />
                  </div>
                  <div className={`text-[12px] tabular-nums ${due.late ? "font-semibold text-[#B8612F]" : "font-semibold text-[#1B6FA8]"}`}>{due.text}</div>
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {!readOnly && (
                      <>
                        <button type="button" disabled={busy === r.id} className={BTN_SM} onClick={() => void quick(r.id, "talked")} title="Rozmowa odbyta → W kontakcie, następny krok za 2 dni rob. (zmienisz w karcie)">
                          Rozmawiałam
                        </button>
                        <button type="button" disabled={busy === r.id} className={BTN_SM} onClick={() => void quick(r.id, "no_answer")} title="Nie odebrała → SMS z szablonu od razu i kolejna próba (jutro 16:00, potem 8:30)">
                          Nie odebrała → SMS
                        </button>
                        <button type="button" className={BTN_SM} onClick={() => onLost(r.id)} title="Przegrana — z powodem">
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </Line>
              );
            })}
            {b.fresh.length > fresh.length && (
              <button type="button" onClick={() => setMoreFresh(true)} className="w-full py-2 text-center text-[12px] text-[#1B6FA8] hover:underline">
                + {b.fresh.length - fresh.length} więcej
              </button>
            )}
          </div>
        )}
      </section>

      <section id="plan-3" className="scroll-mt-4">
        <H2>3–5 · Do zrobienia dziś</H2>
        {b.today.length === 0 ? (
          <Empty>Na dziś nic więcej — kroki na kolejne dni są na Tablicy i Liście.</Empty>
        ) : (
          <div className="border border-[#E3E6E9] bg-white">
            {b.today.map((r) => {
              const noRental = r.stage === "REZERWACJA" && !r.rentalId;
              const meta =
                r.stage === "OFERTA" && r.followUpNo
                  ? `follow-up ${r.followUpNo} z 2 · oferta ${d2(r.stageChangedAt)}`
                  : noRental
                    ? "rezerwacja bez wpisu w kalendarzu"
                    : NEXT_STEP_LABEL[(r.nextStepType as NextStepType) ?? "INNE"];
              return (
                <Line key={r.id} grid={GRID} r={r} selected={selectedId === r.id} onOpen={() => onOpen(r.id)}>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#0C3450]">{who(r)}</div>
                    <div className="truncate text-[12px] text-[#5C6166]">{meta}</div>
                  </div>
                  <div className="truncate text-[12px] text-[#5C6166]" title={r.nextStepNote ?? undefined}>
                    {r.nextStepNote ?? (noRental ? "potwierdzić termin i wpisać do kalendarza" : "")}
                  </div>
                  <div>
                    <StageChip stage={r.stage} />
                  </div>
                  <div>{noRental ? <span className="text-[12px] font-semibold text-[#1B6FA8]">dziś</span> : <When at={r.nextActionAt} now={now} />}</div>
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {!readOnly && noRental && suggestions[r.id] && (
                      <button type="button" className={BTN_SM} title={`W kalendarzu: „${suggestions[r.id].title}” ${d2(new Date(suggestions[r.id].startsAt))} · ${suggestions[r.id].deviceName}`} onClick={() => onLink(r.id, suggestions[r.id].id)}>
                        Powiąż z wynajmem
                      </button>
                    )}
                    {!readOnly && noRental && !suggestions[r.id] && (
                      <Link href={`/kalendarz/wynajem/nowy?${new URLSearchParams({ ...(r.requestedFrom ? { date: r.requestedFrom.slice(0, 10) } : {}), sygnal: r.id }).toString()}`} className={BTN_SM}>
                        Wpisz do kalendarza
                      </Link>
                    )}
                    {!readOnly && !noRental && r.phone && (
                      <a href={`tel:${r.phone}`} onClick={() => onOpen(r.id, "call")} className={BTN_SM}>
                        Zadzwoń
                      </a>
                    )}
                    <button type="button" className={BTN_SM} onClick={() => onOpen(r.id)}>
                      Szczegóły
                    </button>
                  </div>
                </Line>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-[18px] xl:grid-cols-2">
        <section className="min-w-0">
          <H2>Gniją – stoją ponad limit etapu</H2>
          {b.rotting.length === 0 ? (
            <Empty>Nic nie gnije — każdy sygnał ma świeżą aktywność i krok.</Empty>
          ) : (
            <div className="border border-[#E3E6E9] bg-white">
              {b.rotting.map((r) => (
                <Line key={r.id} grid={GRID_HALF} r={r} selected={selectedId === r.id} onOpen={() => onOpen(r.id)}>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#0C3450]">{who(r)}</div>
                    <div className="truncate text-[12px] text-[#5C6166]">{r.nextStepNote ?? `${r.stage === "OFERTA" ? "oferta" : "etap od"} ${d2(r.stageChangedAt)}`}</div>
                  </div>
                  <div>
                    <StageChip stage={r.stage} />
                  </div>
                  <div className="text-[12px] font-semibold text-[#B8612F]">{rotInfo(r, now).label}</div>
                  <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={BTN_SM} onClick={() => onOpen(r.id)}>
                      Szczegóły
                    </button>
                  </div>
                </Line>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0">
          <H2>Wracają (Odłożone)</H2>
          {b.returning.length === 0 ? (
            <Empty>Brak odłożonych. „Odłóż do…” w karcie sygnału — data powrotu i powód; w tym dniu sygnał wraca tutaj.</Empty>
          ) : (
            <div className="border border-[#E3E6E9] bg-white">
              {b.returning.map((r) => (
                <Line key={r.id} grid={GRID_HALF} r={r} selected={selectedId === r.id} onOpen={() => onOpen(r.id)}>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#0C3450]">{who(r)}</div>
                    <div className="truncate text-[12px] text-[#5C6166]">
                      {r.postponeReason ? (POSTPONE_REASON_LABEL[r.postponeReason as PostponeReasonKey] ?? r.postponeReason) : "odłożone"}
                      {r.nextStepNote ? ` · ${r.nextStepNote.replace(/^wraca: [^—]*(— )?/, "")}` : ""}
                    </div>
                  </div>
                  <div>
                    <StageChip stage={r.stage} />
                  </div>
                  <div>
                    <When at={r.returnAt ?? null} now={now} prefix="wraca " />
                  </div>
                  <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={BTN_SM} onClick={() => onOpen(r.id)}>
                      Szczegóły
                    </button>
                  </div>
                </Line>
              ))}
            </div>
          )}
        </section>
      </div>
      <StageLegend />
    </div>
  );
}

// „Plan dnia” (zasady-wzor.html, ekran 1): kolejność dnia z licznikami
// (klik przewija do sekcji), postęp „Dziś: X z Y”, tydzień i cel sezonu.
function PlanBand({ b, now, progress, playbook, season }: { b: ReturnType<typeof buildInbox<Row>>; now: Date; progress: DayProgress; playbook: Playbook; season: number }) {
  const eod = endOfDay(now);
  const dueNew = b.fresh.filter((l) => !l.nextActionAt || l.nextActionAt <= eod || rotInfo(l, now).rotting);
  const calls = b.today.filter((l) => l.nextStepType === "ODDZWONI" || l.nextStepType === "PONOWNA_PROBA" || l.nextStepType === "UMOW_TERMIN");
  const followUps = b.today.filter((l) => l.nextStepType === "FOLLOW_UP_OFERTY");
  const returning = [...b.today.filter((l) => (l.nextStepNote ?? "").startsWith("wraca z odłożonych")), ...b.returning.filter((l) => l.returnAt && l.returnAt <= eod)];
  const names = (xs: Row[]) => xs.slice(0, 2).map((l) => who(l).split(/[@\s·]/)[0]).join(", ") + (xs.length > 2 ? "…" : "");
  const remaining = dueNew.length + calls.length + followUps.length + returning.length;
  const total = progress.doneToday + remaining;
  const pct = total ? Math.round((progress.doneToday / total) * 100) : 100;
  const seasonPct = Math.min(100, Math.round((season / playbook.season.target) * 100));
  const scroll = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const items: { no: number; title: string; n: number; sub: string; done: boolean; target: string }[] = [
    { no: 1, title: "Dzisiejsze wynajmy", n: progress.rentalsToday, sub: progress.rentalsToday ? `${progress.rentalsWithDriver} z ${progress.rentalsToday} z kierowcą` : "brak dziś", done: progress.rentalsWithDriver === progress.rentalsToday, target: "" },
    { no: 2, title: "Nowe zapytania", n: dueNew.length, sub: `z ${b.fresh.length} · cel ${FIRST_CONTACT_SLA_HOURS} h rob.`, done: dueNew.length === 0, target: "plan-2" },
    { no: 3, title: "Umówione telefony", n: calls.length, sub: names(calls), done: calls.length === 0, target: "plan-3" },
    { no: 4, title: "Follow-upy ofert", n: followUps.length, sub: names(followUps), done: followUps.length === 0, target: "plan-3" },
    { no: 5, title: "Wracają odłożone", n: returning.length, sub: names(returning), done: returning.length === 0, target: "plan-3" },
  ];
  return (
    <div className="grid border border-[#E3E6E9] bg-white md:grid-cols-[repeat(5,minmax(0,1fr))_280px]">
      {items.map((it) => (
        <button
          key={it.no}
          type="button"
          onClick={() => (it.target ? scroll(it.target) : window.location.assign(`${window.location.pathname.replace(/\/sygnaly.*$/, "")}/nadchodzace`))}
          className={`border-b border-r border-[#E3E6E9] px-3.5 py-2.5 text-left hover:bg-[#F7F9FB] md:border-b-0 ${it.done ? "text-[#5C6166]" : ""}`}
        >
          <span className={`mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-white ${it.done ? "bg-[#2F7A68]" : "bg-[#0C3450]"}`}>{it.done ? "✓" : it.no}</span>
          <b className={`font-semibold ${it.done ? "text-[#5C6166]" : "text-[#0C3450]"}`}>{it.title}</b>
          <div className="mt-0.5">
            {!(it.done && it.no === 1) && <span className="text-[18px] font-medium text-[#0C3450]">{it.n} </span>}
            <span className="text-[12px] text-[#5C6166]">{it.sub}</span>
          </div>
        </button>
      ))}
      <div className="bg-[#EEF6F2] px-3.5 py-2.5">
        <b className="font-semibold text-[#2F7A68]">
          Dziś: {progress.doneToday} z {total} zrobione
        </b>
        <div className="my-1.5 h-2 bg-[#D5E9E0]">
          <i className="block h-2 bg-[#2F7A68]" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[12px] text-[#5C6166]">
          Tydzień: {progress.weekOffers} {progress.weekOffers === 1 ? "oferta" : progress.weekOffers >= 2 && progress.weekOffers <= 4 ? "oferty" : "ofert"} → {progress.weekReservations} {progress.weekReservations === 1 ? "rezerwacja" : progress.weekReservations >= 2 && progress.weekReservations <= 4 ? "rezerwacje" : "rezerwacji"}
        </div>
        <b className="mt-1.5 block font-semibold text-[#0C3450]">
          Cel sezonu: {season} z {playbook.season.target} rezerwacji z nowych
        </b>
        <div className="my-1.5 h-2 bg-[#D6E7F4]">
          <i className="block h-2 bg-[#1B6FA8]" style={{ width: `${seasonPct}%` }} />
        </div>
        <div className="text-[12px] text-[#5C6166]">Nagroda: {playbook.season.reward}</div>
      </div>
    </div>
  );
}

export function StageLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[11.5px] text-[#5C6166]">
      Etapy:
      {(["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "WYGRANA", "PRZEGRANA", "ODLOZONE"] as const).map((s) => (
        <StageChip key={s} stage={s} />
      ))}
      · <span className="font-semibold text-[#B8612F]">terakota</span> = gnije / po terminie
    </div>
  );
}
