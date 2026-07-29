"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";

function ManualRunButton({
  label,
  runningLabel,
  path,
  formatResult,
}: {
  label: string;
  runningLabel: string;
  path: string;
  formatResult: (data: { checked: number; sent: number; failed: number; queued?: number }) => string;
}) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${BASE_PATH}${path}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message || "Nie udało się uruchomić.");
        return;
      }
      setResult(formatResult(data));
      router.refresh();
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isRunning}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {isRunning ? runningLabel : label}
      </button>
      {result && <p className="text-xs text-green-700">{result}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function ReminderManualRunPanel() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Ręczne uruchomienie</h2>
      <p className="mb-4 text-sm text-gray-500">
        Doraźnie, bez czekania na cron: sprawdź, co jest do wysyłki, albo wyślij to, co już jest w kolejce i zapadalne.
      </p>
      <div className="flex flex-wrap gap-4">
        <ManualRunButton
          label="Sprawdź teraz"
          runningLabel="Sprawdzanie…"
          path="/api/reminders/run-check"
          formatResult={(data) => `Sprawdzono: ${data.checked}, nowo w kolejce: ${data.queued}.`}
        />
        <ManualRunButton
          label="Wyślij teraz"
          runningLabel="Wysyłanie…"
          path="/api/reminders/run-send"
          formatResult={(data) => `Sprawdzono: ${data.checked}, wysłano: ${data.sent}, błędy: ${data.failed}.`}
        />
      </div>
    </div>
  );
}
