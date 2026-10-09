"use client";

import { useEffect, useState } from "react";
import { FIRST_CONTACT_SLA_HOURS, NEXT_STEP_LABEL, workDurationLabel, type NextStepType } from "@/lib/leads/funnel";
import { LOST_REASON_LABEL, POSTPONE_REASON_LABEL, STAGE_LABEL, type LostReasonKey, type PostponeReasonKey } from "@/lib/leads/labels";
import type { LeadStageKey } from "@/lib/leads/parse-deal";
import { addWorkdays, nextWorkday, workHoursBetween } from "@/lib/leads/work-time";
import { stepTypeOptions } from "@/lib/leads/step-edit";
import { INPUT } from "@/components/clients/client-forms";

// Blok „Następny krok” (wniosek 47) — jeden komponent dla karty sygnału i
// rozwiniętej sprawy w „Na dziś”: te same akcje i te same reguły. Wynik
// rozmowy, „Edytuj krok” (rodzaj + opis), „Zmień termin” (data, jutro, +3 dni
// rob., wyczyść) i podpis „ustawił: …”. Agent widzi krok tylko do odczytu.

export type StepBlockLead = {
  id: string;
  stage: LeadStageKey;
  nextActionAt: string | null;
  nextStepType: string | null;
  nextStepNote: string | null;
  firstContactAt: string | null;
  createdAt: string;
  returnAt: string | null;
  postponeReason: string | null;
  lostReason: string | null;
  lostNote: string | null;
  stepSetText: string | null;
};

const ACTION = "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[#C9D3DC] bg-white px-2.5 text-[12.5px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
const ACTION_PRIMARY = "inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[#1B6FA8] px-3 text-[12.5px] font-semibold text-white hover:bg-[#0C3450] disabled:opacity-40";
const DATE_INPUT = `${INPUT.replace("w-full", "")} h-8 w-[150px]`;
const toDay = (d: Date | string | null) => {
  if (!d) return "";
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const OPEN = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "ODLOZONE"];

export function LeadStepBlock({
  lead,
  readOnly,
  busy,
  onPatch,
  onOutcome,
}: {
  lead: StepBlockLead;
  readOnly: boolean;
  busy: boolean;
  // PATCH /api/leads/[id]; zwraca true po zapisie.
  onPatch: (body: Record<string, unknown>, success?: string) => Promise<boolean>;
  onOutcome: () => void;
}) {
  const [term, setTerm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState(lead.nextStepType ?? "INNE");
  const [note, setNote] = useState(lead.nextStepNote ?? "");
  // Nowa wersja kroku z serwera (po zapisie / odświeżeniu) resetuje pola edycji.
  const sig = `${lead.nextStepType}|${lead.nextStepNote}`;
  const [seen, setSeen] = useState(sig);
  if (sig !== seen) {
    setSeen(sig);
    setType(lead.nextStepType ?? "INNE");
    setNote(lead.nextStepNote ?? "");
  }

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setEditing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing]);

  const closed = lead.stage === "WYGRANA" || lead.stage === "PRZEGRANA";
  const postponed = lead.stage === "ODLOZONE";
  const open = OPEN.includes(lead.stage);
  const canEditStep = !readOnly && !closed && !postponed;
  const late = lead.nextActionAt ? new Date(lead.nextActionAt) < new Date() : false;

  async function saveStep() {
    const body: Record<string, unknown> = {};
    if (type !== (lead.nextStepType ?? "INNE")) body.nextStepType = type;
    if (note.trim() !== (lead.nextStepNote ?? "")) body.nextStepNote = note.trim();
    if (!Object.keys(body).length) return setEditing(false);
    if (await onPatch(body, "Zapisano krok.")) setEditing(false);
  }

  return (
    <div className="flex flex-col gap-2 border-l-[3px] border-[#1B6FA8] bg-[#EAF4FB] px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166]">{editing ? "Następny krok · edycja" : "Następny krok"}</span>
        {!editing && lead.stepSetText && <span className="ml-auto text-[11px] text-[#5C6166]">{lead.stepSetText}</span>}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[12px] text-[#5C6166]">
            Rodzaj kroku
            <select className={`${INPUT} h-9 cursor-pointer`} value={type} disabled={busy} onChange={(e) => setType(e.target.value)}>
              {stepTypeOptions(lead.nextStepType).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label.charAt(0).toUpperCase() + o.label.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[#5C6166]">
            Opis (domyślny tekst można dopisać lub zmienić)
            <textarea className={`${INPUT} h-auto min-h-[64px] py-2`} rows={3} maxLength={500} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} autoFocus />
          </label>
          <div className="flex gap-1.5">
            <button type="button" className={ACTION_PRIMARY} disabled={busy} onClick={() => void saveStep()}>
              Zapisz
            </button>
            <button type="button" className={ACTION} disabled={busy} onClick={() => setEditing(false)}>
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <>
          {closed ? (
            <span className="text-[13px] text-[var(--c-muted)]">
              Sygnał zamknięty ({STAGE_LABEL[lead.stage].toLowerCase()})
              {lead.stage === "PRZEGRANA" && lead.lostReason ? ` · ${LOST_REASON_LABEL[lead.lostReason as LostReasonKey]}${lead.lostNote ? ` — ${lead.lostNote}` : ""}` : ""}
            </span>
          ) : postponed ? (
            <span className="text-[13px] text-[#6B5B3E]">
              Odłożone do <b className="font-semibold">{lead.returnAt ? new Date(lead.returnAt).toLocaleDateString("pl-PL") : "—"}</b>
              {lead.postponeReason ? ` · ${POSTPONE_REASON_LABEL[lead.postponeReason as PostponeReasonKey] ?? lead.postponeReason}` : ""} — w dniu powrotu wraca do „Na dziś”.
            </span>
          ) : lead.nextActionAt ? (
            <span className="text-[13.5px] text-[#0C3450]">
              <b className="font-semibold">{NEXT_STEP_LABEL[(lead.nextStepType as NextStepType) ?? "INNE"] ?? lead.nextStepType}</b>
              {" · "}
              <b className={`font-semibold ${late ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>
                {new Date(lead.nextActionAt).toLocaleString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </b>
              {lead.nextStepNote && <span className="block whitespace-pre-line text-[13px] text-[#2A3540]">{lead.nextStepNote}</span>}
            </span>
          ) : (
            <span className="text-[13px] text-[#B8612F]">brak — ustaw termin</span>
          )}

          {(!readOnly && (open || canEditStep)) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {open && (
                <button type="button" className={ACTION_PRIMARY} onClick={onOutcome}>
                  Wynik rozmowy
                </button>
              )}
              {canEditStep && (
                <button type="button" className={ACTION} onClick={() => setEditing(true)}>
                  {lead.nextActionAt || lead.nextStepType ? "Edytuj krok" : "Ustaw krok"}
                </button>
              )}
              {!closed && (
                <button type="button" className={`${ACTION} ml-auto`} onClick={() => setTerm((v) => !v)} aria-expanded={term}>
                  Zmień termin ▾
                </button>
              )}
            </div>
          )}

          {term && !readOnly && !closed && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" className={DATE_INPUT} value={toDay(lead.nextActionAt)} disabled={busy} onChange={(e) => void onPatch({ nextActionAt: e.target.value || null }, "Ustawiono następny krok.")} />
              <button type="button" className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]" onClick={() => void onPatch({ nextActionAt: toDay(nextWorkday(new Date())) }, "Następny krok: jutro.")}>
                jutro
              </button>
              <button type="button" className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]" onClick={() => void onPatch({ nextActionAt: toDay(addWorkdays(new Date(), 3)) }, "Następny krok: za 3 dni robocze.")}>
                +3 dni rob.
              </button>
              {lead.nextActionAt && (
                <button type="button" className="ml-auto text-xs text-[var(--c-muted)] hover:text-[var(--c-red)]" onClick={() => void onPatch({ nextActionAt: null })}>
                  wyczyść
                </button>
              )}
              {!lead.firstContactAt && (
                <span className="w-full text-[12px] text-[var(--c-muted)]">
                  czas na kontakt {FIRST_CONTACT_SLA_HOURS} h rob. (czeka {workDurationLabel(workHoursBetween(new Date(lead.createdAt), new Date()))})
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
