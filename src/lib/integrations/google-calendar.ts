import { createSign } from "crypto";

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

async function getAccessToken(): Promise<string> {
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
      scope: "https://www.googleapis.com/auth/calendar.readonly",
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

  return body.access_token as string;
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
