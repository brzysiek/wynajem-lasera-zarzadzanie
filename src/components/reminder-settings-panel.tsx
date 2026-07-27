"use client";

import { useState, type FormEvent } from "react";

type ReminderDays = 1 | 3 | 7;

const LABELS: Record<ReminderDays, string> = {
  7: "7 dni przed",
  3: "3 dni przed",
  1: "1 dzień przed",
};

const ORDER: ReminderDays[] = [7, 3, 1];

async function postJson(url: string, body: unknown) {
  const res = await fetch(`/wynajem${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export function ReminderSettingsPanel({
  initialHour,
  initialTemplates,
}: {
  initialHour: string;
  initialTemplates: { daysBefore: ReminderDays; body: string }[];
}) {
  const [hour, setHour] = useState(initialHour);
  const [bodies, setBodies] = useState<Record<ReminderDays, string>>(() => {
    const map = {} as Record<ReminderDays, string>;
    for (const t of initialTemplates) map[t.daysBefore] = t.body;
    return map;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setSaved(false);

    const templates: Record<string, string> = {};
    for (const days of ORDER) templates[String(days)] = bodies[days] ?? "";

    const { ok, data } = await postJson("/api/reminders/settings", { hour, templates });
    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się zapisać ustawień.");
      return;
    }
    setSaved(true);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
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

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Szablony wiadomości</h2>
        <p className="mb-4 text-sm text-gray-500">
          Dostępne znaczniki: <code className="rounded bg-gray-100 px-1 py-0.5">{"{klient}"}</code>{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{"{urzadzenie}"}</code>{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{"{data_start}"}</code>{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{"{godzina_start}"}</code>{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{"{data_koniec}"}</code>
        </p>
        <div className="flex flex-col gap-4">
          {ORDER.map((days) => (
            <label key={days} className="flex flex-col gap-1 text-sm text-gray-700">
              {LABELS[days]}
              <textarea
                value={bodies[days] ?? ""}
                onChange={(e) => setBodies((prev) => ({ ...prev, [days]: e.target.value }))}
                rows={2}
                required
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
          ))}
        </div>
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
