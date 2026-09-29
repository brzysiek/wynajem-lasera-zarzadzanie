"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DayProgress, LeadDetail, LeadRow } from "@/lib/leads/load";
import { ACTIVITY_LABEL, TYPE_LABEL } from "@/lib/leads/labels";
import { DEVICE_INTEREST_LABEL, formatPhone, type DeviceInterestKey } from "@/lib/clients/labels";
import { LEAD_DEVICE_LABEL } from "@/lib/leads/parse-deal";
import { NO_ANSWER_LIMIT, buildToday, type FunnelLead, type TodayGroup, type TodayItem } from "@/lib/leads/funnel";
import type { SignalTask } from "@/lib/leads/today-extras";
import { api } from "@/components/clients/client-forms";
import { openTask } from "@/components/open-tasks";
import { Dots, Seg, toFunnel, type LinkSuggestion } from "./funnel-views";
import { StageChip } from "./lead-ui";
import { StageLegend, plural } from "./plan-day";
import { step as stepText, when as whenText } from "./today-table";
import type { CardIntent } from "./lead-card";

// Sygnały → Na dziś (wniosek 27 B, 26): kolejka pracy. Granatowy pasek „Do
// zrobienia dziś” (klik = filtr sekcji) — od wniosku 33 w SignalsTodayBar nad
// zakładkami; tu jedna linia filtrów, sprawy w
// sekcjach jako karty z kontekstem; klik w kartę rozwija ją w miejscu (oś
// czasu, historia, rezerwacja) — bez panelu z boku.

type Row = LeadRow & FunnelLead;
type Section = { key: string; label: string; items: TodayItem<Row>[] };
export type TodayOwner = "me" | "all";
export type TodayGroupKey = TodayGroup | "tasks";
type Owner = TodayOwner;
type Source = "all" | "www" | "phone";

const WWW: LeadRow["type"][] = ["POBRANIE_CENNIKA", "KONTAKT", "REZERWACJA_WWW", "SZKOLENIE_WWW"];
const BTN_SM = "inline-flex h-[28px] items-center whitespace-nowrap rounded-[6px] border border-[#C9D3DC] bg-white px-[10px] text-[12.5px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
const BTN_SM_PRIMARY = "inline-flex h-[28px] items-center whitespace-nowrap rounded-[6px] bg-[#1B6FA8] px-[10px] text-[12.5px] font-semibold text-white hover:bg-[#0C3450]";
const d2 = (d: Date | string) => new Date(d).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Nazwa gabinetu — e-mail tylko jako dopisek, gdy brak nazwy.
export function names(r: LeadRow): { title: string; extra: string | null } {
  const title = r.clientName ?? r.person ?? null;
  return title ? { title, extra: null } : { title: r.email ?? r.title, extra: null };
}

function devicesOf(r: LeadRow): DeviceInterestKey[] {
  if (r.devices.length) return r.devices;
  return r.clientInfo?.lastInterest ? [r.clientInfo.lastInterest] : [];
}

export function TodayQueue({
  rows,
  now,
  currentUserId,
  readOnly,
  progress,
  callStats,
  freeByInterest,
  signalTasks,
  selectedId,
  onOpen,
  onOutcome,
  onChanged,
  onSerial,
  suggestions,
  onLink,
  owner,
  onOwner,
  group,
  onGroup,
}: {
  rows: LeadRow[];
  now: Date;
  currentUserId: string;
  readOnly: boolean;
  progress: DayProgress;
  callStats: { talked: number; noAnswer: number };
  freeByInterest: Partial<Record<DeviceInterestKey, string[]>>;
  signalTasks: SignalTask[];
  selectedId: string | null;
  onOpen: (id: string, intent?: CardIntent) => void;
  onOutcome: (id: string) => void;
  onChanged: () => void;
  onSerial: () => void;
  // Rezerwacja bez wynajmu: podpowiedź wynajmu z kalendarza (jednym kliknięciem).
  suggestions: Record<string, LinkSuggestion>;
  onLink: (leadId: string, rentalId: string) => void;
  // Wniosek 33: pasek „Do zrobienia dziś” jest nad zakładkami (leads-manager) —
  // „Moje / Wszyscy” i wybrany kafel wspólne z nim.
  owner: TodayOwner;
  onOwner: (o: TodayOwner) => void;
  group: TodayGroupKey | null;
  onGroup: (g: TodayGroupKey | null) => void;
}) {
  const setOwner = onOwner;
  const setGroup = onGroup;
  const [source, setSource] = useState<Source>("all");
  const [device, setDevice] = useState<"all" | DeviceInterestKey>("all");
  const [legend, setLegend] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const funnel = useMemo(() => toFunnel(rows) as Row[], [rows]);
  const mine = owner === "me" ? funnel.filter((r) => r.ownerId === currentUserId) : funnel;
  const today = useMemo(() => buildToday(mine, now), [mine, now]);
  const filtered = today
    .filter((x) => (source === "all" ? true : source === "www" ? WWW.includes(x.lead.type) : x.lead.type === "TELEFON"))
    .filter((x) => (device === "all" ? true : devicesOf(x.lead).includes(device)));
  const tasks = signalTasks.filter((t) => (owner === "me" ? t.assigneeId === currentUserId : true));
  const of = (g: TodayGroup) => filtered.filter((x) => x.group === g);

  const sections: Section[] = [
    { key: "late", label: "Po czasie", items: filtered.filter((x) => x.priority === "late") },
    { key: "new", label: "Nowe zapytania", items: of("new").filter((x) => x.priority !== "late") },
    { key: "calls", label: "Umówione telefony", items: of("calls").filter((x) => x.priority !== "late") },
    { key: "followups", label: "Follow-up ofert", items: of("followups").filter((x) => x.priority !== "late") },
    { key: "spring", label: "Wracają z wiosny", items: of("spring").filter((x) => x.priority !== "late") },
    { key: "back", label: "Wracają odłożone", items: of("back").filter((x) => x.priority !== "late") },
    { key: "other", label: "Inne sprawy", items: of("other").filter((x) => x.priority !== "late") },
  ];
  const shownSections = group === "tasks" ? [] : group ? [{ key: group, label: sections.find((s) => s.key === group)?.label ?? "", items: of(group) }] : sections;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Seg<Owner>
          value={owner}
          onChange={setOwner}
          options={[
            ["me", "Moje"],
            ["all", "Wszyscy"],
          ]}
        />
        <Seg<"all" | DeviceInterestKey>
          value={device}
          onChange={setDevice}
          options={[
            ["all", "Każde urządzenie"],
            ["LIGHTSHEER", "LightSheer"],
            ["ALMA_HARMONY", "Alma"],
            ["OBSERV", "Observ"],
            ["COOLTECH", "Cooltech"],
          ]}
        />
        <Seg<Source>
          value={source}
          onChange={setSource}
          options={[
            ["all", "Każde źródło"],
            ["www", "WWW"],
            ["phone", "Telefon"],
          ]}
        />
        {!readOnly && (
          <button type="button" onClick={onSerial} className={BTN_SM} title="Otwiera po kolei kontakty do obdzwonienia">
            Dzwoń po kolei
          </button>
        )}
        {progress.unassigned.count > 0 && progress.unassigned.firstId && (
          <Link href={`/kalendarz?wynajem=${progress.unassigned.firstId}`} className="text-[12.5px] font-semibold text-[#B8612F] hover:underline" title="Rezerwacje z kalendarza bez klienta">
            Przypisz klienta ({progress.unassigned.count})
          </Link>
        )}
        <span className="text-[12px] text-[#5C6166]">
          dziś: {callStats.talked} {plural(callStats.talked, "rozmowa", "rozmowy", "rozmów")} · {callStats.noAnswer} nieodebrane
        </span>
        <span className="ml-auto flex items-center gap-2 text-[12px] text-[#5C6166]">
          {group && (
            <button type="button" className="text-[#1B6FA8] hover:underline" onClick={() => setGroup(null)}>
              pokaż wszystko
            </button>
          )}
          <button type="button" onClick={() => setLegend((v) => !v)} aria-expanded={legend} title="Legenda etapów i priorytetów" className="flex h-6 w-6 items-center justify-center rounded-full border border-[#C9D3DC] text-[12px] font-semibold text-[#1B6FA8]">
            i
          </button>
        </span>
      </div>
      {legend && <StageLegend priorities />}

      {shownSections.every((s) => !s.items.length) && group !== "tasks" && (!tasks.length || group) && (
        <p className="border border-[#CFE3DA] bg-[#EEF6F2] px-4 py-3 text-[13px] font-semibold text-[#2F7A68]">✓ {group ? "W tym punkcie nic na dziś." : "Na dziś wszystko zrobione — nowe obsłużone, każdy sygnał ma krok z datą."}</p>
      )}

      <div data-tour="today-table" className="flex flex-col gap-3">
      {shownSections.map(
        (s) =>
          s.items.length > 0 && (
            <section key={s.key} className="flex flex-col gap-2">
              <h3 className={`m-0 text-[11px] font-semibold uppercase tracking-[0.12em] ${s.key === "late" ? "text-[#B8612F]" : "text-[#5C6166]"}`}>
                {s.label} ({s.items.length})
              </h3>
              {s.items.map((x) => (
                <QueueCard
                  key={x.lead.id}
                  item={x}
                  now={now}
                  readOnly={readOnly}
                  selected={selectedId === x.lead.id}
                  expanded={expanded === x.lead.id}
                  freeByInterest={freeByInterest}
                  onToggle={() => setExpanded((id) => (id === x.lead.id ? null : x.lead.id))}
                  onOpen={onOpen}
                  onOutcome={onOutcome}
                  suggestion={suggestions[x.lead.id] ?? null}
                  onLink={onLink}
                />
              ))}
            </section>
          ),
      )}
      </div>

      {(group === "tasks" || !group) && tasks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5C6166]">Zadania przy sygnałach ({tasks.length})</h3>
          {tasks.map((t) => (
            <SignalTaskRow key={t.id} t={t} today={iso(now)} readOnly={readOnly} onOpen={() => onOpen(t.leadId)} onChanged={onChanged} />
          ))}
        </section>
      )}
    </div>
  );
}

function SignalTaskRow({ t, today, readOnly, onOpen, onChanged }: { t: SignalTask; today: string; readOnly: boolean; onOpen: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const late = t.dueDate && t.dueDate < today;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-l-[3px] border-[#E3E6E9] border-l-[#E08A5C] bg-white px-3 py-2 text-[13px]">
      <span className={`flex-none text-[11px] font-semibold uppercase tracking-[0.08em] ${late ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>{late ? `zaległe ${d2(t.dueDate!)}` : "dziś"}</span>
      <button type="button" onClick={onOpen} className="min-w-0 font-semibold text-[#0C3450] hover:underline" title={t.leadTitle}>
        {t.clientName ?? t.leadTitle}
      </button>
      <span className="min-w-0 flex-1 truncate text-[#2A3540]" title={t.title}>
        {t.title}
      </span>
      <span className="text-[12px] text-[#5C6166]">{[t.author ? `zlecił(a): ${t.author}` : null, t.assignee ? `dla: ${t.assignee}` : null].filter(Boolean).join(" · ")}</span>
      <button type="button" className={BTN_SM} onClick={() => openTask(t.id)}>
        Zadanie
      </button>
      {!readOnly && (
        <button
          type="button"
          disabled={busy}
          className={BTN_SM}
          onClick={async () => {
            setBusy(true);
            await api(`/api/tasks/${t.id}`, "PATCH", { status: "DONE" });
            setBusy(false);
            onChanged();
          }}
        >
          Zrobione ✓
        </button>
      )}
    </div>
  );
}

function QueueCard({
  item,
  now,
  readOnly,
  selected,
  expanded,
  freeByInterest,
  onToggle,
  onOpen,
  onOutcome,
  suggestion,
  onLink,
}: {
  item: TodayItem<Row>;
  now: Date;
  readOnly: boolean;
  selected: boolean;
  expanded: boolean;
  freeByInterest: Partial<Record<DeviceInterestKey, string[]>>;
  onToggle: () => void;
  onOpen: (id: string, intent?: CardIntent) => void;
  onOutcome: (id: string) => void;
  suggestion: LinkSuggestion | null;
  onLink: (leadId: string, rentalId: string) => void;
}) {
  const r = item.lead;
  const noRental = r.stage === "REZERWACJA" && !r.rentalId;
  const n = names(r);
  const w = whenText(item, now);
  const devs = devicesOf(r);
  const free = devs.flatMap((dv) => (freeByInterest[dv]?.length ? [`${DEVICE_INTEREST_LABEL[dv]}: wolne ${freeByInterest[dv]!.join(", ")}`] : []));
  const km = r.clientInfo?.distanceKm;
  const untouched = r.stage === "SYGNAL" && !r.firstContactAt;
  const counter = untouched && r.attempts > 0 ? `${r.attempts + 1}. próba` : r.stage === "OFERTA" && r.followUpNo ? `follow-up ${r.followUpNo} z 2` : null;
  const [draftBusy, setDraftBusy] = useState(false);

  async function mailDraft() {
    setDraftBusy(true);
    const { ok, data } = await api<{ to: string | null; subject: string; body: string }>(`/api/leads/${r.id}/offer-draft`, "GET");
    setDraftBusy(false);
    if (ok) window.location.href = `mailto:${data.to ?? r.email ?? ""}?subject=${encodeURIComponent(data.subject)}&body=${encodeURIComponent(data.body)}`;
  }

  return (
    <div className={`border border-l-[3px] bg-white ${w.tone === "late" ? "border-l-[#E08A5C]" : "border-l-[#1B6FA8]"} ${selected ? "border-[#1B6FA8]" : "border-[#E3E6E9]"}`}>
      <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => e.key === "Enter" && onToggle()} aria-expanded={expanded} className="flex cursor-pointer flex-col gap-1 px-3.5 py-2.5 hover:bg-[#F9FAFB]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 max-w-full truncate text-[14.5px] font-semibold text-[#0C3450] [overflow-wrap:anywhere]" title={r.title}>
            {n.title}
          </span>
          {r.clientName && r.email && !r.person && <span className="truncate text-[12px] text-[#8A939B]">{r.email}</span>}
          <StageChip stage={r.stage} />
          {(r.city || km != null) && <span className="text-[12px] text-[#5C6166]">{[r.city, km != null ? `${Math.round(km)} km` : null].filter(Boolean).join(" · ")}</span>}
          <span className={`ml-auto text-[12.5px] font-semibold tabular-nums ${w.tone === "late" ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>{w.text}</span>
        </div>
        <div className="line-clamp-2 text-[13px] text-[#2A3540]" title={r.nextStepNote ?? undefined}>
          {stepText(r)}
          {r.nextStepNote && !stepText(r).includes(r.nextStepNote) ? ` — ${r.nextStepNote}` : ""}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[#5C6166]">
          {devs.length > 0 && <span>{devs.map((dv) => LEAD_DEVICE_LABEL[dv]).join(", ")}{!r.devices.length ? " (z historii)" : ""}</span>}
          {free.length > 0 && <span className="text-[#2F7A68]">{free.join(" · ")}</span>}
          {r.lastContactAt && <span>ostatni kontakt {d2(r.lastContactAt)}</span>}
          {counter && (
            <span className="flex items-center gap-1">
              {untouched && <Dots attempts={r.attempts} />}
              {counter}
            </span>
          )}
          {r.attempts >= NO_ANSWER_LIMIT && untouched && <span className="text-[#B8612F]">3 próby — rozważ przegraną</span>}
          {r.tasks.count > 0 && <span className="text-[#B8612F]">📋 {r.tasks.count} {r.tasks.count === 1 ? "zadanie" : "zadania"}</span>}
          {r.spring?.note && <span className="text-[#B8612F]" title={r.spring.note.body}>✎ {d2(r.spring.note.at)} {r.spring.note.by ?? ""}</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5" data-tour="row-actions" onClick={(e) => e.stopPropagation()}>
          {!readOnly && r.phone && (
            <a href={`tel:${r.phone}`} className={BTN_SM_PRIMARY} title={formatPhone(r.phone) ?? undefined}>
              Zadzwoń
            </a>
          )}
          {!readOnly && (
            <button type="button" className={BTN_SM} onClick={() => onOutcome(r.id)}>
              Wynik rozmowy
            </button>
          )}
          {!readOnly && (
            <button type="button" disabled={draftBusy || !(r.email || r.clientId)} className={BTN_SM} onClick={() => void mailDraft()} title="Szkic maila z ofertą (wolne terminy, cena)">
              Szkic maila
            </button>
          )}
          {!readOnly && noRental && suggestion && (
            <button type="button" className={BTN_SM} onClick={() => onLink(r.id, suggestion.id)} title={`W kalendarzu: „${suggestion.title}” ${d2(suggestion.startsAt)}`}>
              Powiąż: {d2(suggestion.startsAt)}
            </button>
          )}
          {!readOnly && noRental && !suggestion && (
            <button type="button" className={BTN_SM} onClick={() => onOpen(r.id, "link")}>
              Powiąż z wynajmem
            </button>
          )}
          <button type="button" className={BTN_SM} onClick={() => onOpen(r.id)}>
            Otwórz
          </button>
        </div>
      </div>
      {expanded && <QueueCardDetail row={r} />}
    </div>
  );
}

// Rozwinięcie w miejscu: oś czasu, historia klientki, rezerwacja.
function QueueCardDetail({ row }: { row: Row }) {
  const [d, setD] = useState<LeadDetail | null>(null);
  useEffect(() => {
    let alive = true;
    void api<LeadDetail>(`/api/leads/${row.id}`, "GET").then(({ ok, data }) => alive && ok && setD(data));
    return () => {
      alive = false;
    };
  }, [row.id]);
  const ci = row.clientInfo;
  return (
    <div className="grid gap-4 border-t border-[#E3E6E9] bg-[#FAFBFC] px-3.5 py-3 text-[12.5px] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166]">Oś czasu</span>
        {!d ? (
          <span className="text-[#5C6166]">Wczytywanie…</span>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {d.activities.slice(0, 10).map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="w-[70px] flex-none tabular-nums text-[#8A939B]">{d2(a.at)}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {a.type !== "NOTE" && a.type !== "SYSTEM" && <b className="font-semibold">{ACTIVITY_LABEL[a.type]}: </b>}
                  {a.body ?? ""}
                  {a.userName && <span className="text-[#8A939B]"> · {a.userName}</span>}
                </span>
              </li>
            ))}
            <li className="flex gap-2 text-[#8A939B]">
              <span className="w-[70px] flex-none tabular-nums">{d2(d.createdAt)}</span>
              <span>
                Wpłynęło · {TYPE_LABEL[d.type]} · {d.fromHubspot ? "z HubSpota" : "z panelu"}
              </span>
            </li>
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166]">Historia</span>
        {ci ? (
          <span>
            {ci.arrivals} {plural(ci.arrivals, "przyjazd", "przyjazdy", "przyjazdów")}
            {ci.rhythm ? ` · ${ci.rhythm}` : ""}
            {ci.lastRentalAt ? ` · ostatni ${d2(ci.lastRentalAt)}${ci.lastDevice ? ` (${ci.lastDevice})` : ""}` : ""}
          </span>
        ) : (
          <span className="text-[#5C6166]">bez historii wynajmów</span>
        )}
        {row.message && <span className="text-[#5C6166]">„{row.message.slice(0, 200)}”</span>}
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166]">Rezerwacja</span>
        {row.rentalId ? (
          <Link href={`/kalendarz?wynajem=${row.rentalId}`} className="font-semibold text-[#1B6FA8] hover:underline">
            {row.rentalDevice} · {row.rentalStartsAt ? d2(row.rentalStartsAt) : ""}
          </Link>
        ) : (
          <span className="text-[#5C6166]">brak — „Wynik rozmowy → Umówiła termin”</span>
        )}
      </div>
    </div>
  );
}
