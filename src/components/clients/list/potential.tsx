"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClientListRow } from "@/lib/clients/list-load";
import { DEVICE_INTEREST_LABEL } from "@/lib/clients/labels";
import { TYPE_LABEL } from "@/lib/leads/labels";
import { StageChip } from "@/components/leads/lead-ui";
import type { LeadStageKey, LeadTypeKey } from "@/lib/leads/parse-deal";
import { NEXT_STEP_LABEL, type NextStepType } from "@/lib/leads/funnel";
import { BASE_PATH } from "@/lib/base-path";
import { api } from "../client-forms";
import { dmSmart } from "./format";

// Klienci → Potencjalni (lejek, wzór lejek-wzor.html s4): bez własnych etapów —
// etap i następny krok pochodzą z otwartego sygnału (Sygnały → Tablica).
// Grupy: W lejku (otwarty sygnał) · Poza lejkiem · Archiwum 2025. Kontakt
// przechodzi do „Klientów” sam, po pierwszym wynajmie (status z historii).

export type Funnel = "IN" | "OUT" | "ARCHIVE";
export const FUNNELS: { key: Funnel; label: string }[] = [
  { key: "IN", label: "W lejku" },
  { key: "OUT", label: "Poza lejkiem" },
  { key: "ARCHIVE", label: "Archiwum 2025" },
];
export const LEAD_STAGES: LeadStageKey[] = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"];

export const isEmailName = (r: ClientListRow) => r.name.includes("@");

export function dataGaps(r: ClientListRow): string[] {
  const out: string[] = [];
  if (isEmailName(r)) out.push("nazwa = e-mail");
  if (r.primaryName && !r.primaryLastName && !isEmailName(r)) out.push("brak nazwiska");
  if (!r.hasPhone) out.push("bez telefonu");
  if (!r.city) out.push("miasto");
  if (!r.nip && r.lead?.stage === "OFERTA") out.push("brak NIP");
  return out;
}

// Liczby nad tabelą (W lejku + Poza lejkiem + Archiwum = wszyscy potencjalni).
export function potentialCounts(rows: ClientListRow[]) {
  const out = rows.filter((r) => r.funnel === "OUT");
  return {
    inFunnel: rows.filter((r) => r.funnel === "IN").length,
    out: out.length,
    outWithPhone: out.filter((r) => r.hasPhone).length,
    archive: rows.filter((r) => r.funnel === "ARCHIVE").length,
    emailName: rows.filter(isEmailName).length,
    noPhone: rows.filter((r) => !r.hasPhone).length,
  };
}

const GRID = "grid grid-cols-[minmax(190px,1.6fr)_minmax(90px,1fr)_130px_minmax(130px,1fr)_150px_minmax(140px,1.2fr)_110px] gap-x-3";
const NEW_TYPES: LeadTypeKey[] = ["TELEFON", "EMAIL", "OLX", "POLECENIE", "INNE"];
const TAG = "inline-block px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.1em]";

function NewLead({ r, onDone }: { r: ClientListRow; onDone: (text: string, error?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function create(type: LeadTypeKey) {
    setBusy(true);
    const { ok, data } = await api<{ id: string }>("/api/leads", "POST", { type, clientId: r.id });
    setBusy(false);
    setOpen(false);
    if (!ok) return onDone(data.message ?? "Nie udało się założyć sygnału.", true);
    onDone(`Założono sygnał dla ${r.shortName ?? r.name} — jest w Sygnałach (Na dziś / Do obdzwonienia).`);
  }
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="h-[26px] rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8]">
        + Sygnał
      </button>
      {open && (
        <span className="absolute right-0 top-7 z-10 flex w-[150px] flex-col border border-[#C9D3DC] bg-white py-1 text-left shadow-[0_4px_12px_rgba(12,52,80,0.12)]">
          <span className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Źródło</span>
          {NEW_TYPES.map((t) => (
            <button key={t} type="button" disabled={busy} onClick={() => void create(t)} className="px-2.5 py-1 text-left text-[12.5px] hover:bg-[#EAF4FB] disabled:opacity-40">
              {TYPE_LABEL[t]}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function PotentialTable({
  rows,
  total,
  onMore,
  today,
  canEdit,
  onChanged,
}: {
  rows: ClientListRow[];
  total: number;
  onMore: () => void;
  today: Date;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const done = (text: string, error?: boolean) => {
    setMsg({ text, error });
    if (!error) onChanged();
  };
  async function restore(leadId: string) {
    const { ok, data } = await api("/api/porzadki/archiwum/przywroc", "POST", { type: "lead", ids: [leadId] });
    done(ok ? "Przywrócono sygnał z archiwum 2025." : ((data as { message?: string }).message ?? "Nie udało się przywrócić."), !ok);
  }

  return (
    <div className="mx-4 overflow-x-auto border border-[#E4E7EA] bg-white md:mx-7">
      {msg && <p className={`px-3.5 py-2 text-[13px] ${msg.error ? "bg-[#FBF0E7] text-[#B8612F]" : "bg-[#EEF6F2] text-[#2F7A68]"}`}>{msg.text}</p>}
      <div className="min-w-[1060px]">
        <div className={`${GRID} border-b-[1.5px] border-[#0C3450] px-3.5 pb-1.5 pt-2.5 text-[10px] uppercase tracking-[0.1em] text-[#5C6166]`}>
          <span>Kontakt</span>
          <span>Pyta o</span>
          <span>Etap (z sygnału)</span>
          <span>Następny krok</span>
          <span>Ostatni kontakt</span>
          <span>Dane</span>
          <span className="text-right">Akcja</span>
        </div>
        {rows.length === 0 && <div className="px-3.5 py-10 text-center text-[13px] text-[#5C6166]">Nikt nie pasuje do tych filtrów.</div>}
        {rows.map((r) => {
          const gaps = dataGaps(r);
          const sub = isEmailName(r)
            ? "nazwa do ustalenia"
            : [r.primaryName && r.primaryName !== r.name ? r.primaryName : null, r.city].filter(Boolean).join(" · ") || "—";
          const asks = r.lead?.interests.length ? r.lead.interests.map((k) => DEVICE_INTEREST_LABEL[k]).join(", ") : r.devices.length ? r.devices.map((k) => DEVICE_INTEREST_LABEL[k]).join(", ") : null;
          const last = r.lastContactAt ?? r.lead?.at ?? null;
          const channel = r.lastContactAt ? r.lastContactChannel : r.lead ? "formularz" : null;
          const next = r.funnel === "IN" && r.lead ? r.lead : null;
          const late = next?.nextActionAt ? new Date(next.nextActionAt) < today : false;
          const isToday = next?.nextActionAt ? new Date(next.nextActionAt).toDateString() === today.toDateString() : false;
          return (
            <div key={r.id} className={`${GRID} items-center border-b border-[#F0F1F2] px-3.5 py-2`}>
              <div className="flex min-w-0 flex-col">
                <Link href={`/klienci/${r.id}`} className="truncate font-semibold text-[#0C3450] hover:text-[#1B6FA8]">
                  {r.shortName ?? r.name}
                </Link>
                <span className="truncate text-[12px] text-[#5C6166]">{sub}</span>
              </div>
              <span className="truncate text-[12.5px]" title={asks ?? undefined}>
                {asks ? <span className="bg-[#EAF4FB] px-[7px] py-px text-[11.5px] text-[#0C3450]">{asks}</span> : <span className="text-[#5C6166]">—</span>}
              </span>
              <span>
                {r.funnel === "IN" && r.lead ? (
                  <StageChip stage={r.lead.stage as LeadStageKey} />
                ) : r.funnel === "ARCHIVE" ? (
                  <span className={`${TAG} bg-[#EEF0F2] text-[#5C6166]`}>Archiwum 2025</span>
                ) : (
                  <span className="text-[12px] text-[#B8612F]">poza lejkiem{r.lead?.stage === "PRZEGRANA" ? " (przegrana)" : ""}</span>
                )}
              </span>
              <span className={`text-[12px] tabular-nums ${late ? "font-semibold text-[#B8612F]" : isToday ? "font-semibold text-[#1B6FA8]" : "text-[#5C6166]"}`}>
                {next
                  ? next.nextActionAt
                    ? `${late ? "zaległe" : isToday ? "dziś" : dmSmart(next.nextActionAt, today)}: ${next.nextStepNote ?? NEXT_STEP_LABEL[(next.nextStepType as NextStepType) ?? "INNE"]}`
                    : next.stage === "REZERWACJA"
                      ? "powiąż wynajem"
                      : "brak kroku"
                  : r.funnel === "ARCHIVE"
                    ? "kampania przed sezonem"
                    : "—"}
              </span>
              <span className="text-[12px] tabular-nums text-[#5C6166]">{last ? `${dmSmart(last, today)}${channel ? ` · ${channel}` : ""}` : "—"}</span>
              <div className="flex flex-wrap gap-1">
                {gaps.length ? (
                  gaps.map((g) => (
                    <span key={g} className={`${TAG} border border-[#E6CDB8] bg-[#FBF0E7] text-[#B8612F]`}>
                      {g}
                    </span>
                  ))
                ) : (
                  <span className="text-[12px] text-[#5C6166]">komplet</span>
                )}
              </div>
              <span className="flex justify-end">
                {r.funnel === "IN" && r.lead ? (
                  <a href={`${BASE_PATH}/sygnaly?id=${r.lead.id}`} className="h-[26px] rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] py-[3px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8]">
                    Otwórz
                  </a>
                ) : r.funnel === "ARCHIVE" && r.archivedLeadId && canEdit ? (
                  <button type="button" onClick={() => void restore(r.archivedLeadId!)} className="h-[26px] rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8]">
                    Przywróć
                  </button>
                ) : canEdit ? (
                  <NewLead r={r} onDone={done} />
                ) : r.primaryPhone ? (
                  <a href={`tel:${r.primaryPhone}`} className="text-[12px] text-[#1B6FA8]">
                    Zadzwoń
                  </a>
                ) : null}
              </span>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3 text-[12.5px] text-[#5C6166]">
          <span>
            Pokazano {rows.length} z {total}
            {rows.length < total && (
              <>
                {" "}
                <span className="text-[#C3C4C7]">·</span>{" "}
                <button type="button" onClick={onMore} className="text-[#1B6FA8] hover:text-[#0C3450]">
                  Załaduj kolejne 50
                </button>
              </>
            )}
          </span>
          <span>Etap i następny krok — z sygnału (Sygnały → Tablica). Kontakt przechodzi do „Klientów” po pierwszym wynajmie.</span>
        </div>
      </div>
    </div>
  );
}
