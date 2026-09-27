"use client";

import { useMemo, useState } from "react";
import type { LeadRow } from "@/lib/leads/load";
import { BOARD_STAGES, LOST_REASON_LABEL, STAGE_LABEL, TYPE_LABEL, type LostReasonKey } from "@/lib/leads/labels";
import { LEAD_DEVICE_LABEL, type LeadStageKey } from "@/lib/leads/parse-deal";
import { FUNNEL_FROM, REACH_ORDER } from "@/lib/leads/funnel";
import { Avatar, Dots, Seg } from "./funnel-views";

// Sygnały → Tablica (wzór lejek-wzor.html, s2): jedyny lejek w panelu.
// Karta: prowadząca, następny krok z terminem (terakota = po terminie),
// próby; nagłówek kolumny: konwersja do następnego etapu. Przeciąganie z tymi
// samymi walidacjami co w karcie (Wygrana tylko z wynajmem — przez serwer;
// Przegrana — okno z powodem).

type Period = "2026" | "90" | "archive";
type Owner = "all" | "ania" | "tomek";
const PER_COLUMN = 12;
const dayMs = 86_400_000;
const d2 = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const who = (r: LeadRow) => r.clientName ?? r.person ?? r.email ?? r.title;

function ago(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / dayMs);
  return days <= 0 ? "dziś" : days === 1 ? "wczoraj" : days < 30 ? `${days} dni` : d2(iso);
}

function due(r: LeadRow, now: Date): { text: string; late: boolean; today: boolean } {
  if (r.stage === "REZERWACJA") {
    return r.rentalId
      ? { text: `po wynajmie → Wygrana`, late: false, today: false }
      : { text: "powiąż z wynajmem", late: true, today: false };
  }
  if (!r.nextActionAt) return { text: "brak kroku", late: true, today: false };
  const at = new Date(r.nextActionAt);
  if (at < now) {
    const days = Math.floor((now.getTime() - at.getTime()) / dayMs);
    return { text: days >= 1 ? `po terminie ${days} ${days === 1 ? "dzień" : "dni"}` : "po terminie", late: true, today: false };
  }
  if (at.toDateString() === now.toDateString()) return { text: r.nextStepType === "PIERWSZY_KONTAKT" ? "zadzwonić dziś" : "dziś", late: false, today: true };
  return { text: `${r.nextStepType === "ODDZWONI" ? "oddzwoni" : "krok"} ${d2(r.nextActionAt)}`, late: false, today: false };
}

export function BoardView({
  rows,
  archived,
  users,
  now,
  selectedId,
  readOnly,
  onOpen,
  onMove,
  onLost,
}: {
  rows: LeadRow[];
  archived: LeadRow[];
  users: { id: string; name: string }[];
  now: Date;
  selectedId: string | null;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, stage: LeadStageKey) => void;
  onLost: (id: string) => void;
}) {
  const [period, setPeriod] = useState<Period>("2026");
  const [owner, setOwner] = useState<Owner>("all");
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<LeadStageKey | "LOST" | null>(null);
  const [open, setOpen] = useState<Set<LeadStageKey>>(new Set());
  const byName = (n: string) => users.find((u) => u.name === n)?.id ?? null;
  const ownerId = owner === "ania" ? byName("Ania") : owner === "tomek" ? byName("Tomek") : null;

  const scoped = useMemo(() => {
    const from90 = now.getTime() - 90 * dayMs;
    const base = period === "archive" ? archived : rows.filter((r) => (period === "2026" ? new Date(r.createdAt) >= FUNNEL_FROM : new Date(r.createdAt).getTime() >= from90));
    return owner === "all" ? base : base.filter((r) => r.ownerId === ownerId);
  }, [rows, archived, period, owner, ownerId, now]);

  // Konwersja: z sygnałów, które doszły do etapu, ile doszło do następnego
  // (etap „kiedykolwiek osiągnięty”, także przegrane po drodze).
  const reached = (s: LeadStageKey) => scoped.filter((r) => REACH_ORDER.indexOf(r.maxStage) >= REACH_ORDER.indexOf(s)).length;
  const conv = (s: LeadStageKey) => {
    const next = REACH_ORDER[REACH_ORDER.indexOf(s) + 1];
    const base = reached(s);
    return base ? Math.round((reached(next) / base) * 100) : null;
  };
  const won = scoped.filter((r) => r.stage === "WYGRANA" && r.rentalId).length;
  const lost = scoped.filter((r) => r.stage === "PRZEGRANA");
  const reasons = [...lost.reduce((m, r) => m.set(r.lostReason ?? "INNE", (m.get(r.lostReason ?? "INNE") ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  const dropProps = (target: LeadStageKey | "LOST") => ({
    onDragOver: (e: React.DragEvent) => {
      if (readOnly) return;
      e.preventDefault();
      setDrop(target);
    },
    onDragLeave: () => setDrop((d) => (d === target ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDrop(null);
      if (!dragId || readOnly) return;
      if (target === "LOST") onLost(dragId);
      else onMove(dragId, target);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Seg<Period>
          value={period}
          onChange={setPeriod}
          options={[
            ["2026", "2026"],
            ["90", "90 dni"],
            ["archive", `Archiwum 2025 (${archived.length})`],
          ]}
        />
        <Seg<Owner>
          value={owner}
          onChange={setOwner}
          options={[
            ["all", "Wszyscy"],
            ...(byName("Ania") ? ([["ania", "Ania"]] as [Owner, string][]) : []),
            ...(byName("Tomek") ? ([["tomek", "Tomek"]] as [Owner, string][]) : []),
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {BOARD_STAGES.map((stage) => {
          const col = scoped.filter((r) => r.stage === stage).sort((a, b) => (a.nextActionAt ?? "9999").localeCompare(b.nextActionAt ?? "9999"));
          const expanded = open.has(stage);
          const shown = expanded ? col : col.slice(0, PER_COLUMN);
          const c = conv(stage);
          return (
            <div key={stage} {...dropProps(stage)} className={`min-h-[200px] p-2.5 ${drop === stage ? "bg-[#EAF4FB] outline outline-2 outline-[#1B6FA8]" : "bg-[#F4F6F8]"}`}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <b className="text-[14px] font-semibold text-[#0C3450]">
                  {STAGE_LABEL[stage]} · {col.length}
                </b>
                <span className="text-[11px] text-[#5C6166]" title="Z sygnałów, które doszły do tego etapu (wybrany okres), ile doszło do następnego.">
                  {stage === "REZERWACJA" ? (c == null ? "→ wygrana po wynajmie" : `→ ${c}% do wygranej`) : c == null ? "" : `→ ${c}% do ${stage === "SYGNAL" ? "wywiadu" : stage === "WYWIAD" ? "oferty" : "rezerwacji"}`}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {shown.map((r) => {
                  const d = due(r, now);
                  const dev = r.devices.map((x) => LEAD_DEVICE_LABEL[x]).join(", ");
                  return (
                    <div
                      key={r.id}
                      draggable={!readOnly}
                      onDragStart={() => setDragId(r.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDrop(null);
                      }}
                      onClick={() => onOpen(r.id)}
                      className={`cursor-pointer border border-l-[3px] bg-white px-2.5 py-2 ${d.late ? "border-l-[#E08A5C]" : "border-l-[#1B6FA8]"} ${selectedId === r.id ? "border-[#1B6FA8]" : "border-[#E3E6E9]"} ${dragId === r.id ? "opacity-50" : ""}`}
                    >
                      <div className="font-semibold text-[#0C3450]">
                        {who(r)}
                        {dev && <span className="font-normal text-[#5C6166]"> · {dev}</span>}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-[#5C6166]">
                        {r.stage === "REZERWACJA" && r.rentalStartsAt
                          ? `wynajem ${d2(r.rentalStartsAt)} ✓ powiązany`
                          : r.stage === "OFERTA"
                            ? `oferta ${d2(r.stageChangedAt)}${r.followUpNo ? ` · follow-up ${r.followUpNo} z 2` : ""}`
                            : `${TYPE_LABEL[r.type]} · ${ago(r.createdAt, now)}`}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px]">
                        <Avatar name={r.ownerName} />
                        <span className="flex items-center gap-1.5">
                          {r.attempts > 0 && <Dots attempts={r.attempts} />}
                          <span className={`tabular-nums ${d.late ? "font-semibold text-[#B8612F]" : d.today ? "font-semibold text-[#1B6FA8]" : "text-[#5C6166]"}`}>{d.text}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
                {col.length > PER_COLUMN && (
                  <button
                    type="button"
                    onClick={() => setOpen((s) => new Set(s.has(stage) ? [...s].filter((x) => x !== stage) : [...s, stage]))}
                    className="py-1 text-center text-[12px] text-[#1B6FA8] hover:underline"
                  >
                    {expanded ? "zwiń" : `+ ${col.length - PER_COLUMN} więcej`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2.5">
        <div className="border border-[#E3E6E9] bg-white px-3.5 py-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Wygrane · {period === "archive" ? "archiwum" : period === "90" ? "90 dni" : "2026"}</span>{" "}
          <b className="text-[16px] text-[#2F7A68]">{won}</b> <span className="bg-[#EAF4FB] px-[7px] py-px text-[11.5px] text-[#0C3450]">tylko z wynajmem</span>
        </div>
        <div {...dropProps("LOST")} className={`min-w-[260px] flex-1 border px-3.5 py-2 ${drop === "LOST" ? "border-[#E08A5C] bg-[#FBF0E7]" : "border-[#E3E6E9] bg-white"}`}>
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Przegrane</span> <b className="text-[16px] text-[#0C3450]">{lost.length}</b>{" "}
          <span className="text-[11.5px] text-[#5C6166]">
            {reasons.map(([k, n]) => `${(LOST_REASON_LABEL[k as LostReasonKey] ?? k).toLowerCase()} ${n}`).join(" · ")}
            {!readOnly && <span className="text-[#8A939B]">{reasons.length ? " · " : ""}upuść kartę tutaj, żeby oznaczyć przegraną (z powodem)</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
