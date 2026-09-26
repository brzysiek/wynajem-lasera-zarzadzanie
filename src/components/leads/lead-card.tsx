"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LeadDetail } from "@/lib/leads/load";
import { ACTIVITY_LABEL, LOST_REASON_LABEL, STAGE_KEYS, STAGE_LABEL, TYPE_LABEL, type ActivityTypeKey, type LostReasonKey } from "@/lib/leads/labels";
import { NO_ANSWER_LIMIT } from "@/lib/leads/call-list";
import { LEAD_DEVICE_LABEL, type LeadStageKey } from "@/lib/leads/parse-deal";
import { DEVICE_INTEREST_KEYS, formatPhone, type DeviceInterestKey } from "@/lib/clients/labels";
import { addWorkdays, nextWorkday } from "@/lib/leads/work-time";
import { applySmsPlaceholders } from "@/lib/sms-template";
import { INPUT, api } from "@/components/clients/client-forms";
import { CalendarPlusIcon, PencilIcon, PhoneIcon, SmsIcon, StatusChip, fmtAgo, fmtDate } from "@/components/clients/ui";
import { EmailViewer } from "@/components/clients/email-viewer";
import { BTN, BTN_PRIMARY, LostDialog } from "./lead-dialogs";
import { StageChip, TaskIcon, XCircleIcon, fmtRange, fmtWhen } from "./lead-ui";

// Karta sygnału (prompt 2, 3.3) — panel boczny z każdego widoku. Szybkie
// akcje na górze, zawsze widoczne; pod nimi następny krok, rezerwacja, dane
// z formularza i oś czasu (sygnał + inne aktywności tego klienta).

export type CardIntent = "call" | "sms" | null;
type Panel = "call" | "sms" | "note" | "task" | null;
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

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
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
}: {
  leadId: string;
  users: { id: string; name: string }[];
  intent: CardIntent;
  onClose: () => void;
  onChanged: () => void;
  // Zapisany wynik kontaktu — tryb seryjny „Do obdzwonienia” przechodzi dalej.
  onOutcome?: () => void;
}) {
  const [d, setD] = useState<LeadDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(intent);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [lost, setLost] = useState<false | { preset?: LostReasonKey }>(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [emailIds, setEmailIds] = useState<string[] | null>(null);

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

  if (loadError) return <div className="p-6 text-sm text-[var(--c-red)]">{loadError}</div>;
  if (!d) return <div className="p-6 text-sm text-[var(--c-muted)]">Wczytywanie…</div>;

  const phone = d.phone;
  const noAnswerTpl = templates.find((t) => t.key === "lead_no_answer");
  const returning = d.clientStatus === "STALY" || d.clientStatus === "USPIONY";
  const quick = "flex flex-col items-center justify-center gap-1 rounded-[10px] px-1 py-2.5 text-xs font-semibold transition-colors disabled:opacity-40";
  const activities = showAll ? d.activities : d.activities.slice(0, 8);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Nagłówek */}
      <div className="flex flex-col gap-2 border-b border-[var(--c-border)] px-5 pb-4 pt-5">
        <div className="flex items-start gap-2">
          <h2 className="m-0 min-w-0 flex-grow text-lg font-semibold leading-tight text-[var(--c-navy)]">{d.title}</h2>
          <button type="button" onClick={onClose} aria-label="Zamknij kartę" className="-mr-1 -mt-1 rounded-md p-1.5 text-[var(--c-muted)] hover:bg-[var(--c-bg)]">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          {d.clientId ? (
            <Link href={`/klienci/${d.clientId}`} className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              {d.clientName}
            </Link>
          ) : (
            <span className="text-[var(--c-faint)]">bez klienta</span>
          )}
          {d.clientId && !d.clientQualified ? (
            <span className="rounded-full border border-dashed border-[var(--c-faint)] px-2 py-[2px] text-[11px] font-semibold text-[var(--c-sidebar-text)]">
              Kontakt z zapytania
            </span>
          ) : (
            d.clientStatus && <StatusChip status={d.clientStatus} />
          )}
          {d.callList && d.stage === "SYGNAL" && (
            <span className="rounded-md bg-[var(--c-purple-soft)] px-[7px] py-0.5 text-[11px] font-semibold text-[var(--c-purple-deep)]">Do obdzwonienia</span>
          )}
          {returning && (
            <span className="rounded-md bg-[var(--c-green-soft)] px-[7px] py-0.5 text-[11px] font-semibold text-[var(--c-green-deep)]">Powracająca klientka</span>
          )}
        </div>
        {d.clientStatus === "NIE_KONTAKTOWAC" && (
          <p className="rounded-lg bg-[var(--c-red-soft)] px-3 py-2 text-[13px] text-[var(--c-red)]">
            <b className="font-semibold">Nie kontaktować.</b> Klient ma blokadę — sprawdź kartę klienta przed telefonem.
          </p>
        )}
        <p className="text-xs text-[var(--c-muted)]">
          Wpłynęło {fmtWhen(d.createdAt)}
          {!fmtWhen(d.createdAt).startsWith("dziś") && !fmtWhen(d.createdAt).startsWith("wczoraj") && ` (${fmtAgo(d.createdAt)})`} · {TYPE_LABEL[d.type]} · {d.fromHubspot ? "z HubSpota" : "z panelu"}
          {d.hubspotUrl && (
            <>
              {" · "}
              <a href={d.hubspotUrl} target="_blank" rel="noreferrer" className="text-[var(--c-brand)] hover:underline">
                Otwórz w HubSpot
              </a>
            </>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>
            Etap
            <select
              className={`${INPUT} h-8 cursor-pointer`}
              value={d.stage}
              disabled={busy}
              onChange={(e) => {
                const stage = e.target.value as LeadStageKey;
                if (stage === "PRZEGRANA") setLost({});
                else void patch({ stage }, `Etap: ${STAGE_LABEL[stage]}.`);
              }}
            >
              {STAGE_KEYS.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Prowadzi
            <select className={`${INPUT} h-8 cursor-pointer`} value={d.ownerId ?? ""} disabled={busy} onChange={(e) => void patch({ ownerId: e.target.value || null })}>
              <option value="">— nikt —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {d.stage === "PRZEGRANA" && d.lostReason && (
          <p className="text-xs text-[var(--c-red)]">
            Powód: <b className="font-semibold">{LOST_REASON_LABEL[d.lostReason]}</b>
            {d.lostNote && ` — ${d.lostNote}`}
          </p>
        )}
      </div>

      {/* Szybkie akcje */}
      <div className="grid grid-cols-3 gap-2 border-b border-[var(--c-border)] px-5 py-3">
        {phone ? (
          <a href={`tel:${phone}`} onClick={() => setPanel("call")} className={`${quick} bg-[var(--c-brand)] text-white hover:bg-[var(--c-brand-deep)]`}>
            <PhoneIcon size={18} />
            Zadzwoń
          </a>
        ) : (
          <button type="button" onClick={() => setPanel("call")} className={`${quick} bg-[var(--c-brand)] text-white`} title="Brak telefonu — możesz zapisać wynik rozmowy">
            <PhoneIcon size={18} />
            Rozmowa
          </button>
        )}
        <button
          type="button"
          disabled={!phone}
          title={phone ? undefined : "Brak telefonu"}
          onClick={() => setPanel(panel === "sms" ? null : "sms")}
          className={`${quick} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`}
        >
          <SmsIcon size={18} />
          SMS
        </button>
        <Link
          href={`/kalendarz/wynajem/nowy${d.requestedFrom ? `?date=${toDay(d.requestedFrom)}` : ""}`}
          className={`${quick} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`}
          title="Nowy wynajem w kalendarzu — potem powiąż go z sygnałem niżej"
        >
          <CalendarPlusIcon />
          Rezerwacja
        </Link>
        <button type="button" onClick={() => setPanel(panel === "note" ? null : "note")} className={`${quick} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`}>
          <PencilIcon />
          Notatka
        </button>
        <button type="button" onClick={() => setPanel(panel === "task" ? null : "task")} className={`${quick} bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)] hover:bg-[var(--c-navy-soft)]`}>
          <TaskIcon />
          Zadanie
        </button>
        <button
          type="button"
          disabled={d.stage === "PRZEGRANA"}
          onClick={() => setLost({})}
          className={`${quick} bg-[var(--c-red-soft)] text-[var(--c-red)] hover:opacity-80`}
        >
          <XCircleIcon />
          Przegrana
        </button>
      </div>

      <div className="flex min-h-0 flex-grow flex-col gap-[18px] overflow-y-auto px-5 pb-6 pt-4">
        {toast && (
          <p
            role="status"
            className={`rounded-lg px-3 py-2 text-[13px] ${toast.error ? "bg-[var(--c-red-soft)] text-[var(--c-red)]" : "bg-[var(--c-green-soft)] text-[var(--c-green-deep)]"}`}
          >
            {toast.text}
          </p>
        )}

        {panel === "call" && (
          <CallResult
            stage={d.stage}
            busy={busy}
            noAnswerTpl={noAnswerTpl ?? null}
            phone={phone}
            clientName={d.clientName ?? d.person}
            unqualified={Boolean(d.clientId) && !d.clientQualified}
            noAnswerCount={d.noAnswerCount}
            onLost={(preset) => setLost({ preset })}
            onDone={(outcome) => {
              setPanel(null);
              if (outcome) onOutcome?.();
            }}
            run={(body, msg) => run(`/api/leads/${leadId}/activity`, "POST", body, msg)}
            sendSms={(message) => run(`/api/leads/${leadId}/sms`, "POST", { phone, message }, "SMS wysłany.")}
          />
        )}
        {panel === "sms" && phone && (
          <SmsBox
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
            onSave={async (body) => (await run(`/api/leads/${leadId}/task`, "POST", body, "Dodano zadanie.")) && setPanel(null)}
          />
        )}

        {/* Następny krok */}
        {d.stage !== "WYGRANA" && d.stage !== "PRZEGRANA" && (
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[var(--c-bg)] px-3 py-2.5">
            <span className="text-[13px] font-semibold text-[var(--c-navy)]">Następny krok</span>
            <input
              type="date"
              className={DATE_INPUT}
              value={toDay(d.nextActionAt)}
              disabled={busy}
              onChange={(e) => void patch({ nextActionAt: e.target.value || null }, "Ustawiono następny krok.")}
            />
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
          </div>
        )}

        {/* Rezerwacja */}
        <Section title="Rezerwacja">
          {d.rentalId ? (
            <div className="flex items-center gap-2 rounded-[10px] border border-[var(--c-border)] px-3 py-2 text-[13px]">
              <Link href={`/kalendarz/wynajem/${d.rentalId}?from=/sygnaly`} className="flex-grow font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                {d.rentalDevice} · {d.rentalStartsAt ? fmtDate(d.rentalStartsAt) : ""}
              </Link>
              <button type="button" className="text-xs text-[var(--c-muted)] hover:text-[var(--c-red)]" onClick={() => void patch({ rentalId: null }, "Odpięto rezerwację.")}>
                odepnij
              </button>
            </div>
          ) : d.rentalOptions.length > 0 ? (
            <select
              className={`${INPUT} cursor-pointer`}
              defaultValue=""
              disabled={busy}
              onChange={(e) => e.target.value && void patch({ rentalId: e.target.value }, "Powiązano z rezerwacją — etap: Rezerwacja.")}
            >
              <option value="">Powiąż z wynajmem z kalendarza…</option>
              {d.rentalOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {fmtDate(r.startsAt)} · {r.deviceName} · {r.title}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[13px] text-[var(--c-faint)]">Brak wynajmu do powiązania. Utwórz rezerwację w kalendarzu przyciskiem wyżej.</p>
          )}
        </Section>

        {/* Dane z formularza */}
        <Section
          title="Zgłoszenie"
          action={
            !editing && (
              <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                Edytuj
              </button>
            )
          }
        >
          {editing ? (
            <LeadForm d={d} busy={busy} onCancel={() => setEditing(false)} onSave={async (body) => (await patch(body, "Zapisano zgłoszenie.")) && setEditing(false)} />
          ) : (
            <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-y-1.5 text-[13px]">
              <span className="text-[var(--c-muted)]">Osoba</span>
              <span>{d.person ?? "—"}</span>
              <span className="text-[var(--c-muted)]">Telefon</span>
              <span>{phone ? <a href={`tel:${phone}`} className="text-[var(--c-brand)]">{formatPhone(phone)}</a> : "—"}</span>
              <span className="text-[var(--c-muted)]">E-mail</span>
              <span className="truncate">{d.email ? <a href={`mailto:${d.email}`} className="text-[var(--c-brand)]">{d.email}</a> : "—"}</span>
              <span className="text-[var(--c-muted)]">Urządzenie</span>
              <span>{d.devices.length ? d.devices.map((x) => LEAD_DEVICE_LABEL[x]).join(", ") : "—"}</span>
              <span className="text-[var(--c-muted)]">Termin</span>
              <span>
                {d.requestedFrom ? fmtRange(d.requestedFrom, d.requestedDays) : "—"}
                {d.requestedDays ? ` (${d.requestedDays} ${d.requestedDays === 1 ? "dzień" : "dni"})` : ""}
              </span>
              <span className="text-[var(--c-muted)]">Miejscowość</span>
              <span>{d.city ?? "—"}</span>
              {d.message && (
                <>
                  <span className="text-[var(--c-muted)]">Wiadomość</span>
                  <span className="whitespace-pre-line">„{d.message}”</span>
                </>
              )}
            </div>
          )}
        </Section>

        {(d.otherLeads.length > 0 || d.clientRentals.length > 0) && (
          <Section title="Ten klient">
            <div className="flex flex-col gap-1 text-[13px]">
              {d.clientRentals.length > 0 && (
                <p className="text-[var(--c-muted)]">
                  Wynajmy: {d.clientRentals.map((r) => `${fmtDate(r.startsAt)} ${r.deviceName}`).join(" · ")}
                </p>
              )}
              {d.otherLeads.map((l) => (
                <Link key={l.id} href={`/sygnaly?id=${l.id}`} className="flex items-center gap-2 hover:text-[var(--c-brand-deep)]">
                  <StageChip stage={l.stage} />
                  <span className="truncate">{l.title}</span>
                  <span className="ml-auto flex-none text-xs text-[var(--c-faint)]">{fmtDate(l.createdAt)}</span>
                </Link>
              ))}
            </div>
          </Section>
        )}

        {/* Oś czasu */}
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
                    <span className="block whitespace-pre-line text-[13px] text-[var(--c-text)]">
                      {a.type !== "SYSTEM" && a.type !== "NOTE" && <b className="font-semibold">{ACTIVITY_LABEL[a.type]}: </b>}
                      {a.body ?? ""}
                    </span>
                    <span className="flex flex-wrap gap-x-1.5 text-[11px] text-[var(--c-muted)]">
                      {fmtWhen(a.at)}
                      {a.userName && <span>· {a.userName}</span>}
                      {a.fromHubspot && <span className="rounded bg-[var(--c-accent-soft)] px-1 text-[var(--c-accent-deep)]">HubSpot</span>}
                      {a.otherLead && <span>· {a.otherLead}</span>}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {d.activities.length > 8 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="self-start text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              {showAll ? "Zwiń" : `Pokaż wszystko (${d.activities.length})`}
            </button>
          )}
        </Section>
      </div>

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

// Wynik rozmowy (prompt 2, 3.3): „Rozmawiałam” / „Nie odebrała” / „Oddzwoni”.
function CallResult({
  stage,
  busy,
  noAnswerTpl,
  phone,
  clientName,
  unqualified,
  noAnswerCount,
  onDone,
  onLost,
  run,
  sendSms,
}: {
  stage: LeadStageKey;
  busy: boolean;
  noAnswerTpl: Template | null;
  phone: string | null;
  clientName: string | null;
  unqualified: boolean;
  noAnswerCount: number;
  onDone: (outcome: boolean) => void; // outcome = zapisano wynik (tryb seryjny idzie dalej)
  onLost: (preset?: LostReasonKey) => void;
  run: (body: Record<string, unknown>, msg: string) => Promise<boolean>;
  sendSms: (message: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"talked" | "callback" | "email" | "noAnswerDone" | null>(null);
  const attempts = noAnswerCount + (mode === "noAnswerDone" ? 1 : 0);
  const [note, setNote] = useState("");
  const [toInterview, setToInterview] = useState(stage === "SYGNAL");
  const [date, setDate] = useState("");
  const chip = (on: boolean) =>
    `h-8 rounded-full border px-3 text-[13px] transition-colors ${on ? "border-[var(--c-brand)] bg-white font-semibold text-[var(--c-brand-deep)]" : "border-[var(--c-border)] bg-white hover:border-[var(--c-brand)]"}`;

  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] bg-[var(--c-bg)] p-3">
      <div className="flex items-center">
        <span className="flex-grow text-[13px] font-semibold text-[var(--c-navy)]">Wynik kontaktu</span>
        <button type="button" onClick={() => onDone(false)} className="text-xs text-[var(--c-muted)] hover:text-[var(--c-text)]">
          zamknij
        </button>
      </div>
      {unqualified && (
        <p className="-mt-1 text-xs text-[var(--c-muted)]">„Rozmawiałam” albo „Odpowiedziałam mailem” przenosi kontakt do Klientów jako Potencjalny.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chip(mode === "talked")} onClick={() => setMode("talked")}>
          Rozmawiałam
        </button>
        <button
          type="button"
          disabled={busy}
          className={chip(mode === "noAnswerDone")}
          onClick={async () => (await run({ outcome: "no_answer" }, "Zapisano: nie odebrała. Następny krok: jutro.")) && setMode("noAnswerDone")}
        >
          Nie odebrała → jutro
        </button>
        <button type="button" className={chip(mode === "callback")} onClick={() => setMode("callback")}>
          Oddzwoni — termin
        </button>
        <button type="button" className={chip(mode === "email")} onClick={() => setMode("email")}>
          Odpowiedziałam mailem
        </button>
        <button type="button" className={chip(false)} onClick={() => onLost()}>
          Nie zainteresowana
        </button>
      </div>

      {mode === "email" && (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${INPUT} h-8 min-w-0 flex-grow`} placeholder="Co wysłałaś? (np. cennik, oferta na LightSheer)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            type="button"
            disabled={busy}
            className={`${BTN_PRIMARY} h-8`}
            onClick={async () => (await run({ outcome: "email", body: note }, "Zapisano odpowiedź mailem.")) && onDone(true)}
          >
            Zapisz
          </button>
        </div>
      )}

      {mode === "talked" && (
        <>
          <textarea autoFocus rows={3} className={`${INPUT} h-auto py-2`} placeholder="Co ustaliłaś? (urządzenie, termin, cena, dojazd…)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            {stage === "SYGNAL" && (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={toInterview} onChange={(e) => setToInterview(e.target.checked)} className="accent-[var(--c-brand)]" />
                przesuń na „Wywiad”
              </label>
            )}
            <label className="flex items-center gap-1.5 text-[var(--c-muted)]">
              następny krok
              <input type="date" className={DATE_INPUT} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <button
              type="button"
              disabled={busy}
              className={`${BTN_PRIMARY} ml-auto h-8`}
              onClick={async () =>
                (await run(
                  { outcome: "talked", body: note, ...(date ? { nextActionAt: date } : {}), ...(toInterview && stage === "SYGNAL" ? { stage: "WYWIAD" } : {}) },
                  "Zapisano rozmowę.",
                )) && onDone(true)
              }
            >
              Zapisz rozmowę
            </button>
          </div>
        </>
      )}

      {mode === "callback" && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className={DATE_INPUT} value={date} onChange={(e) => setDate(e.target.value)} />
          <input className={`${INPUT} h-8 min-w-0 flex-grow`} placeholder="Notatka (opcjonalnie)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            type="button"
            disabled={busy || !date}
            className={`${BTN_PRIMARY} h-8`}
            onClick={async () => (await run({ outcome: "callback", body: note, nextActionAt: date }, "Zapisano: oddzwoni.")) && onDone(true)}
          >
            Zapisz
          </button>
        </div>
      )}

      {mode === "noAnswerDone" && attempts >= NO_ANSWER_LIMIT && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--c-red-soft)] px-3 py-2 text-[13px] text-[var(--c-red)]">
          <span className="flex-grow">To już {attempts}. próba bez odpowiedzi.</span>
          <button type="button" className="h-8 rounded-lg bg-[var(--c-red)] px-3 text-[13px] font-semibold text-white hover:opacity-90" onClick={() => onLost("BRAK_KONTAKTU")}>
            Przegrana — brak kontaktu
          </button>
        </div>
      )}
      {mode === "noAnswerDone" && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {noAnswerTpl && phone ? (
            <>
              <span className="text-[var(--c-muted)]">Wysłać SMS „{noAnswerTpl.label.replace(/^Sygnał:\s*/, "")}”?</span>
              <button
                type="button"
                disabled={busy}
                className={`${BTN_PRIMARY} h-8`}
                onClick={async () => (await sendSms(applySmsPlaceholders(noAnswerTpl.body, { clientName }))) && onDone(true)}
              >
                Wyślij SMS
              </button>
              <button type="button" className={`${BTN} h-8`} onClick={() => onDone(true)}>
                Nie teraz
              </button>
            </>
          ) : (
            <button type="button" className={`${BTN} h-8`} onClick={() => onDone(true)}>
              Gotowe
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SmsBox({
  templates,
  phone,
  clientName,
  busy,
  onCancel,
  onSend,
}: {
  templates: Template[];
  phone: string;
  clientName: string | null;
  busy: boolean;
  onCancel: () => void;
  onSend: (message: string) => void;
}) {
  const [message, setMessage] = useState("");
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
