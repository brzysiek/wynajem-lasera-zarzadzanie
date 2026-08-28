"use client";

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

export type DriverOption = { id: string; name: string };

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
  contactNameCache?: string | null;
  contactPhoneCache?: string | null;
  contactEmailCache?: string | null;
  contactCompanyCache?: string | null;
  contactAddressCache?: string | null;
  contactTransportPriceCache?: string | null;
  deliveryAddress?: string | null;
  deliveryTime?: string | null;
  pickupTime?: string | null;
  transportPrice?: string | null;
  reminderRules?: ReminderRuleSummary[];
  messages?: MessageSummary[];
};

export type ReminderTemplatePreview = { offset: ReminderOffset; templateId: string; body: string };

const REMINDER_OPTIONS: { days: ReminderDays; label: string }[] = [
  { days: 1, label: "1 dzień przed" },
  { days: 3, label: "3 dni przed" },
  { days: 7, label: "tydzień (7 dni) przed" },
];

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
              className="flex-none text-xs font-medium text-blue-600 hover:underline"
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

  return (
    <div className="flex flex-col gap-1.5 text-sm text-gray-700">
      Przypomnienia SMS
      <div className="flex flex-col gap-2">
        {REMINDER_OPTIONS.map(({ days, label }) => {
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
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
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
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
        />
        {sendError && <p className="text-xs text-red-700">{sendError}</p>}
        {sendSuccess && <p className="text-xs text-green-700">Wysłano.</p>}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="self-start rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
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

type ContactSummary = {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
};

type AssignedContact = {
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
  return { ok: res.ok, data };
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

function contactFromRental(rental: Rental | null): AssignedContact | null {
  if (!rental?.hubspotContactId) return null;
  return {
    id: rental.hubspotContactId,
    name: rental.contactNameCache ?? null,
    phone: rental.contactPhoneCache ?? null,
    email: rental.contactEmailCache ?? null,
    company: rental.contactCompanyCache ?? null,
    address: rental.contactAddressCache ?? null,
    transportPrice: rental.contactTransportPriceCache ?? null,
    url: null,
  };
}

function ContactSection({
  rentalId,
  initialContact,
  onContactChange,
}: {
  // null while creating a new rental (it doesn't have an id yet) — in that
  // case assign/unassign only update local state instead of calling the API,
  // and the picked contact id travels in the rental-creation request body.
  rentalId: string | null;
  initialContact: AssignedContact | null;
  onContactChange?: (contact: AssignedContact | null) => void;
}) {
  const [contact, setContact] = useState(initialContact);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      return;
    }

    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      setError(null);
      try {
        const res = await fetch(
          `${BASE_PATH}/api/integrations/hubspot/contacts/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.message || "Wyszukiwanie kontaktów nie powiodło się.");
          setResults(null);
        } else {
          setResults(data?.contacts ?? []);
        }
      } catch {
        // Aborted by a newer keystroke — ignore.
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function assign(c: ContactSummary) {
    if (!rentalId) {
      const name = [c.firstname, c.lastname].filter(Boolean).join(" ").trim() || null;
      const next: AssignedContact = {
        id: c.id,
        name,
        phone: c.phone,
        email: c.email,
        company: c.company,
        address: null,
        // Not in the search summary — the server fills it in on save from
        // the full contact fetch (like the address).
        transportPrice: null,
        url: null,
      };
      setContact(next);
      setQuery("");
      setResults(null);
      onContactChange?.(next);
      return;
    }

    setIsAssigning(true);
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/rentals/${rentalId}/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: c.id }),
    });
    const data = await res.json().catch(() => null);
    setIsAssigning(false);
    if (!res.ok) {
      setError(data?.message || "Nie udało się przypisać kontaktu.");
      return;
    }
    const r = data.rental;
    const next: AssignedContact = {
      id: r.hubspotContactId,
      name: r.contactNameCache,
      phone: r.contactPhoneCache,
      email: r.contactEmailCache,
      company: r.contactCompanyCache,
      address: r.contactAddressCache,
      transportPrice: r.contactTransportPriceCache ?? null,
      url: data.contactUrl ?? null,
    };
    setContact(next);
    setQuery("");
    setResults(null);
    onContactChange?.(next);
  }

  async function unassign() {
    if (!rentalId) {
      setContact(null);
      onContactChange?.(null);
      return;
    }

    setIsAssigning(true);
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/rentals/${rentalId}/contact`, { method: "DELETE" });
    setIsAssigning(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.message || "Nie udało się odpiąć kontaktu.");
      return;
    }
    setContact(null);
    onContactChange?.(null);
  }

  if (contact) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-gray-800">
            <p className="font-medium">{contact.name || "(bez nazwy)"}</p>
            {contact.company && <p className="text-gray-600">{contact.company}</p>}
            {contact.phone && <p className="text-gray-600">{contact.phone}</p>}
            {contact.email && <p className="text-gray-600">{contact.email}</p>}
            {contact.address && <p className="text-gray-500">{contact.address}</p>}
            {contact.transportPrice && (
              <p className="text-gray-500">Ustalona cena transportu: {contact.transportPrice}</p>
            )}
            {contact.url && (
              <a
                href={contact.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-blue-600 hover:underline"
              >
                Otwórz w HubSpot ↗
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={unassign}
            disabled={isAssigning}
            className="flex-none rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Odepnij
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <input
        value={query}
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          if (value.trim().length < 3) {
            setResults(null);
            setError(null);
          }
        }}
        placeholder="Imię, nazwisko, firma, telefon lub e-mail (min. 3 znaki)…"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
      />
      {isSearching && <p className="mt-1 text-xs text-gray-400">Szukanie…</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {results && results.length === 0 && !isSearching && (
        <p className="mt-1 text-xs text-gray-400">Brak wyników.</p>
      )}
      {results && results.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200">
          {results.map((c) => {
            const name = [c.firstname, c.lastname].filter(Boolean).join(" ") || "(bez nazwy)";
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={isAssigning}
                  onClick={() => assign(c)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="font-medium text-gray-900">{name}</span>
                  {c.company && <span className="text-gray-500"> · {c.company}</span>}
                  {c.email && <span className="block text-xs text-gray-500">{c.email}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
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

export function RentalForm({
  devices,
  rental,
  defaultDeviceId,
  defaultDateIso,
  reminderTemplates,
  smsTemplates = [],
  drivers = [],
  canManageDrivers = false,
  canManageFinance = false,
  previewPriceRules = [],
  previewPulseTiers = [],
  defaultVatRate = 23,
  backHref,
}: {
  devices: Device[];
  rental: Rental | null;
  defaultDeviceId?: string;
  defaultDateIso?: string;
  reminderTemplates: ReminderTemplatePreview[];
  smsTemplates?: SmsTemplateOption[];
  drivers?: DriverOption[];
  // Only an admin sees/edits the driver field (assignment is admin-only).
  canManageDrivers?: boolean;
  // ADMIN/STAFF widzą sekcję „Finanse".
  canManageFinance?: boolean;
  previewPriceRules?: PreviewPriceRule[];
  previewPulseTiers?: PreviewPulseTier[];
  defaultVatRate?: number;
  backHref: string;
}) {
  const router = useRouter();
  const isEditing = Boolean(rental);
  const [deviceId, setDeviceId] = useState(rental?.deviceId ?? defaultDeviceId ?? devices[0]?.id ?? "");
  const [title, setTitle] = useState(rental?.title ?? "");
  const [description, setDescription] = useState(rental?.description ?? "");
  // Reservation dates are always whole days — no time-of-day picker for
  // startsAt/endsAt (unlike delivery/pickup, which do carry a time). Both
  // are normalized to midnight right away (not just on change), otherwise
  // a rental whose stored time predates the all-day switch keeps a hidden
  // hour/minute that only the untouched field carries — invisible in the
  // date-only input, but enough to make endsAt < startsAt even when both
  // inputs display the same day.
  const allDay = true;
  const toDateOnlyValue = (value: string) => `${value.slice(0, 10)}T00:00`;
  const initialStart = toDateOnlyValue(
    rental ? toLocalInputValue(rental.startsAt) : defaultStart(defaultDateIso ? new Date(defaultDateIso) : undefined),
  );
  const [startsAt, setStartsAt] = useState(initialStart);
  const [endsAt, setEndsAt] = useState(
    toDateOnlyValue(rental ? toLocalInputValue(rental.endsAt) : defaultEnd(initialStart)),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingContact, setPendingContact] = useState<AssignedContact | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState(rental?.deliveryAddress ?? rental?.contactAddressCache ?? "");
  const [deliveryTime, setDeliveryTime] = useState(rental?.deliveryTime ?? "");
  const [pickupTime, setPickupTime] = useState(rental?.pickupTime ?? "");
  const [transportPrice, setTransportPrice] = useState(
    rental?.transportPrice ?? rental?.contactTransportPriceCache ?? "",
  );
  const [driverId, setDriverId] = useState(rental?.driverId ?? "");
  const [eventType, setEventType] = useState<RentalEventType>(rental?.eventType ?? "WYNAJEM");
  const financeRef = useRef<FinancePayload | null>(null);
  const handleFinanceChange = useCallback((p: FinancePayload) => {
    financeRef.current = p;
  }, []);
  const isSzkolenie = eventType === "SZKOLENIE";
  const durationDays = rentalDurationDays(new Date(startsAt), new Date(endsAt));
  const [reminderDays, setReminderDays] = useState<Set<ReminderDays>>(() => {
    if (!rental) return new Set([1, 3, 7]);
    const checked = rental.reminderRules
      ?.filter((r) => r.status === "SENT" || r.status === "SCHEDULED" || r.status === "QUEUED")
      .map((r) => r.daysBefore)
      .filter((d): d is ReminderDays => d === 1 || d === 3 || d === 7);
    return new Set(checked ?? []);
  });
  const device = devices.find((d) => d.id === deviceId);

  // Keep the currently-assigned driver selectable even if they've since been
  // dropped from the drivers list (role changed / renamed), so saving the
  // form doesn't silently wipe the assignment.
  const assignedDriver = rental?.driver ?? null;
  const driverOptions: DriverOption[] =
    assignedDriver && !drivers.some((d) => d.id === assignedDriver.id) ? [assignedDriver, ...drivers] : drivers;

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

  function handleContactChange(contact: AssignedContact | null) {
    setPendingContact(contact);
    if (contact?.address && !deliveryAddress.trim()) {
      setDeliveryAddress(contact.address);
    }
    if (contact?.transportPrice && !transportPrice.trim()) {
      setTransportPrice(contact.transportPrice);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const remaining = daysUntilStart(startsAt);
    const sentDays = new Set(
      rental?.reminderRules?.filter((r) => r.status === "SENT" || r.status === "QUEUED").map((r) => r.daysBefore) ?? [],
    );
    const effectiveReminderDays = Array.from(reminderDays).filter((d) => sentDays.has(d) || remaining >= d);

    const body: Record<string, unknown> = {
      deviceId,
      title,
      description,
      allDay,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      reminderDays: effectiveReminderDays,
      deliveryAddress: isSzkolenie ? "" : deliveryAddress,
      deliveryTime: isSzkolenie ? "" : deliveryTime,
      pickupTime: isSzkolenie ? "" : pickupTime,
      transportPrice: isSzkolenie ? "" : transportPrice,
      eventType,
    };
    if (canManageDrivers) {
      body.driverId = driverId || null;
    }
    if (canManageFinance && financeRef.current) {
      body.finance = financeRef.current;
    }
    if (!isEditing && pendingContact) {
      body.contactId = pendingContact.id;
    }

    const { ok, data } = isEditing
      ? await api(`/api/rentals/${rental!.id}`, { method: "PATCH", body: JSON.stringify(body) })
      : await api("/api/rentals", { method: "POST", body: JSON.stringify(body) });

    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się zapisać rezerwacji.");
      return;
    }
    if (data?.financeError) {
      // Wynajem zapisany, ale finanse wymagają uzupełnienia ceny — zostajemy
      // na formularzu z komunikatem zamiast wychodzić.
      setError(`Zapisano wynajem, ale: ${data.financeError}`);
      return;
    }
    goBack();
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          aria-label="Powrót do kalendarza"
          title="Powrót do kalendarza"
          className="flex-none rounded-md border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
        >
          <BackArrowIcon />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{isEditing ? "Edytuj rezerwację" : "Nowa rezerwacja"}</h1>
          {isEditing && device && <p className="text-sm text-gray-500">{device.name}</p>}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5">
            <p className="mb-2 text-sm text-gray-700">Dane rezerwacji</p>

            {canManageFinance && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <span>Typ wydarzenia:</span>
                <div className="flex overflow-hidden rounded-md border border-gray-300">
                  {(["WYNAJEM", "SZKOLENIE"] as RentalEventType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setEventType(t)}
                      className={`px-3 py-1.5 text-sm font-medium ${
                        eventType === t ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {t === "WYNAJEM" ? "Wynajem" : "Szkolenie"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Urządzenie
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                required
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              >
                {devices
                  .filter((d) => d.active || d.id === deviceId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
              {isEditing && deviceId !== rental!.deviceId && (
                <p className="text-xs text-amber-700">
                  Zmiana urządzenia przeniesie to wydarzenie do kalendarza Google innego urządzenia.
                </p>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Tytuł
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Opis
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Początek
                <input
                  type="date"
                  value={startsAt.slice(0, 10)}
                  onChange={(e) => setStartsAt(`${e.target.value}T00:00`)}
                  required
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Koniec
                <input
                  type="date"
                  value={endsAt.slice(0, 10)}
                  onChange={(e) => setEndsAt(`${e.target.value}T00:00`)}
                  required
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                />
              </label>
            </div>
          </div>

          {!isSzkolenie && (
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5">
            <p className="mb-2 text-sm text-gray-700">Dostawa</p>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Adres dostawy
              <textarea
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                rows={2}
                placeholder="Uzupełnia się automatycznie z adresu klienta, jeśli jest dostępny"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Ustalona cena transportu
              <input
                value={transportPrice}
                onChange={(e) => setTransportPrice(e.target.value)}
                placeholder="Uzupełnia się automatycznie z kontaktu HubSpot, jeśli jest ustalona"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Godzina dostawy
                <input
                  type="time"
                  value={deliveryTime}
                  onChange={(e) => setDeliveryTime(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Godzina odbioru
                <input
                  type="time"
                  value={pickupTime}
                  onChange={(e) => setPickupTime(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                />
              </label>
            </div>
            {deliveryTime && (
              <p className="text-xs text-gray-500">
                Godzina dostawy zostanie dodana jako prefiks do nazwy wydarzenia w kalendarzu: „
                {withDeliveryTimePrefix(title || "(bez tytułu)", deliveryTime)}”
              </p>
            )}
          </div>
          )}
          </div>

          <div className="flex flex-col gap-4">
            {canManageFinance && (
              <RentalFinanceSection
                eventType={eventType}
                pricingCategory={device?.pricingCategory ?? null}
                deviceVariantOptions={device?.variantOptions ?? []}
                durationDays={durationDays}
                transportPrice={transportPrice}
                previewPriceRules={previewPriceRules}
                previewPulseTiers={previewPulseTiers}
                defaultVatRate={defaultVatRate}
                initialFinance={rental?.finance ?? null}
                onChange={handleFinanceChange}
              />
            )}
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="mb-2 text-sm text-gray-700">Klient (HubSpot)</p>
              <ContactSection
                rentalId={isEditing ? rental!.id : null}
                initialContact={isEditing ? contactFromRental(rental) : null}
                onContactChange={handleContactChange}
              />
            </div>

            {canManageDrivers && (
              <div className="rounded-lg border border-gray-200 bg-white p-5">
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  Kierowca
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                  >
                    <option value="">— brak —</option>
                    {driverOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400">
                    Przypisany kierowca widzi ten wynajem w swoim kalendarzu (tylko podgląd).
                  </span>
                </label>
              </div>
            )}

            {isEditing && (
              <div className="rounded-lg border border-gray-200 bg-white p-5">
                <ClientMessageComposer rental={rental!} device={device} templates={smsTemplates} />
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <ReminderSection
                rental={rental}
                device={device}
                startsAt={startsAt}
                selectedDays={reminderDays}
                onToggleDay={toggleReminderDay}
                onCancelQueued={cancelQueuedReminderDay}
                templates={reminderTemplates}
              />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-4">
          <div>
            {isEditing &&
              (confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Na pewno usunąć?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {isDeleting ? "Usuwanie…" : "Tak, usuń"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="text-sm text-gray-500 hover:underline"
                  >
                    Anuluj
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Usuń rezerwację
                </button>
              ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={goBack}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {isSaving ? "Zapisywanie…" : "Zapisz"}
            </button>
          </div>
        </div>

        {isEditing && (
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="mb-2 text-sm text-gray-700">Historia SMS</p>
            <MessageHistorySection messages={rental!.messages ?? []} />
          </div>
        )}
      </form>
    </div>
  );
}
