import { prisma } from "@/lib/prisma";
import { sendOpsMail } from "@/lib/email";
import { logError, logWarn } from "@/lib/logger";
import { alertDue } from "@/lib/ops/health-rules";

// Alarmy mailowe (06.10.2026): wysyłka maila automatycznego nie udała się
// 2 razy z rzędu / ostatecznie, błąd 500 webhooka formularzy, utrata dostępu
// do Gmail API, stanął cron. Adres: Ustawienia → Maile automatyczne (Setting
// alert_email; w repozytorium nie ma adresów), awaryjnie env ALERT_EMAIL.
// Alarm nigdy nie rzuca wyjątku (nie psuje obsługi żądania) i ma limit na
// klucz, żeby nie zasypać skrzynki. Bez danych osobowych klientów w treści.

export const ALERT_EMAIL_KEY = "alert_email";
const PREFIX = "[Panel WynajemLasera] ";

export async function getAlertEmail(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: ALERT_EMAIL_KEY } }).catch(() => null);
  return row?.value?.trim() || process.env.ALERT_EMAIL?.trim() || null;
}

export async function sendAlert(opts: { key: string; subject: string; text: string; throttleMin?: number }): Promise<boolean> {
  try {
    const to = await getAlertEmail();
    if (!to) {
      logWarn("alert_no_recipient", { key: opts.key });
      return false;
    }
    const now = new Date();
    const stateKey = `alert_last:${opts.key}`;
    const last = await prisma.setting.findUnique({ where: { key: stateKey } });
    if (!alertDue(last?.value, now, opts.throttleMin ?? 60)) return false;
    await sendOpsMail(to, `${PREFIX}${opts.subject}`, `${opts.text}\n\n— Panel WynajemLasera.pl, ${now.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}`);
    await prisma.setting.upsert({ where: { key: stateKey }, create: { key: stateKey, value: now.toISOString() }, update: { value: now.toISOString() } });
    return true;
  } catch (err) {
    logError("alert_send_failed", err, { key: opts.key });
    return false;
  }
}
