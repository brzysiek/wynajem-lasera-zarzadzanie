import { createSign } from "crypto";
import { logDebug, logInfo } from "@/lib/logger";

export type IntegrationTestResult = { ok: boolean; message: string };

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

export async function getAccessToken(): Promise<string> {
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
      scope: "https://www.googleapis.com/auth/calendar",
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

  logDebug("google_calendar_token_obtained", { impersonatedUser });
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

// Uses local (server TZ, i.e. Europe/Warsaw) calendar-date components, not
// UTC — startsAt/endsAt represent local midnight, which during CEST is
// 22:00 UTC the previous day, so slicing the UTC ISO string would shift
// all-day dates back by one.
function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toGoogleEventBody(input: GoogleEventInput) {
  // Google's all-day end.date is exclusive (the event runs up to but not
  // including that day), while startsAt/endsAt in this app are both the
  // inclusive first/last day of the rental — so a 1-day rental has
  // startsAt === endsAt and needs end.date one day past endsAt.
  const start = input.allDay ? { date: toDateOnly(input.startsAt) } : { dateTime: input.startsAt.toISOString() };
  const end = input.allDay ? { date: toDateOnly(addDays(input.endsAt, 1)) } : { dateTime: input.endsAt.toISOString() };

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
    const date = new Date(`${value.date}T00:00:00.000Z`);
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

export async function testGoogleCalendarConnection(): Promise<IntegrationTestResult> {
  try {
    const accessToken = await getAccessToken();

    const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=5", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message || `Calendar API zwróciło błąd (HTTP ${res.status}).`);
    }

    const data = await res.json();
    const count = Array.isArray(data.items) ? data.items.length : 0;

    return {
      ok: true,
      message: `Połączono jako ${process.env.GOOGLE_IMPERSONATED_USER} — widoczne kalendarze: ${count}.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
