"use client";

import { useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { zoneRangeLabel, type TransportZone } from "@/lib/clients/delivery-rules";

// Ustawienia → Cennik: baza (skąd liczymy trasy do adresów dostawy) i stawki
// stref transportu. Strefa to tylko podpowiedź na karcie klienta — nie
// nadpisuje transportu z warunków klienta.
export function DeliverySettingsPanel({ initialBase, initialZones }: { initialBase: { address: string; lat: number; lng: number }; initialZones: TransportZone[] }) {
  const [base, setBase] = useState(initialBase);
  const [address, setAddress] = useState(initialBase.address);
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(initialZones.map((z) => [z.code, z.priceNet != null ? String(z.priceNet) : ""])));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(address.trim() !== base.address ? { text: "Szukanie adresu bazy na mapie i przeliczanie tras…" } : null);
    const res = await fetch(`${BASE_PATH}/api/pricing/delivery`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseAddress: address, zonePrices: prices }),
    });
    const data = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) return setMsg({ text: data?.message ?? "Nie udało się zapisać.", error: true });
    const moved = data.base.address !== base.address;
    setBase(data.base);
    setMsg({ text: moved ? "Zapisano. Trasy przeliczą się przy zapisie adresu albo z mapy klientek („Uzupełnij współrzędne”)." : "Zapisano." });
  }

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Baza i strefy transportu</h2>
      <p className="mb-4 text-sm text-gray-500">
        Z bazy liczymy trasę do adresów dostawy (OpenStreetMap, bez korków): km i minuty na karcie klienta. Strefa to podpowiedź — transport z warunków klienta ma pierwszeństwo.
      </p>
      <label className="flex max-w-xl flex-col gap-1 text-sm text-gray-700">
        Adres bazy
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#1B6FA8] focus:outline-none"
        />
        <span className="text-xs tabular-nums text-gray-400">
          współrzędne {base.lat.toFixed(5)}, {base.lng.toFixed(5)}
        </span>
      </label>
      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        {initialZones.map((z) => (
          <label key={z.code} className="flex flex-col gap-1 text-sm text-gray-700">
            <span>
              Strefa {z.code} <span className="text-gray-400">· {zoneRangeLabel(z)}</span>
            </span>
            <input
              value={prices[z.code] ?? ""}
              onChange={(e) => setPrices((p) => ({ ...p, [z.code]: e.target.value }))}
              inputMode="decimal"
              placeholder="zł netto"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#1B6FA8] focus:outline-none"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md bg-[#1B6FA8] px-4 py-2 text-sm font-medium text-white hover:bg-[#14567F] disabled:opacity-50"
        >
          {saving ? "Zapisywanie…" : "Zapisz bazę i strefy"}
        </button>
        {msg && <span className={`text-sm ${msg.error ? "text-red-700" : "text-green-700"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
