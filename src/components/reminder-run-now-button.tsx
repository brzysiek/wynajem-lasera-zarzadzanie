"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReminderRunNowButton() {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/wynajem/api/reminders/run-now", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message || "Nie udało się uruchomić wysyłki.");
        return;
      }
      setResult(`Sprawdzono: ${data.checked}, wysłano: ${data.sent}, błędy: ${data.failed}.`);
      router.refresh();
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isRunning}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {isRunning ? "Wysyłanie…" : "Wyślij teraz"}
      </button>
      {result && <p className="text-xs text-green-700">{result}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
