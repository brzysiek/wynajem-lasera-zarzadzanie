"use client";

import { useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import type { QualificationPreview } from "@/lib/clients/qualification-backfill";

// Porządkowanie bazy (prompt 2 v2, 1.0): klienci = gabinety, z którymi był
// kontakt; reszta to „kontakty z zapytań” (poza listą /klienci). Podgląd →
// świadome włączenie przez ADMINA. Nic w HubSpocie się nie zmienia.

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Błąd serwera (HTTP ${res.status}).`);
  return data as T;
}

export function ClientsQualificationPanel({ configured }: { configured: boolean }) {
  const [p, setP] = useState<QualificationPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function preview() {
    setBusy("preview");
    setError(null);
    try {
      setP(await post<QualificationPreview>("/api/clients/qualification/preview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!p || !window.confirm(`Włączyć podział? Na liście klientów zostanie ${p.qualified}, a ${p.unqualified} przejdzie do „Kontakty z zapytań”. Nic nie zostanie usunięte.`)) return;
    setBusy("apply");
    setError(null);
    try {
      const r = await post<{ flagged: number }>("/api/clients/qualification/apply");
      setDone(r.flagged);
      setP(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Klienci i kontakty z zapytań</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Sygnał to zapytanie, klient to gabinet, z którym faktycznie był kontakt (rozmowa, odpowiedź mailem, wynajem, faktura).
          Pozostali trafiają do „Kontakty z zapytań” — nie znikają, tylko nie zaśmiecają listy klientów. Zrób to po imporcie
          klientów i sygnałów oraz po imporcie historii e-maili.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void preview()}
          disabled={!configured || busy !== null}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "preview" ? "Liczenie…" : p ? "Odśwież podgląd" : "1. Pokaż podgląd"}
        </button>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={!p || busy !== null}
          className="rounded-md bg-[#1B6FA8] px-3 py-2 text-sm font-medium text-white hover:bg-[#14567F] disabled:opacity-40"
        >
          {busy === "apply" ? "Zapisywanie…" : p?.active ? "2. Zapisz ponownie" : "2. Włącz podział"}
        </button>
        <Link href="/klienci" className="ml-auto text-sm font-medium text-[#1B6FA8] hover:underline">
          Lista klientów →
        </Link>
      </div>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {done != null && (
        <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Podział włączony — oznaczono {done} klientów. Lista /klienci pokazuje teraz tylko zakwalifikowanych; resztę znajdziesz pod „Kontakty z
          zapytań”.
        </p>
      )}
      {p && (
        <div className="mt-5 space-y-4 text-sm">
          {p.active && <p className="rounded-md bg-blue-50 px-3 py-2 text-blue-800">Podział jest już włączony — podgląd pokazuje stan po ponownym przeliczeniu.</p>}
          {(!p.callsReadable || !p.notesReadable) && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
              Nie udało się odczytać {[!p.notesReadable && "notatek", !p.callsReadable && "rozmów"].filter(Boolean).join(" ani ")} z HubSpota — aplikacja
              HubSpot nie ma do nich uprawnienia. Kwalifikacja opiera się na pozostałych źródłach.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-xl font-semibold tabular-nums text-green-700">{p.qualified}</p>
              <p className="text-xs text-gray-500">klientów (lista /klienci)</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-xl font-semibold tabular-nums text-gray-900">{p.unqualified}</p>
              <p className="text-xs text-gray-500">kontaktów z zapytań</p>
            </div>
          </div>
          <div>
            <p className="mb-1 font-semibold text-gray-800">Dlaczego klient</p>
            {p.byReason.map((r) => (
              <p key={r.reason} className="flex max-w-md justify-between text-gray-600">
                <span>{r.reason}</span>
                <span className="tabular-nums">{r.count}</span>
              </p>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <details className="rounded-md border border-gray-200" open>
              <summary className="cursor-pointer px-3 py-2 text-gray-800">Przykłady — klienci (20)</summary>
              <ul className="space-y-0.5 px-3 pb-3 text-gray-700">
                {p.qualifiedExamples.map((e, i) => (
                  <li key={i}>
                    {e.name}
                    {e.city && <span className="text-gray-400"> · {e.city}</span>} <span className="text-xs text-gray-400">({e.reason})</span>
                  </li>
                ))}
              </ul>
            </details>
            <details className="rounded-md border border-gray-200" open>
              <summary className="cursor-pointer px-3 py-2 text-gray-800">Przykłady — kontakty z zapytań (20)</summary>
              <ul className="space-y-0.5 px-3 pb-3 text-gray-700">
                {p.unqualifiedExamples.map((e, i) => (
                  <li key={i}>
                    {e.name}
                    {e.city && <span className="text-gray-400"> · {e.city}</span>}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      )}
    </section>
  );
}
