"use client";

import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import type { GmailStatus, GmailSyncResult } from "@/lib/gmail/sync";

// Historia e-maili z Gmaila (CRM, prompt 3C) — ustawienia ADMINA: test
// zakresu, wyłącznik, podłączone skrzynki (świadoma zgoda), import historii
// z paskiem postępu. W bazie tylko metadane i skrót — treść maila panel
// pobiera z Gmaila dopiero przy otwarciu wiadomości.

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_PATH}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || `Błąd serwera (HTTP ${res.status}).`);
  return data as T;
}

function ago(iso: string | null) {
  if (!iso) return "jeszcze nie";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  return new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function GmailSyncPanel() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newBox, setNewBox] = useState("");
  const [consent, setConsent] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void call<GmailStatus>("/api/gmail/status").then(setStatus, (e) => setError(e.message));
  }, []);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setImporting(true);
    setError(null);
    try {
      for (let i = 0; i < 60; i++) {
        const r = await call<{ results: GmailSyncResult | null }>("/api/gmail/sync", "POST");
        setStatus(await call<GmailStatus>("/api/gmail/status"));
        const failed = r.results?.find((x) => x.error);
        if (failed) throw new Error(`${failed.mailbox}: ${failed.error}`);
        if (!r.results || r.results.every((x) => x.pendingAddresses === 0)) break;
      }
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Błąd."} Import można wznowić — dokończy od miejsca przerwania.`);
    } finally {
      setImporting(false);
    }
  }

  const s = status;
  const total = s?.totalAddresses ?? 0;
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Historia e-maili (Gmail)</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          E-maile do i od osób kontaktowych klientów pojawiają się na osi czasu klienta — wstecz (import) i na bieżąco (co 5 min).
          Reszta skrzynki nie trafia do panelu. W bazie zapisujemy tylko temat, skrót i datę; pełną treść panel pobiera z Gmaila
          przy otwarciu wiadomości. Wymaga zakresu <code className="rounded bg-gray-100 px-1 text-xs">gmail.readonly</code> w Google Admin.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void act("test", async () => setTest(await call("/api/gmail/test", "POST")))}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === "test" ? "Sprawdzanie…" : "Sprawdź dostęp"}
        </button>
        {s && (
          <label className="ml-2 flex cursor-pointer items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#1B6FA8]"
              checked={s.enabled}
              disabled={busy !== null}
              onChange={(e) => void act("toggle", async () => setStatus(await call("/api/gmail/settings", "POST", { enabled: e.target.checked })))}
            />
            Synchronizacja włączona <span className="text-xs text-gray-500">(cron co 5 minut)</span>
          </label>
        )}
      </div>
      {test && (
        <p className={`mt-3 rounded-md px-3 py-2 text-sm ${test.ok ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{test.message}</p>
      )}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {s && (
        <div className="mt-5 space-y-3">
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Skrzynka</th>
                  <th className="px-3 py-2 font-medium">Import historii</th>
                  <th className="px-3 py-2 text-right font-medium">E-maili z klientami</th>
                  <th className="px-3 py-2 font-medium">Ostatnia synchronizacja</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s.mailboxes.map((m) => {
                  const pct = total ? Math.round((m.importedAddresses / total) * 100) : 100;
                  return (
                    <tr key={m.mailbox}>
                      <td className="px-3 py-2 font-medium text-gray-900">{m.mailbox}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-[#1B6FA8] transition-[width]" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 tabular-nums">
                            {m.importedAddresses}/{total} adresów
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.stored}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {ago(m.lastSyncAt)}
                        {m.lastError && <span className="block text-red-600">{m.lastError}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.mailboxes.length > 1 && (
                          <button
                            type="button"
                            className="text-xs text-gray-500 hover:text-red-600"
                            disabled={busy !== null}
                            onClick={() =>
                              window.confirm(`Odłączyć ${m.mailbox}? Zapisane z niej e-maile znikną z kart klientów.`) &&
                              void act("remove", async () => setStatus(await call("/api/gmail/settings", "POST", { removeMailbox: m.mailbox })))
                            }
                          >
                            Odłącz
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={importing || busy !== null}
              onClick={() => void runImport()}
              className="rounded-md bg-[#1B6FA8] px-3 py-2 text-sm font-medium text-white hover:bg-[#14567F] disabled:opacity-40"
            >
              {importing ? "Importowanie historii…" : "Importuj historię teraz"}
            </button>
            <span className="text-xs text-gray-500">
              Import idzie partiami; można go przerwać i wznowić. Po włączeniu synchronizacji cron dokończy go sam.
            </span>
          </div>

          <details className="rounded-md border border-gray-200">
            <summary className="cursor-pointer px-3 py-2 text-sm text-gray-800 hover:bg-gray-50">Podłącz kolejną skrzynkę z domeny {s.domain}</summary>
            <div className="space-y-2 px-3 pb-3">
              <input
                type="email"
                value={newBox}
                onChange={(e) => setNewBox(e.target.value)}
                placeholder={`np. ania@${s.domain ?? "firma.pl"}`}
                className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1B6FA8]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  Rozumiem, że biuro (ADMIN i STAFF) zobaczy w panelu korespondencję tej skrzynki z klientami — tematy, skróty i po
                  otwarciu pełną treść. Właściciel skrzynki o tym wie.
                </span>
              </label>
              <button
                type="button"
                disabled={!newBox || !consent || busy !== null}
                onClick={() =>
                  void act("add", async () => {
                    setStatus(await call("/api/gmail/settings", "POST", { addMailbox: newBox, consent }));
                    setNewBox("");
                    setConsent(false);
                  })
                }
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                {busy === "add" ? "Sprawdzanie skrzynki…" : "Podłącz skrzynkę"}
              </button>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
