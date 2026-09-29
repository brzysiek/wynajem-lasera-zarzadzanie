"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LeadDetail } from "@/lib/leads/load";
import { ACTIVITY_LABEL, LOST_REASON_LABEL, POSTPONE_REASON_LABEL, STAGE_LABEL, TYPE_LABEL, type ActivityTypeKey, type LostReasonKey, type PostponeReasonKey } from "@/lib/leads/labels";
import { FIRST_CONTACT_SLA_HOURS, NEXT_STEP_LABEL, NO_ANSWER_LIMIT, OPEN_STAGES, ROT_DAYS_OFFER, ROT_WORK_DAYS_CONTACT, funnelFromRow, rotInfo, workDurationLabel, type FunnelLead, type NextStepType } from "@/lib/leads/funnel";
import { workHoursBetween } from "@/lib/leads/work-time";
import { LEAD_DEVICE_LABEL, type LeadStageKey } from "@/lib/leads/parse-deal";
import { DEVICE_INTEREST_KEYS, formatPhone, type DeviceInterestKey } from "@/lib/clients/labels";
import { addWorkdays, nextWorkday } from "@/lib/leads/work-time";
import { applySmsPlaceholders } from "@/lib/sms-template";
import { INPUT, api } from "@/components/clients/client-forms";
import { CalendarPlusIcon, PencilIcon, PhoneIcon, SmsIcon, StatusChip, fmtAgo, fmtDate } from "@/components/clients/ui";
import { EmailViewer } from "@/components/clients/email-viewer";
import { ArchiveDialog } from "@/components/porzadki/archive-dialog";
import { BTN, BTN_PRIMARY, LostDialog } from "./lead-dialogs";
import { StageChip, TaskIcon, fmtRange, fmtWhen } from "./lead-ui";
import { Dots } from "./funnel-views";
import { StageTip } from "./stage-tip";
import { RentalPicker } from "./rental-picker";
import { OpenTasks } from "@/components/open-tasks";
import { CallOutcomeDialog } from "./call-outcome-dialog";
import type { Playbook } from "@/lib/leads/playbook";

// Karta sygnału (prompt 2, 3.3) — panel boczny z każdego widoku. Szybkie
// akcje na górze, zawsze widoczne; pod nimi następny krok, rezerwacja, dane
// z formularza i oś czasu (sygnał + inne aktywności tego klienta).

export type CardIntent = "call" | "sms" | "postpone" | "link" | null;
type Panel = "sms" | "note" | "task" | null;
type Template = { id: string; key: string; label: string; body: string };

const LABEL = "flex flex-col gap-1 text-xs font-medium text-[var(--c-muted)]";
// INPUT bez w-full — do pól daty o stałej szerokości w jednym wierszu z tekstem.
const DATE_INPUT = `${INPUT.replace("w-full", "")} h-8 w-[150px]`;
const toDay = (d: Date | string | null) => {
  if (!d) return "";
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

const ACTIVITY_TONE: Record<ActivityTypeKey, { bg: string; fg: string; mark: string }> = {
  CALL: { bg: "var(--c-green-soft)", fg: "var(--c-green-deep)", mark: "R" },
  CALL_NO_ANSWER: { bg: "var(--c-purple-soft)", fg: "var(--c-purple-deep)", mark: "✕" },
  SMS: { bg: "var(--c-brand-soft)", fg: "var(--c-brand-deep)", mark: "S" },
  EMAIL: { bg: "var(--c-gold-soft)", fg: "var(--c-gold-deep)", mark: "M" },
  NOTE: { bg: "var(--c-accent-soft)", fg: "var(--c-accent-deep)", mark: "N" },
  STAGE_CHANGE: { bg: "var(--c-bg)", fg: "var(--c-sidebar-text)", mark: "→" },
  SYSTEM: { bg: "var(--c-bg)", fg: "var(--c-muted)", mark: "•" },
};

function Section({ title, action, children, id }: { title: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} className="flex scroll-mt-4 flex-col gap-2">
      <div className="flex items-center">
        <h3 className="m-0 flex-grow text-sm font-semibold text-[var(--c-navy)]">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function LeadCard({
  leadId,
  users,
  intent,
  onClose,
  onChanged,
  onOutcome,
  agent = false,
  canArchive = false,
  playbook = null,
}: {
  leadId: string;
  users: { id: string; name: string }[];
  intent: CardIntent;
  onClose: () => void;
  onChanged: () => void;
  // Zapisany wynik kontaktu — tryb seryjny „Do obdzwonienia” przechodzi dalej.
  onOutcome?: () => void;
  // Rola AGENT: tylko notatka, zadanie i „Przenieś do klientów” — bez
  // telefonu, SMS, etapów, rezerwacji i edycji zgłoszenia (API tak samo).
  agent?: boolean;
  // ADMIN: „Archiwizuj” / „Przywróć” (Porządki → Archiwum).
  canArchive?: boolean;
  // Złote zasady: podpowiedź dla etapu (skrypty, pytania, szkic oferty).
  playbook?: Playbook | null;
}) {
  const [d, setD] = useState<LeadDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(intent === "sms" && !agent ? "sms" : null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [lost, setLost] = useState<false | { preset?: LostReasonKey }>(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [emailIds, setEmailIds] = useState<string[] | null>(null);
  const [archiving, setArchiving] = useState(false);
  // Wniosek 24/27: okno „Wynik rozmowy” (postpone = „Odłóż do…” z Tablicy),
  // „Zmień termin”, „Powiąż z wynajmem”, podpowiedź zwinięta do żarówki.
  const [outcome, setOutcome] = useState<false | true | "postpone">(!agent && (intent === "call" || intent === "postpone") ? (intent === "postpone" ? "postpone" : true) : false);
  const [reschedule, setReschedule] = useState(false);
  const [linking, setLinking] = useState(intent === "link");
  const [tipOpen, setTipOpen] = useState<boolean | null>(null);
  const [freeDates, setFreeDates] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    void api<LeadDetail>(`/api/leads/${leadId}`, "GET").then(({ ok, data }) => {
      if (!alive) return;
      if (ok) setD(data);
      else setLoadError(data.message ?? "Nie udało się wczytać sygnału.");
    });
    void api<{ templates: Template[] }>("/api/message-templates", "GET").then(({ ok, data }) => alive && ok && setTemplates(data.templates ?? []));
    return () => {
      alive = false;
    };
  }, [leadId]);

  // „Czego chce”: wolne terminy z kalendarza (ten sam szkic co „Szkic maila”).
  const [draft, setDraft] = useState<{ to: string | null; subject: string; body: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void api<{ to: string | null; subject: string; body: string; freeDates: string[] }>(`/api/leads/${leadId}/offer-draft`, "GET").then(({ ok, data }) => {
      if (!alive || !ok) return;
      setFreeDates(data.freeDates ?? []);
      setDraft({ to: data.to, subject: data.subject, body: data.body });
    });
    return () => {
      alive = false;
    };
  }, [leadId]);

  // „Powiąż z wynajmem” z listy / Tablicy — od razu do listy kandydatów.
  const loadedId = d?.id;
  useEffect(() => {
    if (intent === "link" && loadedId) document.getElementById("lead-rental-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [intent, loadedId]);

  useEffect(() => {
    if (!toast || toast.error) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Każda akcja zwraca świeży stan karty; lista odświeża się w tle.
  async function run(path: string, method: string, body: unknown, success: string): Promise<boolean> {
    setBusy(true);
    const { ok, data } = await api<LeadDetail>(path, method, body);
    setBusy(false);
    if (!ok) {
      setToast({ text: data.message ?? "Nie udało się zapisać.", error: true });
      return false;
    }
    setD(data);
    setToast({ text: success });
    onChanged();
    return true;
  }
  const patch = (body: Record<string, unknown>, success = "Zapisano.") => run(`/api/leads/${leadId}`, "PATCH", body, success);

  // „Przenieś do klientów” (kwalifikacja kontaktu z zapytania) — potem
  // świeży stan karty sygnału.
  async function qualify() {
    if (!d?.clientId) return;
    setBusy(true);
    const res = await api(`/api/clients/${d.clientId}/qualification`, "POST", { action: "qualify" });
    setBusy(false);
    if (!res.ok) {
      setToast({ text: (res.data as { message?: string }).message ?? "Nie udało się.", error: true });
      return;
    }
    const fresh = await api<LeadDetail>(`/api/leads/${leadId}`, "GET");
    if (fresh.ok) setD(fresh.data);
    setToast({ text: "Przeniesiono do klientów (Potencjalny)." });
    onChanged();
  }

  if (loadError) return <div className="p-6 text-sm text-[var(--c-red)]">{loadError}</div>;
  if (!d) return <div className="p-6 text-sm text-[var(--c-muted)]">Wczytywanie…</div>;

  const phone = d.phone;
  const noAnswerTpl = templates.find((t) => t.key === "lead_no_answer");
  const returning = d.clientStatus === "STALY" || d.clientStatus === "USPIONY";
  const open = OPEN_STAGES.includes(d.stage) || d.stage === "ODLOZONE";
  const activities = showAll ? d.activities : d.activities.slice(0, 3);
  const ci = d.clientInfo;
  // Wniosek 27 D: urządzenie z historii klientki, gdy sygnał go nie ma.
  const devices = d.devices.length ? d.devices : ci?.lastInterest ? [ci.lastInterest] : [];
  const lastOffer = d.activities.find((a) => /ofert/i.test(a.body ?? "") && (a.type === "EMAIL" || a.type === "CALL" || a.type === "STAGE_CHANGE"));
  const ACTION = "inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[#C9D3DC] bg-white px-2.5 text-[12.5px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
  const ACTION_PRIMARY = "inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[#1B6FA8] px-3 text-[12.5px] font-semibold text-white hover:bg-[#0C3450]";
  const outcomeLead = { id: d.id, stage: d.stage, attempts: d.attempts, followUpNo: d.followUpNo, nextStepType: d.nextStepType, phone, clientId: d.clientId, clientName: d.clientName ?? d.person, requestedFrom: d.requestedFrom };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* 1. Nagłówek (wniosek 27 C): gabinet, status, telefon, e-mail, miejscowość i km, prowadzi */}
      <div className="flex flex-col gap-1.5 border-b border-[var(--c-border)] px-5 pb-3 pt-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-grow">
            {d.clientId ? (
              <Link href={`/klienci/${d.clientId}`} className="block text-lg font-semibold leading-tight text-[var(--c-navy)] [overflow-wrap:anywhere] hover:text-[var(--c-brand-deep)]">
                {d.clientName ?? d.title}
              </Link>
            ) : (
              <h2 className="m-0 text-lg font-semibold leading-tight text-[var(--c-navy)] [overflow-wrap:anywhere]">{d.person ?? d.title}</h2>
            )}
            {d.title !== d.clientName && <div className="truncate text-[12px] text-[var(--c-muted)]" title={d.title}>{d.title}</div>}
          </div>
          {canArchive && !d.archive && (
            <button type="button" onClick={() => setArchiving(true)} className="-mt-0.5 rounded-md px-1.5 py-1 text-xs text-[var(--c-muted)] hover:bg-[var(--c-red-soft)] hover:text-[var(--c-red)]">
              Archiwizuj
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Zamknij kartę" className="-mr-1 -mt-1 rounded-md p-1.5 text-[var(--c-muted)] hover:bg-[var(--c-bg)]">
            ✕
          </button>
        </div>
        {d.archive && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--c-red-soft)] px-3 py-2 text-[13px] text-[var(--c-red)]">
            <b className="font-semibold">W archiwum</b>
            {d.archive.note && <span>— {d.archive.note}</span>}
            {canArchive && (
              <button
                type="button"
                className="ml-auto font-semibold underline"
                onClick={async () => {
                  const res = await api("/api/porzadki/archiwum/przywroc", "POST", { type: "lead", ids: [leadId] });
                  if (!res.ok) return setToast({ text: (res.data as { message?: string }).message ?? "Nie udało się.", error: true });
                  const fresh = await api<LeadDetail>(`/api/leads/${leadId}`, "GET");
                  if (fresh.ok) setD(fresh.data);
                  onChanged();
                }}
              >
                Przywróć
              </button>
            )}
          </p>
        )}
        {archiving && (
          <ArchiveDialog
            type="lead"
            ids={[leadId]}
            label={d.title}
            onClose={() => setArchiving(false)}
            onDone={() => {
              setArchiving(false);
              onChanged();
              onClose();
            }}
          />
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span title={stageAgeText(d)}>
            <StageChip stage={d.stage} />
          </span>
          {d.clientId && !d.clientQualified ? (
            <>
              <span className="rounded-full border border-dashed border-[var(--c-faint)] px-2 py-[2px] text-[11px] font-semibold text-[var(--c-sidebar-text)]">Kontakt z zapytania</span>
              {agent && (
                <button type="button" disabled={busy} onClick={() => void qualify()} className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)] disabled:opacity-50">
                  Przenieś do klientów
                </button>
              )}
            </>
          ) : (
            d.clientStatus && <StatusChip status={d.clientStatus} />
          )}
          {d.clientResigned && <span className="rounded-md bg-[#FBF0E7] px-[7px] py-0.5 text-[11px] font-semibold text-[#B8612F]">Zrezygnował</span>}
          {returning && <span className="rounded-md bg-[var(--c-green-soft)] px-[7px] py-0.5 text-[11px] font-semibold text-[var(--c-green-deep)]">Powracająca klientka</span>}
          {d.attempts > 0 && OPEN_STAGES.includes(d.stage) && (
            <span className="text-[11.5px] text-[#5C6166]">
              <Dots attempts={d.attempts} /> {d.attempts}× nie odebrała
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px]">
          {phone ? (
            <a href={`tel:${phone}`} className="font-semibold text-[var(--c-brand)] hover:underline">
              ☎ {formatPhone(phone)}
            </a>
          ) : (
            <span className="text-[var(--c-faint)]">bez telefonu</span>
          )}
          {d.email && (
            <a href={`mailto:${d.email}`} className="min-w-0 truncate text-[var(--c-brand)] hover:underline">
              {d.email}
            </a>
          )}
          {(d.city || ci?.distanceKm != null) && <span className="text-[var(--c-muted)]">{[d.city, ci?.distanceKm != null ? `${Math.round(ci.distanceKm)} km` : null].filter(Boolean).join(" · ")}</span>}
          <span className="text-[var(--c-muted)]">prowadzi: {d.ownerName ?? "—"}</span>
        </div>
        {d.clientStatus === "NIE_KONTAKTOWAC" && (
          <p className="rounded-lg bg-[var(--c-red-soft)] px-3 py-2 text-[13px] text-[var(--c-red)]">
            <b className="font-semibold">Nie kontaktować.</b> Klient ma blokadę — sprawdź kartę klienta przed telefonem.
          </p>
        )}
        {!agent && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {phone && (
              <a href={`tel:${phone}`} className={ACTION_PRIMARY}>
                <PhoneIcon size={14} /> Zadzwoń
              </a>
            )}
            <button type="button" disabled={!phone} className={ACTION} onClick={() => setPanel(panel === "sms" ? null : "sms")}>
              <SmsIcon size={14} /> SMS
            </button>
<a
              href={d.email || draft?.to ? `mailto:${draft?.to ?? d.email}?subject=${encodeURIComponent(draft?.subject ?? "Wynajem urządzenia")}&body=${encodeURIComponent(draft?.body ?? "")}` : undefined}
              aria-disabled={!d.email && !draft?.to}
              className={`${ACTION} ${d.email || draft?.to ? "" : "pointer-events-none opacity-40"}`}
              title="Szkic maila z ofertą (wolne terminy, cena)"
            >
              ✉ Szkic maila
            </a>
            <Link href={`/kalendarz/wynajem/nowy?${new URLSearchParams({ ...(d.requestedFrom ? { date: toDay(d.requestedFrom) } : {}), sygnal: d.id }).toString()}`} className={ACTION}>
              <CalendarPlusIcon /> Rezerwacja
            </Link>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-grow flex-col gap-[18px] overflow-y-auto px-5 pb-6 pt-4">
        {toast && (
          <p role="status" className={`rounded-lg px-3 py-2 text-[13px] ${toast.error ? "bg-[var(--c-red-soft)] text-[var(--c-red)]" : "bg-[var(--c-green-soft)] text-[var(--c-green-deep)]"}`}>
            {toast.text}
          </p>
        )}
        {!agent && OPEN_STAGES.includes(d.stage) && d.attempts >= NO_ANSWER_LIMIT && (
          <div className="flex flex-wrap items-center gap-2 border-l-[3px] border-[#E08A5C] bg-[#FBF0E7] px-3 py-2 text-[13px] text-[#B8612F]">
            <span className="flex-grow">
              {d.attempts} próby bez odebrania. Oznaczyć jako przegrana – <b className="font-semibold">brak kontaktu</b>?
            </span>
            <button
              type="button"
              disabled={busy}
              className="h-8 rounded-[6px] bg-[#B8612F] px-3 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
              onClick={() => void patch({ stage: "PRZEGRANA", lostReason: "BRAK_KONTAKTU", lostNote: `${d.attempts} próby bez odebrania` }, "Przegrana — brak kontaktu.")}
            >
              Tak, przegrana
            </button>
            {phone && (
              <button type="button" className={`${BTN} h-8`} onClick={() => setPanel("sms")}>
                Szkic SMS
              </button>
            )}
          </div>
        )}

        {/* 2. Następny krok (wyróżniony) */}
        <div className="flex flex-col gap-2 border-l-[3px] border-[#1B6FA8] bg-[#EAF4FB] px-3 py-2.5">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166]">Następny krok</span>
          {d.stage === "WYGRANA" || d.stage === "PRZEGRANA" ? (
            <span className="text-[13px] text-[var(--c-muted)]">
              Sygnał zamknięty ({STAGE_LABEL[d.stage].toLowerCase()})
              {d.stage === "PRZEGRANA" && d.lostReason ? ` · ${LOST_REASON_LABEL[d.lostReason]}${d.lostNote ? ` — ${d.lostNote}` : ""}` : ""}
            </span>
          ) : d.stage === "ODLOZONE" ? (
            <span className="text-[13px] text-[#6B5B3E]">
              Odłożone do <b className="font-semibold">{d.returnAt ? new Date(d.returnAt).toLocaleDateString("pl-PL") : "—"}</b>
              {d.postponeReason ? ` · ${POSTPONE_REASON_LABEL[d.postponeReason as PostponeReasonKey] ?? d.postponeReason}` : ""} — w dniu powrotu wraca do „Na dziś”.
            </span>
          ) : d.nextActionAt ? (
            <span className="text-[13.5px] text-[#0C3450]">
              <b className="font-semibold">{NEXT_STEP_LABEL[(d.nextStepType as NextStepType) ?? "INNE"] ?? d.nextStepType}</b>
              {" · "}
              <b className={`font-semibold ${new Date(d.nextActionAt) < new Date() ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>
                {new Date(d.nextActionAt).toLocaleString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </b>
              {d.nextStepNote && <span className="block text-[13px] text-[#2A3540]">{d.nextStepNote}</span>}
            </span>
          ) : (
            <span className="text-[13px] text-[#B8612F]">brak — ustaw termin</span>
          )}
          <div className="flex flex-wrap gap-1.5">
            {!agent && open && (
              <button type="button" className={ACTION_PRIMARY} onClick={() => setOutcome(true)}>
                Wynik rozmowy
              </button>
            )}
            {!agent && d.stage !== "WYGRANA" && d.stage !== "PRZEGRANA" && (
              <button type="button" className={ACTION} onClick={() => setReschedule((v) => !v)} aria-expanded={reschedule}>
                Zmień termin
              </button>
            )}
            <button type="button" className={ACTION} onClick={() => setPanel(panel === "note" ? null : "note")}>
              <PencilIcon /> Notatka
            </button>
            <button type="button" className={ACTION} onClick={() => setPanel(panel === "task" ? null : "task")}>
              <TaskIcon /> Zadanie
            </button>
          </div>
          {reschedule && !agent && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" className={DATE_INPUT} value={toDay(d.nextActionAt)} disabled={busy} onChange={(e) => void patch({ nextActionAt: e.target.value || null }, "Ustawiono następny krok.")} />
              <button type="button" className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]" onClick={() => void patch({ nextActionAt: toDay(nextWorkday(new Date())) }, "Następny krok: jutro.")}>
                jutro
              </button>
              <button type="button" className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]" onClick={() => void patch({ nextActionAt: toDay(addWorkdays(new Date(), 3)) }, "Następny krok: za 3 dni robocze.")}>
                +3 dni rob.
              </button>
              {d.nextActionAt && (
                <button type="button" className="ml-auto text-xs text-[var(--c-muted)] hover:text-[var(--c-red)]" onClick={() => void patch({ nextActionAt: null })}>
                  wyczyść
                </button>
              )}
              {!d.firstContactAt && (
                <span className="w-full text-[12px] text-[var(--c-muted)]">
                  czas na kontakt {FIRST_CONTACT_SLA_HOURS} h rob. (czeka {workDurationLabel(workHoursBetween(new Date(d.createdAt), new Date()))})
                </span>
              )}
            </div>
          )}
        </div>
        {panel === "sms" && phone && (
          <SmsBox
            initial={d.attempts >= NO_ANSWER_LIMIT && noAnswerTpl ? applySmsPlaceholders(noAnswerTpl.body, { clientName: d.clientName ?? d.person }) : ""}
            templates={templates}
            phone={phone}
            clientName={d.clientName ?? d.person}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSend={async (message) => (await run(`/api/leads/${leadId}/sms`, "POST", { phone, message }, "SMS wysłany.")) && setPanel(null)}
          />
        )}
        {panel === "note" && (
          <NoteBox
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={async (body) => (await run(`/api/leads/${leadId}/activity`, "POST", { outcome: "note", body }, "Zapisano notatkę.")) && setPanel(null)}
          />
        )}
        {panel === "task" && (
          <TaskBox
            users={users}
            defaultAssignee={d.ownerId}
            title={d.title}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={async (body) => (await run(`/api/leads/${leadId}/task`, "POST", body, "Dodano zadanie — termin kroku sygnału ten sam.")) && setPanel(null)}
          />
        )}
        {d.openTasks.length > 0 && <OpenTasks tasks={d.openTasks} />}

        {/* 3. Czego chce · Historia */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Section
            title="Czego chce"
            action={
              !editing &&
              !agent && (
                <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                  Edytuj
                </button>
              )
            }
          >
            {editing ? (
              <LeadForm d={d} busy={busy} onCancel={() => setEditing(false)} onSave={async (body) => (await patch(body, "Zapisano zgłoszenie.")) && setEditing(false)} />
            ) : (
              <div className="flex flex-col gap-1 text-[13px]">
                <span>
                  {devices.length ? devices.map((x) => LEAD_DEVICE_LABEL[x]).join(", ") : "urządzenie —"}
                  {!d.devices.length && devices.length ? <span className="text-[var(--c-muted)]"> (z historii)</span> : null}
                </span>
                <span className="text-[var(--c-muted)]">
                  {d.requestedFrom ? fmtRange(d.requestedFrom, d.requestedDays) : "termin —"}
                  {d.requestedDays ? ` · ${d.requestedDays} ${d.requestedDays === 1 ? "dzień" : "dni"}` : ""}
                </span>
                {freeDates && freeDates.length > 0 && <span className="text-[#2F7A68]">wolne: {freeDates.join(", ")}</span>}
                {d.person && d.person !== d.clientName && <span className="text-[var(--c-muted)]">osoba: {d.person}</span>}
                {d.message && <span className="whitespace-pre-line text-[var(--c-muted)]">„{d.message}”</span>}
              </div>
            )}
          </Section>
          <Section title="Historia">
            <div className="flex flex-col gap-1 text-[13px]">
              {ci && ci.arrivals > 0 ? (
                <>
                  <span>
                    {ci.arrivals} {ci.arrivals === 1 ? "przyjazd" : ci.arrivals < 5 ? "przyjazdy" : "przyjazdów"}
                    {ci.rhythm ? ` · ${ci.rhythm}` : ""}
                  </span>
                  {ci.lastRentalAt && (
                    <span className="text-[var(--c-muted)]">
                      ostatni {fmtDate(ci.lastRentalAt)}
                      {ci.lastDevice ? ` · ${ci.lastDevice}` : ""}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[var(--c-muted)]">bez wynajmów</span>
              )}
              {lastOffer && <span className="text-[var(--c-muted)]">ostatnia oferta {fmtDate(lastOffer.at)}</span>}
              {d.otherLeads.map((l) => (
                <Link key={l.id} href={`/sygnaly?id=${l.id}`} className="flex items-center gap-2 text-[12.5px] hover:text-[var(--c-brand-deep)]">
                  <StageChip stage={l.stage} />
                  <span className="truncate">{l.title}</span>
                </Link>
              ))}
            </div>
          </Section>
        </div>

        {/* 4. Oś czasu: 3 ostatnie, reszta pod „rozwiń” */}
        <Section title="Oś czasu">
          <ul className="flex flex-col gap-2.5">
            {activities.map((a) => {
              const tone = ACTIVITY_TONE[a.type];
              return (
                <li
                  key={a.id}
                  className={`flex gap-2.5 ${a.emailIds ? "-m-1 cursor-pointer rounded-lg p-1 hover:bg-[var(--c-bg)]" : ""}`}
                  onClick={a.emailIds ? () => setEmailIds(a.emailIds!) : undefined}
                >
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
                    {tone.mark}
                  </span>
                  <span className="min-w-0 flex-grow">
                    <span className="block whitespace-pre-line text-[13px] text-[var(--c-text)] [overflow-wrap:anywhere]">
                      {a.type !== "SYSTEM" && a.type !== "NOTE" && <b className="font-semibold">{ACTIVITY_LABEL[a.type]}: </b>}
                      {a.body ?? ""}
                    </span>
                    <span className="flex flex-wrap gap-x-1.5 text-[11px] text-[var(--c-muted)]">
                      {fmtWhen(a.at)}
                      <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#1B6FA8]">
                        · {a.userRole === "AGENT" ? "agent" : a.userName ? a.userName : a.emailIds ? "e-mail" : "system"}
                      </span>
                      {a.fromHubspot && <span className="rounded bg-[var(--c-accent-soft)] px-1 text-[var(--c-accent-deep)]">HubSpot</span>}
                      {a.otherLead && <span>· {a.otherLead}</span>}
                    </span>
                  </span>
                </li>
              );
            })}
            {(showAll || d.activities.length <= 3) && (
              <li className="flex gap-2.5 text-[12.5px] text-[var(--c-muted)]">
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--c-bg)] text-[11px] font-bold">↓</span>
                <span>
                  Wpłynęło {fmtWhen(d.createdAt)}
                  {!fmtWhen(d.createdAt).startsWith("dziś") && !fmtWhen(d.createdAt).startsWith("wczoraj") && ` (${fmtAgo(d.createdAt)})`} · {TYPE_LABEL[d.type]} · {d.fromHubspot ? "z HubSpota" : "z panelu"}
                  {d.hubspotUrl && (
                    <>
                      {" · "}
                      <a href={d.hubspotUrl} target="_blank" rel="noreferrer" className="text-[var(--c-brand)] hover:underline">
                        HubSpot
                      </a>
                    </>
                  )}
                </span>
              </li>
            )}
          </ul>
          {d.activities.length > 3 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="self-start text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              {showAll ? "Zwiń" : `Rozwiń (${d.activities.length})`}
            </button>
          )}
        </Section>

        {/* 5. Rezerwacja — gdy jest; inaczej „Powiąż z wynajmem” */}
        <div id="lead-rental-section" className="flex scroll-mt-4 flex-col gap-2">
          {d.rentalId ? (
            <Section title="Rezerwacja">
              <div className="flex items-center gap-2 rounded-[10px] border border-[var(--c-border)] px-3 py-2 text-[13px]">
                <Link href={`/kalendarz?wynajem=${d.rentalId}`} className="flex-grow font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                  {d.rentalDevice} · {d.rentalStartsAt ? fmtDate(d.rentalStartsAt) : ""}
                </Link>
                {!agent && (
                  <button type="button" className="text-xs text-[var(--c-muted)] hover:text-[var(--c-red)]" onClick={() => void patch({ rentalId: null }, "Odpięto rezerwację.")}>
                    odepnij
                  </button>
                )}
              </div>
            </Section>
          ) : !agent && open ? (
            linking ? (
              <Section title="Powiąż z wynajmem">
                <RentalPicker leadId={d.id} initial={d.rentalOptions} busy={busy} onPick={(id) => void patch({ rentalId: id }, "Powiązano z rezerwacją — etap: Rezerwacja.")} />
              </Section>
            ) : (
              <button type="button" className={`${ACTION} self-start`} onClick={() => setLinking(true)}>
                Powiąż z wynajmem
              </button>
            )
          ) : null}
        </div>

        {/* 7. Podpowiedź / wywiad — zwinięta do żarówki, otwarta sama tylko w „Nowe” */}
        {playbook &&
          ((tipOpen ?? d.stage === "SYGNAL") ? (
            <div className="flex flex-col gap-1">
              <button type="button" onClick={() => setTipOpen(false)} className="self-start text-xs font-semibold text-[var(--c-brand)] hover:underline">
                💡 Zwiń podpowiedź
              </button>
              <StageTip
                leadId={d.id}
                stage={d.stage}
                followUpNo={d.followUpNo}
                playbook={playbook}
                smsText={phone && noAnswerTpl ? applySmsPlaceholders(noAnswerTpl.body, { clientName: d.clientName ?? d.person }) : null}
                canAct={!agent}
                onSendSms={(message) => run(`/api/leads/${leadId}/sms`, "POST", { phone, message }, "SMS wysłany.")}
              />
            </div>
          ) : (
            <button type="button" onClick={() => setTipOpen(true)} className={`${ACTION} self-start`} title="Podpowiedź i wywiad (6 pytań)">
              💡 Podpowiedź
            </button>
          ))}

        {/* 6. Etap jako jeden pasek przycisków + „Prowadzi” */}
        <div className="flex flex-col gap-2 border-t border-[var(--c-border)] pt-3">
          <StageBar
            stage={d.stage}
            disabled={busy || agent}
            hasRental={Boolean(d.rentalId)}
            onPick={(stage) => {
              if (stage === "PRZEGRANA") setLost({});
              else if (stage === "ODLOZONE") setOutcome("postpone");
              else void patch({ stage }, `Etap: ${STAGE_LABEL[stage]}.`);
            }}
          />
          <label className={`${LABEL} flex-row items-center gap-2`}>
            Prowadzi
            <select className={`${INPUT} h-8 w-auto cursor-pointer`} value={d.ownerId ?? ""} disabled={busy || agent} onChange={(e) => void patch({ ownerId: e.target.value || null })}>
              <option value="">— nikt —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {outcome && (
        <CallOutcomeDialog
          lead={outcomeLead}
          initialChoice={outcome === "postpone" ? "later" : undefined}
          initialPostpone={outcome === "postpone"}
          onClose={() => setOutcome(false)}
          onDone={(detail) => {
            setOutcome(false);
            if (detail) setD(detail);
            setToast({ text: "Zapisano wynik rozmowy." });
            onChanged();
            onOutcome?.();
          }}
        />
      )}
      {emailIds && <EmailViewer messageIds={emailIds} onClose={() => setEmailIds(null)} />}
      {lost && (
        <LostDialog
          initialReason={lost.preset}
          onClose={() => setLost(false)}
          onSubmit={async (v) => {
            const ok = await patch({ stage: "PRZEGRANA", ...v, returnAt: v.returnAt || null }, "Oznaczono jako przegraną.");
            if (ok) {
              setLost(false);
              onOutcome?.();
            }
            return ok ? null : "Nie udało się zapisać.";
          }}
        />
      )}
    </div>
  );
}

// Wniosek 27 C: etap jako jeden pasek przycisków na dole karty (zamiast
// selecta i steppera). Wygrana tylko z powiązaną rezerwacją; Przegrana
// i Odłożone otwierają swoje okna.
const BAR_STAGES: LeadStageKey[] = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "WYGRANA", "ODLOZONE", "PRZEGRANA"];
function StageBar({ stage, disabled, hasRental, onPick }: { stage: LeadStageKey; disabled: boolean; hasRental: boolean; onPick: (s: LeadStageKey) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Etap">
      {BAR_STAGES.map((s) => {
        const on = s === stage;
        const blocked = disabled || on || (s === "WYGRANA" && !hasRental);
        return (
          <button
            key={s}
            type="button"
            disabled={blocked}
            aria-pressed={on}
            title={s === "WYGRANA" && !hasRental ? "Wygrana dopiero z powiązaną rezerwacją" : undefined}
            onClick={() => onPick(s)}
            className={`h-7 rounded-[6px] px-2.5 text-[12px] ${
              on
                ? s === "PRZEGRANA"
                  ? "bg-[#8A939B] font-semibold text-white"
                  : s === "ODLOZONE"
                    ? "bg-[#6B5B3E] font-semibold text-white"
                    : "bg-[#1B6FA8] font-semibold text-white"
                : "border border-[#E3E6E9] bg-white text-[#5C6166] enabled:hover:border-[#1B6FA8] enabled:hover:text-[#0C3450] disabled:opacity-50"
            }`}
          >
            {STAGE_LABEL[s]}
          </button>
        );
      })}
    </div>
  );
}

// Dymek na chipie etapu (dawny wiersz „W etapie N dni · limit gnicia”).
function stageAgeText(d: LeadDetail): string {
  if (d.stage === "ODLOZONE") return `Odłożone do ${d.returnAt ? new Date(d.returnAt).toLocaleDateString("pl-PL") : "—"}`;
  if (!OPEN_STAGES.includes(d.stage)) return STAGE_LABEL[d.stage];
  const now = new Date();
  const rot = rotInfo(funnelFromRow(d) as unknown as FunnelLead, now);
  const days = Math.floor((now.getTime() - new Date(d.stageChangedAt).getTime()) / 86_400_000);
  const limit = d.stage === "SYGNAL" && !d.firstContactAt ? `czas na kontakt ${FIRST_CONTACT_SLA_HOURS} h rob.` : d.stage === "OFERTA" ? `limit gnicia ${ROT_DAYS_OFFER} dni` : d.stage === "REZERWACJA" ? "do dnia wynajmu" : `limit gnicia ${ROT_WORK_DAYS_CONTACT} dni rob.`;
  return `W etapie ${days} ${days === 1 ? "dzień" : "dni"} · ${limit}${rot.rotting ? ` · gnije (${rot.label})` : ""}`;
}

function SmsBox({
  initial = "",
  templates,
  phone,
  clientName,
  busy,
  onCancel,
  onSend,
}: {
  initial?: string;
  templates: Template[];
  phone: string;
  clientName: string | null;
  busy: boolean;
  onCancel: () => void;
  onSend: (message: string) => void;
}) {
  // Szkic (np. po 3. próbie bez odebrania) — do poprawienia, nie wysyła się sam.
  const [message, setMessage] = useState(initial);
  // Najpierw szablony sygnałów, potem reszta (bez przypomnień o wynajmie).
  const list = [...templates.filter((t) => t.key.startsWith("lead_")), ...templates.filter((t) => t.key.startsWith("custom_"))];
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--c-brand)] p-3">
      <span className="text-[13px] font-semibold text-[var(--c-navy)]">SMS na {formatPhone(phone)}</span>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMessage(applySmsPlaceholders(t.body, { clientName }))}
              className="h-7 rounded-full border border-[var(--c-border)] px-2.5 text-xs transition-colors hover:border-[var(--c-brand)] hover:text-[var(--c-brand-deep)]"
            >
              {t.label.replace(/^Sygnał:\s*/, "")}
            </button>
          ))}
        </div>
      )}
      <textarea rows={4} className={`${INPUT} h-auto py-2`} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Treść SMS-a…" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--c-faint)]">{message.length} znaków</span>
        <button type="button" className={`${BTN} ml-auto h-8`} onClick={onCancel}>
          Anuluj
        </button>
        <button type="button" disabled={busy || !message.trim()} className={`${BTN_PRIMARY} h-8`} onClick={() => onSend(message)}>
          Wyślij
        </button>
      </div>
    </div>
  );
}

function NoteBox({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (body: string) => void }) {
  const [body, setBody] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--c-brand)] p-3">
      <textarea autoFocus rows={3} className={`${INPUT} h-auto py-2`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Notatka do sygnału…" />
      <div className="flex justify-end gap-2">
        <button type="button" className={`${BTN} h-8`} onClick={onCancel}>
          Anuluj
        </button>
        <button type="button" disabled={busy || !body.trim()} className={`${BTN_PRIMARY} h-8`} onClick={() => onSave(body)}>
          Zapisz notatkę
        </button>
      </div>
    </div>
  );
}

function TaskBox({
  users,
  defaultAssignee,
  title,
  busy,
  onCancel,
  onSave,
}: {
  users: { id: string; name: string }[];
  defaultAssignee: string | null;
  title: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: { title: string; dueDate: string | null; assigneeId: string | null }) => void;
}) {
  const [t, setT] = useState(`Sygnał: ${title}`);
  const [due, setDue] = useState(toDay(nextWorkday(new Date())));
  const [assignee, setAssignee] = useState(defaultAssignee ?? "");
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--c-brand)] p-3">
      <input autoFocus className={INPUT} value={t} onChange={(e) => setT(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className={INPUT} value={due} onChange={(e) => setDue(e.target.value)} />
        <select className={`${INPUT} cursor-pointer`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Prowadząca osoba / ja</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] text-[var(--c-faint)]">Zadanie pojawi się w panelu Zadań.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={`${BTN} h-8`} onClick={onCancel}>
          Anuluj
        </button>
        <button type="button" disabled={busy || !t.trim()} className={`${BTN_PRIMARY} h-8`} onClick={() => onSave({ title: t, dueDate: due || null, assigneeId: assignee || null })}>
          Dodaj zadanie
        </button>
      </div>
    </div>
  );
}

function LeadForm({ d, busy, onCancel, onSave }: { d: LeadDetail; busy: boolean; onCancel: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [f, setF] = useState({
    title: d.title,
    contactName: d.person ?? "",
    contactPhone: d.phone ?? "",
    contactEmail: d.email ?? "",
    requestedFrom: toDay(d.requestedFrom),
    requestedDays: d.requestedDays ? String(d.requestedDays) : "",
    location: d.city ?? "",
    message: d.message ?? "",
  });
  const [devices, setDevices] = useState<DeviceInterestKey[]>(d.devices);
  return (
    <div className="flex flex-col gap-2">
      <label className={LABEL}>
        Nazwa sygnału
        <input className={INPUT} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={LABEL}>
          Osoba
          <input className={INPUT} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
        </label>
        <label className={LABEL}>
          Telefon
          <input className={INPUT} value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} />
        </label>
      </div>
      <label className={LABEL}>
        E-mail
        <input className={INPUT} value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {DEVICE_INTEREST_KEYS.filter((k) => k !== "SZKOLENIE").map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={devices.includes(k)}
            onClick={() => setDevices((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))}
            className={`h-7 rounded-full border px-2.5 text-xs ${devices.includes(k) ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "border-[var(--c-border)]"}`}
          >
            {LEAD_DEVICE_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className={LABEL}>
          Termin od
          <input type="date" className={INPUT} value={f.requestedFrom} onChange={(e) => setF({ ...f, requestedFrom: e.target.value })} />
        </label>
        <label className={LABEL}>
          Dni
          <input type="number" min={1} className={INPUT} value={f.requestedDays} onChange={(e) => setF({ ...f, requestedDays: e.target.value })} />
        </label>
        <label className={LABEL}>
          Miejscowość
          <input className={INPUT} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </label>
      </div>
      <label className={LABEL}>
        Wiadomość
        <textarea rows={3} className={`${INPUT} h-auto py-2`} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={`${BTN} h-8`} onClick={onCancel}>
          Anuluj
        </button>
        <button
          type="button"
          disabled={busy}
          className={`${BTN_PRIMARY} h-8`}
          onClick={() => onSave({ ...f, requestedFrom: f.requestedFrom || null, requestedDays: f.requestedDays || null, deviceInterest: devices })}
        >
          Zapisz
        </button>
      </div>
    </div>
  );
}
