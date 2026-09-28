"use client";

import { useEffect, useState } from "react";
import type { LeadStageKey } from "@/lib/leads/parse-deal";
import { fillScript, type Playbook } from "@/lib/leads/playbook";
import { STAGE_LABEL } from "@/lib/leads/labels";
import { api } from "@/components/clients/client-forms";

// Karta sygnału → „Podpowiedź” (zasady-wzor.html, ekran 2): skrypt dopasowany
// do etapu. Nowe: otwarcie, 6 pytań, zakończenie terminem, SMS po nieodebranym;
// W kontakcie: pytania + oferta; Oferta: follow-up 1 / 2 z wolnym terminem;
// Odłożone: co powiedzieć, gdy wracamy. Odhaczone pytania i zwinięcie —
// tylko w tej przeglądarce.

const BTN_SM = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
const BTN_SM_PRI = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[6px] border border-[#1B6FA8] bg-[#1B6FA8] px-[9px] text-[12px] text-white hover:bg-[#0C3450] disabled:opacity-40";

function Quote({ children }: { children: string }) {
  return <div className="my-1.5 border-l-[3px] border-[#2F7A68] bg-white px-2.5 py-1.5 text-[12.5px] text-[#2A3540]">{children}</div>;
}

type Draft = { to: string | null; subject: string; body: string; freeDates: string[] };

export function StageTip({
  leadId,
  stage,
  followUpNo,
  playbook,
  smsText,
  canAct,
  onSendSms,
}: {
  leadId: string;
  stage: LeadStageKey;
  followUpNo: number;
  playbook: Playbook;
  smsText: string | null; // szablon „lead_no_answer” z podstawionymi danymi; null = brak telefonu / szablonu
  canAct: boolean;
  onSendSms: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(true);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const key = `wl_tip_${leadId}`;

  useEffect(() => {
    try {
      /* eslint-disable react-hooks/set-state-in-effect -- localStorage dostępny dopiero w przeglądarce */
      setOpen(localStorage.getItem("wl_tip_open") !== "0");
      setChecked(JSON.parse(localStorage.getItem(key) ?? "[]"));
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // brak localStorage — domyślnie rozwinięta, nic nie odhaczone
    }
  }, [key]);

  // Wolny termin do skryptów follow-upu / powrotu.
  useEffect(() => {
    if (stage !== "OFERTA" && stage !== "ODLOZONE") return;
    let alive = true;
    void api<Draft>(`/api/leads/${leadId}/offer-draft`, "GET").then(({ ok, data }) => alive && ok && setDraft(data));
    return () => {
      alive = false;
    };
  }, [leadId, stage]);

  if (!["SYGNAL", "WYWIAD", "OFERTA", "ODLOZONE"].includes(stage)) return null;

  const toggleOpen = () => {
    setOpen((v) => {
      try {
        localStorage.setItem("wl_tip_open", v ? "0" : "1");
      } catch {
        // tylko do odświeżenia
      }
      return !v;
    });
  };
  const toggle = (i: number) =>
    setChecked((c) => {
      const n = [...c];
      n[i] = !n[i];
      try {
        localStorage.setItem(key, JSON.stringify(n));
      } catch {
        // tylko do odświeżenia
      }
      return n;
    });

  async function prepareOffer() {
    setBusy(true);
    const { ok, data } = await api<Draft>(`/api/leads/${leadId}/offer-draft`, "GET");
    setBusy(false);
    if (!ok) return;
    setDraft(data);
    window.location.href = `mailto:${data.to ?? ""}?subject=${encodeURIComponent(data.subject)}&body=${encodeURIComponent(data.body)}`;
  }

  const termin = draft?.freeDates[0] ?? null;
  const questions = (
    <>
      {playbook.questions.map((q, i) => (
        <label key={i} className="grid cursor-pointer grid-cols-[18px_1fr] gap-1.5 py-0.5 text-[12.5px]">
          <input type="checkbox" checked={Boolean(checked[i])} onChange={() => toggle(i)} className="mt-[3px] accent-[#2F7A68]" />
          <span className={checked[i] ? "text-[#5C6166] line-through" : ""}>{q}</span>
        </label>
      ))}
    </>
  );
  const offerBtn = canAct && (
    <button type="button" disabled={busy} className={BTN_SM} onClick={() => void prepareOffer()} title="Szkic maila: urządzenie, 2 wolne terminy z kalendarza, cena z transportem">
      {busy ? "Przygotowuję…" : "Przygotuj ofertę (szkic maila z wolnymi terminami)"}
    </button>
  );

  return (
    <div className="border border-[#CFE3DA] bg-[#F7FBF9] px-3 py-2.5 text-[12.5px]">
      <button type="button" onClick={toggleOpen} className="flex w-full items-center text-left">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#2F7A68]">Podpowiedź · etap {STAGE_LABEL[stage]}</span>
        <span className="ml-auto text-[12px] text-[#2F7A68]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-1.5">
          {stage === "SYGNAL" && (
            <>
              <div className="text-[#5C6166]">1. Zadzwoń teraz. Otwarcie:</div>
              <Quote>{playbook.scripts.newOpening}</Quote>
              <div className="text-[#5C6166]">2. Wywiad – {playbook.questions.length} pytań (odhacz w trakcie):</div>
              {questions}
              <div className="mt-1.5 text-[#5C6166]">3. Zakończ terminem: {playbook.scripts.newClosing}</div>
              {smsText && (
                <>
                  <div className="mt-1.5 text-[#5C6166]">Nie odebrała? → SMS jednym kliknięciem:</div>
                  <Quote>{smsText}</Quote>
                </>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {canAct && smsText && (
                  <button
                    type="button"
                    disabled={busy || sent}
                    className={BTN_SM_PRI}
                    onClick={async () => {
                      setBusy(true);
                      if (await onSendSms(smsText)) setSent(true);
                      setBusy(false);
                    }}
                  >
                    {sent ? "SMS wysłany ✓" : "Wyślij SMS z szablonu"}
                  </button>
                )}
                {offerBtn}
              </div>
            </>
          )}
          {stage === "WYWIAD" && (
            <>
              <div className="text-[#5C6166]">Wywiad – {playbook.questions.length} pytań:</div>
              {questions}
              <div className="mt-1.5 text-[#5C6166]">{playbook.scripts.contactOffer}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{offerBtn}</div>
            </>
          )}
          {stage === "OFERTA" && (
            <>
              <div className="text-[#5C6166]">{followUpNo >= 2 ? "Follow-up 2 (+7 dni rob.) — nowa wartość:" : "Follow-up 1 (+3 dni rob.) — trzymany termin:"}</div>
              <Quote>{fillScript(followUpNo >= 2 ? playbook.scripts.offerFollowUp2 : playbook.scripts.offerFollowUp1, { termin })}</Quote>
              <div className="text-[#5C6166]">Pytaj o wybór, nie o zgodę{draft && draft.freeDates.length === 2 ? `: „${draft.freeDates[0]} czy ${draft.freeDates[1]}?”` : "."} Nigdy samo „czy Pani się zastanowiła?”.</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{offerBtn}</div>
            </>
          )}
          {stage === "ODLOZONE" && (
            <>
              <div className="text-[#5C6166]">Gdy wracamy:</div>
              <Quote>{fillScript(playbook.scripts.postponedReturn, { termin })}</Quote>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{offerBtn}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
