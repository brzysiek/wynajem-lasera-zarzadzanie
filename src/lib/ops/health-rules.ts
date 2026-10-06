// Odporność panelu (06.10.2026): reguły /api/health i alarmów mailowych.
// Czysty moduł (vitest bez "@/").

// Cron Gmaila chodzi co 5 min i odświeża lastSyncAt; to on ponawia też maile
// automatyczne — brak odświeżenia przez 15 min = ponowienia nie działają.
export const CRON_MAX_AGE_MIN = 15;

export type HealthInput = { db: boolean; gmailSend: boolean; gmailRead: boolean; syncEnabled: boolean; lastSyncAt: string | null; now: Date };
export type HealthResult = { ok: boolean; db: boolean; gmail: boolean; cron: boolean };

export function evaluateHealth(i: HealthInput): HealthResult {
  const gmail = i.gmailSend && i.gmailRead;
  const cron = !i.syncEnabled || (i.lastSyncAt != null && i.now.getTime() - Date.parse(i.lastSyncAt) <= CRON_MAX_AGE_MIN * 60_000);
  return { ok: i.db && gmail && cron, db: i.db, gmail, cron };
}

// Błąd dostępu do Gmail API (klucz konta serwisowego, delegacja w Google
// Admin, zakres) — wymaga interwencji, ponowienia nie pomogą.
const ACCESS_ERROR = /(invalid_grant|unauthorized_client|invalid_client|access_denied|delegation denied|insufficient permission|account.?disabled|Brak zmiennych w \.env)/i;
export function isGmailAccessError(message: string | null | undefined): boolean {
  return ACCESS_ERROR.test(message ?? "");
}

// Czy alarm o tym kluczu można wysłać (limit, żeby nie zasypać skrzynki).
export function alertDue(lastIso: string | null | undefined, now: Date, windowMin: number): boolean {
  if (windowMin <= 0 || !lastIso) return true;
  const last = Date.parse(lastIso);
  return Number.isNaN(last) || now.getTime() - last >= windowMin * 60_000;
}

export function validAlertEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
