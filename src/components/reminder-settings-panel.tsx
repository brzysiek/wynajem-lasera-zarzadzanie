"use client";

import { useState, type FormEvent } from "react";
import { BASE_PATH } from "@/lib/base-path";

async function postJson(url: string, body: unknown) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export function ReminderSettingsPanel({
  initialHour,
  initialEnabled,
}: {
  initialHour: string;
  initialEnabled: boolean;
}) {
  const [hour, setHour] = useState(initialHour);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [enabled, setEnabled] = useState(initialEnabled);
  const [isToggling, setIsToggling] = useState(false);
  const [toggleMessage, setToggleMessage] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

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

  async function handleToggle() {
    const nextEnabled = !enabled;
    setIsToggling(true);
    setToggleError(null);
    setToggleMessage(null);

    const { ok, data } = await postJson("/api/reminders/settings", { enabled: nextEnabled });
    setIsToggling(false);
    if (!ok) {
      setToggleError(data?.message || "Nie udało się zmienić ustawień.");
      return;
    }

    setEnabled(nextEnabled);
    const discarded = typeof data?.discarded === "number" ? data.discarded : 0;
    if (nextEnabled && discarded > 0) {
      setToggleMessage(
        `Włączono. Pominięto ${discarded} przypomnie${discarded === 1 ? "nie" : "ń"}, które stały się nieaktualne w czasie wstrzymania.`,
      );
    } else if (nextEnabled) {
      setToggleMessage("Włączono.");
    } else {
      setToggleMessage("Wstrzymano — żadne SMS-y nie będą wysyłane, dopóki nie włączysz z powrotem.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        className={`rounded-lg border p-6 ${enabled ? "border-gray-200 bg-white" : "border-amber-300 bg-amber-50"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="mb-1 text-lg font-semibold text-gray-900">
              {enabled ? "Przypomnienia SMS są włączone" : "Przypomnienia SMS są wstrzymane"}
            </h2>
            <p className="text-sm text-gray-500">
              {enabled
                ? "Wentyl bezpieczeństwa — jednym kliknięciem wstrzymasz całą automatyczną wysyłkę SMS (potwierdzenia i przypomnienia), np. gdy trzeba pilnie coś poprawić."
                : "Żadne potwierdzenia ani przypomnienia SMS nie są teraz wysyłane. To, co w tym czasie stanie się aktualne, nie zostanie wysłane później z opóźnieniem — po włączeniu z powrotem zostanie pominięte, a nie dosłane."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={isToggling}
            className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              enabled ? "bg-red-600 text-white hover:bg-red-700" : "bg-gray-900 text-white hover:bg-gray-700"
            }`}
          >
            {isToggling ? "Zapisywanie…" : enabled ? "Wyłącz przypomnienia SMS" : "Włącz przypomnienia SMS"}
          </button>
        </div>
        {toggleError && <p className="mt-3 text-sm text-red-700">{toggleError}</p>}
        {toggleMessage && !toggleError && <p className="mt-3 text-sm text-green-700">{toggleMessage}</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">Godzina wysyłki</h2>
          <p className="mb-4 text-sm text-gray-500">
            Godzina, o której mają wychodzić przypomnienia 7/3/1-dniowe (np. 9:00 rano). Potwierdzenie rezerwacji
            wychodzi zawsze od razu, niezależnie od tej godziny.
          </p>
          <input
            type="time"
            value={hour}
            onChange={(e) => setHour(e.target.value)}
            required
            disabled={!enabled}
            className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
          />
          {!enabled && (
            <p className="mt-2 text-xs text-gray-400">Włącz przypomnienia SMS powyżej, żeby zmienić godzinę.</p>
          )}
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
        {saved && !error && <p className="text-sm text-green-700">Zapisano.</p>}

        <div>
          <button
            type="submit"
            disabled={isSaving || !enabled}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {isSaving ? "Zapisywanie…" : "Zapisz"}
          </button>
        </div>
      </form>
    </div>
  );
}
