"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Device = {
  id: string;
  name: string;
  shortName: string;
  color: string;
  googleCalendarId: string;
  active: boolean;
  rentalCount: number;
  lastSync: { status: "OK" | "ERROR"; createdAt: string } | null;
  nextRental: { title: string; startsAt: string } | null;
};

type GoogleCalendarOption = { id: string; summary: string };

async function api(url: string, init?: RequestInit) {
  const res = await fetch(`/wynajem${url}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
}

function DeviceForm({
  device,
  onSaved,
  onCancel,
}: {
  device: Device | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(device?.name ?? "");
  const [shortName, setShortName] = useState(device?.shortName ?? "");
  const [color, setColor] = useState(device?.color ?? "#2563eb");
  const [googleCalendarId, setGoogleCalendarId] = useState(device?.googleCalendarId ?? "");
  const [calendars, setCalendars] = useState<GoogleCalendarOption[] | null>(null);
  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedCalendars, setLoadedCalendars] = useState(false);

  async function loadCalendars() {
    if (loadedCalendars) return;
    setLoadedCalendars(true);
    const { ok, data } = await api("/api/integrations/google-calendar/calendars");
    if (ok && Array.isArray(data?.calendars)) {
      setCalendars(data.calendars);
    } else {
      setCalendarsError(data?.message || "Nie udało się pobrać listy kalendarzy — wpisz ID ręcznie.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const body = { name, shortName, color, googleCalendarId };
    const { ok, data } = device
      ? await api(`/api/devices/${device.id}`, { method: "PATCH", body: JSON.stringify(body) })
      : await api("/api/devices", { method: "POST", body: JSON.stringify(body) });

    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się zapisać urządzenia.");
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Nazwa
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Skrót (w kalendarzu)
          <input
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            required
            maxLength={12}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Kolor
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-full rounded-md border border-gray-300"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Kalendarz Google
          {calendars ? (
            <select
              value={googleCalendarId}
              onChange={(e) => setGoogleCalendarId(e.target.value)}
              required
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            >
              <option value="">— wybierz —</option>
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.summary}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={googleCalendarId}
              onChange={(e) => setGoogleCalendarId(e.target.value)}
              onFocus={loadCalendars}
              required
              placeholder="np. xxxx@group.calendar.google.com"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            />
          )}
          {calendarsError && <span className="text-xs text-amber-700">{calendarsError}</span>}
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isSaving ? "Zapisywanie…" : "Zapisz"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}

function DeviceRow({ device, isAdmin, onChanged }: { device: Device; isAdmin: boolean; onChanged: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function handleSync() {
    setIsSyncing(true);
    setSyncMessage(null);
    const { ok, data } = await api(`/api/devices/${device.id}/sync`, { method: "POST" });
    setIsSyncing(false);
    setSyncMessage(data?.message || (ok ? "Zsynchronizowano." : "Błąd synchronizacji."));
    if (ok) onChanged();
  }

  async function handleToggleActive() {
    const { ok } = await api(`/api/devices/${device.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !device.active }),
    });
    if (ok) onChanged();
  }

  if (isEditing) {
    return (
      <div className="py-3">
        <DeviceForm
          device={device}
          onSaved={() => {
            setIsEditing(false);
            onChanged();
          }}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <span className="h-4 w-4 flex-none rounded-full border border-gray-300" style={{ backgroundColor: device.color }} />
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm font-medium text-gray-900">
          {device.name} <span className="text-gray-400">({device.shortName})</span>
          {!device.active && (
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">wycofane</span>
          )}
        </p>
        <p className="truncate text-xs text-gray-500">{device.googleCalendarId}</p>
      </div>

      <div className="min-w-[9rem] text-xs text-gray-600">
        <p>{device.rentalCount} rezerwacji</p>
        {device.nextRental ? (
          <p>
            Najbliższa: {device.nextRental.title} · {formatDateTime(device.nextRental.startsAt)}
          </p>
        ) : (
          <p className="text-gray-400">Brak nadchodzących</p>
        )}
      </div>

      <div className="min-w-[9rem] text-xs">
        {device.lastSync ? (
          <span className={device.lastSync.status === "OK" ? "text-green-700" : "text-red-700"}>
            Sync: {device.lastSync.status === "OK" ? "OK" : "błąd"} · {formatDateTime(device.lastSync.createdAt)}
          </span>
        ) : (
          <span className="text-gray-400">Brak synchronizacji</span>
        )}
        {syncMessage && <p className="text-gray-500">{syncMessage}</p>}
      </div>

      <div className="flex flex-none gap-2">
        <button
          type="button"
          onClick={handleSync}
          disabled={isSyncing}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isSyncing ? "Synchronizowanie…" : "Synchronizuj teraz"}
        </button>
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Edytuj
            </button>
            <button
              type="button"
              onClick={handleToggleActive}
              className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              {device.active ? "Wycofaj" : "Przywróć"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function DevicesPanel({ devices, isAdmin }: { devices: Device[]; isAdmin: boolean }) {
  const [isAdding, setIsAdding] = useState(false);
  const router = useRouter();

  function reload() {
    router.refresh();
  }

  return (
    <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Urządzenia ({devices.length})</h2>
        {isAdmin && !isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Dodaj urządzenie
          </button>
        )}
      </div>

      {isAdding && (
        <div className="mb-4">
          <DeviceForm
            device={null}
            onSaved={() => {
              setIsAdding(false);
              reload();
            }}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} isAdmin={isAdmin} onChanged={reload} />
        ))}
        {devices.length === 0 && <p className="py-6 text-center text-sm text-gray-400">Brak urządzeń.</p>}
      </div>
    </div>
  );
}
