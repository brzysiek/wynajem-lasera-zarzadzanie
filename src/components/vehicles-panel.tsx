"use client";

import { useState, type FormEvent } from "react";
import { BASE_PATH } from "@/lib/base-path";

export type VehicleDto = {
  id: string;
  name: string;
  plateNumber: string;
  fuelCostPerKm: string;
  fuelCostUpdatedAt: string | null;
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
  if (!iso) return "nigdy aktualizowane";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "dziś";
  if (days === 1) return "1 dzień temu";
  if (days < 5) return `${days} dni temu`;
  return `${days} dni temu`;
}

function VehicleRow({ vehicle, onSaved }: { vehicle: VehicleDto; onSaved: (v: VehicleDto) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(vehicle.name);
  const [plateNumber, setPlateNumber] = useState(vehicle.plateNumber);
  const [fuelCostPerKm, setFuelCostPerKm] = useState(vehicle.fuelCostPerKm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const { ok, data } = await api(`/api/vehicles/${vehicle.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, plateNumber, fuelCostPerKm: Number(fuelCostPerKm.replace(",", ".")) }),
    });
    setSaving(false);
    if (!ok) return setError(data?.message || "Nie udało się zapisać.");
    onSaved({ ...vehicle, name, plateNumber, fuelCostPerKm, fuelCostUpdatedAt: new Date().toISOString() });
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
            value={fuelCostPerKm}
            onChange={(e) => setFuelCostPerKm(e.target.value)}
            inputMode="decimal"
            placeholder="zł/km"
            className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
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
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
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
          {vehicle.plateNumber} · {vehicle.fuelCostPerKm} zł/km · ostatnia aktualizacja: {daysAgoLabel(vehicle.fuelCostUpdatedAt)}
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

export function VehiclesPanel({ initialVehicles }: { initialVehicles: VehicleDto[] }) {
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
      body: JSON.stringify({ name: newName, plateNumber: newPlate, fuelCostPerKm: Number(newFuel.replace(",", ".")) || 0 }),
    });
    setAdding(false);
    if (!ok) return setError(data?.message || "Nie udało się dodać pojazdu.");
    setVehicles((prev) => [
      ...prev,
      {
        id: data.vehicle.id,
        name: data.vehicle.name,
        plateNumber: data.vehicle.plateNumber,
        fuelCostPerKm: data.vehicle.fuelCostPerKm.toString(),
        fuelCostUpdatedAt: data.vehicle.fuelCostUpdatedAt,
        active: data.vehicle.active,
      },
    ]);
    setNewName("");
    setNewPlate("");
    setNewFuel("");
  }

  return (
    <div className="max-w-2xl">
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
            placeholder="zł/km"
            className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={adding || !newName.trim() || !newPlate.trim()}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            + Dodaj
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </form>
    </div>
  );
}
