"use client";

import { useMemo } from "react";
import type { DayProgress, LeadRow } from "@/lib/leads/load";
import { FIRST_CONTACT_SLA_HOURS, buildToday, isFreshInquiry, type FunnelLead, type TodayGroup, type TodayItem } from "@/lib/leads/funnel";
import { REWARD_STEP, nextReward, type Playbook } from "@/lib/leads/playbook";
import type { SeasonGoal } from "@/lib/leads/season-goal";
import type { SignalTask } from "@/lib/leads/today-extras";
import { TodayBar } from "@/components/today-bar";
import { Seg, toFunnel } from "./funnel-views";
import { lateNote, scopeHint, scopeRows } from "@/lib/leads/today-scope";
import { WinToast } from "./plan-day";
import { names, type TodayGroupKey, type TodayOwner } from "./today-queue";

// Wniosek 33: „Do zrobienia dziś” nad zakładkami Tablica / Na dziś / Raport —
// jeden pasek na każdym widoku (jak w Klientach). Klik w kafel: na Tablicy i
// w Raporcie przełącza na „Na dziś” z filtrem tej grupy. Po prawej postęp
// dnia i cel sezonu.

type Row = LeadRow & FunnelLead;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function SignalsTodayBar({
  rows,
  now,
  currentUserId,
  owner,
  onOwner,
  playbook,
  goal,
  progress,
  signalTasks,
  active,
  onToggle,
  reviewCount,
}: {
  rows: LeadRow[];
  now: Date;
  currentUserId: string;
  owner: TodayOwner;
  // Wniosek 35: przełącznik „Moje / Wszyscy” przy pasku (wspólny z Tablicą i „Na dziś”).
  onOwner: (o: TodayOwner) => void;
  playbook: Playbook;
  goal: SeasonGoal;
  progress: DayProgress;
  signalTasks: SignalTask[];
  active: TodayGroupKey | "review" | null;
  onToggle: (g: TodayGroupKey | "review" | null) => void;
  // Wniosek 43: maile czekające w „Do sprawdzenia” (kafel przełącza widok).
  reviewCount: number;
}) {
  const funnel = useMemo(() => toFunnel(rows) as Row[], [rows]);
  const mine = useMemo(() => scopeRows(funnel, owner, currentUserId), [funnel, owner, currentUserId]);
  const today = useMemo(() => buildToday(mine, now), [mine, now]);
  const of = (g: TodayGroup) => today.filter((x) => x.group === g);
  const tasks = signalTasks.filter((t) => (owner === "me" ? t.assigneeId === currentUserId : true));
  // Podpowiedź: „Moje” puste, a u innych są sprawy (np. Tomek przy sygnałach Ani).
  const mineCount = useMemo(() => buildToday(scopeRows(funnel, "me", currentUserId), now).length + signalTasks.filter((t) => t.assigneeId === currentUserId).length, [funnel, currentUserId, now, signalTasks]);
  const allCount = useMemo(() => buildToday(funnel, now).length + signalTasks.length, [funnel, now, signalTasks]);
  const hint = owner === "me" ? scopeHint(mineCount, allCount) : null;
  // Zaległe w każdym kaflu — terakota pod podpisem (zgodnie z Tablicą).
  const lateOf = (g: TodayGroup) => {
    const items = of(g);
    return lateNote(items.filter((x) => x.priority === "late").length, items.length);
  };
  const untouchedTotal = mine.filter((r) => r.stage === "SYGNAL" && !r.firstContactAt && isFreshInquiry(r, now)).length;
  const se = playbook.season;
  const names2 = (xs: TodayItem<Row>[]) => xs.slice(0, 2).map((x) => names(x.lead).title.split(/[@\s·]/)[0]).join(", ") + (xs.length > 2 ? "…" : "");
  const tiles = [
    { key: "new", label: "Nowe zapytania", n: of("new").length, sub: `z ${untouchedTotal} · kontakt w ${FIRST_CONTACT_SLA_HOURS} h rob.`, late: lateOf("new") },
    { key: "review", label: "Do sprawdzenia", n: reviewCount, sub: reviewCount ? "maile od nowych osób" : "—", highlight: reviewCount > 0 },
    { key: "calls", label: "Umówione telefony", n: of("calls").length, sub: names2(of("calls")) || "—", late: lateOf("calls") },
    { key: "followups", label: "Follow-up ofert", n: of("followups").length, sub: names2(of("followups")) || "—", late: lateOf("followups") },
    // Wiosna: do „Na dziś” trafia max SPRING_PER_DAY dziennie z puli (rozkład telefonów).
    { key: "spring", label: "Wracają z wiosny", n: of("spring").length, sub: `${of("spring").length} na dziś z ${goal.pool} w puli`, late: lateOf("spring") },
    { key: "back", label: "Wracają odłożone", n: of("back").length, sub: names2(of("back")) || "—", late: lateOf("back") },
    { key: "other", label: "Inne sprawy", n: of("other").length, sub: names2(of("other")) || "—", late: lateOf("other") },
    { key: "tasks", label: "Zadania przy sygnałach", n: tasks.length, sub: tasks.length ? `${tasks.filter((t) => t.dueDate && t.dueDate < iso(now)).length} zaległe` : "—", highlight: true },
  ];

  const done = owner === "me" ? (progress.doneByUser[currentUserId] ?? 0) : progress.doneToday;
  const total = done + today.length + tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 100;
  const seasonPct = Math.min(100, Math.round((goal.total / se.target) * 100));
  const next = nextReward(goal.total, se);

  const right = (
    <div className="flex flex-col gap-1 text-[12px] text-[#DCE8F2]">
      <span>
        Dziś: <b className="font-semibold text-white">{done}</b> z {total} zrobione
      </span>
      <div className="h-1 bg-white/20">
        <i className="block h-1 bg-[#7FC4A8]" style={{ width: `${pct}%` }} />
      </div>
      <span title={next ? `Następna nagroda przy ${next.at}: ${next.text}` : "Cel osiągnięty"}>
        Cel sezonu: <b className="font-semibold text-white">{goal.total}</b> z {se.target} · wracają {goal.returning}/{se.returningTarget} · nowe {goal.fresh}/{se.newTarget}
        {next ? ` · do nagrody ${next.left}` : " 🎉"}
      </span>
      <div className="relative h-1 bg-white/20">
        <i className="block h-1 bg-[#BFD6EA]" style={{ width: `${seasonPct}%` }} />
        {Array.from({ length: Math.floor(se.target / REWARD_STEP) }, (_, i) => (i + 1) * REWARD_STEP).map((m) => (
          <span key={m} className={`absolute -top-[2px] h-2 w-[2px] ${goal.total >= m ? "bg-[#7FC4A8]" : "bg-white/50"}`} style={{ left: `calc(${(m / se.target) * 100}% - 1px)` }} />
        ))}
      </div>
    </div>
  );

  return (
    <div data-tour="plan" className="flex flex-col gap-2">
      <TodayBar
        className=""
        title="Do zrobienia dziś"
        dateLabel={`${now.toLocaleDateString("pl-PL", { weekday: "long", day: "2-digit", month: "2-digit" })} · ${owner === "me" ? "moje" : "wszyscy"}`}
        tiles={tiles}
        active={active}
        onToggle={(k) => onToggle(k as TodayGroupKey | "review" | null)}
        right={right}
        allowEmpty
      />
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#5C6166]">
        <Seg<TodayOwner>
          value={owner}
          onChange={onOwner}
          options={[
            ["me", "Moje"],
            ["all", "Wszyscy"],
          ]}
        />
        {hint && (
          <span>
            {hint} –{" "}
            <button type="button" className="font-semibold text-[#1B6FA8] underline" onClick={() => onOwner("all")}>
              pokaż wszystkie
            </button>
          </span>
        )}
      </div>
      <WinToast goal={goal} now={now} playbook={playbook} userId={currentUserId} />
    </div>
  );
}
