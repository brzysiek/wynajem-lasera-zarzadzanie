"use client";

import { useEffect, useState } from "react";
import type { LeadStageKey } from "@/lib/leads/parse-deal";
import { fillScript, type Playbook } from "@/lib/leads/playbook";
import { STAGE_LABEL } from "@/lib/leads/labels";
import { api } from "@/components/clients/client-forms";
import { LEAD_CARD_CHANNEL_ACTIONS } from "@/lib/leads/channel-actions";
import { buildBureauPrompt, bureauDescription, type BureauInput, type BureauKind } from "@/lib/leads/bureau-prompt";

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

// „Kopiuj prompt dla BIURO” (wniosek 47, część 3/3): kopiuje gotowy prompt do
// schowka; treści promptu nie pokazujemy (ani podglądu, ani tooltipa).
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function BureauAction({ kind, bureau }: { kind: BureauKind; bureau: BureauInput }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  return (
    <div className="mt-1.5 flex flex-col items-start gap-1">
      <div className="text-[#2A3540]">{bureauDescription(kind, bureau)}</div>
      <button
        type="button"
        className={BTN_SM_PRI}
        onClick={async () => {
          const ok = await copyText(buildBureauPrompt(kind, bureau));
          setState(ok ? "done" : "error");
          setTimeout(() => setState("idle"), 2000);
        }}
      >
        {state === "done" ? "Skopiowano ✓" : state === "error" ? "Nie udało się skopiować" : "Kopiuj prompt dla BIURO"}
      </button>
    </div>
  );
}

type Draft = { to: string | null; subject: string; body: string; freeDates: string[]; freeByDevice?: { device: string; dates: string[] }[] };

export function StageTip({
  leadId,
  stage,
  followUpNo,
  playbook,
  smsText,
  canAct,
  bureau,
  onPrepareOffer,
  onSendSms,
}: {
  leadId: string;
  stage: LeadStageKey;
  followUpNo: number;
  playbook: Playbook;
  smsText: string | null; // szablon „lead_no_answer” z podstawionymi danymi; null = brak telefonu / szablonu
  canAct: boolean;
  // Dane biznesowe sygnału do promptu dla BIURO (bez treści maili klientki).
  bureau: BureauInput;
  // Tylko przy włączonej fladze LEAD_CARD_CHANNEL_ACTIONS (stary widok).
  onPrepareOffer?: () => void;
  onSendSms?: (text: string) => Promise<boolean>;
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

  // Wniosek 47: jedna droga do maila — „Przygotuj ofertę” zakłada szkic z tekstem
  // oferty w sekcji „Odpowiedź mailowa” (bez mailto:).
  function prepareOffer() {
    onPrepareOffer?.();
  }
  const legacy = LEAD_CARD_CHANNEL_ACTIONS;

  // Przegląd 29.09 07:15, pkt 8: 2 najbliższe wolne terminy urządzenia; bez
  // urządzenia — „[wybierz termin]” i wolne terminy każdego urządzenia niżej.
  const termin = draft?.freeDates.length ? draft.freeDates.slice(0, 2).join(" albo ") : draft ? "[wybierz termin]" : null;
  const byDevice = !draft?.freeDates.length && draft?.freeByDevice?.length ? (
    <div className="text-[12px] text-[#5C6166]">Wolne w kalendarzu: {draft.freeByDevice.map((x) => `${x.device} ${x.dates.join(", ")}`).join(" · ")}</div>
  ) : null;
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
  const offerBtn = canAct && legacy && (
    <button type="button" disabled={busy} className={BTN_SM} onClick={prepareOffer} title="Szkic odpowiedzi z ofertą: urządzenie, 2 wolne terminy z kalendarza, cena z transportem">
      {busy ? "Przygotowuję…" : "Przygotuj ofertę (szkic maila z wolnymi terminami)"}
    </button>
  );
  const bureauMail = (kind: BureauKind) => canAct && !legacy && <BureauAction kind={kind} bureau={bureau} />;

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
                  <div className="mt-1.5 text-[#5C6166]">{legacy ? "Nie odebrała? → SMS jednym kliknięciem:" : "Nie odebrała? → SMS (tekst z szablonu):"}</div>
                  <Quote>{smsText}</Quote>
                </>
              )}
              {canAct && smsText && !legacy && <BureauAction kind="SMS_NIEODEBRANY" bureau={bureau} />}
              {bureauMail("OFERTA_MAIL")}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {canAct && legacy && smsText && onSendSms && (
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
              {bureauMail("OFERTA_MAIL")}
              <div className="mt-1.5 flex flex-wrap gap-1.5">{offerBtn}</div>
            </>
          )}
          {stage === "OFERTA" && (
            <>
              <div className="text-[#5C6166]">{followUpNo >= 2 ? "Follow-up 2 (+7 dni rob.) — nowa wartość:" : "Follow-up 1 (+3 dni rob.) — trzymany termin:"}</div>
              <Quote>{fillScript(followUpNo >= 2 ? playbook.scripts.offerFollowUp2 : playbook.scripts.offerFollowUp1, { termin })}</Quote>
              {byDevice}
              <div className="text-[#5C6166]">Pytaj o wybór, nie o zgodę{draft && draft.freeDates.length === 2 ? `: „${draft.freeDates[0]} czy ${draft.freeDates[1]}?”` : "."} Nigdy samo „czy Pani się zastanowiła?”.</div>
              {bureauMail("FOLLOW_UP_MAIL")}
              <div className="mt-1.5 flex flex-wrap gap-1.5">{offerBtn}</div>
            </>
          )}
          {stage === "ODLOZONE" && (
            <>
              <div className="text-[#5C6166]">Gdy wracamy:</div>
              <Quote>{fillScript(playbook.scripts.postponedReturn, { termin })}</Quote>
              {byDevice}
              {bureauMail("POWROT_MAIL")}
              <div className="mt-1.5 flex flex-wrap gap-1.5">{offerBtn}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
