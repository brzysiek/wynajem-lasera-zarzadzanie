"use client";

import { useState } from "react";
import { api } from "@/components/clients/client-forms";
import type { SuggestionDto } from "@/lib/leads/lead-suggestion";
import { plural } from "./plan-day";

// „Sugestia Klaudiusza” (wniosek 47, część 2): 1–2 zdania „Sugeruję…” zapisane
// przez agenta w zaplanowanym przebiegu — panel niczego nie generuje. Godzina
// sugestii; gdy od tego czasu doszły wpisy osi czasu, tekst jest przygaszony z
// licznikiem. „Poproś o aktualizację” (ADMIN/STAFF) oznacza sygnał dla
// następnego przebiegu. Sugestia tylko podpowiada — nic nie zmienia ani nie wysyła.

const fmt = (iso: string) => new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// „dziś 07:31” / „wczoraj 15:02” / „08.10, 15:02” — kiedy agent ostatnio coś zapisał.
function lastRun(iso: string, now: Date): string {
  const at = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  const hm = at.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  return diff === 0 ? `dziś ${hm}` : diff === 1 ? `wczoraj ${hm}` : fmt(iso);
}

export function LeadSuggestionBlock({ leadId, suggestion, canRequest, onUpdated }: { leadId: string; suggestion: SuggestionDto | null; canRequest: boolean; onUpdated: (s: SuggestionDto) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!suggestion) return null;

  async function request() {
    setBusy(true);
    setError(null);
    const { ok, data } = await api<{ suggestion: SuggestionDto }>(`/api/leads/${leadId}/suggestion`, "POST", {});
    setBusy(false);
    if (!ok) return setError((data as { message?: string }).message ?? "Nie udało się zapisać prośby.");
    onUpdated(data.suggestion);
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[var(--c-border)] bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#1B6FA8]">Sugestia Klaudiusza</span>
        <span className="ml-auto text-[11px] text-[var(--c-muted)]">
          {fmt(suggestion.generatedAt)}
          {canRequest && !suggestion.requestPending && (
            <>
              {" · "}
              <button type="button" disabled={busy} onClick={() => void request()} className="font-semibold text-[var(--c-brand)] hover:underline disabled:opacity-50">
                Poproś o aktualizację
              </button>
            </>
          )}
        </span>
      </div>
      <p className={`m-0 whitespace-pre-line text-[13.5px] leading-snug text-[#0C3450] [overflow-wrap:anywhere] ${suggestion.stale ? "opacity-55" : ""}`}>{suggestion.text}</p>
      {suggestion.stale && (
        <p className="m-0 text-[12px] text-[#B8612F]">
          od tego czasu {suggestion.newEntries} {plural(suggestion.newEntries, "nowy wpis", "nowe wpisy", "nowych wpisów")}
        </p>
      )}
      {suggestion.requestPending && <p className="m-0 text-[12px] font-semibold text-[#2F7A68]">Klaudiusz zaktualizuje w następnym przebiegu.</p>}
      {error && <p className="m-0 text-[12px] text-[var(--c-red)]">{error}</p>}
      {suggestion.lastRunAt && <p className="m-0 text-[11px] text-[var(--c-faint)]">Ostatni przebieg Klaudiusza: {lastRun(suggestion.lastRunAt, new Date())}</p>}
    </div>
  );
}
