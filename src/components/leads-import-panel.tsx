"use client";

import { useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import type { DealsImportPreview, DealsSyncResult } from "@/lib/leads/hubspot-sync";
import { STAGE_LABEL, TYPE_LABEL } from "@/lib/leads/labels";
import type { LeadStageKey, LeadTypeKey } from "@/lib/leads/parse-deal";

// Import transakcji HubSpot → Sygnały (CRM, prompt 2A) — podgląd (nic nie
// zapisuje) → import partiami. HubSpot jest wyłącznie czytany. Po imporcie
// nowe sygnały dochodzą same (cron co 5 min / „Pobierz” na /sygnaly).

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Błąd serwera (HTTP ${res.status}).`);
  return data as T;
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

const LINK_LABEL: Record<string, string> = {
  contact: "powiązany kontakt HubSpot",
  email: "e-mail z nazwy transakcji",
  phone: "telefon",
  newClient: "nowy klient (utworzony automatycznie)",
  none: "bez klienta (brak e-maila i telefonu)",
};

export function LeadsImportPanel({ configured }: { configured: boolean }) {
  const [preview, setPreview] = useState<DealsImportPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState<{ created: number; notesError: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    setBusy("preview");
    setError(null);
    setDone(null);
    try {
      setPreview(await post<DealsImportPreview>("/api/leads/import/preview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    if (!preview) return;
    const ok = window.confirm(
      `Zaimportować ${preview.toImport} transakcji jako sygnały?\n\nHubSpot zostaje bez zmian. Dla e-maili i telefonów spoza bazy powstaną nowi klienci.`,
    );
    if (!ok) return;
    setBusy("import");
    setError(null);
    let created = 0;
    let notesError: string | null = null;
    try {
      for (let i = 0; i < 40; i++) {
        const r = await post<DealsSyncResult>("/api/leads/import/run");
        created += r.created;
        notesError ??= r.notesError;
        setProgress({ done: created, total: created + r.remaining });
        if (r.remaining === 0) break;
        if (r.created === 0) throw new Error("Import stanął w miejscu — spróbuj ponownie za chwilę.");
      }
      setDone({ created, notesError });
      setPreview(null);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Błąd."} To, co zdążyło się zapisać, zostaje — ponowne uruchomienie dokończy import bez duplikatów.`);
    } finally {
      setBusy(null);
    }
  }

  const p = preview;
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Import sygnałów (transakcje)</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Przenosi transakcje z lejka „Proces sprzedaży” do modułu Sygnały: od 01.09.2025 wszystkie, starsze tylko te poza
          etapem „Sygnał” (reszta to archiwum). Razem z notatkami. HubSpot jest tylko odczytywany. Po imporcie etapy prowadzi
          się w panelu, a nowe zgłoszenia dochodzą automatycznie.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handlePreview()}
          disabled={!configured || busy !== null}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "preview" ? "Pobieranie z HubSpota…" : preview ? "Odśwież podgląd" : "1. Pokaż podgląd"}
        </button>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={!preview || preview.toImport === 0 || busy !== null}
          className="rounded-md bg-[#1B6FA8] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#14567F] disabled:opacity-40"
        >
          {busy === "import" ? "Importowanie…" : "2. Importuj sygnały"}
        </button>
        {!configured && <span className="text-sm text-amber-700">Najpierw ustaw token HubSpot wyżej.</span>}
        <Link href="/sygnaly" className="ml-auto text-sm font-medium text-[#1B6FA8] hover:underline">
          Otwórz Sygnały →
        </Link>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {progress && busy === "import" && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>Zapisywanie sygnałów…</span>
            <span className="tabular-nums">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-[#1B6FA8] transition-[width] duration-300" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%` }} />
          </div>
        </div>
      )}

      {done && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-semibold">Import zakończony — dodano {done.created} sygnałów.</p>
          {done.notesError && (
            <p className="mt-1 text-amber-800">
              Notatek z HubSpota nie udało się pobrać ({done.notesError}). Sygnały działają; historia notatek dojdzie po nadaniu
              aplikacji HubSpot uprawnienia do odczytu notatek.
            </p>
          )}
        </div>
      )}

      {p && (
        <div className="mt-5 space-y-4">
          {p.missingStages.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              W HubSpocie brakuje etapów z mapowania: {p.missingStages.join(", ")}. Transakcje z nieznanym etapem trafią do
              „Sygnału”.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="transakcji w HubSpot" value={p.dealsTotal} />
            <Stat label="do importu" value={p.toImport} tone="brand" />
            <Stat label="już w panelu" value={p.alreadyImported} />
            <Stat label="pominięte (archiwum, inne lejki)" value={p.skipped} />
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="mb-1 font-semibold text-gray-800">Typ</p>
              {Object.entries(p.byType).map(([k, v]) => (
                <p key={k} className="flex justify-between text-gray-600">
                  <span>{TYPE_LABEL[k as LeadTypeKey]}</span>
                  <span className="tabular-nums">{v}</span>
                </p>
              ))}
            </div>
            <div>
              <p className="mb-1 font-semibold text-gray-800">Etap</p>
              {Object.entries(p.byStage).map(([k, v]) => (
                <p key={k} className="flex justify-between text-gray-600">
                  <span>{STAGE_LABEL[k as LeadStageKey]}</span>
                  <span className="tabular-nums">{v}</span>
                </p>
              ))}
            </div>
            <div>
              <p className="mb-1 font-semibold text-gray-800">Powiązanie z klientem</p>
              {Object.entries(p.link).map(([k, v]) => (
                <p key={k} className="flex justify-between gap-2 text-gray-600">
                  <span>{LINK_LABEL[k]}</span>
                  <span className="tabular-nums">{v}</span>
                </p>
              ))}
            </div>
          </div>
          {p.sample.length > 0 && (
            <details className="rounded-md border border-gray-200">
              <summary className="cursor-pointer px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">Najnowsze do importu ({p.sample.length})</summary>
              <ul className="space-y-1 px-3 pb-3 text-sm text-gray-700">
                {p.sample.map((s, i) => (
                  <li key={i}>
                    {new Date(s.createdAt).toLocaleDateString("pl-PL")} · <b className="font-semibold">{s.title}</b>{" "}
                    <span className="text-xs text-gray-400">
                      ({TYPE_LABEL[s.type]}, {STAGE_LABEL[s.stage]}
                      {s.phone ? ", z telefonem" : ""})
                    </span>
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
