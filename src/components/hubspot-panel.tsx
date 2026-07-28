"use client";

import { useState, type FormEvent } from "react";
import { BASE_PATH } from "@/lib/base-path";

type TestResult = { ok: boolean; message: string };

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

export function HubspotPanel({ initiallyConfigured }: { initiallyConfigured: boolean }) {
  const [configured, setConfigured] = useState(initiallyConfigured);
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);
    setTestResult(null);

    const { ok, data } = await postJson(`${BASE_PATH}/api/integrations/hubspot`, { token });

    setIsSaving(false);
    setSaveMessage(data?.message || (ok ? "Zapisano." : "Nie udało się zapisać tokenu."));
    if (ok) {
      setConfigured(true);
      setToken("");
    }
  }

  async function handleRemove() {
    setIsSaving(true);
    setSaveMessage(null);
    setTestResult(null);

    const { data } = await postJson(`${BASE_PATH}/api/integrations/hubspot`);

    setIsSaving(false);
    setSaveMessage(data?.message || "Token usunięty.");
    setConfigured(false);
  }

  async function handleTest() {
    setIsTesting(true);
    setTestResult(null);

    const { data } = await postJson(`${BASE_PATH}/api/integrations/hubspot/test`, {});

    setIsTesting(false);
    setTestResult(data || { ok: false, message: "Brak odpowiedzi z serwera." });
  }

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">HubSpot</h2>
          <p className="text-sm text-gray-500">Token dostępu Private App (CRM kontaktów).</p>
        </div>
        <StatusBadge ok={configured} label={configured ? "Skonfigurowano" : "Brak konfiguracji"} />
      </div>

      <form onSubmit={handleSave} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          placeholder={configured ? "•••••••••••• (ustawiony — wpisz nowy, żeby zmienić)" : "pat-xx-xxxxxxxx-xxxx-..."}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          className="w-full flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isSaving || !token}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isSaving ? "Zapisywanie…" : "Zapisz"}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={isTesting}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isTesting ? "Testowanie…" : "Testuj połączenie"}
        </button>
        {configured && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={isSaving}
            className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Usuń token
          </button>
        )}
      </div>

      {saveMessage && <p className="mt-3 text-sm text-gray-600">{saveMessage}</p>}
      {testResult && (
        <div className="mt-3">
          <TestResultBox result={testResult} />
        </div>
      )}
    </section>
  );
}
