"use client";

import { useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import type { InvoiceHistoryPreview } from "@/lib/history/invoice-import";

// Import faktur z Fakturowni do historii klientów (CRM, prompt 3B) — podgląd
// (nic nie zapisuje) → import. Fakturownia jest wyłącznie czytana; dashboard
// faktur działa jak dotąd (czyta Fakturownię na żywo).

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Błąd serwera (HTTP ${res.status}).`);
  return data as T;
}

type ImportResult = { created: number; updated: number; rematched: number };

function fmtPln(n: number) {
  return `${new Intl.NumberFormat("pl-PL", { useGrouping: "always", maximumFractionDigits: 0 }).format(Math.round(n))} zł`;
}

function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "brand" | "green" | "warn" }) {
  const color = tone === "brand" ? "text-[#1B6FA8]" : tone === "green" ? "text-green-700" : tone === "warn" ? "text-amber-700" : "text-gray-900";
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

export function InvoiceHistoryImportPanel({ configured }: { configured: boolean }) {
  const [preview, setPreview] = useState<InvoiceHistoryPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    setBusy("preview");
    setError(null);
    setResult(null);
    try {
      setPreview(await post<InvoiceHistoryPreview>("/api/history/invoices/preview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    setBusy("import");
    setError(null);
    try {
      setResult(await post<ImportResult>("/api/history/invoices/import"));
      setPreview(null);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Błąd."} Import można bezpiecznie powtórzyć.`);
    } finally {
      setBusy(null);
    }
  }

  const p = preview;
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Faktury w historii klientów</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Kopiuje metadane faktur (numer, nabywca, NIP, kwoty, pozycje) do historii klientów i dopasowuje je — najpierw po
          NIP, potem po nazwie. Fakturownia jest tylko odczytywana. Nowe faktury dopisuje codzienny cron; import można
          bezpiecznie powtórzyć.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={!configured || busy !== null}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "preview" ? "Pobieranie z Fakturowni…" : preview ? "Odśwież podgląd" : "1. Pokaż podgląd"}
        </button>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={!preview || busy !== null}
          className="rounded-md bg-[#1B6FA8] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#14567F] disabled:opacity-40"
        >
          {busy === "import" ? "Importowanie…" : preview && preview.toImport === 0 ? "2. Odśwież dane faktur" : "2. Importuj faktury"}
        </button>
        {!configured && <span className="text-sm text-amber-700">Najpierw skonfiguruj Fakturownię wyżej.</span>}
        <Link href="/klienci/dopasowania" className="ml-auto text-sm font-medium text-[#1B6FA8] hover:underline">
          Dopasowania do klientów →
        </Link>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">
            Gotowe — dodano {result.created} faktur{result.updated > 0 && `, zaktualizowano ${result.updated}`}.
          </p>
          <p className="mt-1">
            Faktury bez pewnego dopasowania są w zakładce „Faktury” na stronie{" "}
            <Link href="/klienci/dopasowania" className="font-medium underline">
              Klienci → Dopasowania
            </Link>
            .
          </p>
        </div>
      )}

      {p && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="faktur w Fakturowni" value={p.total} />
            <Stat label="do importu" value={p.toImport} tone="brand" />
            <Stat label="z NIP nabywcy" value={p.withNip} />
            <Stat label="przypisze się samo" value={p.byState.AUTO + p.byState.CONFIRMED} tone="green" />
            <Stat label="do decyzji" value={p.byState.SUGGESTED + p.byState.UNMATCHED} tone="warn" />
            <Stat label="netto łącznie" value={fmtPln(p.totalNet)} />
          </div>
          <p className="text-xs text-gray-500">
            {Object.entries(p.perYear)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([y, v]) => `${y}: ${v.count} faktur (${fmtPln(v.net)})`)
              .join(" · ")}{" "}
            · {p.withRental} wystawionych z panelu dla wynajmów (nie liczą się drugi raz).
          </p>
          {p.unmatchedBuyers.length > 0 && (
            <details className="rounded-md border border-gray-200">
              <summary className="cursor-pointer px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">
                Nabywcy do ręcznego przypisania ({p.unmatchedBuyers.length})
              </summary>
              <ul className="space-y-1 px-3 pb-3 text-sm text-gray-700">
                {p.unmatchedBuyers.map((b) => (
                  <li key={b.buyerName}>
                    {b.buyerName} <span className="text-xs text-gray-400">({b.count})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
