"use client";

import { useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import type { CalendarHistoryPreview } from "@/lib/history/calendar-import";

// Import historii wynajmów z kalendarzy urządzeń (CRM, prompt 3A) — podgląd
// (nic nie zapisuje) → import. Historia trafia do osobnej tabeli: nie
// tworzy wynajmów, przypomnień SMS ani zadań kierowcy. Kalendarz Google jest
// wyłącznie czytany.

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Błąd serwera (HTTP ${res.status}).`);
  return data as T;
}

type ImportResult = { created: number; rematched: number; skippedInRental: number; errors: { deviceName: string; message: string }[] };

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "brand" | "green" | "warn" }) {
  const color =
    tone === "brand" ? "text-[#1B6FA8]" : tone === "green" ? "text-green-700" : tone === "warn" && value > 0 ? "text-amber-700" : "text-gray-900";
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

const METHOD_LABEL: Record<string, string> = { PHONE: "telefon", EMAIL: "e-mail", NIP: "NIP", NAME_AUTO: "nazwa", MANUAL: "alias" };

export function CalendarHistoryImportPanel() {
  const [preview, setPreview] = useState<CalendarHistoryPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    setBusy("preview");
    setError(null);
    setResult(null);
    try {
      setPreview(await post<CalendarHistoryPreview>("/api/history/calendar/preview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    if (!preview) return;
    const ok = window.confirm(
      `Zaimportować ${preview.toImport} historycznych wydarzeń?\n\n` +
        "Trafią wyłącznie do historii klientów — nie powstaną z nich wynajmy, SMS-y ani zadania kierowców. Kalendarze zostają bez zmian.",
    );
    if (!ok) return;
    setBusy("import");
    setError(null);
    try {
      setResult(await post<ImportResult>("/api/history/calendar/import"));
      setPreview(null);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Błąd."} Import można bezpiecznie powtórzyć — dołoży tylko brakujące wydarzenia.`);
    } finally {
      setBusy(null);
    }
  }

  const p = preview;
  const matched = p ? p.byState.AUTO + p.byState.CONFIRMED : 0;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Historia wynajmów z kalendarzy</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Panel synchronizuje kalendarze urządzeń tylko 30 dni wstecz. Ten import dociąga starsze wydarzenia do historii
          klientów (status, „klient od”, liczba wynajmów). Nie tworzy wynajmów, SMS-ów ani zadań — to tylko historia.
          Można go bezpiecznie powtórzyć.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={busy !== null}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "preview" ? "Czytanie kalendarzy…" : preview ? "Odśwież podgląd" : "1. Pokaż podgląd"}
        </button>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={!preview || preview.toImport === 0 || busy !== null}
          className="rounded-md bg-[#1B6FA8] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#14567F] disabled:opacity-40"
        >
          {busy === "import" ? "Importowanie…" : "2. Importuj historię"}
        </button>
        <Link href="/klienci/dopasowania" className="ml-auto text-sm font-medium text-[#1B6FA8] hover:underline">
          Dopasowania do klientów →
        </Link>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">Import zakończony — dodano {result.created} wydarzeń do historii.</p>
          <p className="mt-1">
            Teraz przejrzyj propozycje na stronie{" "}
            <Link href="/klienci/dopasowania" className="font-medium underline">
              Klienci → Dopasowania
            </Link>
            .
          </p>
          {result.errors.length > 0 && (
            <p className="mt-1 text-amber-800">
              Nie udało się odczytać: {result.errors.map((e) => `${e.deviceName} (${e.message})`).join("; ")}
            </p>
          )}
        </div>
      )}

      {p && (
        <div className="mt-5 space-y-4">
          {p.toImport === 0 && (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Cała historia jest już zaimportowana.</p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="wydarzeń historycznych" value={p.total} />
            <Stat label="do importu" value={p.toImport} tone="brand" />
            <Stat label="przypisze się samo" value={matched} tone="green" />
            <Stat label="propozycje do potwierdzenia" value={p.byState.SUGGESTED} tone="warn" />
            <Stat label="bez dopasowania" value={p.byState.UNMATCHED} tone="warn" />
            <Stat label="pominięte (serwis, FV…)" value={p.byState.IGNORED} />
          </div>
          <p className="text-xs text-gray-500">
            {p.byKind.WYNAJEM} wynajmów · {p.byKind.SZKOLENIE} szkoleń · {p.groups} różnych tytułów do przejrzenia (jedna
            decyzja przypisuje wszystkie wydarzenia o tym samym tytule) · {p.skippedInRental} wydarzeń już jest w panelu jako
            wynajmy.
          </p>

          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Urządzenie</th>
                  {p.years.map((y) => (
                    <th key={y} className="px-3 py-2 text-right font-medium">
                      {y}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Razem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {p.byDevice.map((d) => (
                  <tr key={d.deviceName}>
                    <td className="px-3 py-1.5 text-gray-800">{d.deviceName}</td>
                    {p.years.map((y) => (
                      <td key={y} className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                        {d.perYear[y] ?? "–"}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-900">{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {p.sampleAuto.length > 0 && (
            <details className="rounded-md border border-gray-200">
              <summary className="cursor-pointer px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">
                Przykłady automatycznych dopasowań ({p.sampleAuto.length})
              </summary>
              <ul className="space-y-1 px-3 pb-3 text-sm text-gray-700">
                {p.sampleAuto.map((s, i) => (
                  <li key={i}>
                    „{s.title}” → <b className="font-semibold">{s.clientName}</b>
                    {s.method && <span className="text-xs text-gray-400"> ({METHOD_LABEL[s.method] ?? s.method})</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {p.errors.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Nie udało się odczytać: {p.errors.map((e) => `${e.deviceName} (${e.message})`).join("; ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
