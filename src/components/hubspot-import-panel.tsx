"use client";

import { useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import type { ImportBatchResult, ImportPreview } from "@/lib/clients/hubspot-import-run";

// Import klientów z HubSpota (CRM, etap 1B) — dwa kroki, żeby ADMIN widział
// skutki przed zapisem: podgląd (nic nie zapisuje) → import partiami z
// paskiem postępu. HubSpot jest wyłącznie czytany.

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Błąd serwera (HTTP ${res.status}).`);
  return data as T;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "brand" | "warn" }) {
  const color = tone === "brand" ? "text-[#1B6FA8]" : tone === "warn" && value > 0 ? "text-amber-700" : "text-gray-900";
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

// Rozwijana sekcja raportu — pusta pokazuje zielone „brak”, niepusta ma
// licznik i rozwija się do listy.
function ReportSection({ title, hint, items }: { title: string; hint?: string; items: React.ReactNode[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-sm last:border-0">
        <span className="text-gray-700">{title}</span>
        <span className="text-xs font-medium text-green-700">brak</span>
      </div>
    );
  }
  return (
    <details className="group border-b border-gray-100 last:border-0">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-gray-800">
          <span className="text-[10px] text-gray-400 transition-transform group-open:rotate-90">▸</span>
          {title}
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{items.length}</span>
      </summary>
      <div className="px-3 pb-3 pl-7">
        {hint && <p className="mb-2 text-xs text-gray-500">{hint}</p>}
        <ul className="max-h-64 space-y-1 overflow-y-auto text-sm text-gray-700">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function HubspotImportPanel({ configured }: { configured: boolean }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportBatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    setLoadingPreview(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await post<ImportPreview>("/api/clients/import/preview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleImport() {
    if (!preview) return;
    const ok = window.confirm(
      preview.contactsToCreate === 0
        ? "Wszyscy klienci są już w panelu. Uzupełnić brakujące drugie numery telefonu (komórki z HubSpota) i powiązania wynajmów?\n\nNic nie zostanie nadpisane."
        : `Zaimportować ${preview.clientsToCreate} nowych klientów i ${preview.contactsToCreate} osób kontaktowych?\n\n` +
            "HubSpot zostaje bez zmian. Istniejące wynajmy dostaną powiązanie z klientem — ich dane kontaktowe się nie zmieniają.",
    );
    if (!ok) return;
    setImporting(true);
    setError(null);
    setProgress(null);
    try {
      let total: number | null = null;
      let done = 0;
      for (;;) {
        const batch = await post<ImportBatchResult>("/api/clients/import/run");
        total ??= batch.processed + batch.remaining;
        done += batch.processed;
        setProgress({ done, total });
        if (batch.finished) {
          setResult(batch);
          break;
        }
        if (batch.processed === 0) throw new Error("Import stanął w miejscu — spróbuj ponownie za chwilę.");
      }
      setPreview(null);
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "Błąd."} To, co zdążyło się zapisać, zostaje — ponowne uruchomienie dokończy import bez duplikatów.`,
      );
    } finally {
      setImporting(false);
    }
  }

  const r = preview?.report;
  const nothingToImport = preview && preview.contactsToCreate === 0;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Import klientów z HubSpota</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Przenosi kontakty i firmy z HubSpota do bazy klientów panelu. HubSpot jest tylko odczytywany — nic w nim nie
          zmieniamy. Import można bezpiecznie powtórzyć: dokłada tylko brakujące rekordy.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={!configured || loadingPreview || importing}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {loadingPreview ? "Pobieranie z HubSpota…" : preview ? "Odśwież podgląd" : "1. Pokaż podgląd"}
        </button>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={!preview || importing}
          className="rounded-md bg-[#1B6FA8] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#14567F] disabled:opacity-40"
        >
          {importing ? "Importowanie…" : nothingToImport ? "2. Uzupełnij dane" : "2. Importuj"}
        </button>
        {!configured && <span className="text-sm text-amber-700">Najpierw ustaw token HubSpot wyżej.</span>}
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {progress && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>{importing ? "Zapisywanie klientów…" : "Zakończono"}</span>
            <span className="tabular-nums">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-[#1B6FA8] transition-[width] duration-300"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%` }}
            />
          </div>
        </div>
      )}

      {result?.rentals && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">Import zakończony.</p>
          <p className="mt-1">
            Podpięto {result.rentals.linked} wynajmów do klientów · odległość uzupełniona u {result.rentals.distancesSet}{" "}
            klientów.
          </p>
          {result.rentals.orphans.length > 0 && (
            <p className="mt-1 text-amber-800">
              {result.rentals.orphans.length} wynajmów ma kontakt HubSpot, którego nie ma już w HubSpocie — do ręcznego
              przypięcia (lista w podglądzie).
            </p>
          )}
        </div>
      )}

      {preview && r && (
        <div className="mt-5">
          {nothingToImport && (
            <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Wszystkie kontakty z HubSpota są już w panelu — nie ma nic do importu.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="kontakty w HubSpot" value={r.contactsFetched} />
            <Stat label="firmy w HubSpot" value={r.companiesFetched} />
            <Stat label="nowi klienci" value={preview.clientsToCreate} tone="brand" />
            <Stat label="nowe osoby kontaktowe" value={preview.contactsToCreate} tone="brand" />
            <Stat label="wynajmy do podpięcia" value={preview.rentals.willLink} tone="brand" />
            <Stat label="wynajmy bez odpowiednika" value={preview.rentals.orphans.length} tone="warn" />
          </div>

          <div className="mt-4 overflow-hidden rounded-md border border-gray-200">
            <ReportSection
              title="Klienci z kilkoma osobami"
              hint="Te osoby zostaną połączone w jednego klienta (wspólna firma w HubSpot albo ten sam NIP). Sprawdź, czy to na pewno ten sam gabinet."
              items={r.multiPersonClients.map((c) => (
                <span key={c.key}>
                  <b className="font-semibold">{c.name}</b>: {c.people.join(", ")}
                </span>
              ))}
            />
            <ReportSection
              title="Możliwe duplikaty (ta sama nazwa)"
              hint="Różne kontakty z tą samą nazwą gabinetu, ale bez wspólnej firmy i NIP — NIE łączymy ich automatycznie. Po imporcie można je scalić ręcznie."
              items={r.possibleDuplicateNames.map((d) => `${d.name} — ${d.count} klientów`)}
            />
            <ReportSection
              title="Ten sam NIP w różnych firmach"
              items={r.nipAcrossCompanies.map((n) => `${n.nip}: ${n.companies.join(", ")}`)}
            />
            <ReportSection
              title="Ten sam e-mail u kilku kontaktów"
              items={r.duplicateEmails.map((d) => `${d.email}: ${d.contacts.join(", ")}`)}
            />
            <ReportSection title="Kontakty bez e-maila i telefonu" items={r.noEmailNoPhone} />
            <ReportSection
              title="Nierozpoznane numery telefonu"
              hint="Zapiszą się jako zwykły tekst — do poprawienia na karcie klienta."
              items={r.unparsedPhones.map((p) => `${p.contact}: „${p.value}”`)}
            />
            <ReportSection title="Nieprawidłowe NIP" items={r.unparsedNips.map((p) => `${p.contact}: „${p.value}”`)} />
            <ReportSection
              title="Nierozpoznane ceny transportu"
              items={r.unparsedTransportPrices.map((p) => `${p.contact}: „${p.value}”`)}
            />
            <ReportSection
              title="Wynajmy z kontaktem, którego nie ma w HubSpot"
              hint="Zostaną bez klienta — przypniesz je ręcznie po uruchomieniu modułu Klienci."
              items={preview.rentals.orphans.map((o) => (
                <Link key={o.id} href={`/kalendarz/wynajem/${o.id}`} className="text-[#1B6FA8] hover:underline">
                  {fmtDate(o.startsAt)} · {o.title}
                  {o.contactName ? ` (${o.contactName})` : ""}
                </Link>
              ))}
            />
          </div>
        </div>
      )}
    </section>
  );
}
