"use client";

import { useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { BTN, BTN_PRIMARY, Card, ErrorNote } from "@/components/porzadki/shared";

// Ustawienia → Konwersje Google (wniosek 54, etap 1): ile konwersji czeka,
// dlaczego sygnały odpadły i pobranie pliku CSV (z oznaczeniem albo bez).

export type ConversionSummary = {
  pending: number;
  already: number;
  leadsChecked: number;
  leadsEligible: number;
  skipped: { reason: string; label: string; leads: number }[];
  byName: { name: string; pending: number; withoutValue: number }[];
};

type BackfillResult = {
  applied: boolean;
  updated: number;
  wouldUpdate: number;
  stats: { total: number; withGclid: number; noGclidWithBraid: number; none: number; braidOnlyInUrl: number };
};

export function GoogleConversionsPanel({ initial }: { initial: ConversionSummary }) {
  const [fill, setFill] = useState<BackfillResult | null>(null);
  const [fillBusy, setFillBusy] = useState(false);

  async function backfill(apply: boolean) {
    setFillBusy(true);
    setError(null);
    try {
      const r = await fetch(`${BASE_PATH}/api/google-conversions/backfill`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply }) });
      if (!r.ok) return setError("Nie udało się sprawdzić identyfikatorów.");
      setFill((await r.json()) as BackfillResult);
    } finally {
      setFillBusy(false);
    }
  }

  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch(`${BASE_PATH}/api/google-conversions`, { cache: "no-store" });
    if (r.ok) setData((await r.json()) as ConversionSummary);
  }

  async function download(opts: { mark: boolean; all: boolean }) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await fetch(`${BASE_PATH}/api/google-conversions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        setError(j.message ?? "Nie udało się przygotować pliku.");
        return;
      }
      const rows = Number(r.headers.get("X-Rows") ?? "0");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "konwersje-google-ads.csv";
      a.click();
      URL.revokeObjectURL(url);
      setInfo(`Pobrano plik: ${rows} ${rows === 1 ? "konwersja" : "konwersji"}${opts.mark ? " — oznaczone jako wysłane, nie pójdą drugi raz." : "."}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card title="Do wgrania">
        <p className="mb-3 text-sm text-[var(--c-text)]">
          Sygnałów ze zgodą marketingową i identyfikatorem kliknięcia: <b>{data.leadsEligible}</b> (z {data.leadsChecked} z ostatnich 90 dni z formularzy WWW).
          Konwersji czeka na wgranie: <b>{data.pending}</b>, wcześniej wyeksportowanych: {data.already}.
        </p>
        <table className="mb-3 w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--c-muted)]">
            <tr>
              <th className="py-1 font-medium">Konwersja</th>
              <th className="py-1 font-medium">Czeka</th>
              <th className="py-1 font-medium">Bez kwoty</th>
            </tr>
          </thead>
          <tbody>
            {data.byName.map((r) => (
              <tr key={r.name} className="border-t border-[var(--c-border)]">
                <td className="py-1.5">{r.name}</td>
                <td className="py-1.5">{r.pending}</td>
                <td className="py-1.5 text-[var(--c-muted)]">{r.withoutValue || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || data.pending === 0} className={BTN_PRIMARY} onClick={() => void download({ mark: true, all: false })}>
            Pobierz CSV i oznacz jako wysłane
          </button>
          <button type="button" disabled={busy || data.pending === 0} className={BTN} onClick={() => void download({ mark: false, all: false })}>
            Pobierz bez oznaczania
          </button>
          <button type="button" disabled={busy || data.pending + data.already === 0} className={BTN} onClick={() => void download({ mark: false, all: true })}>
            Pobierz wszystko od nowa
          </button>
        </div>
        <ErrorNote message={error} />
        {info && <p className="mt-2 text-[13px] text-[var(--c-brand-deep)]">{info}</p>}
        <p className="mt-3 text-xs text-[var(--c-muted)]">
          Plik wgrywasz w Google Ads: Cele → Konwersje → Wgrywanie. Nazwy działań konwersji w Google muszą być takie same jak w pliku. Czas w pliku jest w strefie Europe/Warsaw, waluta PLN, bez e-maili i telefonów. Rezerwacja i wynajem
          niosą kwotę netto z rozliczenia wynajmu (gdy rozliczenia jeszcze nie ma — wiersz bez kwoty).
        </p>
      </Card>
      <Card title="Identyfikatory kliknięć w sygnałach od 11.10">
        <p className="mb-3 text-sm text-[var(--c-muted)]">
          Na iPhone / Safari Google często daje gbraid albo wbraid zamiast gclid. Nowe sygnały zapisują je z formularza; starym można je jednorazowo dopisać z adresu strony wejścia (nic nie jest nadpisywane).
        </p>
        {fill && (
          <ul className="mb-3 m-0 flex list-none flex-col gap-1 p-0 text-sm">
            <li>Sygnałów z formularzy WWW: <b>{fill.stats.total}</b></li>
            <li>z gclid: <b>{fill.stats.withGclid}</b></li>
            <li>bez gclid, ale z gbraid / wbraid: <b>{fill.stats.noGclidWithBraid}</b></li>
            <li>bez żadnego identyfikatora: <b>{fill.stats.none}</b></li>
            <li>
              gbraid / wbraid tylko w adresie (do uzupełnienia): <b>{fill.wouldUpdate}</b>
              {fill.applied ? ` — uzupełniono ${fill.updated}` : ""}
            </li>
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={fillBusy} className={BTN} onClick={() => void backfill(false)}>
            Sprawdź (nic nie zapisuje)
          </button>
          <button type="button" disabled={fillBusy || !fill || fill.applied || fill.wouldUpdate === 0} className={BTN_PRIMARY} onClick={() => void backfill(true)}>
            Uzupełnij {fill && !fill.applied ? fill.wouldUpdate : ""} sygnałów
          </button>
        </div>
      </Card>
      <Card title="Dlaczego sygnały nie trafiają do pliku">
        {data.skipped.length === 0 ? (
          <p className="text-sm text-[var(--c-muted)]">Brak sygnałów odrzuconych.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {data.skipped.map((s) => (
              <li key={s.reason} className="flex justify-between gap-4 border-t border-[var(--c-border)] py-1.5 first:border-t-0">
                <span>{s.label}</span>
                <b>{s.leads}</b>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-[var(--c-muted)]">Sygnały sprzed wdrożenia pól zgód mają „brak danych” i nie trafiają do pliku — Google i tak nie liczy konwersji bez zgody.</p>
      </Card>
    </div>
  );
}
