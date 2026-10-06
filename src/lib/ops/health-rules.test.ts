import { describe, expect, it } from "vitest";
import { alertDue, evaluateHealth, isGmailAccessError, validAlertEmail } from "./health-rules";

const now = new Date("2026-10-06T12:00:00Z");
const base = { db: true, gmailSend: true, gmailRead: true, syncEnabled: true, lastSyncAt: "2026-10-06T11:57:00Z", now };

describe("evaluateHealth", () => {
  it("wszystko działa", () => expect(evaluateHealth(base)).toEqual({ ok: true, db: true, gmail: true, cron: true }));
  it("baza nie działa", () => expect(evaluateHealth({ ...base, db: false }).ok).toBe(false));
  it("Gmail: wysyłka albo odczyt nie działa", () => {
    expect(evaluateHealth({ ...base, gmailSend: false })).toMatchObject({ ok: false, gmail: false });
    expect(evaluateHealth({ ...base, gmailRead: false })).toMatchObject({ ok: false, gmail: false });
  });
  it("cron: synchronizacja starsza niż 15 min albo bez śladu → nie działa", () => {
    expect(evaluateHealth({ ...base, lastSyncAt: "2026-10-06T11:44:00Z" })).toMatchObject({ ok: false, cron: false });
    expect(evaluateHealth({ ...base, lastSyncAt: null }).cron).toBe(false);
    expect(evaluateHealth({ ...base, lastSyncAt: "2026-10-06T11:45:00Z" }).cron).toBe(true); // równo 15 min
  });
  it("synchronizacja wyłączona → cron nie jest wymagany", () => {
    expect(evaluateHealth({ ...base, syncEnabled: false, lastSyncAt: null })).toMatchObject({ ok: true, cron: true });
  });
});

describe("isGmailAccessError", () => {
  it("rozpoznaje utratę dostępu", () => {
    expect(isGmailAccessError("invalid_grant: Invalid email or User ID")).toBe(true);
    expect(isGmailAccessError("unauthorized_client")).toBe(true);
    expect(isGmailAccessError("Brak zmiennych w .env: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.")).toBe(true);
  });
  it("inne błędy to nie utrata dostępu", () => {
    expect(isGmailAccessError("Gmail API zwróciło błąd (HTTP 503).")).toBe(false);
    expect(isGmailAccessError(null)).toBe(false);
  });
});

describe("alertDue", () => {
  it("limit czasowy", () => {
    expect(alertDue(null, now, 60)).toBe(true);
    expect(alertDue("2026-10-06T11:30:00Z", now, 60)).toBe(false);
    expect(alertDue("2026-10-06T10:59:00Z", now, 60)).toBe(true);
    expect(alertDue("2026-10-06T11:59:00Z", now, 0)).toBe(true); // 0 = zawsze
    expect(alertDue("nie data", now, 60)).toBe(true);
  });
});

describe("validAlertEmail", () => {
  it("walidacja adresu", () => {
    expect(validAlertEmail("ktos@firma.pl")).toBe(true);
    expect(validAlertEmail("ktos@")).toBe(false);
    expect(validAlertEmail("")).toBe(false);
  });
});
