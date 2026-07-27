import { logDebug, logInfo, logWarn } from "@/lib/logger";

export type IntegrationTestResult = { ok: boolean; message: string };
export type SendSmsResult = { ok: boolean; message: string; providerMessageId?: string };

const API_BASE = "https://api.szybkisms.pl/rest";

export function getSzybkiSmsConfigStatus(): { configured: boolean } {
  return { configured: Boolean(process.env.SZYBKISMS_API_TOKEN) };
}

export async function testSzybkiSmsConnection(): Promise<IntegrationTestResult> {
  const token = process.env.SZYBKISMS_API_TOKEN;
  if (!token) {
    return { ok: false, message: "Brak SZYBKISMS_API_TOKEN — zapisz token wyżej, żeby przetestować połączenie." };
  }

  try {
    const res = await fetch(`${API_BASE}/account`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.detail || body?.title || body?.message || `SzybkiSMS API zwróciło błąd (HTTP ${res.status}).`);
    }

    const credit = body?.credit ?? "?";
    const currency = body?.currency ?? "";
    return { ok: true, message: `Połączono — saldo konta: ${credit} ${currency}`.trim() + "." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// recipient must already be normalized to E.164 (e.g. "+48500600700") — the
// SzybkiSMS API rejects anything else (schema pattern ^\+[0-9]+$).
export async function sendSms(recipient: string, message: string): Promise<SendSmsResult> {
  const token = process.env.SZYBKISMS_API_TOKEN;
  if (!token) {
    logWarn("szybkisms_send_skipped_no_token", { recipient });
    return { ok: false, message: "Brak SZYBKISMS_API_TOKEN." };
  }

  logDebug("szybkisms_send_attempt", { recipient, messageLength: message.length });

  try {
    const res = await fetch(`${API_BASE}/messages/sms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: recipient, message }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.detail || body?.title || `SzybkiSMS API zwróciło błąd (HTTP ${res.status}).`);
    }

    const first = Array.isArray(body) ? body[0] : null;
    if (!first) {
      throw new Error("SzybkiSMS API zwróciło nieoczekiwaną odpowiedź.");
    }
    if (first.status_code && first.status_code !== "QUEUED" && first.status_code !== "SENT" && first.status_code !== "DELIVERED") {
      throw new Error(first.status_description || `SzybkiSMS odrzuciło wiadomość (${first.status_code}).`);
    }

    logInfo("szybkisms_send_ok", { recipient, providerMessageId: first.id, statusCode: first.status_code });
    return {
      ok: true,
      message: first.status_description || "Wysłano.",
      providerMessageId: first.id != null ? String(first.id) : undefined,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logWarn("szybkisms_send_failed", { recipient, reason });
    return { ok: false, message: reason };
  }
}
