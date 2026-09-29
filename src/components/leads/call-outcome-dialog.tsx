"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LeadDetail } from "@/lib/leads/load";
import { LOST_REASON_LABEL, LOST_REASON_PICK, POSTPONE_REASON_KEYS, POSTPONE_REASON_LABEL, type LostReasonKey, type PostponeReasonKey } from "@/lib/leads/labels";
import { RESIGN_REASON_KEYS, RESIGN_REASON_LABEL, type ResignReasonKey } from "@/lib/clients/labels";
import { NO_ANSWER_LIMIT } from "@/lib/leads/funnel";
import { applySmsPlaceholders } from "@/lib/sms-template";
import { INPUT, api } from "@/components/clients/client-forms";
import { RentalPicker } from "./rental-picker";
import type { RentalCandidate } from "@/lib/leads/rental-candidates";

// „Wynik rozmowy” (wniosek 24): krótka notatka, kanał i jeden wybór — panel
// sam ustawia etap, krok, rezerwację i stan klienta. Każdy wynik zapisuje
// kontakt (data, kto, kanał) i notatkę na osi czasu sygnału (widoczną też
// na karcie klienta). Tylko ADMIN/STAFF — agent zgłasza propozycje.

export type OutcomeLead = {
  id: string;
  stage: string;
  attempts: number;
  followUpNo: number;
  nextStepType: string | null;
  phone: string | null;
  clientId: string | null;
  clientName: string | null;
  requestedFrom: string | null;
};

type Choice = "booked" | "no_answer" | "callback" | "later" | "offer" | "resign";
const CHOICES: { key: Choice; label: string; hint: string }[] = [
  { key: "booked", label: "Umówiła termin", hint: "nowa albo zapisana rezerwacja → etap Rezerwacja" },
  { key: "no_answer", label: "Nie odebrała", hint: "próba +1, ponowienie jutro o innej porze" },
  { key: "callback", label: "Oddzwoni / przemyśli", hint: "krok z datą" },
  { key: "later", label: "Urlop / później", hint: "zostaje „W kontakcie” z krokiem na datę" },
  { key: "offer", label: "Wysłać ofertę", hint: "Oferta wysłana, follow-up za 3 dni rob." },
  { key: "resign", label: "Rezygnuje", hint: "Przegrana z powodem i klient „Zrezygnował”" },
];
const CHANNELS = [
  ["telefon", "Telefon"],
  ["sms", "SMS"],
  ["mail", "Mail"],
] as const;

const DATE_INPUT = "h-8 rounded-[6px] border border-[#C9D3DC] bg-white px-2 text-[13px]";
const BTN = "inline-flex h-8 items-center rounded-[6px] border border-[#C9D3DC] bg-white px-3 text-[13px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
const BTN_PRIMARY = "inline-flex h-8 items-center rounded-[6px] bg-[#1B6FA8] px-3 text-[13px] font-semibold text-white hover:bg-[#0C3450] disabled:opacity-40";
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plusDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const RESIGN_TO_LOST: Partial<Record<ResignReasonKey, LostReasonKey>> = { KUPILA_URZADZENIE: "KUPILA_URZADZENIE", CENA: "CENA" };

export function CallOutcomeDialog({
  lead,
  onClose,
  onDone,
  initialChoice,
  initialPostpone = false,
}: {
  lead: OutcomeLead;
  onClose: () => void;
  onDone: (detail: LeadDetail | null) => void;
  // „Odłóż do…” z Tablicy albo paska etapów: od razu „Urlop / później” z odłożeniem.
  initialChoice?: Choice;
  initialPostpone?: boolean;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice | null>(initialChoice ?? null);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number][0]>("telefon");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => (initialChoice === "later" ? plusDays(14) : initialChoice === "callback" ? plusDays(3) : ""));
  const [kind, setKind] = useState<"ODDZWONI" | "DOPYTAC">("ODDZWONI");
  const [postpone, setPostpone] = useState(initialPostpone);
  const [postponeReason, setPostponeReason] = useState<PostponeReasonKey | "">("");
  const [lostReason, setLostReason] = useState<LostReasonKey>("INNE");
  const [resignReason, setResignReason] = useState<ResignReasonKey>("INNE");
  const [recontact, setRecontact] = useState("");
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<RentalCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tpl, setTpl] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    void api<{ templates: { key: string; body: string }[] }>("/api/message-templates", "GET").then(({ ok, data }) => ok && setTpl(data.templates?.find((t) => t.key === "lead_no_answer")?.body ?? null));
  }, []);
  useEffect(() => {
    if (!picking || candidates) return;
    void api<{ candidates: RentalCandidate[] }>(`/api/leads/${lead.id}/rental-candidates`, "GET").then(({ ok, data }) => setCandidates(ok ? (data.candidates ?? []) : []));
  }, [picking, candidates, lead.id]);

  async function post(body: Record<string, unknown>): Promise<LeadDetail | null> {
    const { ok, data } = await api<LeadDetail>(`/api/leads/${lead.id}/activity`, "POST", { channel, ...body });
    if (!ok) {
      setError(data.message ?? "Nie udało się zapisać.");
      return null;
    }
    return data;
  }
  async function finish(detail: LeadDetail | null) {
    setBusy(false);
    if (detail) onDone(detail);
  }

  const followUp = lead.nextStepType === "FOLLOW_UP_OFERTY" && lead.followUpNo === 1;
  const nextTry = lead.attempts === 0 ? "jutro 16:00" : lead.attempts === 1 ? "jutro 8:30" : "jutro 10:00";
  const text = note.trim();

  async function save() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    if (choice === "no_answer") {
      const d = await post({ outcome: "no_answer", body: text || null });
      if (d && !followUp && lead.phone && tpl) await api(`/api/leads/${lead.id}/sms`, "POST", { phone: lead.phone, message: applySmsPlaceholders(tpl, { clientName: lead.clientName }) });
      return finish(d);
    }
    if (choice === "callback") {
      if (!date) return (setBusy(false), setError("Wybierz datę."));
      return finish(kind === "ODDZWONI" ? await post({ outcome: "callback", body: text || null, nextActionAt: date }) : await post({ outcome: "talked", body: text || null, nextActionAt: date, stepType: "DOPYTAC" }));
    }
    if (choice === "later") {
      if (!date) return (setBusy(false), setError("Wybierz datę kontaktu."));
      if (postpone) {
        if (!postponeReason) return (setBusy(false), setError("Wybierz powód odłożenia."));
        return finish(await post({ outcome: "postpone", body: text || null, nextActionAt: date, postponeReason }));
      }
      const step = lead.nextStepType === "UMOW_TERMIN" ? "UMOW_TERMIN" : "DOPYTAC";
      return finish(await post({ outcome: "talked", body: text || "później — kontakt w wybranym terminie", nextActionAt: date, stepType: step }));
    }
    if (choice === "offer") return finish(await post({ outcome: "offer_sent", body: text || null }));
    if (choice === "resign") {
      const d = await post({ outcome: "talked", body: text || `rezygnuje: ${RESIGN_REASON_LABEL[resignReason]}` });
      if (!d) return setBusy(false);
      const lostNote = text || RESIGN_REASON_LABEL[resignReason];
      const lost = await api<LeadDetail>(`/api/leads/${lead.id}`, "PATCH", { stage: "PRZEGRANA", lostReason, lostNote });
      if (!lost.ok) return (setBusy(false), setError(lost.data.message ?? "Nie udało się ustawić przegranej."));
      if (lead.clientId) {
        const r = await api(`/api/clients/${lead.clientId}/resign`, "POST", { reason: resignReason, note: text || null, recontactAt: recontact || null });
        if (!r.ok) return (setBusy(false), setError((r.data as { message?: string }).message ?? "Nie udało się ustawić „Zrezygnował”."));
      }
      return finish(lost.data);
    }
  }

  async function bookNew() {
    setBusy(true);
    const d = await post({ outcome: "talked", body: text || "umówiła termin" });
    setBusy(false);
    if (!d) return;
    onDone(d);
    router.push(`/kalendarz/wynajem/nowy?${new URLSearchParams({ ...(lead.requestedFrom ? { date: lead.requestedFrom.slice(0, 10) } : {}), sygnal: lead.id }).toString()}`);
  }
  async function bookExisting(rentalId: string) {
    setBusy(true);
    const d = await post({ outcome: "talked", body: text || "umówiła termin" });
    if (!d) return setBusy(false);
    const linked = await api<LeadDetail>(`/api/leads/${lead.id}`, "PATCH", { rentalId });
    if (!linked.ok) return (setBusy(false), setError(linked.data.message ?? "Nie udało się powiązać rezerwacji."));
    return finish(linked.data);
  }

  return (
    <div data-lead-modal className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Wynik rozmowy" className="flex w-full max-w-[520px] flex-col gap-3 rounded-[12px] bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h3 className="m-0 flex-1 text-[16px] font-semibold text-[#0C3450]">Wynik rozmowy{lead.clientName ? ` — ${lead.clientName}` : ""}</h3>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="text-[16px] text-[#5C6166] hover:text-[#0C3450]">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="text-[#5C6166]">Kanał:</span>
          {CHANNELS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setChannel(k)} className={`rounded-full border px-2.5 py-[2px] ${channel === k ? "border-[#0C3450] bg-[#0C3450] text-white" : "border-[#C9D3DC] hover:border-[#0C3450]"}`}>
              {l}
            </button>
          ))}
        </div>
        <textarea rows={2} className={`${INPUT} h-auto py-2`} placeholder="Krótka notatka (co ustaliłaś)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="grid grid-cols-2 gap-1.5">
          {CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setChoice(c.key);
                setError(null);
                if (c.key === "callback" && !date) setDate(plusDays(3));
                if (c.key === "later" && !date) setDate(plusDays(14));
              }}
              className={`flex flex-col rounded-[8px] border px-3 py-2 text-left ${choice === c.key ? "border-[#1B6FA8] bg-[#EAF4FB]" : "border-[#E3E6E9] hover:border-[#1B6FA8]"} ${c.key === "resign" ? "text-[#B8612F]" : "text-[#0C3450]"}`}
            >
              <b className="text-[13.5px] font-semibold">{c.label}</b>
              <span className="text-[11.5px] text-[#5C6166]">{c.key === "no_answer" && !followUp ? `próba ${lead.attempts + 1}, ponowienie ${nextTry}${lead.phone && tpl ? " + SMS" : ""}` : c.hint}</span>
            </button>
          ))}
        </div>

        {choice === "booked" && (
          <div className="flex flex-col gap-2 rounded-[8px] bg-[#F4F6F8] p-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={BTN_PRIMARY} onClick={() => void bookNew()}>
                Nowa rezerwacja →
              </button>
              <button type="button" disabled={busy} className={BTN} onClick={() => setPicking((v) => !v)}>
                Wybierz zapisaną
              </button>
            </div>
            {picking && (candidates ? <RentalPicker leadId={lead.id} initial={candidates} busy={busy} onPick={(id) => void bookExisting(id)} /> : <span className="text-[12px] text-[#5C6166]">Wczytywanie…</span>)}
            <span className="text-[11.5px] text-[#5C6166]">Rezerwacja z lejka liczy się do celu sezonu.</span>
          </div>
        )}
        {choice === "no_answer" && lead.attempts + 1 >= NO_ANSWER_LIMIT && !followUp && (
          <p className="text-[12.5px] text-[#B8612F]">To już {lead.attempts + 1}. próba — po zapisie rozważ „Przegrana – brak kontaktu” (baner w karcie).</p>
        )}
        {choice === "callback" && (
          <div className="flex flex-wrap items-center gap-2">
            {(["ODDZWONI", "DOPYTAC"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-2.5 py-[2px] text-[12.5px] ${kind === k ? "border-[#0C3450] bg-[#0C3450] text-white" : "border-[#C9D3DC]"}`}>
                {k === "ODDZWONI" ? "Oddzwoni" : "Przemyśli — dopytać"}
              </button>
            ))}
            <input type="date" className={DATE_INPUT} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Termin" />
            <button type="button" className="text-[12.5px] text-[#1B6FA8] hover:underline" onClick={() => setDate(plusDays(3))}>
              +3 dni
            </button>
            <button type="button" className="text-[12.5px] text-[#1B6FA8] hover:underline" onClick={() => setDate(plusDays(7))}>
              +1 tydz.
            </button>
          </div>
        )}
        {choice === "later" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-[#5C6166]">Kontakt:</span>
              <input type="date" className={DATE_INPUT} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Data kontaktu" />
              <button type="button" className="text-[12.5px] text-[#1B6FA8] hover:underline" onClick={() => setDate(plusDays(7))}>
                +1 tydz.
              </button>
              <button type="button" className="text-[12.5px] text-[#1B6FA8] hover:underline" onClick={() => setDate(plusDays(14))}>
                +2 tyg.
              </button>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-[#5C6166]">
              <input type="checkbox" checked={postpone} onChange={(e) => setPostpone(e.target.checked)} />
              Dłuższa przerwa — „Odłóż do…” (etap Odłożone)
            </label>
            {postpone && (
              <select className={`${INPUT} h-8 w-auto`} value={postponeReason} onChange={(e) => setPostponeReason(e.target.value as PostponeReasonKey | "")} aria-label="Powód odłożenia">
                <option value="">— powód —</option>
                {POSTPONE_REASON_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {POSTPONE_REASON_LABEL[k]}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {choice === "resign" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[12px] text-[#5C6166]">
              Powód rezygnacji (klient)
              <select className={`${INPUT} h-8`} value={resignReason} onChange={(e) => {
                const r = e.target.value as ResignReasonKey;
                setResignReason(r);
                setLostReason(RESIGN_TO_LOST[r] ?? "INNE");
              }}>
                {RESIGN_REASON_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {RESIGN_REASON_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-[#5C6166]">
              Powód przegranej (sygnał)
              <select className={`${INPUT} h-8`} value={lostReason} onChange={(e) => setLostReason(e.target.value as LostReasonKey)}>
                {LOST_REASON_PICK.map((k) => (
                  <option key={k} value={k}>
                    {LOST_REASON_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-[#5C6166] sm:col-span-2">
              Ponowny kontakt (opcjonalnie, np. przed sezonem)
              <input type="date" className={DATE_INPUT} value={recontact} onChange={(e) => setRecontact(e.target.value)} />
            </label>
            {!lead.clientId && <span className="text-[11.5px] text-[#B8612F] sm:col-span-2">Sygnał bez klienta — tylko przegrana (bez stanu „Zrezygnował”).</span>}
          </div>
        )}

        {error && <p className="text-[12.5px] text-[#B8612F]">{error}</p>}
        {choice && choice !== "booked" && (
          <div className="flex justify-end gap-2">
            <button type="button" className={BTN} onClick={onClose}>
              Anuluj
            </button>
            <button type="button" disabled={busy} className={BTN_PRIMARY} onClick={() => void save()}>
              Zapisz wynik
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
