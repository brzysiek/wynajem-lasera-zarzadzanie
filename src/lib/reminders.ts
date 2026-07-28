import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/integrations/szybkisms";
import { logDebug, logInfo, logError } from "@/lib/logger";
import { SUPPORT_PHONE } from "@/lib/sms-template";

export const REMINDER_DAYS = [1, 3, 7] as const;
export type ReminderDays = (typeof REMINDER_DAYS)[number];

// The reservation-confirmation message reuses the same ReminderRule/SMS
// pipeline (scheduling, sending, history) as the day-before reminders, with
// 0 as its "daysBefore" — it has no day-count wording, so unlike 1/3/7 it
// isn't gated by how many days remain before the rental starts.
export const CONFIRMATION_OFFSET = 0 as const;
export const ALL_REMINDER_OFFSETS = [CONFIRMATION_OFFSET, ...REMINDER_DAYS] as const;
export type ReminderOffset = (typeof ALL_REMINDER_OFFSETS)[number];

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
  0: "Potwierdzamy rezerwację: {urzadzenie}, termin {data_start} – {data_koniec}. Pytania: {telefon_obslugi}. Pozdrawiamy, WynajemLasera.pl",
  7: "Przypomnienie: za tydzień, {data_start}, rozpoczyna się wynajem: {urzadzenie}. Pytania: {telefon_obslugi}. Pozdrawiamy, WynajemLasera.pl",
  3: "Przypomnienie: za 3 dni, {data_start}, rozpoczyna się wynajem: {urzadzenie}. Pytania: {telefon_obslugi}. Pozdrawiamy, WynajemLasera.pl",
  1: "Przypomnienie: jutro, {data_start}, rozpoczyna się wynajem: {urzadzenie}. Pytania: {telefon_obslugi}. Pozdrawiamy, WynajemLasera.pl",
};

const SETTING_KEY_HOUR = "sms_reminder_hour";
const DEFAULT_REMINDER_HOUR = "09:00";
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

export async function getReminderHour(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY_HOUR } });
  return row?.value || DEFAULT_REMINDER_HOUR;
}

export async function setReminderHour(value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY_HOUR },
    update: { value },
    create: { key: SETTING_KEY_HOUR, value },
  });
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
      // FAILED or CANCELLED -> re-arm as a fresh scheduled reminder (retry).
      await prisma.reminderRule.update({
        where: { id: current.id },
        data: { status: "SCHEDULED", scheduledFor: computeScheduledFor(rental.startsAt, days), errorMessage: null },
      });
    } else if (wanted && current && current.status === "SCHEDULED") {
      const newScheduledFor = computeScheduledFor(rental.startsAt, days);
      if (newScheduledFor.getTime() !== current.scheduledFor.getTime()) {
        await prisma.reminderRule.update({ where: { id: current.id }, data: { scheduledFor: newScheduledFor } });
      }
    } else if (!wanted && current && current.status === "SCHEDULED") {
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
    .replaceAll("{klient}", rental.contactNameCache?.trim() || "")
    .replaceAll("{urzadzenie}", rental.device.name)
    .replaceAll("{data_start}", start.toLocaleDateString("pl-PL"))
    .replaceAll("{data_koniec}", end.toLocaleDateString("pl-PL"))
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
// paused, sendDueReminders() no-ops entirely, so SCHEDULED rules just sit
// untouched instead of sending. Anything that became "due" during that
// window is marked as skipped here rather than sent late — a stale 7-day
// reminder would state the wrong day count, and a confirmation SMS sent
// days after booking would look like a mistake to the customer. Rules not
// yet due are left alone and still fire normally once their time comes.
export async function discardStaleReminders(): Promise<number> {
  const hour = await getReminderHour();
  const [hh, mm] = hour.split(":").map((n) => Number(n) || 0);
  const targetMinutes = hh * 60 + mm;
  const nowParts = warsawParts(new Date());

  const scheduledRules = await prisma.reminderRule.findMany({ where: { status: "SCHEDULED", channel: "SMS" } });

  let discarded = 0;
  for (const rule of scheduledRules) {
    const days = rule.daysBefore as ReminderOffset;
    const isDue =
      days === CONFIRMATION_OFFSET
        ? rule.scheduledFor.getTime() <= Date.now()
        : (() => {
            const targetParts = warsawParts(rule.scheduledFor);
            const isPastDay = targetParts.dateStr < nowParts.dateStr;
            const isExactDueToday =
              targetParts.dateStr === nowParts.dateStr && nowParts.hour * 60 + nowParts.minute >= targetMinutes;
            return isPastDay || isExactDueToday;
          })();
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

export async function sendDueReminders(
  source: ReminderCheckSource = "CRON",
): Promise<{ checked: number; sent: number; failed: number }> {
  const remindersEnabled = await getRemindersEnabled();
  if (!remindersEnabled) {
    return { checked: 0, sent: 0, failed: 0 };
  }

  const hour = await getReminderHour();
  const [hh, mm] = hour.split(":").map((n) => Number(n) || 0);
  const targetMinutes = hh * 60 + mm;
  const nowParts = warsawParts(new Date());

  const dueRules = await prisma.reminderRule.findMany({
    where: { status: "SCHEDULED", channel: "SMS" },
    include: { rental: { include: { device: true } } },
  });
  const rentalsChecked = new Set(dueRules.map((r) => r.rentalId)).size;

  let sent = 0;
  let failed = 0;
  let due = 0;

  for (const rule of dueRules) {
    const days = rule.daysBefore as ReminderOffset;
    const isConfirmation = days === CONFIRMATION_OFFSET;
    let expiredWithoutSending = false;

    if (isConfirmation) {
      // Scheduled at creation/re-arm time, with no daily-hour gate and no
      // "wrong day count" risk — send as soon as a cron tick sees it due.
      if (rule.scheduledFor.getTime() > Date.now()) continue;
    } else {
      const targetParts = warsawParts(rule.scheduledFor);
      const isPastDay = targetParts.dateStr < nowParts.dateStr;
      const isExactDueToday = targetParts.dateStr === nowParts.dateStr && nowParts.hour * 60 + nowParts.minute >= targetMinutes;
      if (!isPastDay && !isExactDueToday) continue;
      expiredWithoutSending = isPastDay;
    }
    due++;

    const rental = rule.rental;

    if (expiredWithoutSending) {
      // The exact "N dni przed" day already passed without this firing
      // (e.g. the app was down at the time) — sending it now would state a
      // wrong day count ("za 7 dni" with fewer than 7 actually left), so
      // it's marked failed instead of catching up late with stale wording.
      const errorMessage = "Termin wysyłki minął bez wysłania przypomnienia (np. aplikacja była wyłączona o właściwej porze).";
      await prisma.reminderRule.update({ where: { id: rule.id }, data: { status: "FAILED", errorMessage } });
      failed++;
      logError("reminder_window_missed", new Error(errorMessage), { rentalId: rental.id, daysBefore: days });
      continue;
    }

    const template = await prisma.messageTemplate.findUnique({ where: { key: TEMPLATE_KEYS[days] } });
    const body = renderTemplate(template?.body || DEFAULT_TEMPLATE_BODY[days] || "{urzadzenie}", rental);
    const phone = rental.contactPhoneCache ? normalizePolishPhone(rental.contactPhoneCache) : null;

    if (!phone) {
      const errorMessage = "Brak poprawnego numeru telefonu kontaktu.";
      await prisma.$transaction([
        prisma.reminderRule.update({ where: { id: rule.id }, data: { status: "FAILED", errorMessage, messageBody: body } }),
        prisma.message.create({
          data: { rentalId: rental.id, channel: "SMS", recipient: rental.contactPhoneCache || "", body, status: "FAILED", errorMessage },
        }),
      ]);
      failed++;
      logError("reminder_send_failed", new Error(errorMessage), { rentalId: rental.id, daysBefore: days });
      continue;
    }

    const result = await sendSms(phone, body);
    if (result.ok) {
      await prisma.$transaction([
        prisma.reminderRule.update({ where: { id: rule.id }, data: { status: "SENT", sentAt: new Date(), messageBody: body } }),
        prisma.message.create({
          data: {
            rentalId: rental.id,
            channel: "SMS",
            recipient: phone,
            body,
            status: "SENT",
            providerMessageId: result.providerMessageId,
          },
        }),
      ]);
      sent++;
      logInfo("reminder_sent", { rentalId: rental.id, daysBefore: days, phone });
    } else {
      await prisma.$transaction([
        prisma.reminderRule.update({ where: { id: rule.id }, data: { status: "FAILED", errorMessage: result.message, messageBody: body } }),
        prisma.message.create({
          data: { rentalId: rental.id, channel: "SMS", recipient: phone, body, status: "FAILED", errorMessage: result.message },
        }),
      ]);
      failed++;
      logError("reminder_send_failed", new Error(result.message), { rentalId: rental.id, daysBefore: days });
    }
  }

  await prisma.reminderCheckLog.create({
    data: { rentalsChecked, dueCount: due, sentCount: sent, failedCount: failed, source },
  });

  logDebug("reminder_check_run", { rentalsChecked, dueCount: due, sentCount: sent, failedCount: failed });

  return { checked: dueRules.length, sent, failed };
}

export type ReminderCheckLogDto = {
  id: string;
  rentalsChecked: number;
  dueCount: number;
  sentCount: number;
  failedCount: number;
  source: ReminderCheckSource;
  createdAt: Date;
};

export async function getReminderCheckLogs(limit = 50): Promise<ReminderCheckLogDto[]> {
  return prisma.reminderCheckLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
