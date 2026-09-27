"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import type { ExcelImportReport } from "@/lib/invoicing/excel-import";

// Faktury sprzed Fakturowni (do 13/03/2026) — pisane w szablonie Excela,
// leżą w folderze faktur wynajmu na Dysku (wniosek 9). Biuro pobiera folder
// jako ZIP (albo zaznacza pliki .xls), panel najpierw pokazuje, co odczytał
// (nic nie zapisuje), potem importuje. Ponowny import niczego nie dubluje.

type Result = ExcelImportReport & { dryRun: boolean };

function fmtPln(n: number) {
  return `${new Intl.NumberFormat("pl-PL", { useGrouping: "always", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} zł`;
}

const STATE_LABEL: Record<string, string> = { AUTO: "przypisze się samo", CONFIRMED: "przypisze się samo", SUGGESTED: "propozycja — do potwierdzenia", UNMATCHED: "do przypisania", IGNORED: "pominięta" };

function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "brand" | "green" | "warn" }) {
  const color = tone === "brand" ? "text-[#1B6FA8]" : tone === "green" ? "text-green-700" : tone === "warn" ? "text-amber-700" : "text-gray-900";
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

export function ExcelInvoiceImportPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(mode: "preview" | "import") {
    setBusy(mode);
    setError(null);
    const form = new FormData();
    form.set("mode", mode);
    for (const f of files) form.append("files", f);
    try {
      const res = await fetch(`${BASE_PATH}/api/history/invoices/excel`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || `Błąd serwera (HTTP ${res.status}).`);
      setResult(data as Result);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Błąd."} Import można bezpiecznie powtórzyć.`);
    } finally {
      setBusy(null);
    }
  }

  const r = result;
  const matched = r ? r.invoices.filter((i) => i.state === "AUTO" || i.state === "CONFIRMED").length : 0;
  const net = r ? r.invoices.reduce((s, i) => s + i.totalNet, 0) : 0;
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Faktury sprzed Fakturowni (Excel)</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Faktury wynajmu do 13/03/2026 pisane w szablonie Excela. Pobierz folder faktur wynajmu z Dysku (prawy przycisk → Pobierz — powstanie ZIP) albo
          zaznacz pliki .xls / .xlsx. PDF-y i faktury Inżynierii („FV IN_…”) są pomijane. Najpierw podgląd — nic nie zapisuje; ponowny import niczego nie
          dubluje.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          multiple
          accept=".zip,.xls,.xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
            setResult(null);
            setError(null);
          }}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy !== null}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {files.length ? `Wybrano ${files.length} ${files.length === 1 ? "plik" : "plików"} — zmień` : "Wybierz ZIP albo pliki Excela"}
        </button>
        <button
          type="button"
          onClick={() => void send("preview")}
          disabled={!files.length || busy !== null}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "preview" ? "Czytanie plików…" : "1. Pokaż podgląd"}
        </button>
        <button
          type="button"
          onClick={() => void send("import")}
          disabled={!r || !r.dryRun || r.invoices.length === 0 || busy !== null}
          className="rounded-md bg-[#1B6FA8] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#14567F] disabled:opacity-40"
        >
          {busy === "import" ? "Importowanie…" : "2. Importuj faktury"}
        </button>
        <Link href="/klienci/dopasowania" className="ml-auto text-sm font-medium text-[#1B6FA8] hover:underline">
          Dopasowania do klientów →
        </Link>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {r && !r.dryRun && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">
            Gotowe — dodano {r.created} faktur{r.updated > 0 && `, zaktualizowano ${r.updated}`}
            {r.unchanged > 0 && `, bez zmian ${r.unchanged}`}.
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

      {r && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="plików Excela" value={r.files} />
            <Stat label={r.dryRun ? "nowych do importu" : "dodano"} value={r.created} tone="brand" />
            <Stat label="już w panelu" value={r.updated + r.unchanged} />
            <Stat label="przypisze się samo" value={matched} tone="green" />
            <Stat label="do decyzji" value={r.invoices.length - matched} tone="warn" />
            <Stat label="netto łącznie" value={fmtPln(net)} />
          </div>
          {(r.errors.length > 0 || r.skipped.length > 0 || r.otherFiles > 0) && (
            <p className="text-xs text-gray-500">
              {r.otherFiles > 0 && `Pominięto ${r.otherFiles} plików innych niż Excel (PDF itp.). `}
              {r.skipped.length > 0 && `Pominięto ${r.skipped.length}: ${r.skipped.slice(0, 4).map((s) => `${s.file} (${s.reason})`).join("; ")}${r.skipped.length > 4 ? "…" : ""}. `}
            </p>
          )}
          {r.errors.length > 0 && (
            <details open className="rounded-md border border-amber-200 bg-amber-50">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-amber-800">Nie udało się odczytać ({r.errors.length})</summary>
              <ul className="space-y-1 px-3 pb-3 text-sm text-amber-900">
                {r.errors.map((e) => (
                  <li key={e.file}>
                    {e.file} — {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {r.invoices.length > 0 && (
            <details className="rounded-md border border-gray-200">
              <summary className="cursor-pointer px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">Odczytane faktury ({r.invoices.length})</summary>
              <div className="max-h-96 overflow-auto px-3 pb-3">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Numer</th>
                      <th className="py-1 pr-3 font-medium">Wystawiona</th>
                      <th className="py-1 pr-3 font-medium">Nabywca</th>
                      <th className="py-1 pr-3 text-right font-medium">Netto</th>
                      <th className="py-1 font-medium">Klient w panelu</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-700">
                    {r.invoices.map((i) => (
                      <tr key={i.number} className="border-t border-gray-100">
                        <td className="py-1 pr-3 tabular-nums">{i.number}</td>
                        <td className="py-1 pr-3 tabular-nums">{i.issueDate.split("-").reverse().join(".")}</td>
                        <td className="py-1 pr-3">{i.buyerName}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{fmtPln(i.totalNet)}</td>
                        <td className="py-1">{i.client ?? <span className="text-amber-700">{STATE_LABEL[i.state] ?? i.state}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
