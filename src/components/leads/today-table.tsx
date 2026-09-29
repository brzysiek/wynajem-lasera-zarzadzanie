"use client";

import { useState } from "react";
import Link from "next/link";
import type { LeadRow } from "@/lib/leads/load";
import { TYPE_LABEL } from "@/lib/leads/labels";
import { formatPhone } from "@/lib/clients/labels";
import { FIRST_CONTACT_SLA_HOURS, NEXT_STEP_LABEL, addWorkHours, isFreshInquiry, rotInfo, type FunnelLead, type NextStepType, type TodayItem } from "@/lib/leads/funnel";
import { Dots, type LinkSuggestion } from "./funnel-views";
import { StageChip } from "./lead-ui";
import { PriorityTag } from "./plan-day";
import type { CardIntent } from "./lead-card";

// Sygnały → Lista, filtr „Na dziś” (zasady-wzor.html, ekran 1): jedna tabela
// w kolejności dnia — po czasie → nowe → zaplanowane na dziś → wracające
// odłożone. Nowe: wynik kontaktu jednym kliknięciem.

type Row = LeadRow & FunnelLead;

const BTN_SM = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
// Przegląd 29.09 07:15, pkt 6: przy ~1290 px bez przewijania w bok — termin
// i akcje zawijają się w komórce zamiast wychodzić poza ekran.
const GRID = "84px 58px minmax(0,1.5fr) 116px minmax(0,1.2fr) 128px 210px";
const d2 = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
const hm = (d: Date) => d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
const who = (r: LeadRow) => r.clientName ?? r.person ?? r.email ?? r.title;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function meta(r: Row): string {
  // Wniosek 21: gabinet z wiosny — ostatni wynajem, urządzenie, rytm, telefon.
  if (r.spring && r.stage !== "REZERWACJA") {
    return [r.spring.lastAt ? `ostatni ${d2(new Date(r.spring.lastAt))}` : null, r.spring.device, r.spring.rhythm, r.phone ? `tel. ${formatPhone(r.phone)}` : null].filter(Boolean).join(" · ");
  }
  if (r.stage === "SYGNAL" && !r.firstContactAt) return [TYPE_LABEL[r.type], r.phone ? `tel. ${formatPhone(r.phone)}` : null].filter(Boolean).join(" · ");
  if (r.stage === "OFERTA") return `${r.followUpNo ? `follow-up ${r.followUpNo} z 2 · ` : ""}oferta ${d2(r.stageChangedAt)}`;
  if (r.stage === "REZERWACJA") return r.rentalId ? `wynajem ${r.rentalStartsAt ? d2(new Date(r.rentalStartsAt)) : ""}` : "brak wpisu w kalendarzu";
  if (r.stage === "ODLOZONE") return "odłożone";
  return NEXT_STEP_LABEL[(r.nextStepType as NextStepType) ?? "INNE"];
}

function step(r: Row): string {
  if (r.spring && r.stage === "WYWIAD" && r.nextStepType === "UMOW_TERMIN") return `umówić termin${r.spring.suggest ? ` · wolne ${d2(new Date(r.spring.suggest))}` : ""}`;
  if (r.stage === "SYGNAL" && !r.firstContactAt) return r.attempts > 0 ? `${r.attempts + 1}. próba${r.nextActionAt && r.nextActionAt.getHours() >= 15 ? " (najlepiej 16–17)" : r.nextActionAt && r.nextActionAt.getHours() < 10 ? " (najlepiej 8–9)" : ""}` : "pierwszy kontakt";
  if (r.stage === "ODLOZONE" || r.nextStepType === "POWROT") return "wraca z odłożonych";
  if (r.stage === "REZERWACJA" && !r.rentalId) return r.nextStepNote ?? "potwierdzić termin i wpisać do kalendarza";
  return r.nextStepNote ?? NEXT_STEP_LABEL[(r.nextStepType as NextStepType) ?? "INNE"];
}

function when(x: TodayItem<Row>, now: Date): { text: string; tone: "late" | "today" } {
  const r = x.lead;
  if (r.stage === "SYGNAL" && !r.firstContactAt) {
    const rot = rotInfo(r, now);
    const planned = (r.attempts > 0 || !isFreshInquiry(r, now)) && r.nextActionAt;
    if (x.priority === "late") return { text: planned ? `zaległa od ${d2(r.nextActionAt!)}` : (rot.label ?? "po czasie"), tone: "late" };
    if (planned) return { text: sameDay(r.nextActionAt!, now) ? `dziś ${hm(r.nextActionAt!)}` : d2(r.nextActionAt!), tone: "today" };
    return { text: `dziś do ${hm(addWorkHours(r.createdAt, FIRST_CONTACT_SLA_HOURS))}`, tone: "today" };
  }
  if (x.priority === "late" && r.nextActionAt) {
    const days = Math.max(1, Math.floor((now.getTime() - r.nextActionAt.getTime()) / 86_400_000));
    return { text: `zaległy ${days} ${days === 1 ? "dzień" : "dni"}`, tone: "late" };
  }
  const at = r.stage === "ODLOZONE" ? r.returnAt : r.nextActionAt;
  return { text: at && sameDay(at, now) && (at.getHours() >= 11 || at.getMinutes()) ? `dziś ${hm(at)}` : "dziś", tone: "today" };
}

export function TodayTable({
  items,
  now,
  selectedId,
  readOnly,
  suggestions,
  onOpen,
  onQuick,
  onLost,
  onLink,
}: {
  items: TodayItem<Row>[];
  now: Date;
  selectedId: string | null;
  readOnly: boolean;
  suggestions: Record<string, LinkSuggestion>;
  onOpen: (id: string, intent?: CardIntent) => void;
  onQuick: (id: string, outcome: "talked" | "no_answer") => Promise<void>;
  onLost: (id: string) => void;
  onLink: (leadId: string, rentalId: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  async function quick(id: string, outcome: "talked" | "no_answer") {
    setBusy(id);
    await onQuick(id, outcome);
    setBusy(null);
  }
  // Akcje wiersza — wspólne dla tabeli i widoku na telefonie.
  const actions = (r: Row, untouched: boolean, noRental: boolean) =>
    readOnly ? (
      <button type="button" className={BTN_SM} onClick={() => onOpen(r.id)}>
        Szczegóły
      </button>
    ) : untouched ? (
      <>
        <button type="button" disabled={busy === r.id} className={BTN_SM} onClick={() => void quick(r.id, "talked")} title="Rozmowa odbyta → W kontakcie, krok za 2 dni rob. (zmienisz w karcie)">
          Rozmawiałam
        </button>
        <button type="button" disabled={busy === r.id} className={BTN_SM} onClick={() => void quick(r.id, "no_answer")} title="SMS z szablonu od razu i kolejna próba (jutro 16:00, potem 8:30)">
          Nie odebrała → SMS
        </button>
        <button type="button" className={BTN_SM} onClick={() => onLost(r.id)} title="Przegrana — z powodem">
          ✕
        </button>
      </>
    ) : (
      <>
        {noRental && suggestions[r.id] ? (
          <button type="button" className={BTN_SM} onClick={() => onLink(r.id, suggestions[r.id].id)} title={`W kalendarzu: „${suggestions[r.id].title}” ${d2(new Date(suggestions[r.id].startsAt))}`}>
            Powiąż z wynajmem
          </button>
        ) : noRental ? (
          <Link href={`/kalendarz/wynajem/nowy?${new URLSearchParams({ ...(r.requestedFrom ? { date: r.requestedFrom.slice(0, 10) } : {}), sygnal: r.id }).toString()}`} className={BTN_SM}>
            Wpisz do kalendarza
          </Link>
        ) : r.phone ? (
          <a href={`tel:${r.phone}`} onClick={() => onOpen(r.id, "call")} className={BTN_SM}>
            Zadzwoń
          </a>
        ) : null}
        <button type="button" className={BTN_SM} onClick={() => onOpen(r.id)}>
          Szczegóły
        </button>
      </>
    );

  if (!items.length) {
    return <p className="border border-[#CFE3DA] bg-[#EEF6F2] px-4 py-3 text-[13px] font-semibold text-[#2F7A68]">✓ Na dziś wszystko zrobione — nowe obsłużone, każdy sygnał ma krok z datą.</p>;
  }
  return (
    <div data-tour="today-table" className="border border-[#E3E6E9] bg-white">
      {/* Telefon (~390 px): wiersz jako karta — kto, krok, termin i przyciski
          bez przewijania tabeli w bok (kontrola 29.09, pkt 7). */}
      <div className="md:hidden">
        {items.map((x) => {
          const r = x.lead;
          const untouched = r.stage === "SYGNAL" && !r.firstContactAt;
          const noRental = r.stage === "REZERWACJA" && !r.rentalId;
          const w = when(x, now);
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(r.id)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
              className={`flex cursor-pointer flex-col gap-1 border-b border-[#F0F1F2] px-3 py-2.5 text-[13px] last:border-0 ${selectedId === r.id ? "bg-[#EAF4FB]" : ""}`}
            >
              <div className="flex items-center gap-2">
                <PriorityTag p={x.priority} />
                <StageChip stage={r.stage} />
                <span className={`ml-auto text-[12.5px] font-semibold tabular-nums ${w.tone === "late" ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>{w.text}</span>
              </div>
              <div className="truncate font-semibold text-[#0C3450]" title={r.title}>
                {who(r)}
              </div>
              <div className="truncate text-[12px] text-[#5C6166]">
                {d2(r.createdAt)} · {step(r)}
                {untouched && r.attempts > 0 && (
                  <>
                    {" · "}
                    <Dots attempts={r.attempts} />
                  </>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                {actions(r, untouched, noRental)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto md:block">
      <div className="min-w-[860px]">
        <div className="grid gap-2.5 border-b-[1.5px] border-[#0C3450] px-3.5 py-[7px] text-[10px] uppercase tracking-[0.1em] text-[#5C6166]" style={{ gridTemplateColumns: GRID }}>
          <span>Priorytet</span>
          <span>Wpłynęło</span>
          <span>Kontakt</span>
          <span>Etap</span>
          <span>Następny krok</span>
          <span>Termin</span>
          <span />
        </div>
        {items.map((x, idx) => {
          const r = x.lead;
          const untouched = r.stage === "SYGNAL" && !r.firstContactAt;
          const noRental = r.stage === "REZERWACJA" && !r.rentalId;
          const w = when(x, now);
          const note = untouched ? (r.nextStepNote && r.nextStepType !== "PIERWSZY_KONTAKT" && r.nextStepType !== "PONOWNA_PROBA" ? r.nextStepNote : r.message?.slice(0, 60)) : null;
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(r.id)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
              className={`grid cursor-pointer items-center gap-2.5 border-b border-[#F0F1F2] px-3.5 py-[7px] text-[13px] last:border-0 hover:bg-[#F7F9FB] ${selectedId === r.id ? "bg-[#EAF4FB]" : ""}`}
              style={{ gridTemplateColumns: GRID }}
            >
              <span>
                <PriorityTag p={x.priority} />
              </span>
              <span className="text-[12px] tabular-nums text-[#5C6166]">{d2(r.createdAt)}</span>
              <div className="min-w-0">
                <div className="truncate font-semibold text-[#0C3450]" title={r.title}>
                  {who(r)}
                </div>
                <div className="truncate text-[12px] text-[#5C6166]">
                  {meta(r)}
                  {untouched && r.attempts > 0 && (
                    <>
                      {" · "}
                      <Dots attempts={r.attempts} />
                    </>
                  )}
                  {note ? ` · ${note}` : ""}
                </div>
              </div>
              <span>
                <StageChip stage={r.stage} />
              </span>
              <span className="truncate text-[12.5px] text-[#5C6166]" title={step(r)}>
                {step(r)}
              </span>
              <span className={`text-[12.5px] font-semibold leading-tight tabular-nums ${w.tone === "late" ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>{w.text}</span>
              <div
                className="flex flex-wrap justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
                data-tour={untouched && items.findIndex((y) => y.lead.stage === "SYGNAL" && !y.lead.firstContactAt) === idx ? "row-actions" : undefined}
              >
                {actions(r, untouched, noRental)}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
