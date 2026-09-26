"use client";

import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import type { ApiTokenDto } from "@/lib/agent-api/tokens-admin";

// Tokeny API agenta (Ustawienia → Użytkownicy, konto z rolą Agent AI):
// tworzenie (token pokazany raz), unieważnianie, ostatnie wywołania.

type Call = { id: string; at: string; method: string; path: string; status: number; durationMs: number | null; token: string };

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T & { message?: string } }> {
  const res = await fetch(`${BASE_PATH}${url}`, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined, cache: "no-store" });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

const fmt = (iso: string) => new Date(iso).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });

export function AgentTokensPanel({ userId }: { userId: string }) {
  const [tokens, setTokens] = useState<ApiTokenDto[] | null>(null);
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCalls, setShowCalls] = useState(false);

  useEffect(() => {
    let alive = true;
    void call<{ tokens: ApiTokenDto[] }>(`/api/users/${userId}/tokens`).then(({ ok, data }) => alive && (ok ? setTokens(data.tokens) : setError(data.message ?? "Błąd.")));
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!showCalls) return;
    let alive = true;
    void call<{ calls: Call[] }>(`/api/users/${userId}/api-calls`).then(({ ok, data }) => alive && ok && setCalls(data.calls));
    return () => {
      alive = false;
    };
  }, [showCalls, userId]);

  async function create() {
    setBusy(true);
    setError(null);
    const { ok, data } = await call<{ token: string; tokens: ApiTokenDto[] }>(`/api/users/${userId}/tokens`, { method: "POST", body: JSON.stringify({ name }) });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się utworzyć tokenu.");
    setFresh(data.token);
    setTokens(data.tokens);
    setName("");
  }

  async function revoke(t: ApiTokenDto) {
    if (!window.confirm(`Unieważnić token „${t.name}”? Agent straci dostęp przez ten token od razu.`)) return;
    const { ok, data } = await call<{ tokens: ApiTokenDto[] }>(`/api/users/${userId}/tokens/${t.id}`, { method: "DELETE" });
    if (!ok) return setError(data.message ?? "Nie udało się.");
    setTokens(data.tokens);
  }

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-4">
      <p className="text-sm font-semibold text-gray-900">Tokeny API agenta</p>
      <p className="mt-0.5 text-xs text-gray-500">
        Agent wywołuje <code>/api/agent/…</code> z nagłówkiem <code>Authorization: Bearer …</code>. Limit 120 zapytań na minutę. Opis: docs/agent-api.md.
      </p>

      {fresh && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-800">Skopiuj token teraz — nie pokażę go ponownie.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-xs">{fresh}</code>
            <button type="button" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium" onClick={() => void navigator.clipboard?.writeText(fresh)}>
              Kopiuj
            </button>
            <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setFresh(null)}>
              Gotowe
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <ul className="mt-3 divide-y divide-gray-200 text-sm">
        {tokens?.length === 0 && <li className="py-2 text-gray-400">Brak tokenów.</li>}
        {tokens?.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className={`font-medium ${t.revokedAt ? "text-gray-400 line-through" : "text-gray-900"}`}>{t.name}</span>
            <code className="text-xs text-gray-500">{t.prefix}…</code>
            <span className="text-xs text-gray-500">
              utworzono {fmt(t.createdAt)} · {t.lastUsedAt ? `ostatnio ${fmt(t.lastUsedAt)}` : "nieużywany"} · 24 h: {t.calls24h}
            </span>
            {t.revokedAt ? (
              <span className="ml-auto text-xs text-gray-400">unieważniony {fmt(t.revokedAt)}</span>
            ) : (
              <button type="button" onClick={() => void revoke(t)} className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                Unieważnij
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nazwa tokenu, np. Claude — porządki"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1B6FA8] focus:outline-none"
        />
        <button type="button" disabled={busy} onClick={() => void create()} className="rounded-md bg-[#1B6FA8] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#14567F] disabled:opacity-50">
          Utwórz token
        </button>
        <button type="button" onClick={() => setShowCalls((v) => !v)} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          {showCalls ? "Ukryj wywołania" : "Ostatnie wywołania"}
        </button>
      </div>

      {showCalls && (
        <div className="mt-3 max-h-72 overflow-auto rounded-md border border-gray-200 bg-white">
          {calls === null ? (
            <p className="p-3 text-xs text-gray-400">Wczytywanie…</p>
          ) : calls.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">Brak wywołań.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-gray-100">
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-2 py-1 text-gray-500">{fmt(c.at)}</td>
                    <td className="px-2 py-1 font-mono">{c.method}</td>
                    <td className="break-all px-2 py-1 font-mono">{c.path}</td>
                    <td className={`px-2 py-1 font-semibold ${c.status >= 400 ? "text-red-600" : "text-green-700"}`}>{c.status}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-gray-400">{c.durationMs != null ? `${c.durationMs} ms` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
