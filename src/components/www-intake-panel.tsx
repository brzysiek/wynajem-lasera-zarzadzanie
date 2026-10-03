"use client";

import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";

// Formularze WWW → panel (03.10.2026): adres webhooka (bez tokenu), przełącznik
// tworzenia sygnałów z nowych transakcji HubSpot i ostatnie żądania.
type Log = { id: string; result: string; leadId: string | null; message: string | null; createdAt: string };

export function WwwIntakePanel() {
  const [state, setState] = useState<{ enabled: boolean; tokenConfigured: boolean; logs: Log[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    fetch(`${BASE_PATH}/api/integrations/hubspot/new-deals`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState(d))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  async function toggle(enabled: boolean) {
    if (!enabled && !window.confirm("Wyłączyć tworzenie sygnałów z nowych transakcji HubSpot? Zrób to dopiero, gdy formularze strony wysyłają już bezpośrednio do panelu.")) return;
    setBusy(true);
    await fetch(`${BASE_PATH}/api/integrations/hubspot/new-deals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    setBusy(false);
    void load();
  }
  const url = typeof window !== "undefined" ? `${window.location.origin}${BASE_PATH}/api/webhooks/formularz-www?token=…` : "";
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Formularze strony → Sygnały</h2>
      <p className="mb-4 text-sm text-gray-500">
        Formularze Contact Form 7 z wynajemlasera.pl wysyłają zgłoszenia prosto do panelu (bez n8n i HubSpota). Adres webhooka:{" "}
        <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">{url}</code> — token z <code className="font-mono text-xs">WWW_WEBHOOK_TOKEN</code> w .env serwera
        {state && !state.tokenConfigured && <b className="text-red-600"> (token nie jest ustawiony — webhook odrzuca żądania)</b>}.
      </p>
      {state && (
        <>
          <label className="mb-4 flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={state.enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
            Tworzenie sygnałów z nowych transakcji HubSpot (<code className="font-mono text-xs">leads_hubspot_new_deals</code>) — {state.enabled ? "włączone" : "wyłączone"}
          </label>
          <h3 className="mb-1 text-sm font-semibold text-gray-700">Ostatnie żądania formularzy</h3>
          {state.logs.length === 0 ? (
            <p className="text-sm text-gray-500">Jeszcze nic nie przyszło.</p>
          ) : (
            <ul className="text-sm text-gray-700">
              {state.logs.map((l) => (
                <li key={l.id}>
                  {new Date(l.createdAt).toLocaleString("pl-PL")} · <b>{l.result}</b>
                  {l.leadId && (
                    <>
                      {" "}
                      ·{" "}
                      <a className="text-[#1B6FA8] hover:underline" href={`${BASE_PATH}/sygnaly?id=${l.leadId}`}>
                        sygnał
                      </a>
                    </>
                  )}
                  {l.message && <span className="text-red-600"> · {l.message}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
