"use client";

import { useState, type FormEvent } from "react";
import { BASE_PATH } from "@/lib/base-path";

export type VehicleDto = {
  id: string;
  name: string;
  plateNumber: string;
  fuelConsumptionL100km: string;
  active: boolean;
};

async function api(url: string, init?: RequestInit) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function daysAgoLabel(iso: string | null): string {
  if (!iso) return "nigdy nieaktualizowana";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "dziś";
  if (days === 1) return "1 dzień temu";
  return `${days} dni temu`;
}

// Jeden, współdzielony parametr dla całej floty — ADMIN aktualizuje raz
// tygodniowo zamiast osobno przeliczać koszt/km w każdym pojeździe (patrz
// Vehicle.fuelConsumptionL100km + PricingSetting["fuel_price_per_liter"] w
// schema.prisma). Ten sam komponent logiki co src/components/fuel-price-reminder.tsx,
// tylko inne miejsce wejścia — oba biją w /api/pricing.
export function FuelPriceCard({
  initialValue,
  initialUpdatedAt,
}: {
  initialValue: string;
  initialUpdatedAt: string | null;
}) {
  const [value, setValue] = useState(initialValue);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return setError("Cena musi być nieujemną liczbą.");
    setSaving(true);
    setError(null);
    const { ok, data } = await api("/api/pricing", {
      method: "PATCH",
      body: JSON.stringify({ settings: [{ key: "fuel_price_per_liter", value: n }] }),
    });
    setSaving(false);
    if (!ok) return setError(data?.message || "Nie udało się zapisać.");
    setUpdatedAt(new Date().toISOString());
    setEditing(false);
  }

  return (
    <div className="mb-4 rounded-lg border p-4" style={{ borderColor: "#CFE0F0", background: "#EAF4FB" }}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "#1B6FA8" }}>
        Cena paliwa — jeden parametr dla całej floty
      </p>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <span className="text-sm text-gray-600">zł/L</span>
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-md bg-[#1B6FA8] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Zapisz
          </button>
          <button type="button" onClick={() => { setEditing(false); setValue(initialValue === value ? value : initialValue); setError(null); }} className="text-xs font-medium text-gray-500">
            Anuluj
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-2xl font-bold text-gray-900">
            {Number(value).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł/L
            <span className="ml-2 text-xs font-normal text-gray-500">ostatnia aktualizacja: {daysAgoLabel(updatedAt)}</span>
          </div>
          <button type="button" onClick={() => setEditing(true)} className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#1B6FA8] shadow-sm">
            Zmień cenę
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <p className="mt-2 text-xs text-gray-500">
        Koszt paliwa per wynajem = spalanie pojazdu (poniżej) ÷ 100 × ta cena. Zmieniasz tylko ten jeden parametr — nie musisz
        przeliczać kosztu/km osobno w każdym aucie.
      </p>
    </div>
  );
}

function VehicleRow({ vehicle, onSaved }: { vehicle: VehicleDto; onSaved: (v: VehicleDto) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(vehicle.name);
  const [plateNumber, setPlateNumber] = useState(vehicle.plateNumber);
  const [fuelConsumptionL100km, setFuelConsumptionL100km] = useState(vehicle.fuelConsumptionL100km);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const { ok, data } = await api(`/api/vehicles/${vehicle.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, plateNumber, fuelConsumptionL100km: Number(fuelConsumptionL100km.replace(",", ".")) }),
    });
    setSaving(false);
    if (!ok) return setError(data?.message || "Nie udało się zapisać.");
    onSaved({ ...vehicle, name, plateNumber, fuelConsumptionL100km });
    setEditing(false);
  }

  async function toggleActive() {
    const { ok, data } = await api(`/api/vehicles/${vehicle.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !vehicle.active }),
    });
    if (!ok) return setError(data?.message || "Nie udało się zapisać.");
    onSaved({ ...vehicle, active: !vehicle.active });
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nazwa (np. Ford Transit — auto 1)"
            className="min-w-[180px] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            value={plateNumber}
            onChange={(e) => setPlateNumber(e.target.value)}
            placeholder="Nr rejestracyjny"
            className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            value={fuelConsumptionL100km}
            onChange={(e) => setFuelConsumptionL100km(e.target.value)}
            inputMode="decimal"
            placeholder="L/100km"
            className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-2.5 flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} className="text-xs font-medium text-gray-500">
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !name.trim() || !plateNumber.trim()}
            className="rounded-md bg-[#1B6FA8] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Zapisz
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-3 last:border-0">
      <div className={vehicle.active ? "" : "opacity-50"}>
        <div className="text-sm font-semibold text-gray-900">
          {vehicle.name}
          {!vehicle.active && <span className="ml-2 text-xs font-normal text-gray-400">(nieaktywny)</span>}
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {vehicle.plateNumber} · spalanie {vehicle.fuelConsumptionL100km} L/100km
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        <button
          type="button"
          onClick={() => void toggleActive()}
          className="rounded-full border border-gray-300 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
        >
          {vehicle.active ? "Dezaktywuj" : "Aktywuj"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Edytuj"
        >
          ✎
        </button>
      </div>
    </div>
  );
}

export function VehiclesPanel({
  initialVehicles,
  fuelPrice,
  fuelPriceUpdatedAt,
}: {
  initialVehicles: VehicleDto[];
  fuelPrice: string;
  fuelPriceUpdatedAt: string | null;
}) {
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [newName, setNewName] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [newFuel, setNewFuel] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addVehicle(e: FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    const { ok, data } = await api("/api/vehicles", {
      method: "POST",
      body: JSON.stringify({ name: newName, plateNumber: newPlate, fuelConsumptionL100km: Number(newFuel.replace(",", ".")) || 0 }),
    });
    setAdding(false);
    if (!ok) return setError(data?.message || "Nie udało się dodać pojazdu.");
    setVehicles((prev) => [
      ...prev,
      {
        id: data.vehicle.id,
        name: data.vehicle.name,
        plateNumber: data.vehicle.plateNumber,
        fuelConsumptionL100km: data.vehicle.fuelConsumptionL100km.toString(),
        active: data.vehicle.active,
      },
    ]);
    setNewName("");
    setNewPlate("");
    setNewFuel("");
  }

  return (
    <div className="max-w-2xl">
      <FuelPriceCard initialValue={fuelPrice} initialUpdatedAt={fuelPriceUpdatedAt} />

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        {vehicles.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">Brak pojazdów — dodaj pierwszy poniżej.</p>
        ) : (
          vehicles.map((v) => (
            <VehicleRow
              key={v.id}
              vehicle={v}
              onSaved={(updated) => setVehicles((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
            />
          ))
        )}
      </div>

      <form onSubmit={addVehicle} className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Dodaj pojazd</p>
        <div className="flex flex-wrap gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nazwa (np. Ford Transit — auto 1)"
            className="min-w-[180px] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            value={newPlate}
            onChange={(e) => setNewPlate(e.target.value)}
            placeholder="Nr rejestracyjny"
            className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <input
            value={newFuel}
            onChange={(e) => setNewFuel(e.target.value)}
            inputMode="decimal"
            placeholder="Spalanie L/100km"
            className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={adding || !newName.trim() || !newPlate.trim()}
            className="rounded-md bg-[#1B6FA8] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            + Dodaj
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </form>
    </div>
  );
}
