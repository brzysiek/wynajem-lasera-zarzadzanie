"use client";

import { RentalClientField, type ClientCandidate, type PickedClient } from "@/components/rental-client-field";
import { isGenericTitleKey } from "@/lib/clients/rental-match-rules";
import { normalizeTitle } from "@/lib/history/normalize-title";
import { OpenTasks } from "@/components/open-tasks";
import type { OpenTaskDto } from "@/lib/task-links";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { DevicePricingCategory, RentalEventType } from "@prisma/client";
import { BASE_PATH } from "@/lib/base-path";
import { applySmsPlaceholders } from "@/lib/sms-template";
import { withDeliveryTimePrefix } from "@/lib/rental-title";
import { QueueCancelBadge } from "@/components/queue-cancel-badge";
import { RentalFinanceSection, type FinancePayload } from "@/components/rental-finance-section";
import type { PreviewPriceRule, PreviewPulseTier } from "@/lib/pricing/preview";
import type { RentalFinanceDto } from "@/lib/finance";
import { rentalDurationDays } from "@/lib/pricing/duration";
import { variantLabel } from "@/lib/pricing/variants";
import type { ClientTermsDto } from "@/lib/clients/terms";

export type Device = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  active: boolean;
  // Obecne tylko w formularzu wynajmu (sekcja Finanse) — kalendarz/nadchodzące
  // ładują urządzenia bez tych pól.
  pricingCategory?: DevicePricingCategory | null;
  variantOptions?: string[];
};

// driverColor: null = brak przypisanego koloru — ikona kierownicy na
// kafelku kalendarza wraca do neutralnego wyglądu (patrz DriverBadge w
// calendar-view.tsx).
export type DriverOption = { id: string; name: string; driverColor: string | null };
export type VehicleOption = { id: string; name: string };

export type ReminderDays = 1 | 3 | 7;
// 0 = one-off "reservation confirmation" offset. Historically sent via the
// same scheduled ReminderRule/cron pipeline as day-before reminders — now
// superseded by the manual composer below (see ClientMessageComposer) — but
// the offset/template machinery around it (TEMPLATE_KEYS, DEFAULT_TEMPLATE_BODY
// in reminders.ts) is left in place since old SENT/SCHEDULED rules and the
// "reservation_confirmation" template itself are still relied upon.
export type ReminderOffset = 0 | ReminderDays;

export type SmsTemplateOption = { id: string; key: string; label: string; body: string };

export type ReminderRuleSummary = {
  id: string;
  daysBefore: ReminderOffset;
  status: "SCHEDULED" | "QUEUED" | "SENT" | "FAILED" | "CANCELLED";
  sentAt: string | null;
  scheduledFor: string;
  errorMessage: string | null;
  edited: boolean;
  messageBody: string;
};

export type MessageSummary = {
  id: string;
  recipient: string;
  body: string;
  status: "SENT" | "FAILED";
  errorMessage: string | null;
  sentAt: string;
};

export type Rental = {
  // Klient panelu (CRM); brak = ostrzeżenie w kalendarzu (wniosek 13). Opcjonalne — nie każdy DTO je niesie.
  clientId?: string | null;
  id: string;
  deviceId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  eventType?: RentalEventType;
  finance?: RentalFinanceDto | null;
  hubspotContactId?: string | null;
  driverId?: string | null;
  driver?: DriverOption | null;
  vehicleId?: string | null;
  vehicle?: VehicleOption | null;
  contactNameCache?: string | null;
  contactPhoneCache?: string | null;
  contactEmailCache?: string | null;
  contactCompanyCache?: string | null;
  contactAddressCache?: string | null;
  contactTransportPriceCache?: string | null;
  contactDistanceKm?: string | null;
  internalNotes?: string | null;
  deliveryAddress?: string | null;
  // Adres z paszportu dostawy klienta (null = domyślny klienta / wpisany ręcznie).
  deliveryAddressId?: string | null;
  deliveryTime?: string | null;
  pickupTime?: string | null;
  transportPrice?: string | null;
  reminderRules?: ReminderRuleSummary[];
  messages?: MessageSummary[];
  // Wniosek 29: osoba na miejscu, szkolenie, powiązany sygnał (edycja).
  clientContactId?: string | null;
  trainingPlace?: string | null;
  trainingLead?: string | null;
  trainingParticipants?: number | null;
  lead?: { id: string; title: string } | null;
};

export type ReminderTemplatePreview = { offset: ReminderOffset; templateId: string; body: string };

// Wniosek 29: tylko „3 dni przed” (domyślnie) i „dzień przed”; tydzień —
// wyłącznie dla już zaplanowanych przypomnień (niech się wyślą).
const REMINDER_OPTIONS: { days: ReminderDays; label: string }[] = [
  { days: 3, label: "3 dni przed" },
  { days: 1, label: "dzień przed" },
];
const LEGACY_WEEK_OPTION: { days: ReminderDays; label: string } = { days: 7, label: "tydzień przed (zaplanowane wcześniej)" };

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

// Whole calendar days remaining until the rental's start date (negative/zero
// once it has started). A "N dni przed" reminder only makes sense while at
// least N days remain — otherwise its template text (e.g. "za 3 dni") would
// be factually wrong by the time it went out.
function daysUntilStart(startsAt: string): number {
  const start = new Date(startsAt);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((startDay.getTime() - todayDay.getTime()) / 86_400_000);
}

function ReminderOptionRow({
  label,
  checked,
  disabled,
  sent,
  sentAt,
  failedMessage,
  impossibleReason,
  queuedRuleId,
  queuedDaysBefore,
  queuedScheduledFor,
  queuedMessageBody,
  onToggle,
  onCancelled,
  template,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  sent: boolean;
  sentAt: string | null;
  failedMessage: string | null;
  impossibleReason: string | null;
  queuedRuleId: string | null;
  queuedDaysBefore: ReminderDays | null;
  queuedScheduledFor: string | null;
  queuedMessageBody: string;
  onToggle: () => void;
  onCancelled: () => void;
  template?: ReminderTemplatePreview;
}) {
  const queued = Boolean(queuedRuleId);
  return (
    <label
      className={`flex flex-col gap-1 rounded-md border p-2.5 ${
        sent
          ? "border-green-200 bg-green-50"
          : queued
            ? "border-amber-200 bg-amber-50"
            : impossibleReason
              ? "border-red-100 bg-red-50/60"
              : "border-gray-200 bg-white"
      }`}
    >
      <span
        className={`flex items-center gap-2 text-sm ${
          sent ? "text-green-700" : queued ? "text-amber-700" : impossibleReason ? "text-red-500" : "text-gray-800"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          className={sent ? "accent-green-600" : queued ? "accent-amber-500" : impossibleReason ? "accent-red-500" : undefined}
        />
        {label}
        {queuedRuleId && queuedDaysBefore && (
          <span onClick={(e) => e.preventDefault()}>
            <QueueCancelBadge
              ruleId={queuedRuleId}
              daysBefore={queuedDaysBefore}
              initialMessageBody={queuedMessageBody}
              onCancelled={onCancelled}
            />
          </span>
        )}
      </span>
      {sent && sentAt && <span className="ml-6 text-xs text-green-700">wysłano {formatDateTime(sentAt)}</span>}
      {queued && queuedScheduledFor && (
        <span className="ml-6 text-xs text-amber-700">zakolejkowane — wysyłka: {formatDateTime(queuedScheduledFor)}</span>
      )}
      {failedMessage && <span className="ml-6 text-xs text-red-600">błąd wysyłki: {failedMessage}</span>}
      {impossibleReason && <span className="ml-6 text-xs text-red-500">{impossibleReason}</span>}
      {template && (
        <div className="ml-6 mt-0.5 flex items-start justify-between gap-2">
          <p className="line-clamp-2 flex-1 text-xs italic text-gray-400">„{template.body}”</p>
          {template.templateId && (
            <Link
              href={`/ustawienia/szablony-sms#template-${template.templateId}`}
              target="_blank"
              rel="noreferrer"
              className="flex-none text-xs font-medium text-[#1B6FA8] hover:underline"
            >
              Edytuj →
            </Link>
          )}
        </div>
      )}
    </label>
  );
}

function ReminderSection({
  rental,
  device,
  startsAt,
  selectedDays,
  onToggleDay,
  onCancelQueued,
  templates,
}: {
  rental: Rental | null;
  device: Device | undefined;
  startsAt: string;
  selectedDays: Set<ReminderDays>;
  onToggleDay: (days: ReminderDays) => void;
  onCancelQueued: (days: ReminderDays) => void;
  templates: ReminderTemplatePreview[];
}) {
  const remaining = daysUntilStart(startsAt);
  const templateFor = (offset: ReminderOffset) => templates.find((t) => t.offset === offset);
  const placeholderCtx = {
    clientName: rental?.contactNameCache,
    deviceName: device?.name,
    startsAt: rental?.startsAt,
    endsAt: rental?.endsAt,
  };

  const weekRule = rental?.reminderRules?.find((r) => r.daysBefore === 7 && (r.status === "SCHEDULED" || r.status === "QUEUED" || r.status === "SENT"));
  const options = weekRule ? [...REMINDER_OPTIONS, LEGACY_WEEK_OPTION] : REMINDER_OPTIONS;
  return (
    <div className="flex flex-col gap-1.5 text-sm text-gray-700">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400">
        <span className="mr-1.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1F3A5F] text-[11px] text-white">5</span>
        Przypomnienie SMS
      </span>
      <div className="flex flex-col gap-2">
        {options.map(({ days, label }) => {
          const rule = rental?.reminderRules?.find((r) => r.daysBefore === days);
          const sent = rule?.status === "SENT";
          const queued = rule?.status === "QUEUED";
          const impossible = !sent && remaining < days;
          const disabled = sent || impossible;
          const checked = sent ? true : impossible ? false : selectedDays.has(days);
          const template = templateFor(days);
          const queuedMessageBody = queued
            ? rule!.edited
              ? rule!.messageBody
              : template
                ? applySmsPlaceholders(template.body, placeholderCtx)
                : ""
            : "";
          return (
            <ReminderOptionRow
              key={days}
              label={label}
              checked={checked}
              disabled={disabled}
              sent={Boolean(sent)}
              sentAt={rule?.sentAt ?? null}
              failedMessage={rule?.status === "FAILED" ? rule.errorMessage || "nieznany błąd" : null}
              impossibleReason={
                impossible ? `za mało czasu do wynajmu (${Math.max(remaining, 0)} ${remaining === 1 ? "dzień" : "dni"})` : null
              }
              queuedRuleId={queued ? rule!.id : null}
              queuedDaysBefore={queued ? days : null}
              queuedScheduledFor={queued ? rule!.scheduledFor : null}
              queuedMessageBody={queuedMessageBody}
              onToggle={() => onToggleDay(days)}
              onCancelled={() => onCancelQueued(days)}
              template={template}
            />
          );
        })}
      </div>
    </div>
  );
}

// Mini SMS composer scoped to this rental: pick a template (defaults to the
// reservation-confirmation one) or write free text, with rental-context
// placeholders ({rezerwacja_*}) pre-filled, and send immediately — unlike
// ReminderSection above, this never schedules anything, it sends on click.
function ClientMessageComposer({ rental, device, templates }: { rental: Rental; device: Device | undefined; templates: SmsTemplateOption[] }) {
  const router = useRouter();
  const defaultTemplate = templates.find((t) => t.key === "reservation_confirmation") ?? null;
  const placeholderCtx = {
    clientName: rental.contactNameCache,
    deviceName: device?.name,
    startsAt: rental.startsAt,
    endsAt: rental.endsAt,
  };

  const [templateId, setTemplateId] = useState(defaultTemplate?.id ?? "");
  const [phone, setPhone] = useState(rental.contactPhoneCache ?? "");
  const [message, setMessage] = useState(() => (defaultTemplate ? applySmsPlaceholders(defaultTemplate.body, placeholderCtx) : ""));
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    setMessage(template ? applySmsPlaceholders(template.body, placeholderCtx) : "");
  }

  async function handleSend() {
    setIsSending(true);
    setSendError(null);
    setSendSuccess(false);
    const { ok, data } = await api("/api/sms/send", {
      method: "POST",
      body: JSON.stringify({ phone, message, rentalId: rental.id }),
    });
    setIsSending(false);
    if (!ok) {
      setSendError(data?.message || "Nie udało się wysłać wiadomości.");
      return;
    }
    setSendSuccess(true);
    router.refresh();
  }

  const canSend = phone.trim().length > 0 && message.trim().length > 0 && !isSending;

  return (
    <div className="flex flex-col gap-1.5 text-sm text-gray-700">
      Wiadomość do klienta
      <div className="flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-2.5">
        <select
          value={templateId}
          onChange={(e) => applyTemplate(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-[#1B6FA8] focus:outline-none"
        >
          <option value="">— własna wiadomość —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Numer telefonu"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-[#1B6FA8] focus:outline-none"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-[#1B6FA8] focus:outline-none"
        />
        {sendError && <p className="text-xs text-red-700">{sendError}</p>}
        {sendSuccess && <p className="text-xs text-green-700">Wysłano.</p>}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="self-start rounded-md bg-[#1B6FA8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#14567F] disabled:opacity-50"
        >
          {isSending ? "Wysyłanie…" : "Wyślij SMS"}
        </button>
      </div>
    </div>
  );
}

function MessageHistorySection({ messages }: { messages: MessageSummary[] }) {
  if (messages.length === 0) {
    return <p className="text-xs text-gray-400">Brak wysłanych SMS-ów dla tego wynajmu.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {messages.map((m) => (
        <li key={m.id} className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-medium text-gray-900">{m.recipient}</span>
            <span className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  m.status === "SENT" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                }`}
              >
                {m.status === "SENT" ? "wysłano" : "błąd"}
              </span>
              <span className="text-gray-400">{formatDateTime(m.sentAt)}</span>
            </span>
          </div>
          <p className="text-gray-600">{m.body}</p>
          {m.errorMessage && <p className="mt-1 text-red-600">{m.errorMessage}</p>}
        </li>
      ))}
    </ul>
  );
}

export type AssignedContact = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  address: string | null;
  transportPrice: string | null;
  url: string | null;
};

async function api(url: string, init?: RequestInit) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart(day?: Date): string {
  const date = day ? new Date(day) : new Date();
  if (day) {
    date.setHours(9, 0, 0, 0);
  } else {
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() + 1);
  }
  return toLocalInputValue(date.toISOString());
}

function defaultEnd(start: string): string {
  const date = new Date(start);
  date.setHours(date.getHours() + 4);
  return toLocalInputValue(date.toISOString());
}

const ymdAdd = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const dmShort = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;

type AddressOption = { id: string; label: string; isDefault: boolean; line: string; distanceKm: number | null; durationMin: number | null };
type ClientBrief = {
  client: { id: string; name: string; shortName: string | null; status: string | null; resigned: boolean; rhythm: string | null; lastRental: string | null; next: string[]; terms: string; individual: boolean };
  contacts: { id: string; name: string; phone: string | null; isPrimary: boolean }[];
};
type Availability = { free: boolean; conflicts: { id: string; title: string; clientName: string | null; od: string; do: string }[]; suggestions: string[] };
type SeriesTerm = { od: string; do: string; busy: { id: string; title: string; clientName: string | null } | null };

// Krótkie etykiety wariantów do przełącznika w wierszu „Urządzenie i termin”.
const VARIANT_SEG: Record<string, string> = {
  single_standard: "1 gł.",
  single_flex: "1 gł. (impulsy)",
  double: "2 gł.",
  dye_vl: "Dye-VL",
  dye_vl_ipixel: "oba",
  er_yag_ipixel: "iPixel",
};

const CARD = "rounded-[10px] border border-gray-200 bg-white p-4 sm:px-[18px]";
const INPUT_CLS = "w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm text-gray-900 focus:border-[#1B6FA8] focus:outline-none";
const LABEL_CLS = "flex flex-col gap-1 text-xs text-gray-600";

function CardTitle({ n, children, tag }: { n: number; children: React.ReactNode; tag?: string }) {
  return (
    <div className="mb-2.5 flex items-center text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-400">
      <span className="mr-1.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1F3A5F] text-[11px] text-white">{n}</span>
      {children}
      {tag && <span className="ml-1.5 text-[11px] font-normal normal-case tracking-normal text-gray-400">{tag}</span>}
    </div>
  );
}

function BackArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M17 10a.75.75 0 0 1-.75.75H5.56l4.22 4.22a.75.75 0 1 1-1.06 1.06l-5.5-5.5a.75.75 0 0 1 0-1.06l5.5-5.5a.75.75 0 1 1 1.06 1.06L5.56 9.25H16.25A.75.75 0 0 1 17 10Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Formularz rezerwacji (wniosek 29, wzór rezerwacja-wzor.html): 1 Klient
// (z panelu — wczytuje warunki, adresy, transport ustalony i osoby) · 2
// Urządzenie + wariant + od/do z kontrolą dostępności · 3 Dostawa (albo
// Szkolenie) · 4 Finanse (znacznik źródła przy kwocie) · 5 Przypomnienia SMS.
// Na dole seria „co N tyg.” i „Zapisz i dodaj kolejny”. Kierowca, wiadomość
// do klientki, historia SMS, zadania i sygnał — dopiero w edycji.
export function RentalForm({
  devices,
  rental,
  defaultDeviceId,
  defaultDateIso,
  prefill,
  reminderTemplates,
  smsTemplates = [],
  drivers = [],
  vehicles = [],
  canManageDrivers = false,
  canManageFinance = false,
  previewPriceRules = [],
  previewPulseTiers = [],
  defaultVatRate = 23,
  backHref,
  openTasks = [],
  initialClient = null,
  clientCandidates = [],
  initialVariant = null,
  initialAddressId = null,
}: {
  devices: Device[];
  rental: Rental | null;
  defaultDeviceId?: string;
  defaultDateIso?: string;
  // Nowa rezerwacja z sygnału (lejek): tytuł i sygnał do powiązania.
  prefill?: { leadId: string; title: string | null; contact?: AssignedContact | null };
  reminderTemplates: ReminderTemplatePreview[];
  smsTemplates?: SmsTemplateOption[];
  drivers?: DriverOption[];
  vehicles?: VehicleOption[];
  // Tylko ADMIN: kierowca / pojazd i zapis mimo kolizji urządzenia.
  canManageDrivers?: boolean;
  // ADMIN/STAFF widzą sekcję „Finanse".
  canManageFinance?: boolean;
  previewPriceRules?: PreviewPriceRule[];
  previewPulseTiers?: PreviewPulseTier[];
  defaultVatRate?: number;
  backHref: string;
  // Wniosek 22: otwarte zadania powiązane z rezerwacją.
  openTasks?: OpenTaskDto[];
  // Wniosek 23: klient rezerwacji (wymagany) i kandydaci, gdy go brak.
  initialClient?: PickedClient | null;
  clientCandidates?: ClientCandidate[];
  // „Zapisz i dodaj kolejny”: zostaje wariant i adres.
  initialVariant?: string | null;
  initialAddressId?: string | null;
}) {
  const router = useRouter();
  const isEditing = Boolean(rental);
  const isAdmin = canManageDrivers;
  const [deviceId, setDeviceId] = useState(rental?.deviceId ?? defaultDeviceId ?? devices[0]?.id ?? "");
  const [client, setClient] = useState<PickedClient | null>(initialClient);
  const clientTitle = (c: PickedClient | null) => (c ? (c.shortName ?? c.name) : "");
  const [title, setTitle] = useState(rental?.title ?? prefill?.title ?? clientTitle(initialClient));
  const [autoTitle, setAutoTitle] = useState<string | null>(rental ? null : (prefill?.title ?? clientTitle(initialClient)) || null);
  // Alias z tytułu przy pierwszym przypisaniu (domyślnie tak, bez ogólnych tytułów).
  const [aliasFromTitle, setAliasFromTitle] = useState(true);
  const [description, setDescription] = useState(rental?.description ?? "");
  const [internalNotes, setInternalNotes] = useState(rental?.internalNotes ?? "");
  const allDay = true;
  const toDateOnlyValue = (value: string) => `${value.slice(0, 10)}T00:00`;
  const initialStart = toDateOnlyValue(rental ? toLocalInputValue(rental.startsAt) : defaultStart(defaultDateIso ? new Date(defaultDateIso) : undefined));
  const [startsAt, setStartsAt] = useState(initialStart);
  const [endsAt, setEndsAt] = useState(toDateOnlyValue(rental ? toLocalInputValue(rental.endsAt) : defaultEnd(initialStart)));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState(rental?.deliveryAddress ?? "");
  const [deliveryAddressId, setDeliveryAddressId] = useState<string | null>(rental?.deliveryAddressId ?? initialAddressId ?? null);
  const [otherAddress, setOtherAddress] = useState(Boolean(rental && !rental.deliveryAddressId && rental.deliveryAddress));
  const [deliveryTime, setDeliveryTime] = useState(rental?.deliveryTime ?? "");
  const [pickupTime, setPickupTime] = useState(rental?.pickupTime ?? "");
  const [transportPrice, setTransportPrice] = useState(rental?.transportPrice ?? rental?.contactTransportPriceCache ?? "");
  const [driverId, setDriverId] = useState(rental?.driverId ?? "");
  const [vehicleId, setVehicleId] = useState(rental?.vehicleId ?? "");
  const [eventType, setEventType] = useState<RentalEventType>(rental?.eventType ?? "WYNAJEM");
  const [deviceVariant, setDeviceVariant] = useState<string>(rental?.finance?.deviceVariant ?? initialVariant ?? "");
  const [onSiteId, setOnSiteId] = useState<string | null>(rental?.clientContactId ?? null);
  const [training, setTraining] = useState({ place: rental?.trainingPlace ?? "U_KLIENTKI", lead: rental?.trainingLead ?? "Ania", participants: rental?.trainingParticipants != null ? String(rental.trainingParticipants) : "" });
  const [allowConflict, setAllowConflict] = useState(false);
  const [series, setSeries] = useState<{ weeks: number; until: string }>({ weeks: 0, until: `${new Date().getFullYear() + 1}-06-30` });
  const [seriesTerms, setSeriesTerms] = useState<SeriesTerm[] | null>(null);
  const [showSeries, setShowSeries] = useState(false);
  const financeRef = useRef<FinancePayload | null>(null);
  const handleFinanceChange = useCallback((p: FinancePayload) => {
    financeRef.current = p;
  }, []);
  const isSzkolenie = eventType === "SZKOLENIE";
  const durationDays = rentalDurationDays(new Date(startsAt), new Date(endsAt));
  const device = devices.find((d) => d.id === deviceId);
  const variantOptions = isSzkolenie ? [] : (device?.variantOptions ?? []);
  const clientId = client?.id ?? null;

  // Klient z pola „Klient *” wczytuje swoje dane (wniosek 29, błąd 1):
  // warunki, adresy z paszportu, transport ustalony, osoby.
  const termsQuery = canManageFinance && clientId ? `klient=${encodeURIComponent(clientId)}&dzien=${startsAt.slice(0, 10)}${rental ? `&bez=${encodeURIComponent(rental.id)}` : ""}` : "";
  const [loadedTerms, setLoadedTerms] = useState<{ query: string; terms: ClientTermsDto | null } | null>(null);
  useEffect(() => {
    if (!termsQuery) return;
    let cancelled = false;
    void fetch(`${BASE_PATH}/api/rentals/client-terms?${termsQuery}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { terms?: ClientTermsDto | null } | null) => {
        if (!cancelled) setLoadedTerms({ query: termsQuery, terms: data?.terms ?? null });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [termsQuery]);
  const clientTerms = loadedTerms?.query === termsQuery ? loadedTerms.terms : null;

  const [brief, setBrief] = useState<{ id: string; data: ClientBrief } | null>(null);
  const [addresses, setAddresses] = useState<{ id: string; list: AddressOption[] } | null>(null);
  const autoAddressRef = useRef(!rental || (!rental.deliveryAddressId && !rental.deliveryAddress));
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void api(`/api/rentals/client-brief?klient=${encodeURIComponent(clientId)}${rental ? `&bez=${encodeURIComponent(rental.id)}` : ""}`).then(({ ok, data }) => {
      if (!cancelled && ok) setBrief({ id: clientId, data: data as ClientBrief });
    });
    void api(`/api/rentals/delivery-addresses?klient=${encodeURIComponent(clientId)}`).then(({ ok, data }) => {
      if (cancelled || !ok) return;
      const list = ((data as { addresses?: AddressOption[] })?.addresses ?? []) as AddressOption[];
      setAddresses({ id: clientId, list });
      // Adres domyślny podstawiamy sami, gdy nic nie wybrano ani nie wpisano.
      if (autoAddressRef.current) {
        const pick = list.find((a) => a.id === initialAddressId) ?? list.find((a) => a.isDefault) ?? list[0];
        if (pick) {
          setDeliveryAddressId(pick.id);
          setDeliveryAddress(pick.line);
          setOtherAddress(false);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, rental, initialAddressId]);
  const clientBrief = brief?.id === clientId ? brief.data : null;
  const addressList = addresses?.id === clientId ? addresses.list : [];
  const pickedAddress = addressList.find((a) => a.id === deliveryAddressId) ?? null;
  const contacts = clientBrief?.contacts ?? [];
  const onSite = contacts.find((p) => p.id === onSiteId) ?? contacts.find((p) => p.isPrimary) ?? contacts[0] ?? null;

  // Dostępność urządzenia (wniosek 29, błąd 3).
  const availKey = deviceId ? `${deviceId}|${startsAt.slice(0, 10)}|${endsAt.slice(0, 10)}` : "";
  const [avail, setAvail] = useState<{ key: string; data: Availability } | null>(null);
  useEffect(() => {
    if (!deviceId || endsAt < startsAt) return;
    let cancelled = false;
    const q = new URLSearchParams({ urzadzenie: deviceId, od: startsAt.slice(0, 10), do: endsAt.slice(0, 10), ...(rental ? { bez: rental.id } : {}) });
    const t = setTimeout(() => {
      void api(`/api/rentals/availability?${q.toString()}`).then(({ ok, data }) => {
        if (!cancelled && ok) setAvail({ key: `${deviceId}|${startsAt.slice(0, 10)}|${endsAt.slice(0, 10)}`, data: data as Availability });
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [deviceId, startsAt, endsAt, rental]);
  const availability = avail?.key === availKey ? avail.data : null;

  // Seria: terminy „co N tyg. do dnia …” z oznaczeniem zajętych.
  const seriesKey = !isEditing && series.weeks ? `${deviceId}|${startsAt.slice(0, 10)}|${endsAt.slice(0, 10)}|${series.weeks}|${series.until}` : "";
  const [seriesLoaded, setSeriesLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (!seriesKey) return;
    let cancelled = false;
    void api("/api/rentals/availability", { method: "POST", body: JSON.stringify({ urzadzenie: deviceId, od: startsAt.slice(0, 10), do: endsAt.slice(0, 10), co_tyg: series.weeks, do_dnia: series.until }) }).then(({ ok, data }) => {
      if (cancelled) return;
      setSeriesTerms(ok ? ((data as { terms: SeriesTerm[] }).terms ?? []) : []);
      setSeriesLoaded(seriesKey);
    });
    return () => {
      cancelled = true;
    };
  }, [seriesKey, deviceId, startsAt, endsAt, series.weeks, series.until]);
  const seriesList = seriesKey && seriesLoaded === seriesKey ? (seriesTerms ?? []) : [];
  const seriesBusy = seriesList.filter((t) => t.busy);

  const [reminderDays, setReminderDays] = useState<Set<ReminderDays>>(() => {
    // Wniosek 29: nowe — tylko „3 dni przed”; już zaplanowane 7-dniowe zostają.
    if (!rental) return new Set([3]);
    const checked = rental.reminderRules
      ?.filter((r) => r.status === "SENT" || r.status === "SCHEDULED" || r.status === "QUEUED")
      .map((r) => r.daysBefore)
      .filter((d): d is ReminderDays => d === 1 || d === 3 || d === 7);
    return new Set(checked ?? []);
  });

  const assignedDriver = rental?.driver ?? null;
  const driverOptions: DriverOption[] = assignedDriver && !drivers.some((d) => d.id === assignedDriver.id) ? [assignedDriver, ...drivers] : drivers;
  const assignedVehicle = rental?.vehicle ?? null;
  const vehicleOptions: VehicleOption[] = assignedVehicle && !vehicles.some((v) => v.id === assignedVehicle.id) ? [assignedVehicle, ...vehicles] : vehicles;

  function goBack() {
    router.push(backHref);
  }

  function toggleReminderDay(days: ReminderDays) {
    setReminderDays((prev) => {
      const next = new Set(prev);
      if (next.has(days)) next.delete(days);
      else next.add(days);
      return next;
    });
  }

  function cancelQueuedReminderDay(days: ReminderDays) {
    setReminderDays((prev) => {
      const next = new Set(prev);
      next.delete(days);
      return next;
    });
  }

  // Tytuł = nazwa robocza gabinetu (bez urządzenia i wariantu — urządzenie
  // widać po kolorze kalendarza); nadpisujemy tylko pusty albo wygenerowany.
  function handleClientChange(c: PickedClient | null) {
    setClient(c);
    setOnSiteId(null);
    autoAddressRef.current = !deliveryAddressId && !deliveryAddress.trim() ? true : autoAddressRef.current || !isEditing;
    if (!c) return;
    const next = clientTitle(c);
    if (!title.trim() || title === autoTitle) {
      setTitle(next);
      setAutoTitle(next);
    }
  }

  function setDevice(id: string) {
    setDeviceId(id);
    const opts = devices.find((d) => d.id === id)?.variantOptions ?? [];
    if (deviceVariant && !opts.includes(deviceVariant)) setDeviceVariant("");
  }

  function pickSuggestion(ymd: string) {
    const len = durationDays - 1;
    setStartsAt(`${ymd}T00:00`);
    setEndsAt(`${ymdAdd(ymd, len)}T00:00`);
  }

  function buildBody(range?: { od: string; do: string }): Record<string, unknown> | string {
    const remaining = daysUntilStart(range ? `${range.od}T00:00` : startsAt);
    const sentDays = new Set(rental?.reminderRules?.filter((r) => r.status === "SENT" || r.status === "QUEUED").map((r) => r.daysBefore) ?? []);
    const effectiveReminderDays = Array.from(reminderDays).filter((d) => sentDays.has(d) || remaining >= d);
    if (!client) return "Wybierz klienta rezerwacji (albo dodaj nowego).";
    if (variantOptions.length > 0 && !deviceVariant) return "Wybierz wariant urządzenia.";
    const f = financeRef.current;
    if (canManageFinance && !isSzkolenie && clientTerms && clientTerms.transportNet == null && !clientTerms.transportTakenBy && !(f?.transportPriceNet ?? "").trim()) {
      return "Klient nie ma transportu ustalonego — wpisz kwotę transportu (zapisze się w karcie klienta).";
    }
    const body: Record<string, unknown> = {
      clientId: client.id,
      aliasFromTitle,
      deviceId,
      title,
      description,
      internalNotes,
      allDay,
      startsAt: new Date(range ? `${range.od}T00:00` : startsAt).toISOString(),
      endsAt: new Date(range ? `${range.do}T00:00` : endsAt).toISOString(),
      reminderDays: effectiveReminderDays,
      deliveryAddress: isSzkolenie ? "" : deliveryAddress,
      deliveryAddressId: isSzkolenie ? null : deliveryAddressId,
      deliveryTime: isSzkolenie ? "" : deliveryTime,
      pickupTime: isSzkolenie ? "" : pickupTime,
      transportPrice: isSzkolenie ? "" : transportPrice,
      // km tylko z paszportu dostawy (bez ręcznego pola).
      ...(pickedAddress && !isSzkolenie ? { contactDistanceKm: pickedAddress.distanceKm != null ? String(pickedAddress.distanceKm).replace(".", ",") : "" } : {}),
      clientContactId: onSite?.id ?? null,
      eventType,
      trainingPlace: training.place,
      trainingLead: training.lead,
      trainingParticipants: training.participants,
      ...(allowConflict && isAdmin ? { allowConflict: true } : {}),
    };
    if (canManageDrivers && isEditing) {
      body.driverId = driverId || null;
      body.vehicleId = vehicleId || null;
    }
    if (canManageFinance && f) body.finance = { ...f, deviceVariant: isSzkolenie ? null : deviceVariant || null };
    if (!isEditing && prefill?.leadId) body.leadId = prefill.leadId;
    return body;
  }

  async function save(mode: "close" | "next") {
    setError(null);
    if (availability && !availability.free && !(isAdmin && allowConflict)) {
      setError(isAdmin ? "Urządzenie zajęte w tym terminie — zmień daty albo zaznacz „Zapisz mimo kolizji”." : "Urządzenie zajęte w tym terminie — zmień daty (zapis przy kolizji zatwierdza administrator).");
      return;
    }
    const body = buildBody();
    if (typeof body === "string") return setError(body);
    setIsSaving(true);
    const { ok, data } = isEditing ? await api(`/api/rentals/${rental!.id}`, { method: "PATCH", body: JSON.stringify(body) }) : await api("/api/rentals", { method: "POST", body: JSON.stringify(body) });
    if (!ok) {
      setIsSaving(false);
      setError(data?.message || "Nie udało się zapisać rezerwacji.");
      return;
    }
    // Seria: każdy wolny termin to osobna rezerwacja z tym samym klientem.
    let created = 0;
    const skipped: string[] = [];
    if (!isEditing && series.weeks) {
      for (const t of seriesList.slice(1)) {
        if (t.busy) {
          skipped.push(dmShort(t.od));
          continue;
        }
        const b = buildBody({ od: t.od, do: t.do });
        if (typeof b === "string") break;
        delete b.leadId;
        const res = await api("/api/rentals", { method: "POST", body: JSON.stringify(b) });
        if (res.ok) created++;
        else skipped.push(`${dmShort(t.od)} (${res.data?.message ?? "błąd"})`);
      }
    }
    setIsSaving(false);
    if (data?.financeError) {
      setError(`Zapisano wynajem, ale: ${data.financeError}`);
      return;
    }
    if (series.weeks && !isEditing) window.alert(`Seria: zapisano ${created + 1} ${created + 1 === 1 ? "termin" : "terminów"}.${skipped.length ? ` Pominięte: ${skipped.join(", ")}.` : ""}`);
    if (typeof data?.autoAssigned === "number" && data.autoAssigned > 0) {
      window.alert(`Przypisano też ${data.autoAssigned} ${data.autoAssigned === 1 ? "kolejny termin" : "kolejne terminy"} z tym tytułem lub serią.`);
    }
    if (mode === "next" && !isEditing) {
      // Zostaje klient, urządzenie, wariant i adres; termin — dzień po tym.
      const q = new URLSearchParams({ klient: client!.id, device: deviceId, date: ymdAdd(endsAt.slice(0, 10), 1), ...(deviceVariant ? { wariant: deviceVariant } : {}), ...(deliveryAddressId ? { adres: deliveryAddressId } : {}) });
      router.push(`/kalendarz/wynajem/nowy?${q.toString()}`);
      router.refresh();
      return;
    }
    goBack();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save("close");
  }

  async function handleDelete() {
    if (!rental) return;
    setIsDeleting(true);
    setError(null);
    const { ok, data } = await api(`/api/rentals/${rental.id}`, { method: "DELETE" });
    setIsDeleting(false);
    if (!ok) {
      setError(data?.message || "Nie udało się usunąć rezerwacji.");
      return;
    }
    goBack();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={goBack} aria-label="Powrót do kalendarza" title="Powrót do kalendarza" className="flex-none rounded-md border border-gray-300 bg-white p-2 text-gray-600 hover:bg-gray-50">
          <BackArrowIcon />
        </button>
        <h1 className="text-xl font-semibold text-gray-900">{isEditing ? "Edytuj rezerwację" : "Nowa rezerwacja"}</h1>
        {canManageFinance && (
          <div className="ml-auto flex overflow-hidden rounded-md border border-gray-300" role="group" aria-label="Typ wydarzenia">
            {(["WYNAJEM", "SZKOLENIE"] as RentalEventType[]).map((t) => (
              <button key={t} type="button" onClick={() => setEventType(t)} className={`px-3 py-1.5 text-[13px] ${eventType === t ? "bg-[#1B6FA8] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                {t === "WYNAJEM" ? "Wynajem" : "Szkolenie"}
              </button>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            {/* 1. KLIENT */}
            <div className={CARD}>
              <CardTitle n={1} tag="klient z panelu">
                Klient
              </CardTitle>
              <RentalClientField value={client} onChange={handleClientChange} candidates={clientCandidates} />
              {clientBrief && (
                <p className="mt-2 text-xs leading-relaxed text-gray-600">
                  {[clientBrief.client.status, clientBrief.client.resigned ? "zrezygnował" : null, clientBrief.client.rhythm, clientBrief.client.lastRental ? `ostatni wynajem ${clientBrief.client.lastRental}` : "bez wynajmów", clientBrief.client.next.length ? `kolejne: ${clientBrief.client.next.join(", ")}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  <br />
                  Warunki: <b className="font-semibold text-gray-900">{clientBrief.client.terms}</b> ·{" "}
                  <Link href={`/klienci/${clientBrief.client.id}`} target="_blank" className="text-[#1B6FA8] hover:underline">
                    karta klienta →
                  </Link>
                </p>
              )}
              {isEditing && !initialClient && client && !isGenericTitleKey(normalizeTitle(title).key) && (
                <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={aliasFromTitle} onChange={(e) => setAliasFromTitle(e.target.checked)} />
                  Zapamiętać „{title}” jako alias tej klientki? (kolejne terminy z tym tytułem przypiszą się same)
                </label>
              )}
            </div>

            {/* 2. URZĄDZENIE I TERMIN */}
            <div className={CARD}>
              <CardTitle n={2}>Urządzenie i termin</CardTitle>
              <div className={`grid grid-cols-2 gap-2.5 ${variantOptions.length ? "sm:grid-cols-[1.3fr_1fr_0.8fr_0.8fr]" : "sm:grid-cols-[1.3fr_0.8fr_0.8fr]"}`}>
                <label className={`${LABEL_CLS} col-span-2 sm:col-span-1`}>
                  Urządzenie
                  <select value={deviceId} onChange={(e) => setDevice(e.target.value)} required className={INPUT_CLS}>
                    {devices
                      .filter((d) => d.active || d.id === deviceId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </label>
                {variantOptions.length > 0 && (
                  <div className={`${LABEL_CLS} col-span-2 sm:col-span-1`}>
                    Wariant *
                    <div className={`flex overflow-hidden rounded-md border ${!deviceVariant ? "border-[#E08A5C]" : "border-gray-300"}`} role="group" aria-label="Wariant">
                      {variantOptions.map((v) => (
                        <button
                          key={v}
                          type="button"
                          title={variantLabel(device?.pricingCategory ?? null, v)}
                          onClick={() => setDeviceVariant(v)}
                          className={`flex-1 whitespace-nowrap px-1.5 py-2 text-[13px] ${deviceVariant === v ? "bg-[#1B6FA8] text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                        >
                          {VARIANT_SEG[v] ?? v}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className={LABEL_CLS}>
                  Od
                  <input
                    type="date"
                    value={startsAt.slice(0, 10)}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      // Przesunięcie początku zachowuje długość wynajmu.
                      setEndsAt(`${ymdAdd(v, Math.max(0, durationDays - 1))}T00:00`);
                      setStartsAt(`${v}T00:00`);
                    }}
                    required
                    className={INPUT_CLS}
                  />
                </label>
                <label className={LABEL_CLS}>
                  Do
                  <input type="date" value={endsAt.slice(0, 10)} min={startsAt.slice(0, 10)} onChange={(e) => e.target.value && setEndsAt(`${e.target.value}T00:00`)} required className={INPUT_CLS} />
                </label>
              </div>
              {availability && (
                <div className={`mt-2.5 rounded-md px-2.5 py-2 text-[13px] ${availability.free ? "bg-[#EEF6F2] text-[#2F7A68]" : "bg-[#FDECEC] text-[#B42318]"}`}>
                  {availability.free ? (
                    <>
                      ✓ {device?.shortName ?? device?.name} wolne {dmShort(startsAt.slice(0, 10))}
                      {durationDays > 1 ? `–${dmShort(endsAt.slice(0, 10))}` : ""} · {durationDays} {durationDays === 1 ? "dzień" : "dni"}
                    </>
                  ) : (
                    <>
                      ✕ {device?.shortName ?? device?.name} zajęte {dmShort(availability.conflicts[0].od)}
                      {availability.conflicts[0].do !== availability.conflicts[0].od ? `–${dmShort(availability.conflicts[0].do)}` : ""} – {availability.conflicts[0].clientName ?? availability.conflicts[0].title}
                      {availability.conflicts.length > 1 ? ` (+${availability.conflicts.length - 1})` : ""}
                      {availability.suggestions.length > 0 && (
                        <>
                          {" · pokaż wolne: "}
                          {availability.suggestions.map((s, i) => (
                            <span key={s}>
                              {i > 0 && ", "}
                              <button type="button" className="underline" onClick={() => pickSuggestion(s)}>
                                {dmShort(s)}
                              </button>
                            </span>
                          ))}
                        </>
                      )}
                      {isAdmin && (
                        <label className="mt-1 flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={allowConflict} onChange={(e) => setAllowConflict(e.target.checked)} />
                          Zapisz mimo kolizji (świadomie)
                        </label>
                      )}
                    </>
                  )}
                </div>
              )}
              {isEditing && deviceId !== rental!.deviceId && <p className="mt-1.5 text-xs text-amber-700">Zmiana urządzenia przeniesie to wydarzenie do kalendarza Google innego urządzenia.</p>}
              <label className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                Tytuł w kalendarzu (nazwa robocza gabinetu – urządzenie widać po kolorze kalendarza):
                <input value={title} onChange={(e) => setTitle(e.target.value)} required className="min-w-[220px] flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:border-[#1B6FA8] focus:outline-none" />
              </label>
              {deliveryTime && !isSzkolenie && <p className="mt-1 text-xs text-gray-400">W kalendarzu: „{withDeliveryTimePrefix(title || "(bez tytułu)", deliveryTime)}”</p>}
            </div>

            {/* 3. DOSTAWA / SZKOLENIE */}
            {!isSzkolenie ? (
              <div className={CARD}>
                <CardTitle n={3} tag="z paszportu dostawy">
                  Dostawa
                </CardTitle>
                <label className={LABEL_CLS}>
                  Adres
                  <select
                    value={otherAddress ? "_other" : (deliveryAddressId ?? "_other")}
                    onChange={(e) => {
                      autoAddressRef.current = false;
                      if (e.target.value === "_other") {
                        setOtherAddress(true);
                        setDeliveryAddressId(null);
                        return;
                      }
                      const a = addressList.find((x) => x.id === e.target.value);
                      setOtherAddress(false);
                      setDeliveryAddressId(a?.id ?? null);
                      if (a) setDeliveryAddress(a.line);
                    }}
                    className={INPUT_CLS}
                  >
                    {addressList.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                        {a.isDefault ? " (domyślny)" : ""} — {a.line}
                        {a.distanceKm != null ? ` · ${Math.round(a.distanceKm)} km${a.durationMin != null ? ` · ${Math.floor(a.durationMin / 60)} h ${a.durationMin % 60} min` : ""}` : ""}
                      </option>
                    ))}
                    <option value="_other">— inny adres —</option>
                  </select>
                </label>
                {(otherAddress || addressList.length === 0) && (
                  <textarea
                    value={deliveryAddress}
                    onChange={(e) => {
                      setDeliveryAddress(e.target.value);
                      if (deliveryAddressId) setDeliveryAddressId(null);
                    }}
                    rows={2}
                    placeholder="Adres dostawy"
                    className={`${INPUT_CLS} mt-1.5`}
                  />
                )}
                <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <label className={LABEL_CLS}>
                    Dostawa (godz.)
                    <input type="time" value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} className={INPUT_CLS} />
                  </label>
                  <label className={LABEL_CLS}>
                    Odbiór (godz.)
                    <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className={INPUT_CLS} />
                  </label>
                  <label className={`${LABEL_CLS} col-span-2 sm:col-span-1`}>
                    Osoba na miejscu
                    <select value={onSite?.id ?? ""} onChange={(e) => setOnSiteId(e.target.value || null)} className={INPUT_CLS} disabled={!contacts.length}>
                      {!contacts.length && <option value="">— brak osób w karcie —</option>}
                      {contacts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.phone ? ` · ${p.phone}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <details className="mt-2.5" open={Boolean(internalNotes.trim())}>
                  <summary className="cursor-pointer text-xs text-[#1B6FA8]">+ uwaga dla kierowcy</summary>
                  <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} placeholder="np. domofon nie działa – dzwonić po przyjeździe" className={`${INPUT_CLS} mt-1.5`} />
                </details>
                <details className="mt-1.5" open={Boolean(description.trim())}>
                  <summary className="cursor-pointer text-xs text-[#1B6FA8]">+ opis (trafia do wydarzenia w kalendarzu Google)</summary>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${INPUT_CLS} mt-1.5`} />
                </details>
                <p className="mt-2 text-xs text-gray-400">
                  {pickedAddress?.distanceKm != null ? `${Math.round(pickedAddress.distanceKm)} km z paszportu dostawy (tylko do odczytu)` : "km z paszportu dostawy — przy innym adresie bez km"}
                  {onSite?.phone ? ` · telefon dla kierowcy: ${onSite.phone}` : ""}
                </p>
              </div>
            ) : (
              <div className={CARD}>
                <CardTitle n={3}>Szkolenie</CardTitle>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <label className={LABEL_CLS}>
                    Miejsce
                    <select value={training.place} onChange={(e) => setTraining({ ...training, place: e.target.value })} className={INPUT_CLS}>
                      <option value="U_KLIENTKI">U klientki (adres z paszportu)</option>
                      <option value="U_NAS">U nas – Skawina</option>
                    </select>
                  </label>
                  <label className={LABEL_CLS}>
                    Prowadzi
                    <select value={training.lead} onChange={(e) => setTraining({ ...training, lead: e.target.value })} className={INPUT_CLS}>
                      {["Ania", "Tomek", "ITP (zewn.)"].map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={LABEL_CLS}>
                    Uczestniczek
                    <input type="number" min={1} value={training.participants} onChange={(e) => setTraining({ ...training, participants: e.target.value })} className={INPUT_CLS} />
                  </label>
                </div>
                <details className="mt-2.5" open={Boolean(description.trim())}>
                  <summary className="cursor-pointer text-xs text-[#1B6FA8]">+ opis (trafia do wydarzenia w kalendarzu Google)</summary>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${INPUT_CLS} mt-1.5`} />
                </details>
              </div>
            )}

            {/* Tylko w edycji: kierowca i pojazd (ADMIN). */}
            {isEditing && canManageDrivers && (
              <div className={CARD}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={LABEL_CLS}>
                    Kierowca
                    <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={INPUT_CLS}>
                      <option value="">— brak —</option>
                      {driverOptions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={LABEL_CLS}>
                    Pojazd
                    <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={INPUT_CLS}>
                      <option value="">— brak —</option>
                      {vehicleOptions.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {canManageFinance && (
              <RentalFinanceSection
                rentalId={rental?.id ?? null}
                eventType={eventType}
                pricingCategory={device?.pricingCategory ?? null}
                deviceVariantOptions={variantOptions}
                deviceVariant={deviceVariant}
                onDeviceVariantChange={setDeviceVariant}
                durationDays={durationDays}
                transportPrice={transportPrice}
                onTransportPriceChange={setTransportPrice}
                transportPriceHint={rental?.contactTransportPriceCache ?? null}
                previewPriceRules={previewPriceRules}
                previewPulseTiers={previewPulseTiers}
                defaultVatRate={defaultVatRate}
                initialFinance={rental?.finance ?? null}
                endsAt={endsAt}
                onChange={handleFinanceChange}
                clientTerms={clientTerms}
              />
            )}

            <div className={CARD}>
              <ReminderSection rental={rental} device={device} startsAt={startsAt} selectedDays={reminderDays} onToggleDay={toggleReminderDay} onCancelQueued={cancelQueuedReminderDay} templates={reminderTemplates} />
            </div>

            {isEditing ? (
              <>
                {rental!.lead && (
                  <div className={CARD}>
                    <p className="text-xs text-gray-500">Powiązany sygnał</p>
                    <Link href={`/sygnaly?id=${rental!.lead.id}`} className="text-sm font-medium text-[#1B6FA8] hover:underline">
                      {rental!.lead.title} →
                    </Link>
                  </div>
                )}
                {openTasks.length > 0 && (
                  <div className={CARD}>
                    <OpenTasks tasks={openTasks} />
                  </div>
                )}
                <div className={CARD}>
                  <ClientMessageComposer rental={rental!} device={device} templates={smsTemplates} />
                </div>
              </>
            ) : (
              <div className="rounded-[10px] bg-gray-100 px-3.5 py-3 text-xs text-gray-600">
                <b className="font-semibold">Widoczne dopiero w edycji, po zapisie:</b>
                <br />
                kierowca i pojazd · wiadomość do klientki · historia SMS · otwarte zadania · powiązany sygnał
              </div>
            )}
          </div>
        </div>

        {isEditing && (
          <div className={CARD}>
            <p className="mb-2 text-sm text-gray-700">Historia SMS</p>
            <MessageHistorySection messages={rental!.messages ?? []} />
          </div>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center gap-2.5 border-t border-gray-200 pt-3.5">
          {isEditing ? (
            confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Na pewno usunąć?</span>
                <button type="button" onClick={handleDelete} disabled={isDeleting} className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                  {isDeleting ? "Usuwanie…" : "Tak, usuń"}
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)} className="text-sm text-gray-500 hover:underline">
                  Anuluj
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmingDelete(true)} className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                Usuń rezerwację
              </button>
            )
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-600">
              Seria:
              <select
                value={series.weeks}
                onChange={(e) => {
                  setSeries({ ...series, weeks: Number(e.target.value) });
                  setShowSeries(false);
                }}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-[13px]"
                aria-label="Seria"
              >
                <option value={0}>pojedynczy termin</option>
                {[2, 3, 4, 5, 6, 8].map((w) => (
                  <option key={w} value={w}>
                    co {w} tyg.
                  </option>
                ))}
              </select>
              {series.weeks > 0 && (
                <>
                  do
                  <input type="date" value={series.until} onChange={(e) => e.target.value && setSeries({ ...series, until: e.target.value })} className="rounded-md border border-gray-300 px-2 py-1 text-[13px]" aria-label="Seria do dnia" />
                  {seriesList.length > 0 && (
                    <span className="text-xs text-gray-400">
                      → {seriesList.length} terminów
                      {seriesBusy.length ? `, ${seriesBusy.length} zajęt${seriesBusy.length === 1 ? "y" : "e"} (pominięte)` : ""} ·{" "}
                      <button type="button" className="text-[#1B6FA8] hover:underline" onClick={() => setShowSeries((v) => !v)}>
                        {showSeries ? "ukryj" : "pokaż"}
                      </button>{" "}
                      – każdy jako osobna rezerwacja
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          <span className="flex-1" />
          <button type="button" onClick={goBack} className="rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50">
            Anuluj
          </button>
          {!isEditing && (
            <button type="button" disabled={isSaving} onClick={() => void save("next")} className="rounded-md border border-gray-300 bg-white px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Zapisz i dodaj kolejny
            </button>
          )}
          <button type="submit" disabled={isSaving} className="rounded-md bg-[#1B6FA8] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#14567F] disabled:opacity-50">
            {isSaving ? "Zapisywanie…" : "Zapisz"}
          </button>
        </div>
        {showSeries && seriesList.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {seriesList.map((t) => (
              <li key={t.od} className={`rounded px-2 py-1 ${t.busy ? "bg-[#FDECEC] text-[#B42318]" : "bg-[#EEF6F2] text-[#2F7A68]"}`} title={t.busy ? `zajęte – ${t.busy.clientName ?? t.busy.title}` : "wolne"}>
                {dmShort(t.od)}
                {t.do !== t.od ? `–${dmShort(t.do)}` : ""}
                {t.busy ? " ✕" : ""}
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}
