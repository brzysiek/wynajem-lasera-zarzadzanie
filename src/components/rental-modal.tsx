"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

export type Device = { id: string; name: string; shortName: string; color: string; active: boolean };

export type Rental = {
  id: string;
  deviceId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  hubspotContactId?: string | null;
  contactNameCache?: string | null;
  contactPhoneCache?: string | null;
  contactEmailCache?: string | null;
  contactCompanyCache?: string | null;
  contactAddressCache?: string | null;
};

type ContactSummary = {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
};

type AssignedContact = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  address: string | null;
  url: string | null;
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

function contactFromRental(rental: Rental | null): AssignedContact | null {
  if (!rental?.hubspotContactId) return null;
  return {
    id: rental.hubspotContactId,
    name: rental.contactNameCache ?? null,
    phone: rental.contactPhoneCache ?? null,
    email: rental.contactEmailCache ?? null,
    company: rental.contactCompanyCache ?? null,
    address: rental.contactAddressCache ?? null,
    url: null,
  };
}

function ContactSection({
  rentalId,
  initialContact,
  onChanged,
}: {
  rentalId: string;
  initialContact: AssignedContact | null;
  onChanged: () => void;
}) {
  const [contact, setContact] = useState(initialContact);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      return;
    }

    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      setError(null);
      try {
        const res = await fetch(
          `/wynajem/api/integrations/hubspot/contacts/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.message || "Wyszukiwanie kontaktów nie powiodło się.");
          setResults(null);
        } else {
          setResults(data?.contacts ?? []);
        }
      } catch {
        // Aborted by a newer keystroke — ignore.
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function assign(contactId: string) {
    setIsAssigning(true);
    setError(null);
    const res = await fetch(`/wynajem/api/rentals/${rentalId}/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId }),
    });
    const data = await res.json().catch(() => null);
    setIsAssigning(false);
    if (!res.ok) {
      setError(data?.message || "Nie udało się przypisać kontaktu.");
      return;
    }
    const r = data.rental;
    setContact({
      id: r.hubspotContactId,
      name: r.contactNameCache,
      phone: r.contactPhoneCache,
      email: r.contactEmailCache,
      company: r.contactCompanyCache,
      address: r.contactAddressCache,
      url: data.contactUrl ?? null,
    });
    setQuery("");
    setResults(null);
    onChanged();
  }

  async function unassign() {
    setIsAssigning(true);
    setError(null);
    const res = await fetch(`/wynajem/api/rentals/${rentalId}/contact`, { method: "DELETE" });
    setIsAssigning(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.message || "Nie udało się odpiąć kontaktu.");
      return;
    }
    setContact(null);
    onChanged();
  }

  if (contact) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-gray-800">
            <p className="font-medium">{contact.name || "(bez nazwy)"}</p>
            {contact.company && <p className="text-gray-600">{contact.company}</p>}
            {contact.phone && <p className="text-gray-600">{contact.phone}</p>}
            {contact.email && <p className="text-gray-600">{contact.email}</p>}
            {contact.address && <p className="text-gray-500">{contact.address}</p>}
            {contact.url && (
              <a
                href={contact.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-blue-600 hover:underline"
              >
                Otwórz w HubSpot ↗
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={unassign}
            disabled={isAssigning}
            className="flex-none rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Odepnij
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <input
        value={query}
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          if (value.trim().length < 3) {
            setResults(null);
            setError(null);
          }
        }}
        placeholder="Imię, nazwisko, firma, telefon lub e-mail (min. 3 znaki)…"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
      />
      {isSearching && <p className="mt-1 text-xs text-gray-400">Szukanie…</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {results && results.length === 0 && !isSearching && (
        <p className="mt-1 text-xs text-gray-400">Brak wyników.</p>
      )}
      {results && results.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200">
          {results.map((c) => {
            const name = [c.firstname, c.lastname].filter(Boolean).join(" ") || "(bez nazwy)";
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={isAssigning}
                  onClick={() => assign(c.id)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="font-medium text-gray-900">{name}</span>
                  {c.company && <span className="text-gray-500"> · {c.company}</span>}
                  {c.email && <span className="block text-xs text-gray-500">{c.email}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function RentalModal({
  devices,
  rental,
  defaultDeviceId,
  defaultDate,
  onClose,
  onSaved,
  onDeleted,
  onContactChanged,
}: {
  devices: Device[];
  rental: Rental | null;
  defaultDeviceId?: string;
  defaultDate?: Date;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onContactChanged?: () => void;
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

          {isEditing && (
            <div className="flex flex-col gap-1 text-sm text-gray-700">
              Klient (HubSpot)
              <ContactSection
                rentalId={rental!.id}
                initialContact={contactFromRental(rental)}
                onChanged={() => onContactChanged?.()}
              />
            </div>
          )}

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
