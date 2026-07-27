"use client";

import { useState } from "react";

type TestResult = { ok: boolean; message: string };

type GoogleStatus = {
  serviceAccountEmail: boolean;
  privateKey: boolean;
  impersonatedUser: boolean;
};

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        ok ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-green-600" : "bg-gray-400"}`} />
      {label}
    </span>
  );
}

function TestResultBox({ result }: { result: TestResult }) {
  return (
    <p className={`rounded-md px-3 py-2 text-sm ${result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
      {result.message}
    </p>
  );
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: body === undefined ? "DELETE" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export function GoogleCalendarPanel({ initialStatus }: { initialStatus: GoogleStatus }) {
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const allConfigured =
    initialStatus.serviceAccountEmail && initialStatus.privateKey && initialStatus.impersonatedUser;

  async function handleTest() {
    setIsTesting(true);
    setTestResult(null);

    const { data } = await postJson("/wynajem/api/integrations/google-calendar/test", {});

    setIsTesting(false);
    setTestResult(data || { ok: false, message: "Brak odpowiedzi z serwera." });
  }

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Google Calendar</h2>
          <p className="text-sm text-gray-500">Service account z domain-wide delegation.</p>
        </div>
        <StatusBadge ok={allConfigured} label={allConfigured ? "Skonfigurowano" : "Brak konfiguracji"} />
      </div>

      <ul className="mb-4 space-y-1.5 text-sm text-gray-600">
        <li className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${initialStatus.serviceAccountEmail ? "bg-green-600" : "bg-gray-300"}`} />
          GOOGLE_SERVICE_ACCOUNT_EMAIL
        </li>
        <li className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${initialStatus.privateKey ? "bg-green-600" : "bg-gray-300"}`} />
          GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
        </li>
        <li className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${initialStatus.impersonatedUser ? "bg-green-600" : "bg-gray-300"}`} />
          GOOGLE_IMPERSONATED_USER
        </li>
      </ul>

      <p className="mb-4 text-sm text-gray-500">
        Te trzy wartości ustawia się bezpośrednio w <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">.env</code> na
        serwerze (klucz prywatny to wieloliniowy PEM, nieporęczny w formularzu webowym) — instrukcja niżej. Tutaj można
        tylko sprawdzić, czy to, co jest ustawione, faktycznie działa.
      </p>

      <button
        type="button"
        onClick={handleTest}
        disabled={isTesting}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {isTesting ? "Testowanie…" : "Testuj / autoryzuj ponownie"}
      </button>

      {testResult && (
        <div className="mt-3">
          <TestResultBox result={testResult} />
        </div>
      )}
    </section>
  );
}
