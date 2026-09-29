"use client";

import { useEffect, useState } from "react";
import type { DayProgress, LeadRow } from "@/lib/leads/load";
import { FIRST_CONTACT_SLA_HOURS, type TodayGroup, type TodayItem } from "@/lib/leads/funnel";
import { REWARD_STEP, nextReward, rewardUnlockedAt, type Playbook } from "@/lib/leads/playbook";
import type { SeasonGoal, SeasonWin } from "@/lib/leads/season-goal";
import { StageChip } from "./lead-ui";

// Sygnały → Lista „Na dziś” (zasady-wzor.html, ekran 1): „Plan dnia” w
// kolejności dnia (klik filtruje tabelę), postęp dnia, tydzień i cel sezonu;
// komunikat „Brawo!” przy rezerwacji z lejka; legenda etapów.

const who = (r: LeadRow) => r.clientName ?? r.person ?? r.email ?? r.title;
const d2 = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const firstWord = (r: LeadRow) => who(r).split(/[@\s·]/)[0];

export function PlanBand<T extends LeadRow>({
  items,
  untouchedTotal,
  progress,
  playbook,
  goal,
  selected,
  onSelect,
}: {
  items: TodayItem<T>[];
  untouchedTotal: number;
  progress: DayProgress;
  playbook: Playbook;
  goal: SeasonGoal;
  selected: TodayGroup | null;
  onSelect: (g: TodayGroup | null) => void;
}) {
  const of = (g: TodayGroup) => items.filter((x) => x.group === g).map((x) => x.lead);
  const names = (xs: T[]) => xs.slice(0, 2).map(firstWord).join(", ") + (xs.length > 2 ? "…" : "");
  const total = progress.doneToday + items.length;
  const pct = total ? Math.round((progress.doneToday / total) * 100) : 100;
  const se = playbook.season;
  const seasonPct = Math.min(100, Math.round((goal.total / se.target) * 100));
  const next = nextReward(goal.total, se);
  const marks = Array.from({ length: Math.floor(se.target / REWARD_STEP) }, (_, i) => (i + 1) * REWARD_STEP);
  const milestone = new Date(`${se.milestone}T23:59:59`);
  const springLeft = se.returningTarget - goal.returning;
  const plan: { no: number; title: string; n: number; sub: string; group: TodayGroup | null }[] = [
    { no: 1, title: "Dzisiejsze wynajmy", n: progress.rentalsToday, sub: progress.rentalsToday ? `${progress.rentalsWithDriver} z ${progress.rentalsToday} z kierowcą` : "brak dziś", group: null },
    { no: 2, title: "Nowe zapytania", n: of("new").length, sub: `z ${untouchedTotal} · kontakt w ${FIRST_CONTACT_SLA_HOURS} h rob.`, group: "new" },
    { no: 3, title: "Umówione telefony", n: of("calls").length, sub: names(of("calls")), group: "calls" },
    { no: 4, title: "Wracają z wiosny", n: of("spring").length, sub: `wracają ${goal.returning} z ${se.returningTarget}`, group: "spring" },
    { no: 5, title: "Follow-upy ofert", n: of("followups").length, sub: names(of("followups")), group: "followups" },
    { no: 6, title: "Wracają odłożone", n: of("back").length, sub: names(of("back")), group: "back" },
  ];
  return (
    <div data-tour="plan" className="grid border border-[#E3E6E9] bg-white md:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_300px]">
      {plan.map((it) => {
        const done = it.no === 1 ? progress.rentalsWithDriver === progress.rentalsToday : it.n === 0;
        const on = it.group != null && selected === it.group;
        return (
          <button
            key={it.no}
            type="button"
            aria-pressed={on}
            onClick={() => (it.group ? onSelect(on ? null : it.group) : window.location.assign(`${window.location.pathname.replace(/\/sygnaly.*$/, "")}/nadchodzace`))}
            title={it.group ? (on ? "Pokaż całą listę „Na dziś”" : "Pokaż tylko ten punkt planu") : "Nadchodzące wynajmy"}
            className={`border-b border-r border-[#E3E6E9] px-3.5 py-2.5 text-left hover:bg-[#F7F9FB] md:border-b-0 ${on ? "shadow-[inset_0_-3px_0_#1B6FA8]" : ""}`}
          >
            <span className={`mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-white ${done ? "bg-[#2F7A68]" : "bg-[#0C3450]"}`}>{done ? "✓" : it.no}</span>
            <b className={`font-semibold ${done ? "text-[#5C6166]" : "text-[#0C3450]"}`}>{it.title}</b>
            <div className="mt-0.5">
              {!(done && it.no === 1) && <span className="text-[18px] font-medium text-[#0C3450]">{it.n} </span>}
              <span className="text-[12px] text-[#5C6166]">{it.sub}</span>
            </div>
          </button>
        );
      })}
      <div className="bg-[#EEF6F2] px-3.5 py-2.5">
        <b className="font-semibold text-[#2F7A68]">
          Dziś: {progress.doneToday} z {total} zrobione
        </b>
        <div className="my-1.5 h-2 bg-[#D5E9E0]">
          <i className="block h-2 bg-[#2F7A68]" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[12px] text-[#5C6166]">
          Tydzień: {progress.weekOffers} {plural(progress.weekOffers, "oferta", "oferty", "ofert")} → {progress.weekReservations} {plural(progress.weekReservations, "rezerwacja", "rezerwacje", "rezerwacji")}
        </div>
        <b className="mt-1.5 block font-semibold text-[#0C3450]">
          Cel sezonu: {goal.total} z {se.target} gabinetów
        </b>
        <div className="relative my-1.5 h-2 bg-[#D6E7F4]">
          <i className="block h-2 bg-[#1B6FA8]" style={{ width: `${seasonPct}%` }} />
          {/* Progi nagród co 5 — osiągnięty zielony z 🎬. */}
          {marks.map((m) => (
            <span
              key={m}
              className={`absolute -top-[3px] h-[14px] w-[2px] ${goal.total >= m ? "bg-[#2F7A68]" : "bg-[#9AA1A8]"}`}
              style={{ left: `calc(${(m / se.target) * 100}% - 1px)` }}
              title={`${m} z ${se.target}: ${se.rewards[Math.min(se.rewards.length - 1, m / REWARD_STEP - 1)]}`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-1.5 text-[11.5px] text-[#5C6166]">
          {marks.map((m) => (
            <span key={m} className={goal.total >= m ? "font-semibold text-[#2F7A68]" : ""}>
              {m}
              {goal.total >= m ? " 🎬" : ""}
            </span>
          ))}
        </div>
        <div className="mt-0.5 text-[12px] text-[#5C6166]">
          wracają {goal.returning} z {se.returningTarget} · nowe {goal.fresh} z {se.newTarget}
          {next ? ` · do następnej nagrody: ${next.left} (${next.text})` : " · cel osiągnięty 🎉"}
        </div>
        {springLeft > 0 && new Date() <= milestone && (
          <div className="text-[11.5px] text-[#5C6166]">
            kamień milowy: {se.returningTarget} wracających do {milestone.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })} — brakuje {springLeft}
          </div>
        )}
      </div>
    </div>
  );
}

export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  return n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
}

// „Brawo!” — rezerwacja z lejka (nie stała klientka) z ostatnich 48 h;
// zamknięty komunikat nie wraca (ta przeglądarka).
// „Brawo!” (wniosek 21, pkt 3): nowa rezerwacja z celu sezonu — gabinet z
// wiosny albo nowy (pierwszy przyjazd). Raz, osobno dla każdej osoby; znika
// po ✕ albo 24 h od wpisania rezerwacji. Przy progu co 5 — nagroda.
export const WIN_TOAST_HOURS = 24;

export function WinToast({ goal, now, playbook, userId }: { goal: SeasonGoal; now: Date; playbook: Playbook; userId: string }) {
  const key = `wl_wins_seen:${userId}`;
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage dostępny dopiero w przeglądarce
      setDismissed(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {
      setDismissed([]);
    }
  }, [key]);
  // Do odczytu localStorage nic nie pokazujemy — bez mignięcia zamkniętego banera.
  if (!dismissed) return null;
  const idOf = (w: SeasonWin) => `sezon:${w.clientId}`;
  const win = [...goal.wins].reverse().find((w) => now.getTime() - new Date(w.at).getTime() < WIN_TOAST_HOURS * 3_600_000 && !dismissed.includes(idOf(w)));
  if (!win) return null;
  const se = playbook.season;
  const unlocked = rewardUnlockedAt(win.no, se);
  const next = nextReward(win.no, se);
  const close = () =>
    setDismissed((d) => {
      const n = [...(d ?? []), idOf(win)].slice(-50);
      try {
        localStorage.setItem(key, JSON.stringify(n));
      } catch {
        // tylko do odświeżenia
      }
      return n;
    });
  return (
    <div className="flex flex-wrap items-center gap-2.5 self-start border border-[#CFE3DA] bg-[#EEF6F2] px-3.5 py-2 text-[13px] font-semibold text-[#2F7A68]">
      ✓ Brawo! {win.kind === "returning" ? `${win.name} wraca w tym sezonie` : `Nowy gabinet: ${win.name}`}
      {win.device ? ` (${win.device} ${d2(new Date(win.startsAt))})` : ""} ·{" "}
      {unlocked ? `${win.no} z ${se.target} – nagroda odblokowana: ${unlocked} 🎉` : `${win.no} z ${se.target}${next ? ` – do nagrody ${next.left}` : ""}`}
      <button type="button" onClick={close} className="font-normal text-[#5C6166] hover:text-[#0C3450]" aria-label="Zamknij">
        ✕
      </button>
    </div>
  );
}

export function StageLegend({ priorities = false }: { priorities?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[11.5px] text-[#5C6166]">
      {priorities && (
        <>
          Priorytet:
          {(["late", "new", "today", "back"] as const).map((p) => (
            <PriorityTag key={p} p={p} />
          ))}
          ·
        </>
      )}
      Etapy:
      {(["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "WYGRANA", "PRZEGRANA", "ODLOZONE"] as const).map((s) => (
        <StageChip key={s} stage={s} />
      ))}
      · <span className="font-semibold text-[#B8612F]">terakota</span> = gnije / po terminie
    </div>
  );
}

const PRIORITY: Record<"late" | "new" | "today" | "back", { label: string; cls: string }> = {
  late: { label: "Po czasie", cls: "border border-[#E6CDB8] bg-[#FBF0E7] text-[#B8612F]" },
  new: { label: "Nowe", cls: "bg-[#D6E7F4] text-[#0C3450]" },
  today: { label: "Dziś", cls: "border border-[#B7D2E8] bg-white text-[#1B6FA8]" },
  back: { label: "Wraca", cls: "border border-dashed border-[#B9A67E] bg-white text-[#6B5B3E]" },
};

export function PriorityTag({ p }: { p: "late" | "new" | "today" | "back" }) {
  return <span className={`inline-block whitespace-nowrap px-[7px] py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] ${PRIORITY[p].cls}`}>{PRIORITY[p].label}</span>;
}
