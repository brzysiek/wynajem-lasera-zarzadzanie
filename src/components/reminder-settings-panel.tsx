"use client";

import { useState } from "react";
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

export function ReminderSettingsPanel({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isToggling, setIsToggling] = useState(false);
  const [toggleMessage, setToggleMessage] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

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
  );
}
