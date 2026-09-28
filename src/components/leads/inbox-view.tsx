"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { LeadRow } from "@/lib/leads/load";
import { POSTPONE_REASON_LABEL, TYPE_LABEL, type PostponeReasonKey } from "@/lib/leads/labels";
import { formatPhone } from "@/lib/clients/labels";
import { FIRST_CONTACT_SLA_HOURS, NEXT_STEP_LABEL, buildInbox, inboxKpis, rotInfo, workDurationLabel, type NextStepType } from "@/lib/leads/funnel";
import Link from "next/link";
import { Avatar, Dots, KpiBand, Seg, toFunnel, type LinkSuggestion } from "./funnel-views";
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
}) {
  const [owner, setOwner] = useState<Owner>("me");
  const [moreFresh, setMoreFresh] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const all = useMemo(() => toFunnel(rows), [rows]);
  const scoped = owner === "all" ? all : all.filter((r) => r.ownerId === currentUserId);
  const b = buildInbox(scoped, now);
  const k = inboxKpis(scoped, now);
  const fresh = moreFresh ? b.fresh : b.fresh.slice(0, 12);

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
          dziś: {callStats.talked} {callStats.talked === 1 ? "rozmowa" : "rozmów"} · {callStats.noAnswer} nieodebranych
        </span>
      </div>

      <KpiBand
        items={[
          { label: "Nowe bez kontaktu", value: String(k.fresh), sub: `${k.freshLate} po SLA ${FIRST_CONTACT_SLA_HOURS} h rob.`, warn: k.freshLate > 0 },
          { label: "Do zrobienia dziś", value: String(k.today), sub: "follow-upy i telefony" },
          { label: "Gniją", value: String(k.rotting), sub: "bez aktywności ponad limit etapu", warn: k.rotting > 0 },
          { label: "Wracają (Odłożone)", value: String(k.returningWeek), sub: `w tym tygodniu · odłożonych ${k.returning}` },
          { label: "Czas do 1. kontaktu", value: workDurationLabel(k.medianFirstContact), sub: `mediana 30 dni · cel ${FIRST_CONTACT_SLA_HOURS} h rob.`, warn: (k.medianFirstContact ?? 0) > FIRST_CONTACT_SLA_HOURS },
          { label: "Oferta → rezerwacja", value: `${k.reservations30} z ${k.offers30}`, sub: "ostatnie 30 dni" },
        ]}
      />

      <section>
        <H2 tag={<span className="bg-[#1B6FA8] px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.1em] text-white">SLA {FIRST_CONTACT_SLA_HOURS} h rob.</span>}>Nowe – czekają na pierwszy kontakt</H2>
        {b.fresh.length === 0 ? (
          <Empty>Brak nietkniętych zapytań — wszystkie mają pierwszy kontakt.</Empty>
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
                        <button type="button" disabled={busy === r.id} className={BTN_SM} onClick={() => void quick(r.id, "no_answer")} title="Nie odebrała → kolejna próba jutro 10:00">
                          Nie odebrała
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

      <section>
        <H2>Do zrobienia dziś</H2>
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
