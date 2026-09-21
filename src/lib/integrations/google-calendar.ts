import { createSign } from "crypto";
import { prisma } from "@/lib/prisma";
import { logDebug, logInfo } from "@/lib/logger";

export type DeviceCalendarCheck = {
  deviceId: string;
  deviceName: string;
  calendarId: string;
  ok: boolean;
  reason: string | null;
};

export type IntegrationTestResult = { ok: boolean; message: string; calendars?: DeviceCalendarCheck[] };

export type GoogleCalendarConfigStatus = {
  serviceAccountEmail: boolean;
  privateKey: boolean;
  impersonatedUser: boolean;
};

export function getGoogleCalendarConfigStatus(): GoogleCalendarConfigStatus {
  return {
    serviceAccountEmail: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    privateKey: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    impersonatedUser: Boolean(process.env.GOOGLE_IMPERSONATED_USER),
  };
}

// The JSON key Google gives you has a real multi-line `private_key` field,
// but .env needs it on one line — the documented convention (see the
// instructions below on this page) is to store it with literal `\n`
// sequences instead of real newlines, so this reverses that before signing.
function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

// `scope` domyślnie Kalendarz (wywołania w tym pliku) — src/lib/integrations/gmail.ts
// reużywa TEGO SAMEGO konta serwisowego (te same 3 zmienne w .env) z innym
// zakresem (gmail.compose). Domain-wide delegation w Google Admin musi mieć
// dopisane OBA zakresy do tego samego Client ID, nie tylko calendar.
export async function getAccessToken(
  scope: string = "https://www.googleapis.com/auth/calendar",
): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const impersonatedUser = process.env.GOOGLE_IMPERSONATED_USER;

  const missing = [
    !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    !privateKey && "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    !impersonatedUser && "GOOGLE_IMPERSONATED_USER",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Brak zmiennych w .env: ${missing.join(", ")}.`);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      sub: impersonatedUser,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(normalizePrivateKey(privateKey!), "base64url");
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    throw new Error(body?.error_description || body?.error || `Google zwrócił błąd autoryzacji (HTTP ${res.status}).`);
  }

  logDebug("google_calendar_token_obtained", { impersonatedUser, scope });
  return body.access_token as string;
}

export type GoogleCalendarListEntry = { id: string; summary: string };

export type GoogleEventInput = {
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
};

export type GoogleEvent = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  cancelled: boolean;
  updatedAt: Date;
};

// Explicitly resolves the calendar date in Europe/Warsaw regardless of the
// Node process's own TZ (never guaranteed to match on shared hosting — see
// logger.ts's todayStr, which uses the same pattern for the same reason).
// Using date.getFullYear()/getMonth()/getDate() here previously read the
// *server process's* local date instead, which silently shifted all-day
// events by a day whenever the host's TZ wasn't actually Warsaw.
function toDateOnly(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
}

// Millisecond arithmetic rather than setDate()/getDate() so this doesn't
// depend on the runtime's local TZ either (see toDateOnly above) — a plain
// ±24h shift is safe for the noon-UTC-anchored instants this module works
// with, which never sit close enough to a DST boundary for the hour to matter.
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function toGoogleEventBody(input: GoogleEventInput) {
  // Google's all-day end.date is exclusive (the event runs up to but not
  // including that day), while startsAt/endsAt in this app are both the
  // inclusive first/last day of the rental — so a 1-day rental has
  // startsAt === endsAt and needs end.date one day past endsAt.
  //
  // PATCH on this API merges fields into the stored event rather than
  // replacing start/end wholesale, so an event that was originally created
  // as timed (dateTime + timeZone) still has those fields server-side after
  // we PATCH in a `date` for the all-day switch — Google then sees both
  // `date` and `dateTime` set and rejects the request with "Invalid start
  // time." Explicitly nulling the sibling fields clears them instead of
  // leaving them stale.
  const start = input.allDay
    ? { date: toDateOnly(input.startsAt), dateTime: null, timeZone: null }
    : { dateTime: input.startsAt.toISOString(), date: null };
  const end = input.allDay
    ? { date: toDateOnly(addDays(input.endsAt, 1)), dateTime: null, timeZone: null }
    : { dateTime: input.endsAt.toISOString(), date: null };

  return {
    summary: input.title,
    description: input.description ?? undefined,
    start,
    end,
  };
}

// `isExclusiveEnd` un-does Google's exclusive all-day end.date (see
// toGoogleEventBody) so the parsed date matches this app's inclusive
// startsAt/endsAt convention.
function parseGoogleDateTime(
  value: { dateTime?: string; date?: string },
  isExclusiveEnd = false,
): { date: Date; allDay: boolean } {
  if (value.date) {
    // Anchored at noon UTC rather than midnight UTC: midnight-UTC sits right
    // on Warsaw's local calendar-day boundary (00:00-02:00 local, depending
    // on DST), so reading it back with anything other than an exact
    // Europe/Warsaw offset — including the server process's own ambient TZ,
    // which is what toDateOnly used to do — could resolve to the wrong day.
    // Noon UTC has hours of margin on both sides for any realistic TZ this
    // value gets read back in.
    const date = new Date(`${value.date}T12:00:00.000Z`);
    return { date: isExclusiveEnd ? addDays(date, -1) : date, allDay: true };
  }
  return { date: new Date(value.dateTime!), allDay: false };
}

async function googleFetch(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

export async function listGoogleCalendars(): Promise<GoogleCalendarListEntry[]> {
  const accessToken = await getAccessToken();
  const calendars: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: "250", ...(pageToken ? { pageToken } : {}) });
    const { res, body } = await googleFetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`,
      accessToken,
    );
    if (!res.ok) {
      throw new Error(body?.error?.message || `Calendar API zwróciło błąd (HTTP ${res.status}).`);
    }
    for (const item of body.items ?? []) {
      calendars.push({ id: item.id, summary: item.summary ?? item.id });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  logDebug("google_calendars_listed", { count: calendars.length });
  return calendars;
}

export async function listCalendarEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<GoogleEvent[]> {
  const accessToken = await getAccessToken();
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    });
    const { res, body } = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      accessToken,
    );
    if (!res.ok) {
      throw new Error(body?.error?.message || `Calendar API zwróciło błąd (HTTP ${res.status}).`);
    }
    for (const item of body.items ?? []) {
      if (item.status === "cancelled") continue;
      const start = parseGoogleDateTime(item.start);
      const end = parseGoogleDateTime(item.end, true);
      events.push({
        id: item.id,
        title: item.summary ?? "(bez tytułu)",
        description: item.description ?? null,
        startsAt: start.date,
        endsAt: end.date,
        allDay: start.allDay,
        cancelled: false,
        updatedAt: new Date(item.updated),
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  logDebug("google_calendar_events_listed", { calendarId, count: events.length });
  return events;
}

export async function insertCalendarEvent(calendarId: string, input: GoogleEventInput): Promise<{ id: string }> {
  const accessToken = await getAccessToken();
  const { res, body } = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    accessToken,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toGoogleEventBody(input)) },
  );
  if (!res.ok) {
    throw new Error(body?.error?.message || `Nie udało się utworzyć wydarzenia (HTTP ${res.status}).`);
  }
  logInfo("google_calendar_event_created", { calendarId, eventId: body.id });
  return { id: body.id };
}

export async function updateCalendarEvent(calendarId: string, eventId: string, input: GoogleEventInput): Promise<void> {
  const accessToken = await getAccessToken();
  const { res, body } = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toGoogleEventBody(input)) },
  );
  if (!res.ok) {
    throw new Error(body?.error?.message || `Nie udało się zaktualizować wydarzenia (HTTP ${res.status}).`);
  }
  logInfo("google_calendar_event_updated", { calendarId, eventId });
}

// Moves an event to a different calendar (used when a rental's device
// changes) — the event keeps the same id, just under a new calendarId, so
// no history/attendee state is lost the way a delete+recreate would lose it.
export async function moveCalendarEvent(calendarId: string, eventId: string, destinationCalendarId: string): Promise<void> {
  const accessToken = await getAccessToken();
  const { res, body } = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move?destination=${encodeURIComponent(destinationCalendarId)}`,
    accessToken,
    { method: "POST" },
  );
  if (!res.ok) {
    throw new Error(body?.error?.message || `Nie udało się przenieść wydarzenia do innego kalendarza (HTTP ${res.status}).`);
  }
  logInfo("google_calendar_event_moved", { calendarId, eventId, destinationCalendarId });
}

export async function deleteCalendarEvent(calendarId: string, eventId: string): Promise<void> {
  const accessToken = await getAccessToken();
  const { res, body } = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    { method: "DELETE" },
  );
  // Google returns 410/404 if the event is already gone — treat as success.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error(body?.error?.message || `Nie udało się usunąć wydarzenia (HTTP ${res.status}).`);
  }
  logInfo("google_calendar_event_deleted", { calendarId, eventId, alreadyGone: res.status === 410 || res.status === 404 });
}

// calendarList only reports calendars the impersonated user has "subscribed"
// to in their own Google Calendar UI — a calendar can be directly shared
// with the service account (and therefore fully readable/writable via
// calendars/{id}/events, which is all listCalendarEvents/device-sync.ts
// ever use) without showing up there. So the real "will this device's
// calendar sync?" check is a direct metadata fetch per device, not
// cross-referencing calendarList.
async function checkDeviceCalendarAccess(
  calendarId: string,
  accessToken: string,
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const { res, body } = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
      accessToken,
    );
    if (res.ok) return { ok: true, reason: null };
    if (res.status === 404) return { ok: false, reason: "kalendarz nie istnieje lub ID jest nieprawidłowe." };
    if (res.status === 403) return { ok: false, reason: "kalendarz nie jest udostępniony kontu serwisowemu." };
    if (res.status === 401) return { ok: false, reason: "błąd autoryzacji konta serwisowego." };
    return { ok: false, reason: body?.error?.message || `Calendar API zwróciło błąd (HTTP ${res.status}).` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function testGoogleCalendarConnection(): Promise<IntegrationTestResult> {
  try {
    const accessToken = await getAccessToken();
    const visibleCalendars = await listGoogleCalendars();

    const devices = await prisma.device.findMany({
      select: { id: true, name: true, googleCalendarId: true },
      orderBy: { name: "asc" },
    });

    // Sequential, not Promise.all — same reasoning as syncAllDevices: keeps
    // calls to the Calendar API gentle and results ordered/predictable.
    const calendars: DeviceCalendarCheck[] = [];
    for (const device of devices) {
      const { ok, reason } = await checkDeviceCalendarAccess(device.googleCalendarId, accessToken);
      calendars.push({ deviceId: device.id, deviceName: device.name, calendarId: device.googleCalendarId, ok, reason });
    }

    const failed = calendars.filter((c) => !c.ok);
    const devicesSummary =
      calendars.length === 0
        ? "brak skonfigurowanych urządzeń."
        : failed.length === 0
          ? `wszystkie (${calendars.length}) zsynchronizowane poprawnie.`
          : `${calendars.length - failed.length}/${calendars.length} OK. Błędy: ${failed
              .map((c) => `${c.deviceName} — ${c.reason}`)
              .join("; ")}`;

    return {
      ok: failed.length === 0,
      message: `Połączono jako ${process.env.GOOGLE_IMPERSONATED_USER} — widoczne kalendarze konta: ${visibleCalendars.length}. Kalendarze urządzeń: ${devicesSummary}`,
      calendars,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
