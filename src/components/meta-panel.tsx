"use client";

import { useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import type { SubscriptionInfo } from "@/lib/chat/meta-graph";

type Result = { ok: boolean; message?: string; info?: SubscriptionInfo };

// Ustawienia → Integracje → Meta (wniosek 42): sprawdzenie i odnowienie subskrypcji strony.
export function MetaPanel({ canCall }: { canCall: boolean }) {
  const [busy, setBusy] = useState<"check" | "renew" | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  async function call(kind: "check" | "renew") {
    setBusy(kind);
    try {
      const r = await fetch(`${BASE_PATH}/api/integrations/meta/subscription`, { method: kind === "check" ? "GET" : "POST", cache: "no-store" });
      setRes((await r.json().catch(() => ({ ok: false, message: "Nieprawidłowa odpowiedź serwera." }))) as Result);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!canCall || busy !== null} onClick={() => void call("check")} className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm hover:border-[#1B6FA8] disabled:opacity-40">
          {busy === "check" ? "Sprawdzam…" : "Sprawdź subskrypcję Meta"}
        </button>
        <button type="button" disabled={!canCall || busy !== null} onClick={() => void call("renew")} className="h-9 rounded-md bg-[#1B6FA8] px-3 text-sm font-semibold text-white hover:bg-[#0C3450] disabled:opacity-40">
          {busy === "renew" ? "Odnawiam…" : "Odnów subskrypcję"}
        </button>
        {!canCall && <span className="self-center text-xs text-gray-500">Najpierw ustaw META_PAGE_ID i META_PAGE_ACCESS_TOKEN w konfiguracji serwera.</span>}
      </div>
      {res && !res.ok && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{res.message ?? "Nie udało się."}</p>}
      {res?.ok && res.info && (
        <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          <p className="m-0 font-semibold">Strona: {res.info.pageName ?? "—"}</p>
          <p className="m-0">Instagram: {res.info.instagram ? `@${res.info.instagram.username ?? res.info.instagram.id}` : res.info.pageInfoError ? "nieznane (patrz uwaga niżej)" : "brak powiązanego konta profesjonalnego"}</p>
          {res.info.pageInfoError && (
            <p className="m-0 mt-1 rounded bg-yellow-50 px-2 py-1 text-yellow-900">
              Nazwy strony i konta Instagram nie udało się odczytać — token nie ma uprawnienia „pages_read_engagement”. To tylko podgląd; subskrypcja działa bez niego.
            </p>
          )}
          <p className="m-0 mt-1">Oczekiwane pola: {res.info.expected.join(", ")}</p>
          {res.info.apps.length === 0 && <p className="m-0 text-red-700">Strona nie jest zasubskrybowana przez żadną aplikację.</p>}
          {res.info.apps.map((a, i) => (
            <p key={i} className="m-0">
              {a.ours ? "★ " : ""}
              {a.name ?? a.id ?? "aplikacja"}: {a.fields.join(", ") || "brak pól"}
            </p>
          ))}
          {res.info.missing.length > 0 && <p className="m-0 font-semibold text-red-700">Brakuje: {res.info.missing.join(", ")} — kliknij „Odnów subskrypcję”.</p>}
        </div>
      )}
    </div>
  );
}
