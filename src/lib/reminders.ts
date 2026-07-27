import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/integrations/szybkisms";
import { logInfo, logError } from "@/lib/logger";

export const REMINDER_DAYS = [1, 3, 7] as const;
export type ReminderDays = (typeof REMINDER_DAYS)[number];

const TEMPLATE_KEYS: Record<ReminderDays, string> = {
  1: "reminder_1d",
  3: "reminder_3d",
  7: "reminder_7d",
};

const TEMPLATE_LABELS: Record<ReminderDays, string> = {
  1: "Przypomnienie SMS – 1 dzień przed",
  3: "Przypomnienie SMS – 3 dni przed",
  7: "Przypomnienie SMS – 7 dni przed",
};

const DEFAULT_TEMPLATE_BODY: Record<ReminderDays, string> = {
  7: "Przypomnienie: za tydzień, {data_start} o {godzina_start}, rozpoczyna się wynajem: {urzadzenie}. Pozdrawiamy, WynajemLasera.pl",
  3: "Przypomnienie: za 3 dni, {data_start} o {godzina_start}, rozpoczyna się wynajem: {urzadzenie}. Pozdrawiamy, WynajemLasera.pl",
  1: "Przypomnienie: jutro, {data_start} o {godzina_start}, rozpoczyna się wynajem: {urzadzenie}. Pozdrawiamy, WynajemLasera.pl",
};

const SETTING_KEY_HOUR = "sms_reminder_hour";
const DEFAULT_REMINDER_HOUR = "09:00";

export async function ensureDefaultTemplates(): Promise<void> {
  for (const days of REMINDER_DAYS) {
    await prisma.messageTemplate.upsert({
      where: { key: TEMPLATE_KEYS[days] },
      update: {},
      create: { key: TEMPLATE_KEYS[days], label: TEMPLATE_LABELS[days], channel: "SMS", body: DEFAULT_TEMPLATE_BODY[days] },
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

export function computeScheduledFor(rentalStartsAt: Date, daysBefore: number): Date {
  const result = new Date(rentalStartsAt);
  result.setDate(result.getDate() - daysBefore);
  return result;
}

type RentalForSync = { id: string; startsAt: Date };

// Keeps at most one ReminderRule per (rental, daysBefore) offset in sync with
// the desired checked/unchecked checkbox state from the rental form. SENT
// rules are immutable history and are never touched here — the UI renders
// them checked+disabled so `selectedDays` naturally still includes them.
export async function syncReminderRules(rental: RentalForSync, selectedDays: ReminderDays[]): Promise<void> {
  const existing = await prisma.reminderRule.findMany({ where: { rentalId: rental.id, channel: "SMS" } });

  for (const days of REMINDER_DAYS) {
    const wanted = selectedDays.includes(days);
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
    .replaceAll("{godzina_start}", rental.allDay ? "" : start.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }))
    .replaceAll("{data_koniec}", end.toLocaleDateString("pl-PL"))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePolishPhone(raw: string): string | null {
  const digits = raw.trim().replace(/[^\d+]/g, "");
  if (/^\+\d{9,15}$/.test(digits)) return digits;
  if (/^48\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{9}$/.test(digits)) return `+48${digits}`;
  return null;
}

export async function sendDueReminders(): Promise<{ checked: number; sent: number; failed: number }> {
  const hour = await getReminderHour();
  const [hh, mm] = hour.split(":").map((n) => Number(n) || 0);
  const targetMinutes = hh * 60 + mm;
  const nowParts = warsawParts(new Date());

  const dueRules = await prisma.reminderRule.findMany({
    where: { status: "SCHEDULED", channel: "SMS" },
    include: { rental: { include: { device: true } } },
  });

  let sent = 0;
  let failed = 0;

  for (const rule of dueRules) {
    const targetParts = warsawParts(rule.scheduledFor);
    const isPastDay = targetParts.dateStr < nowParts.dateStr;
    const isDueToday = targetParts.dateStr === nowParts.dateStr && nowParts.hour * 60 + nowParts.minute >= targetMinutes;
    if (!isPastDay && !isDueToday) continue;

    const rental = rule.rental;
    const days = rule.daysBefore as ReminderDays;
    const template = TEMPLATE_KEYS[days]
      ? await prisma.messageTemplate.findUnique({ where: { key: TEMPLATE_KEYS[days] } })
      : null;
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

  return { checked: dueRules.length, sent, failed };
}
