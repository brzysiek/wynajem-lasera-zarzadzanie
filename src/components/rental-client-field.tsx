"use client";

import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { STATUS_LABEL } from "@/lib/clients/labels";
import type { ClientHit } from "@/lib/clients/search";

// Klient rezerwacji (wniosek 23): wybierany w panelu, nie zgadywany.
// Wyszukiwarka (nazwa, nazwa robocza, alias, osoba, telefon, e-mail, NIP),
// kandydaci z uzasadnieniem („alias”, „ta sama seria”, „podobna nazwa 0,83 –
// sprawdź”) i „+ Nowy klient” z kontrolą duplikatów.

export type PickedClient = { id: string; name: string; shortName: string | null; city: string | null };
export type ClientCandidate = { clientId: string; name: string; shortName: string | null; city: string | null; reason: string };

const INPUT = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1B6FA8] focus:outline-none";
const d2 = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });

async function call<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { message?: string } }> {
  const res = await fetch(`${BASE_PATH}${path}`, init);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function HitRow({ h, onPick }: { h: ClientHit; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className="flex w-full flex-col rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-sm hover:border-[#1B6FA8]">
      <span className="font-semibold text-[#0C3450]">
        {h.shortName ?? h.name}
        {h.shortName && h.shortName !== h.name && <span className="font-normal text-gray-500"> · {h.name}</span>}
      </span>
      <span className="text-xs text-gray-500">
        {[h.city, h.person, h.status ? STATUS_LABEL[h.status] : null, h.lastRentalAt ? `ostatni wynajem ${d2(h.lastRentalAt)}` : "bez wynajmu", h.phone].filter(Boolean).join(" · ")}
      </span>
    </button>
  );
}

export function RentalClientField({
  value,
  onChange,
  candidates = [],
  disabled = false,
}: {
  value: PickedClient | null;
  onChange: (c: PickedClient | null) => void;
  candidates?: ClientCandidate[];
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(!value);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", email: "", city: "" });
  const [dups, setDups] = useState<ClientHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- krótkie zapytanie = bez wyników
      setHits(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void call<{ clients: ClientHit[] }>(`/api/clients/search?q=${encodeURIComponent(t)}`).then(({ ok, data }) => alive && setHits(ok ? (data.clients ?? []) : []));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  function pick(c: PickedClient) {
    onChange(c);
    setEditing(false);
    setQ("");
    setHits(null);
    setCreating(false);
    setDups(null);
  }

  async function create(force = false) {
    setBusy(true);
    setError(null);
    const { ok, status, data } = await call<{ id: string; duplicates?: ClientHit[] }>("/api/clients/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, force }),
    });
    setBusy(false);
    if (ok) return pick({ id: data.id, name: draft.name.trim(), shortName: null, city: draft.city.trim() || null });
    if (status === 409 && data.duplicates?.length) return setDups(data.duplicates);
    setError(data.message ?? "Nie udało się dodać klienta.");
  }

  if (value && !editing) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate">
          <b className="font-semibold text-[#0C3450]">{value.shortName ?? value.name}</b>
          {value.shortName && value.shortName !== value.name && <span className="text-gray-500"> · {value.name}</span>}
          {value.city && <span className="text-gray-500"> · {value.city}</span>}
        </span>
        {!disabled && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-[#1B6FA8] hover:underline">
            Zmień klienta
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[#E08A5C] bg-[#FFFBF8] p-3">
      {candidates.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-gray-600">Kandydaci</span>
          {candidates.map((c) => (
            <button
              key={c.clientId}
              type="button"
              disabled={disabled}
              onClick={() => pick({ id: c.clientId, name: c.name, shortName: c.shortName, city: c.city })}
              className="flex items-baseline gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-left text-sm hover:border-[#1B6FA8]"
            >
              <b className="font-semibold text-[#0C3450]">{c.shortName ?? c.name}</b>
              {c.city && <span className="text-xs text-gray-500">{c.city}</span>}
              <span className={`ml-auto text-xs ${c.reason.includes("sprawdź") || c.reason === "HubSpot" ? "text-[#B8612F]" : "text-[#2F7A68]"}`}>{c.reason}</span>
            </button>
          ))}
        </div>
      )}
      <input className={INPUT} value={q} disabled={disabled} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj klienta: nazwa, osoba, telefon, e-mail, NIP" aria-label="Szukaj klienta" />
      {hits && (
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {hits.length ? hits.map((h) => <HitRow key={h.id} h={h} onPick={() => pick(h)} />) : <p className="text-xs text-gray-500">Nie znaleziono — dodaj nowego klienta.</p>}
        </div>
      )}
      {!creating ? (
        <div className="flex items-center gap-3">
          <button type="button" disabled={disabled} onClick={() => setCreating(true)} className="self-start text-sm font-semibold text-[#1B6FA8] hover:underline">
            + Nowy klient
          </button>
          {value && (
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">
              Anuluj zmianę
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-3">
          <span className="text-xs font-semibold text-gray-600">Nowy klient (Potencjalny)</span>
          <input className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Imię i nazwisko albo nazwa gabinetu *" />
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={INPUT} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="Telefon" inputMode="tel" />
            <input className={INPUT} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="E-mail" inputMode="email" />
          </div>
          <input className={INPUT} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="Miejscowość (opcjonalnie)" />
          <span className="text-xs text-gray-500">Telefon albo e-mail — jedno z dwóch wymagane.</span>
          {dups && (
            <div className="flex flex-col gap-1 rounded-md bg-[#FBF0E7] p-2">
              <b className="text-sm text-[#B8612F]">Czy to ta klientka?</b>
              {dups.map((h) => (
                <HitRow key={h.id} h={h} onPick={() => pick(h)} />
              ))}
              <button type="button" disabled={busy} onClick={() => void create(true)} className="self-start text-xs font-semibold text-[#0C3450] hover:underline">
                Nie — utwórz nowego klienta
              </button>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !draft.name.trim() || (!draft.phone.trim() && !draft.email.trim())} onClick={() => void create(false)} className="rounded-md bg-[#1B6FA8] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
              Dodaj i wybierz
            </button>
            <button type="button" onClick={() => setCreating(false)} className="text-sm text-gray-600 hover:underline">
              Anuluj
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
