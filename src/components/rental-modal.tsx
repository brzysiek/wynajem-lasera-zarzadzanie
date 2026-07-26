"use client";

import { useState, type FormEvent } from "react";

export type Device = { id: string; name: string; shortName: string; color: string; active: boolean };

export type Rental = {
  id: string;
  deviceId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
};

async function api(url: string, init?: RequestInit) {
  const res = await fetch(`/wynajem${url}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart(day?: Date): string {
  const date = day ? new Date(day) : new Date();
  if (day) {
    date.setHours(9, 0, 0, 0);
  } else {
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() + 1);
  }
  return toLocalInputValue(date.toISOString());
}

function defaultEnd(start: string): string {
  const date = new Date(start);
  date.setHours(date.getHours() + 4);
  return toLocalInputValue(date.toISOString());
}

export function RentalModal({
  devices,
  rental,
  defaultDeviceId,
  defaultDate,
  onClose,
  onSaved,
  onDeleted,
}: {
  devices: Device[];
  rental: Rental | null;
  defaultDeviceId?: string;
  defaultDate?: Date;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const isEditing = Boolean(rental);
  const [deviceId, setDeviceId] = useState(rental?.deviceId ?? defaultDeviceId ?? devices[0]?.id ?? "");
  const [title, setTitle] = useState(rental?.title ?? "");
  const [description, setDescription] = useState(rental?.description ?? "");
  const [allDay, setAllDay] = useState(rental?.allDay ?? false);
  const initialStart = rental ? toLocalInputValue(rental.startsAt) : defaultStart(defaultDate);
  const [startsAt, setStartsAt] = useState(initialStart);
  const [endsAt, setEndsAt] = useState(rental ? toLocalInputValue(rental.endsAt) : defaultEnd(initialStart));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const device = devices.find((d) => d.id === deviceId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const body = {
      deviceId,
      title,
      description,
      allDay,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    };

    const { ok, data } = isEditing
      ? await api(`/api/rentals/${rental!.id}`, { method: "PATCH", body: JSON.stringify(body) })
      : await api("/api/rentals", { method: "POST", body: JSON.stringify(body) });

    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się zapisać rezerwacji.");
      return;
    }
    onSaved();
  }

  async function handleDelete() {
    if (!rental) return;
    setIsDeleting(true);
    setError(null);
    const { ok, data } = await api(`/api/rentals/${rental.id}`, { method: "DELETE" });
    setIsDeleting(false);
    if (!ok) {
      setError(data?.message || "Nie udało się usunąć rezerwacji.");
      return;
    }
    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          {isEditing ? "Edytuj rezerwację" : "Nowa rezerwacja"}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Urządzenie
            {isEditing ? (
              <span className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: device?.color }} />
                {device?.name ?? "—"}
              </span>
            ) : (
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                required
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              >
                {devices
                  .filter((d) => d.active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Tytuł
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Opis
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            Cały dzień
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Początek
              <input
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? startsAt.slice(0, 10) : startsAt}
                onChange={(e) => setStartsAt(allDay ? `${e.target.value}T00:00` : e.target.value)}
                required
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Koniec
              <input
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? endsAt.slice(0, 10) : endsAt}
                onChange={(e) => setEndsAt(allDay ? `${e.target.value}T00:00` : e.target.value)}
                required
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              {isEditing &&
                (confirmingDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Na pewno usunąć?</span>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {isDeleting ? "Usuwanie…" : "Tak, usuń"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      className="text-sm text-gray-500 hover:underline"
                    >
                      Anuluj
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Usuń rezerwację
                  </button>
                ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Zamknij
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {isSaving ? "Zapisywanie…" : "Zapisz"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
