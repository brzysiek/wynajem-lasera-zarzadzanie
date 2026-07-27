"use client";

import { useState, type FormEvent } from "react";

async function postJson(url: string, body: unknown) {
  const res = await fetch(`/wynajem${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export function ReminderSettingsPanel({ initialHour }: { initialHour: string }) {
  const [hour, setHour] = useState(initialHour);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setSaved(false);

    const { ok, data } = await postJson("/api/reminders/settings", { hour });
    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się zapisać ustawień.");
      return;
    }
    setSaved(true);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Godzina wysyłki</h2>
        <p className="mb-4 text-sm text-gray-500">
          O tej godzinie (czasu polskiego) system codziennie sprawdza i wysyła zaplanowane na dziś przypomnienia SMS.
        </p>
        <input
          type="time"
          value={hour}
          onChange={(e) => setHour(e.target.value)}
          required
          className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {saved && !error && <p className="text-sm text-green-700">Zapisano.</p>}

      <div>
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isSaving ? "Zapisywanie…" : "Zapisz"}
        </button>
      </div>
    </form>
  );
}
