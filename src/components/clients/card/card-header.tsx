"use client";

import { BASE_PATH } from "@/lib/base-path";
import { useContext, useEffect, useState } from "react";
import Link from "next/link";
import type { ClientDetail } from "@/lib/clients/load";
import { CLINIC_TYPE_LABEL, RESIGN_REASON_KEYS, RESIGN_REASON_LABEL, STATUS_LABEL, type ResignReasonKey } from "@/lib/clients/labels";
import { CallOutcomeDialog } from "@/components/leads/call-outcome-dialog";
import { PERSON_ROLE_LABEL, type PersonRole } from "@/lib/clients/profile-fields";
import { monthsLabel } from "@/lib/clients/rhythm";
import { AgentModeContext, INPUT, api } from "../client-forms";
import { gmailComposeUrl } from "./shared";
import { BTN_OUTLINE, BTN_PRIMARY, BTN_TERRA, LABEL_WIDE, WEEKDAY_IN, dm, money, weekdayShort } from "./kit";

// Nagłówek karty, pas 5 wskaźników i blok „Następny krok” — wartości 1:1
// z projektu Main.dc.html (nagłówek 36/48/28 px, nazwa Jost 42 px, pas
// #EAF4FB 26/48 px, wartości Jost 28 px, blok #2B5B82 30/34 px).

const personName = (c: { firstName: string | null; lastName: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ").trim();

export function CardHeader({
  d,
  backHref,
  isAgent,
  onSms,
  onTask,
  onChanged,
  notify,
}: {
  d: ClientDetail;
  backHref: string;
  isAgent: boolean;
  onSms: () => void;
  onTask: () => void;
  // Wniosek 24: po „Wynik rozmowy” / „Zrezygnował” — świeże dane karty.
  onChanged?: () => void;
  notify?: (text: string, error?: boolean) => void;
}) {
  const [outcome, setOutcome] = useState(false);
  const [resigning, setResigning] = useState(false);
  const openLead = d.leads.find((l) => !l.archived && ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "ODLOZONE"].includes(l.stage)) ?? null;
  async function undoResign() {
    const { ok } = await api(`/api/clients/${d.id}/resign`, "DELETE");
    notify?.(ok ? "Cofnięto „Zrezygnował”." : "Nie udało się cofnąć.", !ok);
    if (ok) onChanged?.();
  }
  const primary = d.contacts.find((c) => c.isPrimary) ?? d.contacts[0] ?? null;
  const email = d.contacts.find((c) => c.isPrimary && c.email)?.email ?? d.contacts.find((c) => c.email)?.email ?? null;
  const hasSms = d.contacts.some((c) => c.phone || c.phone2);
  const dc = d.rhythm.deviceConfig;
  const status = d.qualification.qualified ? d.summary.status : null;
  const roleLabel = primary ? (primary.roles[0] ? PERSON_ROLE_LABEL[primary.roles[0] as PersonRole] : primary.role) : null;
  const salutation = d.contacts.find((c) => c.salutation)?.salutation ?? null;
  const mailUrl = email ? `${gmailComposeUrl(email, d.gmail.mailboxes[0] ?? null)}${salutation ? `&body=${encodeURIComponent(`${salutation},\n\n`)}` : ""}` : null;
  const firstSeen = d.summary.firstSeenAt ? new Date(d.summary.firstSeenAt).toLocaleDateString("pl-PL", { month: "2-digit", year: "numeric" }) : null;
  // Zieleń tylko dla „w porządku” (STAŁY, NOWY); reszta neutralnie.
  const statusCls =
    status === "STALY" || status === "NOWY"
      ? "bg-[#2F7A68] text-white"
      : status === "NIE_KONTAKTOWAC"
        ? "bg-[#FBF0E7] text-[#B8612F] line-through"
        : "bg-[#F4F5F6] text-[#5C6166]";
  const meta = [
    primary && personName(primary) ? [personName(primary), roleLabel].filter(Boolean).join(" · ") : null,
    d.city,
    firstSeen ? `klient od ${firstSeen}` : null,
    dc ? `${dc.family}${dc.heads ? ` · ${dc.heads} ${dc.heads === 1 ? "głowica" : "głowice"}` : ""}` : null,
    d.clinicType ? CLINIC_TYPE_LABEL[d.clinicType].toLowerCase() : null,
  ].filter((x): x is string => !!x);

  return (
    <div className="flex flex-col gap-2 px-4 pb-4 pt-6 md:px-7">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166]">
        <Link href={backHref} className="text-[#5C6166] no-underline hover:text-[#1B6FA8]">
          Klienci
        </Link>{" "}
        / {d.profile.shortName ?? d.name}
      </div>
      <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-baseline gap-2.5">
            {/* Nazwa robocza w H1 (jedna linia); pełna nazwa rejestrowa pod spodem. */}
            <h1 className="m-0 min-w-0 truncate text-[26px] font-semibold leading-[1.15] text-[#0C3450]" title={d.name}>
              {d.profile.shortName ?? d.name}
            </h1>
            {status ? (
              <>
                <span className={`flex-none px-[7px] py-px text-[10.5px] font-medium uppercase tracking-[0.14em] ${statusCls}`}>{STATUS_LABEL[status]}</span>
                {d.summary.rhythmHint && status !== "POTENCJALNY" && status !== "NIE_KONTAKTOWAC" && (
                  <span className="flex-none text-[12px] text-[#5C6166]" title={`Przyjazdy: ${d.summary.arrivals} (kilka urządzeń w ciągu 3 dni = 1 przyjazd)`}>
                    {d.summary.rhythmHint}
                  </span>
                )}
              </>
            ) : (
              <span className="flex-none border border-dashed border-[#C3C4C7] px-[7px] py-px text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#5C6166]" title="Kontakt z zapytania — jeszcze bez rozmowy ani korespondencji (lejek v2)">Kontakt</span>
            )}
            {d.resigned && (
              <span
                className="flex-none bg-[#FBF0E7] px-[7px] py-px text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#B8612F]"
                title={[
                  `Zrezygnował ${new Date(d.resigned.at).toLocaleDateString("pl-PL")}`,
                  d.resigned.reason ? RESIGN_REASON_LABEL[d.resigned.reason as ResignReasonKey] ?? d.resigned.reason : null,
                  d.resigned.note,
                  d.resigned.recontactAt ? `ponowny kontakt ${new Date(d.resigned.recontactAt).toLocaleDateString("pl-PL")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                Zrezygnował
              </span>
            )}
            {!isAgent &&
              (d.resigned ? (
                <button type="button" onClick={() => void undoResign()} className="flex-none text-[12px] text-[#5C6166] underline-offset-2 hover:text-[#1B6FA8] hover:underline">
                  cofnij
                </button>
              ) : (
                <button type="button" onClick={() => setResigning(true)} className="flex-none text-[12px] text-[#8A939B] underline-offset-2 hover:text-[#B8612F] hover:underline" title="Stan klienta „Zrezygnował” — poza kampaniami przed sezonem i przypomnieniami o rytmie">
                  zrezygnował?
                </button>
              ))}
          </div>
          {d.profile.shortName && d.profile.shortName !== d.name && <div className="truncate text-[13px] text-[#5C6166]" title={d.name}>{d.name}</div>}
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[13px] text-[#4A4A4A]">
            {meta.map((m, i) => (
              <span key={i} className="flex gap-2.5">
                {i > 0 && <span className="text-[#C3C4C7]">|</span>}
                <span>{m}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {primary?.phone ? (
            <a href={`tel:${primary.phone}`} className={BTN_OUTLINE}>
              Zadzwoń
            </a>
          ) : (
            <button type="button" disabled className={BTN_OUTLINE}>
              Zadzwoń
            </button>
          )}
          {!isAgent && openLead && (
            <button type="button" onClick={() => setOutcome(true)} className={BTN_OUTLINE} title={`Otwarty sygnał: ${openLead.title}`}>
              Wynik rozmowy
            </button>
          )}
          {!isAgent && (
            <button type="button" disabled={!hasSms || !!d.archive} onClick={onSms} className={BTN_OUTLINE}>
              SMS
            </button>
          )}
          {!isAgent &&
            (mailUrl ? (
              <a href={mailUrl} target="_blank" rel="noreferrer" className={BTN_OUTLINE} title="Nowa wiadomość w Gmailu (szkic)">
                Szkic maila
              </a>
            ) : (
              <button type="button" disabled className={BTN_OUTLINE}>
                Szkic maila
              </button>
            ))}
          <button type="button" onClick={onTask} className={BTN_OUTLINE}>
            Zadanie dla Ani
          </button>
          {!isAgent && (
            <Link href={`/kalendarz/wynajem/nowy?klient=${d.id}`} className={BTN_PRIMARY}>
              Nowa rezerwacja →
            </Link>
          )}
        </div>
      </div>
      {outcome && openLead && (
        <CallOutcomeDialog
          lead={{
            id: openLead.id,
            stage: openLead.stage,
            attempts: openLead.attempts,
            followUpNo: openLead.followUpNo,
            nextStepType: openLead.nextStepType,
            phone: primary?.phone ?? null,
            clientId: d.id,
            clientName: d.profile.shortName ?? d.name,
            requestedFrom: openLead.requestedFrom,
          }}
          onClose={() => setOutcome(false)}
          onDone={() => {
            setOutcome(false);
            notify?.("Zapisano wynik rozmowy.");
            onChanged?.();
          }}
        />
      )}
      {resigning && (
        <ResignDialog
          clientId={d.id}
          onClose={() => setResigning(false)}
          onDone={() => {
            setResigning(false);
            notify?.("Klient oznaczony: Zrezygnował.");
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

// Wniosek 24: „Zrezygnował” — powód, notatka, opcjonalny ponowny kontakt
// (w tym dniu powstaje zadanie). To nie „Nie kontaktować”.
function ResignDialog({ clientId, onClose, onDone }: { clientId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<ResignReasonKey>("INNE");
  const [note, setNote] = useState("");
  const [recontact, setRecontact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  async function save() {
    setBusy(true);
    const { ok, data } = await api<{ message?: string }>(`/api/clients/${clientId}/resign`, "POST", { reason, note: note.trim() || null, recontactAt: recontact || null });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    onDone();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex w-full max-w-md flex-col gap-3 bg-white p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Zrezygnował">
        <h2 className="m-0 text-[17px] font-semibold text-[#0C3450]">Zrezygnował</h2>
        <p className="m-0 text-[12.5px] text-[#5C6166]">Poza kampanią przed sezonem, pulą wiosny, przypomnieniami o rytmie i Planem dnia. Nowy wynajem sam zdejmie ten stan.</p>
        <label className={LABEL_WIDE}>
          Powód
          <select className={INPUT} value={reason} onChange={(e) => setReason(e.target.value as ResignReasonKey)}>
            {RESIGN_REASON_KEYS.map((k) => (
              <option key={k} value={k}>
                {RESIGN_REASON_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_WIDE}>
          Notatka
          <textarea rows={2} className={`${INPUT} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className={LABEL_WIDE}>
          Ponowny kontakt (opcjonalnie)
          <input type="date" className={INPUT} value={recontact} onChange={(e) => setRecontact(e.target.value)} />
        </label>
        {error && <p className="m-0 text-[12.5px] text-[#B8612F]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_OUTLINE}>
            Anuluj
          </button>
          <button type="button" disabled={busy} onClick={() => void save()} className={BTN_PRIMARY}>
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pas wskaźników

function Indicator({ label, value, sub, warn = false }: { label: string; value: React.ReactNode; sub?: React.ReactNode; warn?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${warn ? "border-l-[3px] border-[#E08A5C] pl-3" : ""}`}>
      <div className={warn ? "text-[10.5px] uppercase tracking-[0.14em] text-[#B8612F]" : LABEL_WIDE}>{label}</div>
      <div className={`text-[22px] font-medium leading-tight tabular-nums ${warn ? "text-[#B8612F]" : "text-[#1B6FA8]"}`}>{value}</div>
      {sub && <div className="text-[12px] text-[#5C6166]">{sub}</div>}
    </div>
  );
}

export function Indicators({ d }: { d: ClientDetail }) {
  const n = d.overview.nextRental;
  const r = d.rhythm;
  const plannedRows = d.history.filter((h) => h.kind === "rental" && !h.deleted && h.upcoming);
  const planned = plannedRows.length;
  const t = d.txTotals;
  // Przychód 12 mies.: faktury i rozliczenia; wynajmy bez kwoty (z kalendarza)
  // — szacunek z ceny ustalonej (wynajem + transport).
  const { known, withoutAmount: unknown } = d.cardFacts.revenue12m;
  const price = d.profile.agreedPrice ? Number(d.profile.agreedPrice) + (d.transportPriceNet ? Number(d.transportPriceNet) : 0) : null;
  const estimate = known + (price ? unknown * price : 0);
  const estimated = unknown > 0 && !!price;
  const warn = t.overdueCount > 0 || t.noTransferCount > 0 || t.uncheckedCount > 0;
  const due = t.overdueCount
    ? `${money(t.overdueNet)} po terminie`
    : t.noTransferCount
      ? `${t.noTransferCount} FV bez wpłaty`
      : t.dueCount
        ? `${money(t.dueNet)} do zapłaty`
        : t.uncheckedCount
          ? `${t.uncheckedCount} FV do sprawdzenia`
          : "0 zł";

  return (
    <div className="grid grid-cols-2 gap-4 bg-[#EAF4FB] px-4 py-3 md:grid-cols-3 md:px-7 xl:grid-cols-5">
      <Indicator
        label="Następny wynajem"
        value={n ? `${weekdayShort(n.startsAt)} ${dm(n.startsAt)}${n.time ? ` · ${n.time}` : ""}` : r.forecast[0] ? `≈ ${dm(r.forecast[0])}` : "—"}
        sub={
          n ? (
            <>
              {`${n.deviceName}${n.heads ? ` ${n.heads} gł.` : ""}`}
              {n.time ? "" : " · godz. do ustalenia"}
              {n.smsSentAt && <span className="font-semibold text-[#2F7A68]"> · SMS {dm(n.smsSentAt)} ✓</span>}
            </>
          ) : r.forecast[0] ? (
            "prognoza z rytmu — brak rezerwacji"
          ) : (
            "brak zaplanowanych"
          )
        }
      />
      <Indicator
        label="Rytm"
        value={r.rhythmDays ? `co ${r.rhythmDays} dni` : "—"}
        sub={
          [
            r.preferredWeekday && r.preferredWeekday.share >= 0.5 ? `${r.preferredWeekday.count} z ${r.preferredWeekday.total} ${WEEKDAY_IN[r.preferredWeekday.day]}` : null,
            r.seasonalBreak.length ? `przerwa ${monthsLabel(r.seasonalBreak)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || (r.rhythmDays ? null : "za mało wynajmów")
        }
      />
      <Indicator
        label="Wynajmy"
        value={
          <>
            {d.summary.rentalsTotal} <span className="text-[14px] font-normal">· {d.summary.rentals12m} w 12 mies.</span>
          </>
        }
        sub={planned ? `+ ${planned} ${planned === 1 ? "zaplanowany" : "zaplanowane"} (${plannedRows.map((h) => dm(h.at)).reverse().join(", ")})` : "brak zaplanowanych"}
      />
      <Indicator
        label="Przychód 12 mies."
        value={estimate > 0 ? `${estimated ? "≈ " : ""}${money(Math.round(estimate))}` : "—"}
        sub={estimate > 0 ? (estimated ? `netto · ${unknown} × ${money(price!)} (szacunek)` : "netto · z faktur i rozliczeń") : "brak kwot w panelu"}
      />
      <Indicator
        label="Należności"
        warn={warn}
        value={due}
        sub={t.paymentsAsOf ? `wpłaty z okresu ${t.paymentsFrom ? `${dm(t.paymentsFrom)}–` : "do "}${dm(t.paymentsAsOf)}` : "wpłaty z banku: brak danych"}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Następny krok

export function NextStepBanner({ d, onChanged, notify, onTask }: { d: ClientDetail; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void; onTask: (title: string, due: string | null) => void }) {
  const agent = useContext(AgentModeContext);
  const step = d.profile.nextStep;
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(step?.text ?? "");
  const [due, setDue] = useState(step?.dueAt?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (edit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- formularz startuje od zapisanego kroku
    setText(step?.text ?? "");
    setDue(step?.dueAt?.slice(0, 10) ?? "");
  }, [edit, step]);

  async function save() {
    setBusy(true);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}`, "PATCH", { nextStepText: text, nextStepDueAt: due || null, ...(agent ? { changeSource: "karta klienta", changeConfidence: "MEDIUM" } : {}) });
    setBusy(false);
    if (!ok) return notify(data.message ?? "Nie udało się zapisać kroku.", true);
    setEdit(false);
    onChanged(data.detail);
  }

  const [manualTitle, ...rest] = (step?.text ?? "").split("\n");
  const derived = d.overview.nextStep;
  // Wniosek 26: pokazujemy najbliższą otwartą sprawę (krok sygnału, zadanie
  // albo ręczny krok) — jedno źródło; ręczny krok edytuje się jak dotąd.
  const fromCase = Boolean(derived && step && derived.text !== manualTitle && (!step.dueAt || (derived.at && derived.at < step.dueAt)));
  const title = fromCase ? derived!.text : manualTitle;
  const shownDue = fromCase ? derived!.at : (step?.dueAt ?? null);
  const r = d.rhythm;
  const footer = [r.forecast.length ? `prognoza: ${r.forecast.slice(0, 3).map((x) => dm(x)).join(", ")}` : null, r.rhythmDays ? `rytm co ${r.rhythmDays} dni` : null, r.churnRisk ? `ryzyko odejścia: ${r.churnRisk.level}` : null]
    .filter(Boolean)
    .join(" · ");
  const overdue = shownDue && new Date(shownDue).getTime() < new Date().setHours(0, 0, 0, 0);

  return (
    <div className="flex flex-col gap-2 bg-[#2B5B82] px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[#CFE3F2]">
        Następny krok
        {shownDue && !edit && <span className={overdue ? "text-white" : ""}> · {overdue ? "zaległe od" : "do"} {dm(shownDue)}</span>}
      </div>
      {edit ? (
        <>
          <textarea
            rows={3}
            className="w-full border border-[#46749A] bg-white px-3 py-2 text-[13px] text-[#333333] outline-none"
            placeholder={"Pierwsza linia = krok, kolejne = kontekst"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3 border-t border-[#46749A] pt-2">
            <input type="date" className={`${INPUT} w-auto`} value={due} onChange={(e) => setDue(e.target.value)} />
            <span className="flex-grow" />
            <button type="button" onClick={() => setEdit(false)} className="h-[34px] rounded-[6px] border border-[#CFE3F2] px-3 text-[13px] text-white">
              Anuluj
            </button>
            <button type="button" disabled={busy} onClick={() => void save()} className={BTN_TERRA}>
              Zapisz
            </button>
          </div>
        </>
      ) : step ? (
        <>
          {fromCase && derived?.href ? (
            <a href={`${BASE_PATH}${derived.href}`} className="text-left text-[16px] font-medium leading-[1.3] text-white hover:underline" title="Otwórz sygnał">
              {title}
            </a>
          ) : (
            <button type="button" onClick={() => setEdit(true)} className="text-left text-[16px] font-medium leading-[1.3] text-white hover:underline" title="Zmień">
              {title}
            </button>
          )}
          {fromCase ? (
            <div className="text-[13px] leading-[1.5] text-[#EAF4FB]">
              Ręczny krok: {manualTitle}
              {step?.dueAt ? ` · ${dm(step.dueAt)}` : ""}{" "}
              <button type="button" onClick={() => setEdit(true)} className="underline underline-offset-2">
                zmień
              </button>
            </div>
          ) : (
            rest.join(" ").trim() && <div className="text-[13px] leading-[1.5] text-[#EAF4FB]">{rest.join(" ").trim()}</div>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-[#46749A] pt-2">
            <button type="button" onClick={() => onTask(title, shownDue)} className={BTN_TERRA}>
              Utwórz zadanie dla Ani →
            </button>
            {footer && <span className="text-[12.5px] text-[#CFE3F2]">{footer}</span>}
          </div>
        </>
      ) : (
        <>
          {derived ? (
            // Wniosek 26: bez ręcznego kroku — najbliższa sprawa z sygnału / zadania.
            derived.href ? (
              <a href={`${BASE_PATH}${derived.href}`} className="text-[16px] font-medium leading-[1.3] text-white hover:underline">
                {derived.text}
                {derived.at ? ` · ${dm(derived.at)}` : ""}
              </a>
            ) : (
              <div className="text-[16px] font-medium leading-[1.3] text-white">
                {derived.text}
                {derived.at ? ` · ${dm(derived.at)}` : ""}
              </div>
            )
          ) : (
            <>
              <div className="text-[16px] font-medium leading-[1.3] text-white">Nie ustalono następnego kroku</div>
              <div className="text-[13px] leading-[1.5] text-[#EAF4FB]">Wpisz, co dalej z tym klientem — agent też może go zaproponować.</div>
            </>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-[#46749A] pt-2">
            <button type="button" onClick={() => setEdit(true)} className={BTN_TERRA}>
              Ustaw następny krok →
            </button>
            {footer && <span className="text-[12.5px] text-[#CFE3F2]">{footer}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ zadanie (dla Ani)

export function TaskDialog({
  d,
  initialTitle,
  initialDue,
  onClose,
  onDone,
}: {
  d: ClientDetail;
  initialTitle: string;
  initialDue: string | null;
  onClose: () => void;
  onDone: (n: ClientDetail) => void;
}) {
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ title: initialTitle, dueDate: initialDue?.slice(0, 10) ?? "", assigneeId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api<{ users: { id: string; name: string }[] }>("/api/tasks/assignees", "GET").then(({ ok, data }) => {
      if (!alive || !ok) return;
      setUsers(data.users);
      const ania = data.users.find((u) => /^ania\b|^anna\b/i.test(u.name));
      if (ania) setF((p) => (p.assigneeId ? p : { ...p, assigneeId: ania.id }));
    });
    return () => {
      alive = false;
    };
  }, []);
  async function save() {
    setBusy(true);
    setError(null);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/tasks`, "POST", { title: f.title, dueDate: f.dueDate || null, assigneeId: f.assigneeId || undefined });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się utworzyć zadania.");
    onDone(data.detail);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex w-full max-w-md flex-col gap-3 bg-white p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Nowe zadanie">
        <h2 className="card-display m-0 text-[17px] font-medium text-[var(--c-navy)]">Nowe zadanie · {d.name}</h2>
        <input className={INPUT} autoFocus placeholder="Co zrobić?" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className={INPUT} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          <select className={INPUT} value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
            <option value="">dla mnie</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className=" bg-[var(--c-red-soft)] px-3 py-2 text-[12.5px] text-[var(--c-red)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_OUTLINE}>
            Anuluj
          </button>
          <button type="button" disabled={busy || !f.title.trim()} onClick={() => void save()} className={BTN_PRIMARY}>
            Utwórz zadanie
          </button>
        </div>
      </div>
    </div>
  );
}
