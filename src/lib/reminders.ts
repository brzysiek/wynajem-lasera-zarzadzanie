import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/integrations/szybkisms";
import { logDebug, logInfo, logError } from "@/lib/logger";
import { SUPPORT_PHONE } from "@/lib/sms-template";

export const REMINDER_DAYS = [1, 3, 7] as const;
export type ReminderDays = (typeof REMINDER_DAYS)[number];

// The reservation-confirmation message used to reuse the same
// ReminderRule/SMS pipeline (scheduling, sending, history) as the
// day-before reminders, with 0 as its "daysBefore" offset. Confirmations are
// now always sent manually (see ClientMessageComposer in rental-form.tsx),
// so no new rules with this offset are created — but the pipeline still
// processes any that linger from before that change.
export const CONFIRMATION_OFFSET = 0 as const;
export const ALL_REMINDER_OFFSETS = [CONFIRMATION_OFFSET, ...REMINDER_DAYS] as const;
export type ReminderOffset = (typeof ALL_REMINDER_OFFSETS)[number];

// How far ahead the hourly cron looks when promoting SCHEDULED 1/3/7-day
// reminders into QUEUED, so the "Nadchodzące powiadomienia do wysłania"
// review/cancel UI has visibility before the daily send cron picks them up.
export const QUEUE_LOOKAHEAD_DAYS = 7;

export const TEMPLATE_KEYS: Record<ReminderOffset, string> = {
  0: "reservation_confirmation",
  1: "reminder_1d",
  3: "reminder_3d",
  7: "reminder_7d",
};

const TEMPLATE_LABELS: Record<ReminderOffset, string> = {
  0: "Potwierdzenie rezerwacji",
  1: "Przypomnienie SMS – 1 dzień przed",
  3: "Przypomnienie SMS – 3 dni przed",
  7: "Przypomnienie SMS – 7 dni przed",
};

const DEFAULT_TEMPLATE_BODY: Record<ReminderOffset, string> = {
  0: "Potwierdzamy rezerwację: {rezerwacja_urzadzenie}, termin {rezerwacja_data_start} – {rezerwacja_data_koniec}. Pytania: {telefon_obslugi}. Pozdrawiamy, WynajemLasera.pl",
  7: "Przypomnienie: za tydzień, {rezerwacja_data_start}, rozpoczyna się wynajem: {rezerwacja_urzadzenie}. Pytania: {telefon_obslugi}. Pozdrawiamy, WynajemLasera.pl",
  3: "Przypomnienie: za 3 dni, {rezerwacja_data_start}, rozpoczyna się wynajem: {rezerwacja_urzadzenie}. Pytania: {telefon_obslugi}. Pozdrawiamy, WynajemLasera.pl",
  1: "Przypomnienie: jutro, {rezerwacja_data_start}, rozpoczyna się wynajem: {rezerwacja_urzadzenie}. Pytania: {telefon_obslugi}. Pozdrawiamy, WynajemLasera.pl",
};

const SETTING_KEY_ENABLED = "sms_reminders_enabled";

export async function ensureDefaultTemplates(): Promise<void> {
  for (const offset of ALL_REMINDER_OFFSETS) {
    await prisma.messageTemplate.upsert({
      where: { key: TEMPLATE_KEYS[offset] },
      update: {},
      create: { key: TEMPLATE_KEYS[offset], label: TEMPLATE_LABELS[offset], channel: "SMS", body: DEFAULT_TEMPLATE_BODY[offset] },
    });
  }
}

export async function getRemindersEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY_ENABLED } });
  return row?.value !== "false";
}

export async function setRemindersEnabled(value: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY_ENABLED },
    update: { value: value ? "true" : "false" },
    create: { key: SETTING_KEY_ENABLED, value: value ? "true" : "false" },
  });
}

export async function getReminderTemplates(): Promise<{ daysBefore: ReminderDays; body: string }[]> {
  await ensureDefaultTemplates();
  const templates = await prisma.messageTemplate.findMany({
    where: { key: { in: Object.values(TEMPLATE_KEYS) } },
  });
  return REMINDER_DAYS.map((days) => ({
    daysBefore: days,
    body: templates.find((t) => t.key === TEMPLATE_KEYS[days])?.body || DEFAULT_TEMPLATE_BODY[days],
  }));
}

export async function setReminderTemplateBody(days: ReminderDays, body: string): Promise<void> {
  await prisma.messageTemplate.upsert({
    where: { key: TEMPLATE_KEYS[days] },
    update: { body },
    create: { key: TEMPLATE_KEYS[days], label: TEMPLATE_LABELS[days], channel: "SMS", body },
  });
}

// Used by the rental form to preview the exact SMS body under each reminder
// checkbox (confirmation + 1/3/7 days before), alongside a link to edit it.
export async function getAllReminderTemplates(): Promise<{ offset: ReminderOffset; templateId: string; body: string }[]> {
  await ensureDefaultTemplates();
  const templates = await prisma.messageTemplate.findMany({
    where: { key: { in: Object.values(TEMPLATE_KEYS) } },
  });
  return ALL_REMINDER_OFFSETS.map((offset) => {
    const template = templates.find((t) => t.key === TEMPLATE_KEYS[offset]);
    return { offset, templateId: template?.id ?? "", body: template?.body || DEFAULT_TEMPLATE_BODY[offset] };
  });
}

export function computeScheduledFor(rentalStartsAt: Date, daysBefore: number): Date {
  const result = new Date(rentalStartsAt);
  result.setDate(result.getDate() - daysBefore);
  return result;
}

type RentalForSync = { id: string; startsAt: Date };

function daysUntilStart(startsAt: Date): number {
  const startDay = new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate());
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((startDay.getTime() - todayDay.getTime()) / 86_400_000);
}

// Keeps at most one ReminderRule per (rental, daysBefore) offset in sync with
// the desired checked/unchecked checkbox state from the rental form. SENT
// rules are immutable history and are never touched here — the UI renders
// them checked+disabled so `selectedDays` naturally still includes them.
//
// `remaining < days` forces `wanted` to false regardless of what the caller
// asked for — this is what protects offsets that became impossible after a
// rental's startsAt moved (e.g. calendar drag-and-drop, which PATCHes only
// startsAt/endsAt and re-selects whatever was already SCHEDULED without
// itself re-checking validity against the new date).
export async function syncReminderRules(
  rental: RentalForSync,
  selectedDays: ReminderDays[],
  confirmationSelected: boolean,
): Promise<void> {
  const existing = await prisma.reminderRule.findMany({ where: { rentalId: rental.id, channel: "SMS" } });
  const remaining = daysUntilStart(rental.startsAt);

  const currentConfirmation = existing.find((r) => r.daysBefore === CONFIRMATION_OFFSET);
  if (currentConfirmation?.status !== "SENT") {
    if (confirmationSelected && !currentConfirmation) {
      const template = await prisma.messageTemplate.findUnique({ where: { key: TEMPLATE_KEYS[CONFIRMATION_OFFSET] } });
      await prisma.reminderRule.create({
        data: {
          rentalId: rental.id,
          daysBefore: CONFIRMATION_OFFSET,
          channel: "SMS",
          status: "SCHEDULED",
          scheduledFor: new Date(),
          messageBody: template?.body || DEFAULT_TEMPLATE_BODY[CONFIRMATION_OFFSET],
        },
      });
    } else if (confirmationSelected && currentConfirmation && currentConfirmation.status !== "SCHEDULED") {
      // FAILED or CANCELLED -> re-arm as a fresh scheduled send (retry).
      await prisma.reminderRule.update({
        where: { id: currentConfirmation.id },
        data: { status: "SCHEDULED", scheduledFor: new Date(), errorMessage: null },
      });
    } else if (!confirmationSelected && currentConfirmation && currentConfirmation.status === "SCHEDULED") {
      await prisma.reminderRule.delete({ where: { id: currentConfirmation.id } });
    }
    // confirmationSelected && currentConfirmation?.status === "SCHEDULED": already queued, nothing to do.
  }

  for (const days of REMINDER_DAYS) {
    const wanted = selectedDays.includes(days) && remaining >= days;
    const current = existing.find((r) => r.daysBefore === days);
    if (current?.status === "SENT") continue;

    if (wanted && !current) {
      const template = await prisma.messageTemplate.findUnique({ where: { key: TEMPLATE_KEYS[days] } });
      await prisma.reminderRule.create({
        data: {
          rentalId: rental.id,
          daysBefore: days,
          channel: "SMS",
          status: "SCHEDULED",
          scheduledFor: computeScheduledFor(rental.startsAt, days),
          messageBody: template?.body || DEFAULT_TEMPLATE_BODY[days],
        },
      });
    } else if (wanted && current && current.status !== "SCHEDULED") {
      // FAILED, CANCELLED, or already QUEUED -> re-arm as a fresh scheduled
      // reminder (retry / undo an accidental cancel).
      await prisma.reminderRule.update({
        where: { id: current.id },
        data: { status: "SCHEDULED", scheduledFor: computeScheduledFor(rental.startsAt, days), errorMessage: null },
      });
    } else if (wanted && current && current.status === "SCHEDULED") {
      const newScheduledFor = computeScheduledFor(rental.startsAt, days);
      if (newScheduledFor.getTime() !== current.scheduledFor.getTime()) {
        await prisma.reminderRule.update({ where: { id: current.id }, data: { scheduledFor: newScheduledFor } });
      }
    } else if (!wanted && current && (current.status === "SCHEDULED" || current.status === "QUEUED")) {
      await prisma.reminderRule.delete({ where: { id: current.id } });
    }
  }
}

function warsawParts(date: Date): { dateStr: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value])) as Record<string, string>;
  return { dateStr: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

type RentalForRender = {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  contactNameCache: string | null;
  device: { name: string };
};

function renderTemplate(body: string, rental: RentalForRender): string {
  const start = new Date(rental.startsAt);
  const end = new Date(rental.endsAt);
  return body
    .replaceAll("{rezerwacja_klient}", rental.contactNameCache?.trim() || "")
    .replaceAll("{rezerwacja_urzadzenie}", rental.device.name)
    .replaceAll("{rezerwacja_data_start}", start.toLocaleDateString("pl-PL"))
    .replaceAll("{rezerwacja_data_koniec}", end.toLocaleDateString("pl-PL"))
    .replaceAll("{telefon_obslugi}", SUPPORT_PHONE)
    // Defensive cleanup for any template bodies saved before this token was retired.
    .replaceAll(" o {godzina_start}", "")
    .replaceAll("{godzina_start}", "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePolishPhone(raw: string): string | null {
  const digits = raw.trim().replace(/[^\d+]/g, "");
  if (/^\+\d{9,15}$/.test(digits)) return digits;
  if (/^48\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{9}$/.test(digits)) return `+48${digits}`;
  return null;
}

// Called right when reminders are switched back on from paused: while
// paused, the hourly/daily cycles no-op entirely, so SCHEDULED/QUEUED rules
// just sit untouched instead of sending. Anything that became due during
// that window is marked as skipped here rather than sent late — a stale
// 7-day reminder would state the wrong day count, and a confirmation SMS
// sent days after booking would look like a mistake to the customer. Rules
// not yet due are left alone and still fire normally once their time comes.
export async function discardStaleReminders(): Promise<number> {
  const nowParts = warsawParts(new Date());
  const rules = await prisma.reminderRule.findMany({ where: { status: { in: ["SCHEDULED", "QUEUED"] }, channel: "SMS" } });

  let discarded = 0;
  for (const rule of rules) {
    const days = rule.daysBefore as ReminderOffset;
    const isDue =
      days === CONFIRMATION_OFFSET
        ? rule.scheduledFor.getTime() <= Date.now()
        : warsawParts(rule.scheduledFor).dateStr <= nowParts.dateStr;
    if (!isDue) continue;

    await prisma.reminderRule.update({
      where: { id: rule.id },
      data: {
        status: "FAILED",
        errorMessage: "Przypomnienie pominięte — przypomnienia SMS były wstrzymane w tym czasie.",
      },
    });
    discarded++;
  }
  return discarded;
}

export type ReminderCheckSource = "CRON" | "MANUAL";

type ReminderRuleForSend = { id: string; rentalId: string; daysBefore: number };
type RentalForSend = RentalForRender & { id: string; contactPhoneCache: string | null };

// Renders the current template + sends the SMS + persists the outcome on
// both the ReminderRule and the Message history. Shared by the confirmation
// pipeline and the queued-send pipeline — the only difference between them
// is which rules are eligible and how due-ness is decided upstream.
async function sendReminderNow(rule: ReminderRuleForSend, rental: RentalForSend): Promise<"sent" | "failed"> {
  const days = rule.daysBefore as ReminderOffset;
  const template = await prisma.messageTemplate.findUnique({ where: { key: TEMPLATE_KEYS[days] } });
  const body = renderTemplate(template?.body || DEFAULT_TEMPLATE_BODY[days] || "{rezerwacja_urzadzenie}", rental);
  const phone = rental.contactPhoneCache ? normalizePolishPhone(rental.contactPhoneCache) : null;

  if (!phone) {
    const errorMessage = "Brak poprawnego numeru telefonu kontaktu.";
    await prisma.$transaction([
      prisma.reminderRule.update({ where: { id: rule.id }, data: { status: "FAILED", errorMessage, messageBody: body } }),
      prisma.message.create({
        data: { rentalId: rental.id, channel: "SMS", recipient: rental.contactPhoneCache || "", body, status: "FAILED", errorMessage },
      }),
    ]);
    logError("reminder_send_failed", new Error(errorMessage), { rentalId: rental.id, daysBefore: days });
    return "failed";
  }

  const result = await sendSms(phone, body);
  if (result.ok) {
    await prisma.$transaction([
      prisma.reminderRule.update({ where: { id: rule.id }, data: { status: "SENT", sentAt: new Date(), messageBody: body } }),
      prisma.message.create({
        data: { rentalId: rental.id, channel: "SMS", recipient: phone, body, status: "SENT", providerMessageId: result.providerMessageId },
      }),
    ]);
    logInfo("reminder_sent", { rentalId: rental.id, daysBefore: days, phone });
    return "sent";
  }

  await prisma.$transaction([
    prisma.reminderRule.update({ where: { id: rule.id }, data: { status: "FAILED", errorMessage: result.message, messageBody: body } }),
    prisma.message.create({
      data: { rentalId: rental.id, channel: "SMS", recipient: phone, body, status: "FAILED", errorMessage: result.message },
    }),
  ]);
  logError("reminder_send_failed", new Error(result.message), { rentalId: rental.id, daysBefore: days });
  return "failed";
}

async function markExpired(ruleId: string, rentalId: string, days: ReminderOffset): Promise<void> {
  // The exact "N dni przed" day already passed without this firing (e.g.
  // the daily cron didn't run that day) — sending it now would state a
  // wrong day count ("za 7 dni" with fewer than 7 actually left), so it's
  // marked failed instead of catching up late with stale wording.
  const errorMessage = "Termin wysyłki minął bez wysłania przypomnienia (np. aplikacja była wyłączona o właściwej porze).";
  await prisma.reminderRule.update({ where: { id: ruleId }, data: { status: "FAILED", errorMessage } });
  logError("reminder_window_missed", new Error(errorMessage), { rentalId, daysBefore: days });
}

type PipelineTally = { checked: number; rentalsChecked: number; due: number; sent: number; failed: number };

// Reservation confirmations (offset 0) bypass the queue entirely — they're
// meant to go out immediately, with no "N dni przed" wording that could go
// stale, so there's nothing to gain from a review/cancel window. In
// practice this only ever processes rules left over from before
// confirmations became manual-only.
async function processDueConfirmations(): Promise<PipelineTally> {
  const rules = await prisma.reminderRule.findMany({
    where: { status: "SCHEDULED", channel: "SMS", daysBefore: CONFIRMATION_OFFSET },
    include: { rental: { include: { device: true } } },
  });
  const rentalsChecked = new Set(rules.map((r) => r.rentalId)).size;

  let due = 0;
  let sent = 0;
  let failed = 0;
  for (const rule of rules) {
    if (rule.scheduledFor.getTime() > Date.now()) continue;
    due++;
    const outcome = await sendReminderNow(rule, rule.rental);
    if (outcome === "sent") sent++;
    else failed++;
  }

  return { checked: rules.length, rentalsChecked, due, sent, failed };
}

// Promotes SCHEDULED 1/3/7-day reminders into QUEUED once they're within
// the lookahead window, so they show up in the review/cancel UI ahead of
// the daily send. Idempotent — rules already QUEUED are simply skipped by
// the SCHEDULED-only filter.
async function processQueueBuild(): Promise<number> {
  const horizon = new Date(Date.now() + QUEUE_LOOKAHEAD_DAYS * 86_400_000);
  const due = await prisma.reminderRule.findMany({
    where: { status: "SCHEDULED", channel: "SMS", daysBefore: { in: [...REMINDER_DAYS] }, scheduledFor: { lte: horizon } },
    select: { id: true },
  });
  if (due.length === 0) return 0;

  await prisma.reminderRule.updateMany({ where: { id: { in: due.map((r) => r.id) } }, data: { status: "QUEUED" } });
  return due.length;
}

// Sends whatever in the QUEUED 1/3/7-day pipeline is actually due "today"
// (Warsaw date). Items whose date hasn't arrived yet are left QUEUED for a
// future run; items whose date already passed are marked failed rather than
// sent late (see markExpired).
async function processQueuedSends(): Promise<PipelineTally> {
  const nowParts = warsawParts(new Date());
  const rules = await prisma.reminderRule.findMany({
    where: { status: "QUEUED", channel: "SMS" },
    include: { rental: { include: { device: true } } },
  });
  const rentalsChecked = new Set(rules.map((r) => r.rentalId)).size;

  let due = 0;
  let sent = 0;
  let failed = 0;
  for (const rule of rules) {
    const days = rule.daysBefore as ReminderOffset;
    const targetDateStr = warsawParts(rule.scheduledFor).dateStr;
    if (targetDateStr > nowParts.dateStr) continue; // not due yet, stays queued

    due++;
    if (targetDateStr < nowParts.dateStr) {
      await markExpired(rule.id, rule.rentalId, days);
      failed++;
      continue;
    }

    const outcome = await sendReminderNow(rule, rule.rental);
    if (outcome === "sent") sent++;
    else failed++;
  }

  return { checked: rules.length, rentalsChecked, due, sent, failed };
}

// Meant for the hourly cron: sends any overdue confirmations (legacy) and
// builds the reminder queue. Call this frequently — it's cheap and
// idempotent either way.
export async function runHourlyReminderCycle(
  source: ReminderCheckSource = "CRON",
): Promise<{ checked: number; sent: number; failed: number; queued: number }> {
  if (!(await getRemindersEnabled())) {
    return { checked: 0, sent: 0, failed: 0, queued: 0 };
  }

  const confirmations = await processDueConfirmations();
  const queued = await processQueueBuild();

  await prisma.reminderCheckLog.create({
    data: {
      rentalsChecked: confirmations.rentalsChecked,
      dueCount: confirmations.due,
      sentCount: confirmations.sent,
      failedCount: confirmations.failed,
      queuedCount: queued,
      source,
    },
  });
  logDebug("reminder_hourly_cycle", { ...confirmations, queued });

  return { checked: confirmations.checked, sent: confirmations.sent, failed: confirmations.failed, queued };
}

// Meant for the daily cron (schedule configured in cPanel, invisible to the
// app): sends whatever in the queue is due today.
export async function runDailySendCycle(
  source: ReminderCheckSource = "CRON",
): Promise<{ checked: number; sent: number; failed: number }> {
  if (!(await getRemindersEnabled())) {
    return { checked: 0, sent: 0, failed: 0 };
  }

  const result = await processQueuedSends();

  await prisma.reminderCheckLog.create({
    data: {
      rentalsChecked: result.rentalsChecked,
      dueCount: result.due,
      sentCount: result.sent,
      failedCount: result.failed,
      queuedCount: 0,
      source,
    },
  });
  logDebug("reminder_daily_send_cycle", result);

  return { checked: result.checked, sent: result.sent, failed: result.failed };
}

// Cancels a not-yet-sent reminder from the "Nadchodzące powiadomienia do
// wysłania" review UI. Works on QUEUED items (the common case) and on
// SCHEDULED ones (not yet promoted into the queue), but never touches
// SENT/FAILED/CANCELLED rules.
export async function cancelQueuedReminder(id: string): Promise<boolean> {
  const rule = await prisma.reminderRule.findUnique({ where: { id } });
  if (!rule || (rule.status !== "QUEUED" && rule.status !== "SCHEDULED")) return false;

  await prisma.reminderRule.update({ where: { id }, data: { status: "CANCELLED" } });
  return true;
}

export type UpcomingQueueItemDto = {
  id: string;
  rentalId: string;
  rentalTitle: string;
  deviceName: string;
  clientName: string | null;
  phone: string | null;
  daysBefore: ReminderDays;
  scheduledFor: string;
  messageBody: string;
};

// Powers the "Nadchodzące powiadomienia do wysłania" section: everything
// currently QUEUED, with the message body rendered from the *current*
// template (matching what will actually be sent, not the stale snapshot
// captured when the rule was created).
export async function getUpcomingQueue(): Promise<UpcomingQueueItemDto[]> {
  const [rules, templates] = await Promise.all([
    prisma.reminderRule.findMany({
      where: { status: "QUEUED", channel: "SMS" },
      orderBy: { scheduledFor: "asc" },
      include: { rental: { include: { device: true } } },
    }),
    prisma.messageTemplate.findMany({ where: { key: { in: Object.values(TEMPLATE_KEYS) } } }),
  ]);

  return rules.map((rule) => {
    const days = rule.daysBefore as ReminderDays;
    const template = templates.find((t) => t.key === TEMPLATE_KEYS[days]);
    return {
      id: rule.id,
      rentalId: rule.rentalId,
      rentalTitle: rule.rental.title,
      deviceName: rule.rental.device.name,
      clientName: rule.rental.contactNameCache,
      phone: rule.rental.contactPhoneCache,
      daysBefore: days,
      scheduledFor: rule.scheduledFor.toISOString(),
      messageBody: renderTemplate(template?.body || DEFAULT_TEMPLATE_BODY[days], rule.rental),
    };
  });
}

export type ReminderCheckLogDto = {
  id: string;
  rentalsChecked: number;
  dueCount: number;
  sentCount: number;
  failedCount: number;
  queuedCount: number;
  source: ReminderCheckSource;
  createdAt: Date;
};

export async function getReminderCheckLogs(limit = 50): Promise<ReminderCheckLogDto[]> {
  return prisma.reminderCheckLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
