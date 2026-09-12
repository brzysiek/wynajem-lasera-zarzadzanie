"use client";

import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";

// "wyskakujące okienko" żeby ADMIN nie musiał szukać ceny paliwa po
// Ustawieniach — pojawia się na dowolnej stronie, gdy PricingSetting["fuel_price_per_liter"]
// (src/components/vehicles-panel.tsx, ten sam parametr) nie było aktualizowane
// od >= STALE_DAYS, z polem do zapisu WPROST w oknie (bez przekierowania).
// "Przypomnij jutro" wycisza tylko do końca dzisiejszego dnia (localStorage) —
// wraca następnego dnia, dopóki cena nie zostanie zaktualizowana.
const STALE_DAYS = 7;
const DISMISS_KEY = "wl_fuel_price_reminder_dismissed_until";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Setting = { key: string; value: string; updatedAt: string };

export function FuelPriceReminder({ role }: { role?: "ADMIN" | "STAFF" | "KIEROWCA" }) {
  const [stale, setStale] = useState<{ value: string; daysStale: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "ADMIN") return;
    let cancelled = false;
    (async () => {
      try {
        const dismissedUntil = localStorage.getItem(DISMISS_KEY);
        if (dismissedUntil && dismissedUntil >= todayISO()) return;
      } catch {
        // localStorage niedostępny — po prostu nie wyciszaj (pokaż jeśli stare).
      }
      let data: { settings?: Setting[] } | null = null;
      try {
        const res = await fetch(`${BASE_PATH}/api/pricing`, { cache: "no-store" });
        if (!res.ok) return;
        data = await res.json();
      } catch {
        return;
      }
      if (cancelled) return;
      const setting = data?.settings?.find((s) => s.key === "fuel_price_per_liter");
      if (!setting) return;
      const daysStale = Math.floor((Date.now() - new Date(setting.updatedAt).getTime()) / 86_400_000);
      if (daysStale >= STALE_DAYS) {
        setStale({ value: setting.value, daysStale });
        setEditValue(setting.value);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  function dismissUntilTomorrow() {
    try {
      localStorage.setItem(DISMISS_KEY, todayISO());
    } catch {
      // best-effort — brak zapisu po prostu pokaże modal znowu przy następnej wizycie.
    }
    setStale(null);
  }

  async function save() {
    const n = Number(editValue.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setError("Cena musi być nieujemną liczbą.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/pricing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: [{ key: "fuel_price_per_liter", value: n }] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się zapisać.");
      setStale(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setSaving(false);
    }
  }

  if (!stale) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-2 text-[28px]">⛽</div>
        <h2 className="mb-1.5 text-[17px] font-semibold text-gray-900">Zaktualizuj cenę paliwa</h2>
        <p className="mb-4 text-[13px] leading-relaxed text-gray-500">
          Cena{" "}
          <b>{Number(stale.value).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł/L</b>{" "}
          nie była zmieniana od {stale.daysStale} dni. Wpływa na koszt paliwa liczony dla całej floty (Finanse → Koszty).
        </p>
        <div className="mb-1 flex items-center gap-2">
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            inputMode="decimal"
            className="w-28 rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-[#1B6FA8] focus:outline-none"
          />
          <span className="text-sm text-gray-600">zł/L</span>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismissUntilTomorrow}
            className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-gray-500 hover:bg-gray-50"
          >
            Przypomnij jutro
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-[#1B6FA8] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
          >
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}
