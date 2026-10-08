"use client";

import { useMemo, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import Link from "next/link";
import type { LeadRow } from "@/lib/leads/load";
import { BOARD_STAGES, LOST_REASON_LABEL, TYPE_LABEL, type LostReasonKey } from "@/lib/leads/labels";
import { LEAD_DEVICE_LABEL, type LeadStageKey } from "@/lib/leads/parse-deal";
import { FUNNEL_FROM, NEXT_STEP_LABEL, REACH_ORDER, funnelFromRow, isSpringQueued, rotInfo, type FunnelLead, type NextStepType } from "@/lib/leads/funnel";
import { Avatar, Dots, Seg, periodTouch } from "./funnel-views";
import { StageChip } from "./lead-ui";
import { StageLegend } from "./plan-day";
import type { CardIntent } from "./lead-card";
import { LEAD_STAGE_COLORS } from "@/components/shell-tokens";

// Sygnały → Tablica (wzór lejek-v2-wzor.html, s2): jedyny lejek w panelu.
// Kolumny w kolorach etapów, terakota = gnije / po terminie, kropki prób,
// na karcie szybkie przyciski (Rozmawiałam, Oferta, Odłóż, ✕). Okres:
// domyślnie 30 dni — sygnały, które wpłynęły albo miały aktywność w okresie.
// Przeciąganie z tymi samymi walidacjami co w karcie (Wygrana tylko z
// wynajmem — przez serwer; Przegrana — okno z powodem).

type Period = "30" | "month" | "2026" | "archive";
type Owner = "all" | "ania" | "tomek";
const PER_COLUMN = 12;
const dayMs = 86_400_000;
const d2 = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const who = (r: LeadRow) => r.clientName ?? r.person ?? r.email ?? r.title;

function ago(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / dayMs);
  return days <= 0 ? "dziś" : days === 1 ? "wczoraj" : days < 30 ? `${days} dni` : d2(iso);
}

const LIMIT_TEXT: Partial<Record<LeadStageKey, string>> = { SYGNAL: "limit 4 h rob.", WYWIAD: "limit 3 dni rob.", OFERTA: "follow-up +3 / +7 dni", REZERWACJA: "do dnia wynajmu" };

function due(r: LeadRow, now: Date): { text: string; late: boolean; today: boolean } {
  const rot = rotInfo(funnelFromRow(r) as unknown as FunnelLead, now);
  if (r.stage === "REZERWACJA") {
    return r.rentalId
      ? { text: `po wynajmie → Wygrana`, late: false, today: false }
      : { text: "powiąż z wynajmem", late: true, today: false };
  }
  // Pula „wracają z wiosny” bez kontaktu: czeka w kolejce (do 3 dziennie w „Na dziś”) — neutralnie, nie jako zaległe.
  if (isSpringQueued(r)) return { text: "w kolejce", late: false, today: false };
  if (!r.nextActionAt) return { text: "brak kroku", late: true, today: false };
  const at = new Date(r.nextActionAt);
  const sameDay = at.toDateString() === now.toDateString();
  const hm = at.getHours() >= 11 ? ` ${at.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}` : "";
  // Nowe (nietknięte): SLA i kolejne próby.
  if (r.stage === "SYGNAL" && !r.firstContactAt) {
    if (r.attempts > 0) return { text: `${r.attempts + 1}. próba ${sameDay ? "dziś" : at < now ? "zaległa" : d2(r.nextActionAt)}`, late: rot.rotting || (at < now && !sameDay), today: sameDay && !rot.rotting };
    return rot.rotting ? { text: "po czasie", late: true, today: false } : { text: "zadzwonić dziś", late: false, today: true };
  }
  if (rot.rotting) return { text: rot.label!, late: true, today: false };
  if (sameDay) return { text: `dziś${hm}`, late: false, today: true };
  if (at < now) {
    const days = Math.floor((now.getTime() - at.getTime()) / dayMs);
    return { text: `po terminie ${days} ${days === 1 ? "dzień" : "dni"}`, late: true, today: false };
  }
  return { text: `${r.nextStepType === "ODDZWONI" ? "oddzwoni" : "krok"} ${d2(r.nextActionAt)}`, late: false, today: false };
}

// Wniosek 25: dymek przy kroku — rodzaj i termin, notatka kroku albo
// ostatnia notatka (data, autor), próby / follow-up, ostatni kontakt, wiosna.
function stepTip(r: LeadRow, d: { late: boolean; today: boolean }): string[] {
  const lines: string[] = [];
  const label = NEXT_STEP_LABEL[(r.nextStepType ?? "INNE") as NextStepType] ?? "kolejny krok";
  const kind = label.charAt(0).toUpperCase() + label.slice(1);
  if (r.nextActionAt) lines.push(`${kind} · ${new Date(r.nextActionAt).toLocaleString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${d.late ? " · zaległy" : d.today ? " · dziś" : ""}`);
  else lines.push("Brak kroku — ustaw termin");
  if (r.nextStepNote) lines.push(r.nextStepNote);
  else if (r.lastNote) lines.push(`Notatka ${d2(r.lastNote.at)}${r.lastNote.by ? ` (${r.lastNote.by})` : ""}: ${r.lastNote.body.length > 140 ? `${r.lastNote.body.slice(0, 140)}…` : r.lastNote.body}`);
  const counters = [r.attempts > 0 ? `${r.attempts}× nie odebrała` : null, r.followUpNo ? `follow-up ${r.followUpNo} z 2` : null].filter(Boolean);
  if (counters.length) lines.push(counters.join(" · "));
  lines.push(r.lastContactAt ? `Ostatni kontakt ${d2(r.lastContactAt)}` : "Bez kontaktu");
  if (r.spring) lines.push(`Wiosna: ${[r.spring.lastAt ? `ostatnio ${d2(r.spring.lastAt)}` : null, r.spring.device, r.spring.rhythm].filter(Boolean).join(" · ")}`);
  return lines;
}

// Wniosek 33: chip „następnego kroku” na karcie Tablicy — ikona rodzaju,
// nazwa, data i ▾; kolor = pilność (terakota zaległe, niebieski dziś, szary
// później). Najechanie = skrót (dymek), klik / dotyk = panel pod chipem z
// notatką i przyciskami Wynik rozmowy · Zmień termin · Otwórz.
const STEP_ICON: Record<string, string> = {
  PIERWSZY_KONTAKT: "📞",
  PONOWNA_PROBA: "📞",
  FOLLOW_UP_OFERTY: "✉️",
  ODDZWONI: "☎️",
  DOPYTAC: "💬",
  POWROT: "↩️",
  UMOW_TERMIN: "📅",
  INNE: "•",
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function StepChip({
  r,
  d,
  now,
  open,
  onToggle,
  readOnly,
  onOutcome,
  onOpen,
  onChanged,
  tourTarget = false,
}: {
  r: LeadRow;
  d: { text: string; late: boolean; today: boolean };
  now: Date;
  open: boolean;
  onToggle: () => void;
  readOnly: boolean;
  onOutcome: (id: string) => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
  tourTarget?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kindKey = (r.nextStepType ?? (r.stage === "SYGNAL" && !r.firstContactAt ? "PIERWSZY_KONTAKT" : "INNE")) as NextStepType;
  const kind = NEXT_STEP_LABEL[kindKey] ?? "kolejny krok";
  const Kind = kind.charAt(0).toUpperCase() + kind.slice(1);
  const at = r.nextActionAt ? new Date(r.nextActionAt) : null;
  const dateTxt = r.stage === "REZERWACJA" ? d.text : !at ? "brak terminu" : at.toDateString() === now.toDateString() ? "dziś" : d2(r.nextActionAt!);
  const label = r.stage === "REZERWACJA" ? d.text : `${Kind} · ${dateTxt}`;
  const tone = d.late ? "border-[#E6CDB8] bg-[#FBF0E7] text-[#B8612F]" : d.today ? "border-[#BFD8EC] bg-[#EAF4FB] text-[#1B6FA8]" : "border-[#E3E6E9] bg-[#F4F6F8] text-[#5C6166]";
  async function reschedule(day: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/leads/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nextActionAt: day }) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "Nie udało się zmienić terminu.");
    onChanged();
  }
  const lines = stepTip(r, d);
  const BTN = "h-6 rounded-[5px] border border-[#C9D3DC] bg-white px-2 text-[11px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
  return (
    <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="group relative inline-flex max-w-full" data-tour={tourTarget ? "step-chip" : undefined}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-[2px] text-[11.5px] font-semibold tabular-nums ${tone}`}
        >
          <span aria-hidden>{STEP_ICON[kindKey] ?? "•"}</span>
          <span className="truncate">{label}</span>
          <span aria-hidden className="text-[9px]">{open ? "▴" : "▾"}</span>
        </button>
        {!open && (
          <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-[240px] flex-col gap-0.5 bg-[#0C3450] px-2.5 py-2 text-left text-[11.5px] font-normal leading-snug text-white shadow-lg group-hover:flex">
            {lines.map((l, i) => (
              <span key={i} className={i === 0 ? "font-semibold" : "text-[#D6E4EF] [overflow-wrap:anywhere]"}>
                {l}
              </span>
            ))}
          </span>
        )}
      </span>
      {open && (
        <div className="mt-1 flex flex-col gap-1 border border-[#E3E6E9] bg-[#F9FAFB] px-2 py-1.5 text-[11.5px] text-[#2A3540]">
          {lines.map((l, i) => (
            <span key={i} className={i === 0 ? "font-semibold text-[#0C3450]" : "whitespace-pre-line [overflow-wrap:anywhere]"}>
              {l}
            </span>
          ))}
          {r.nextStepNote && r.nextStepNote.includes("\n") && <span className="whitespace-pre-line text-[#5C6166]">{r.nextStepNote}</span>}
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {!readOnly && (
              <button type="button" className="h-6 rounded-[5px] bg-[#1B6FA8] px-2 text-[11px] font-semibold text-white hover:bg-[#0C3450]" onClick={() => onOutcome(r.id)}>
                Wynik rozmowy
              </button>
            )}
            {!readOnly && (
              <label className="inline-flex items-center gap-1">
                <span className="text-[11px] text-[#5C6166]">Zmień termin</span>
                <input
                  type="date"
                  disabled={busy}
                  defaultValue={at ? ymd(at) : ""}
                  min={ymd(now)}
                  onChange={(e) => e.target.value && void reschedule(e.target.value)}
                  className="h-6 rounded-[5px] border border-[#C9D3DC] px-1 text-[11px]"
                  aria-label="Nowy termin kroku"
                />
              </label>
            )}
            <button type="button" className={BTN} onClick={() => onOpen(r.id)}>
              Otwórz
            </button>
          </div>
          {error && <span className="text-[#B8612F]">{error}</span>}
        </div>
      )}
    </div>
  );
}

function Tip({ lines, children, label }: { lines: string[]; children: React.ReactNode; label: string }) {
  const [on, setOn] = useState(false);
  return (
    <span
      className="group relative inline-flex"
      onClick={(e) => {
        // Dotyk: pierwszy tap pokazuje dymek zamiast otwierać kartę.
        e.stopPropagation();
        setOn((v) => !v);
      }}
      onMouseLeave={() => setOn(false)}
      aria-label={label}
    >
      {children}
      <span
        role="tooltip"
        className={`absolute bottom-full right-0 z-20 mb-1 w-[240px] flex-col gap-0.5 bg-[#0C3450] px-2.5 py-2 text-left text-[11.5px] font-normal leading-snug text-white shadow-lg ${on ? "flex" : "hidden group-hover:flex"}`}
      >
        {lines.map((l, i) => (
          <span key={i} className={i === 0 ? "font-semibold" : "text-[#D6E4EF] [overflow-wrap:anywhere]"}>
            {l}
          </span>
        ))}
      </span>
    </span>
  );
}

type Show = "active" | "postponed" | "lost";

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
  onQuick,
  onPostpone,
  onOutcome,
  onChanged,
  canArchive2025 = false,
}: {
  rows: LeadRow[];
  archived: LeadRow[];
  users: { id: string; name: string }[];
  now: Date;
  selectedId: string | null;
  readOnly: boolean;
  onOpen: (id: string, intent?: CardIntent) => void;
  onMove: (id: string, stage: LeadStageKey) => void;
  onLost: (id: string) => void;
  onQuick: (id: string, outcome: "talked" | "offer_sent") => Promise<void>;
  onPostpone: (id: string) => void;
  // Wniosek 33: panel pod chipem kroku.
  onOutcome: (id: string) => void;
  onChanged: () => void;
  canArchive2025?: boolean;
}) {
  const [period, setPeriod] = useState<Period>("30");
  const [show, setShow] = useState<Show>("active");
  const [stepOpen, setStepOpen] = useState<string | null>(null);

  const [owner, setOwner] = useState<Owner>("all");
  const old2025 = rows.filter((r) => ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"].includes(r.stage) && new Date(r.createdAt) < FUNNEL_FROM).length;
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<LeadStageKey | "LOST" | null>(null);
  const [open, setOpen] = useState<Set<LeadStageKey>>(new Set());
  const byName = (n: string) => users.find((u) => u.name === n)?.id ?? null;
  const ownerId = owner === "ania" ? byName("Ania") : owner === "tomek" ? byName("Tomek") : null;

  const periodFrom = period === "30" ? now.getTime() - 30 * dayMs : period === "month" ? new Date(now.getFullYear(), now.getMonth(), 1).getTime() : FUNNEL_FROM.getTime();
  const scoped = useMemo(() => {
    // Okres: wpłynął albo miał realny kontakt w okresie (zmiany etapu z
    // migracji i wpisy systemowe się nie liczą).
    const touched = (r: LeadRow) => periodTouch(r) >= periodFrom;
    const base = period === "archive" ? archived : rows.filter((r) => new Date(r.createdAt) >= FUNNEL_FROM && touched(r));
    return owner === "all" ? base : base.filter((r) => r.ownerId === ownerId);
  }, [rows, archived, period, periodFrom, owner, ownerId]);
  // Przewodnik „Co nowego” (wniosek 33) wskazuje chip pierwszej widocznej karty.
  const firstChipId = (() => {
    for (const st of BOARD_STAGES) {
      const col = scoped.filter((r) => r.stage === st).sort((a, b) => (a.nextActionAt ?? "9999").localeCompare(b.nextActionAt ?? "9999"));
      if (col[0]) return col[0].id;
    }
    return null;
  })();
  const [busy, setBusy] = useState<string | null>(null);
  async function quick(id: string, outcome: "talked" | "offer_sent") {
    setBusy(id);
    await onQuick(id, outcome);
    setBusy(null);
  }

  // Konwersja: z sygnałów, które doszły do etapu, ile doszło do następnego
  // (etap „kiedykolwiek osiągnięty”, także przegrane po drodze).
  // Stałe klientki poza konwersją nowych (lejek v2, 3.3 pkt 4).
  const reached = (s: LeadStageKey) => scoped.filter((r) => !r.returningClient && REACH_ORDER.indexOf(r.maxStage) >= REACH_ORDER.indexOf(s)).length;
  const conv = (s: LeadStageKey) => {
    const next = REACH_ORDER[REACH_ORDER.indexOf(s) + 1];
    const base = reached(s);
    return base ? Math.round((reached(next) / base) * 100) : null;
  };
  // Stopka (wzór v2): wygrane w okresie i w 2026, przegrane w okresie z
  // powodami, odłożone z datami powrotu.
  const periodLabel = period === "30" ? "30 dni" : period === "month" ? "ten miesiąc" : "2026";
  const inPeriod = (r: LeadRow) => new Date(r.stageChangedAt).getTime() >= periodFrom;
  const mineAll = owner === "all" ? rows : rows.filter((r) => r.ownerId === ownerId);
  const wonPeriod = scoped.filter((r) => r.stage === "WYGRANA" && r.rentalId && inPeriod(r)).length;
  const won2026 = mineAll.filter((r) => r.stage === "WYGRANA" && r.rentalId && new Date(r.createdAt) >= FUNNEL_FROM).length;
  const lost = scoped.filter((r) => r.stage === "PRZEGRANA" && inPeriod(r));
  const postponed = mineAll.filter((r) => r.stage === "ODLOZONE" && r.returnAt).sort((a, b) => a.returnAt!.localeCompare(b.returnAt!));
  const reasons = [...lost.reduce((m, r) => m.set(r.lostReason ?? "INNE", (m.get(r.lostReason ?? "INNE") ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  const card = (r: LeadRow) => {
                  const d = due(r, now);
                  const dev = r.devices.map((x) => LEAD_DEVICE_LABEL[x]).join(", ");
                  const QA = "border border-[#C9D3DC] bg-white px-1.5 py-px text-[10.5px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
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
                      className={`min-w-0 cursor-pointer border border-l-[3px] px-2.5 py-2 ${d.late ? "border-l-[#E08A5C] bg-[#FFFBF8]" : "border-l-[#1B6FA8] bg-white"} ${selectedId === r.id ? "border-[#1B6FA8]" : "border-[#E3E6E9]"} ${dragId === r.id ? "opacity-50" : ""}`}
                    >
                      {/* Wniosek 18 a): długi e-mail jako nazwa nie rozpycha karty — 2 linie z zawijaniem, pełna nazwa w dymku. */}
                      <div className="line-clamp-2 min-w-0 font-semibold text-[#0C3450] [overflow-wrap:anywhere]" title={`${who(r)}${dev ? ` · ${dev}` : ""}`}>
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
                      {r.nextStepNote && <div className="mt-0.5 truncate text-[11.5px] text-[#2A3540]" title={r.nextStepNote}>{r.nextStepNote.split("\n")[0]}</div>}
                      <StepChip
                        r={r}
                        d={d}
                        now={now}
                        open={stepOpen === r.id}
                        onToggle={() => setStepOpen((v) => (v === r.id ? null : r.id))}
                        readOnly={readOnly}
                        onOutcome={onOutcome}
                        onOpen={(id) => onOpen(id)}
                        onChanged={onChanged}
                        tourTarget={r.id === firstChipId}
                      />
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px]">
                        <Avatar name={r.ownerName} />
                        <span className="flex items-center gap-1.5">
                          {r.tasks.count > 0 && (
                            <Tip label="Zadania przy sygnale" lines={[`Zadania: ${r.tasks.count}`, ...(r.tasks.first ? [`${r.tasks.first.title}${r.tasks.first.dueDate ? ` · ${d2(r.tasks.first.dueDate)}` : ""}`] : []), ...stepTip(r, d).slice(1)]}>
                              <span className="cursor-help">📋{r.tasks.count > 1 ? r.tasks.count : ""}</span>
                            </Tip>
                          )}
                          {r.attempts > 0 && <Dots attempts={r.attempts} />}
                        </span>
                      </div>
                      {!readOnly && period !== "archive" && r.stage !== "PRZEGRANA" && (
                        <div className="mt-1.5 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                          <button type="button" disabled={busy === r.id} className={QA} onClick={() => void quick(r.id, "talked")} title="Rozmowa → W kontakcie, krok za 2 dni rob.">
                            Rozmawiałam
                          </button>
                          {(r.stage === "SYGNAL" || r.stage === "WYWIAD") && (
                            <button type="button" disabled={busy === r.id} className={QA} onClick={() => void quick(r.id, "offer_sent")} title="Wysłałam ofertę → Oferta wysłana, follow-up +3 dni rob.">
                              Oferta
                            </button>
                          )}
                          {r.stage === "REZERWACJA" && !r.rentalId && (
                            <button type="button" className={QA} onClick={() => onOpen(r.id, "link")} title="Lista wynajmów tego klienta i podobnych — wybór jednym kliknięciem">
                              Powiąż z wynajmem
                            </button>
                          )}
                          <button type="button" className={QA} onClick={() => onPostpone(r.id)} title="Odłóż do… — data powrotu i powód">
                            Odłóż
                          </button>
                          <button type="button" className={QA} onClick={() => onLost(r.id)} title="Przegrana — z powodem">
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  );
                };

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
            ["30", "30 dni"],
            ["month", "Ten miesiąc"],
            ["2026", "2026"],
            ["archive", `Archiwum (${archived.length})`],
          ]}
        />
        <Seg<Show>
          value={show}
          onChange={setShow}
          options={[
            ["active", "Aktywne"],
            ["postponed", `Odłożone (${postponed.length})`],
            ["lost", `Przegrane (${lost.length})`],
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
        {canArchive2025 && old2025 > 0 && (
          <Link href="/sygnaly/archiwum-2025" className="ml-auto text-[12.5px] text-[#1B6FA8] hover:underline">
            Otwarte sprzed 2026: {old2025} → przejrzyj i przenieś do archiwum 2025
          </Link>
        )}
      </div>

      {/* Kontrola 29.09 09:45, pkt 5: cztery kolumny zawsze obok siebie (od
          ok. 1000 px obszaru treści mieszczą się w całości); węższe okno —
          przewijanie w bok zamiast łamania na 2×2. Na telefonie jedna pod drugą. */}
      {show !== "active" ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[12.5px] text-[#5C6166]">
            {show === "postponed" ? "Odłożone — wracają same do „Na dziś” w dniu powrotu (od najbliższego)." : `Przegrane — ${periodLabel}, z powodem.`}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {(show === "postponed" ? postponed : lost).map((r) => (
              <div key={r.id} className="flex flex-col">
                {card(r)}
                <span className="border border-t-0 border-[#E3E6E9] bg-[#F9FAFB] px-2.5 py-1 text-[11px] text-[#5C6166]">
                  {show === "postponed"
                    ? `wraca ${d2(r.returnAt!)}`
                    : `${(LOST_REASON_LABEL[(r.lostReason ?? "INNE") as LostReasonKey] ?? r.lostReason ?? "").toLowerCase()}`}
                </span>
              </div>
            ))}
            {(show === "postponed" ? postponed : lost).length === 0 && <p className="text-[13px] text-[#5C6166]">Brak.</p>}
          </div>
        </div>
      ) : (
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(4,minmax(232px,1fr))]">
        {BOARD_STAGES.map((stage) => {
          const col = scoped.filter((r) => r.stage === stage).sort((a, b) => (a.nextActionAt ?? "9999").localeCompare(b.nextActionAt ?? "9999"));
          const expanded = open.has(stage);
          const shown = expanded ? col : col.slice(0, PER_COLUMN);
          const c = conv(stage);
          return (
            <div
              key={stage}
              {...dropProps(stage)}
              // Przewodnik v4: ramka na kolumnie (pusta — sam nagłówek), liczba kart w data-count.
              data-tour={col.length ? `col-${stage}` : undefined}
              data-count={col.length}
              className={`min-h-[200px] min-w-0 p-2.5 ${drop === stage ? "bg-[#EAF4FB] outline outline-2 outline-[#1B6FA8]" : "bg-[#F4F6F8]"}`}
            >
              <div className="-mx-2.5 -mt-2.5 mb-2 h-1" style={{ background: LEAD_STAGE_COLORS[stage].dot }} />
              <div className="mb-2 flex items-baseline justify-between gap-2" data-tour={col.length ? undefined : `col-${stage}`} data-count={col.length}>
                <b className="text-[14px] font-semibold text-[#0C3450]">
                  <StageChip stage={stage} /> {col.length}
                </b>
                <span
                  className="text-[11px] text-[#5C6166]"
                  title={c == null ? undefined : `Konwersja w okresie: ${c}% sygnałów z tego etapu doszło do ${stage === "SYGNAL" ? "kontaktu" : stage === "WYWIAD" ? "oferty" : stage === "OFERTA" ? "rezerwacji" : "wygranej"}.`}
                >
                  {LIMIT_TEXT[stage]}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {shown.map(card)}
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
      </div>
      )}

      <div className="flex flex-wrap gap-2.5">
        <div className="border border-[#E3E6E9] bg-white px-3.5 py-2 text-[13px]">
          <StageChip stage="WYGRANA" /> {period === "archive" ? "archiwum" : periodLabel} <b className="text-[#0C3450]">{wonPeriod}</b> · 2026 <b className="text-[#0C3450]">{won2026}</b>
          <span className="block text-[11px] text-[#5C6166]">tylko z wynajmem w kalendarzu</span>
        </div>
        <div {...dropProps("LOST")} className={`min-w-[260px] flex-1 border px-3.5 py-2 text-[13px] ${drop === "LOST" ? "border-[#E08A5C] bg-[#FBF0E7]" : "border-[#E3E6E9] bg-white"}`}>
          <StageChip stage="PRZEGRANA" /> {periodLabel} <b className="text-[#0C3450]">{lost.length}</b>
          {reasons.length > 0 && <span className="text-[#5C6166]"> · {reasons.map(([k, n]) => `${(LOST_REASON_LABEL[k as LostReasonKey] ?? k).toLowerCase()} ${n}`).join(" · ")}</span>}
          {!readOnly && <span className="block text-[11px] text-[#8A939B]">upuść kartę tutaj, żeby oznaczyć przegraną (z powodem)</span>}
        </div>
        <div className="border border-[#E3E6E9] bg-white px-3.5 py-2 text-[13px]">
          <StageChip stage="ODLOZONE" /> <b className="text-[#0C3450]">{postponed.length}</b>
          {postponed.length > 0 && <span className="text-[#5C6166]"> · wracają {postponed.slice(0, 4).map((r) => d2(r.returnAt!)).join(", ")}{postponed.length > 4 ? "…" : ""}</span>}
        </div>
        <div className="flex-1 border border-[#E3E6E9] bg-white px-3.5 py-2 text-[12px] text-[#5C6166]">
          {readOnly ? "Podgląd: etapy i szybkie przyciski na kartach ma biuro (Tomek, Ania)" : "Karty: przeciągnij do kolumny albo użyj przycisków na karcie"} · kolumna „Nowe” = tylko nietknięte
        </div>
      </div>
      <StageLegend />
    </div>
  );
}
