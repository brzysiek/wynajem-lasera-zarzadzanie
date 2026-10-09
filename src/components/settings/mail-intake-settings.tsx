"use client";

import { useState } from "react";
import { api } from "@/components/clients/client-forms";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { BTN_GHOST, BTN_PRIMARY, Card, ErrorNote, INPUT, LABEL, TEXTAREA } from "@/components/porzadki/shared";
import type { IntakeConfig, WordPoints } from "@/lib/leads/mail-intake-rules";

// Ustawienia → Maile → sygnały (wniosek 43): tryb, słowa z punktami, słowa
// „prośba o wynajem”, zablokowane domeny i progi. Słowa jedno pod drugim; punkty
// po dwukropku („alma harmony: 3”). Minusy zapisujemy jako liczby dodatnie.

const toLines = (xs: WordPoints[]) => xs.map((x) => `${x.word}: ${Math.abs(x.points)}`).join("\n");
const fromLines = (s: string, sign: 1 | -1): WordPoints[] =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf(":");
      const pts = i > 0 ? Number(l.slice(i + 1).trim().replace(",", ".")) : NaN;
      return { word: (i > 0 ? l.slice(0, i) : l).trim(), points: (Number.isFinite(pts) && pts > 0 ? pts : 1) * sign };
    });
const list = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

export function MailIntakeSettings({ initial, defaults }: { initial: IntakeConfig; defaults: IntakeConfig }) {
  const [mode, setMode] = useState(initial.mode);
  const [positive, setPositive] = useState(toLines(initial.positive));
  const [negative, setNegative] = useState(toLines(initial.negative));
  const [rental, setRental] = useState(initial.rentalWords.join("\n"));
  const [domains, setDomains] = useState(initial.blockedDomains.join("\n"));
  const [high, setHigh] = useState(String(initial.high));
  const [medium, setMedium] = useState(String(initial.medium));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function reset() {
    setPositive(toLines(defaults.positive));
    setNegative(toLines(defaults.negative));
    setRental(defaults.rentalWords.join("\n"));
    setDomains(defaults.blockedDomains.join("\n"));
    setHigh(String(defaults.high));
    setMedium(String(defaults.medium));
    setInfo("Przywrócono wartości domyślne — kliknij „Zapisz”, żeby je zatwierdzić.");
  }

  async function save() {
    setBusy(true);
    setError(null);
    setInfo(null);
    const { ok, data } = await api<{ config: IntakeConfig }>("/api/mail-intake/config", "PUT", {
      config: { mode, positive: fromLines(positive, 1), negative: fromLines(negative, -1), rentalWords: list(rental), blockedDomains: list(domains), high: Number(high), medium: Number(medium) },
    });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    setInfo("Zapisano. Nowe reguły działają od następnej synchronizacji (co 5 minut).");
  }

  return (
    <div style={APP_CSS_VARS} className="flex max-w-[860px] flex-col gap-4">
      <Card title="Tryb">
        <div className="flex flex-col gap-2 text-[13.5px]">
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === "CAUTIOUS"} onChange={() => setMode("CAUTIOUS")} className="mt-1" />
            <span>
              <b>Ostrożny</b> (zalecany na pierwsze 2 tygodnie) — panel sam nie zakłada sygnałów. Wysoka i średnia ocena → „Do sprawdzenia”; niska → „Odrzucone automatycznie” (widoczne 14 dni).
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === "AUTO"} onChange={() => setMode("AUTO")} className="mt-1" />
            <span>
              <b>Automatyczny</b> — wysoka ocena zakłada sygnał od razu (źródło: mail), średnia → „Do sprawdzenia”, niska → odrzucone.
            </span>
          </label>
        </div>
      </Card>

      <Card title="Punkty za słowa">
        <div className="grid gap-3 md:grid-cols-2">
          <label className={LABEL}>
            Plusy (słowo: punkty)
            <textarea className={`${TEXTAREA} min-h-[180px] font-mono text-[12.5px]`} value={positive} onChange={(e) => setPositive(e.target.value)} />
          </label>
          <label className={LABEL}>
            Minusy (słowo: punkty odejmowane)
            <textarea className={`${TEXTAREA} min-h-[180px] font-mono text-[12.5px]`} value={negative} onChange={(e) => setNegative(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>
            Próg „wysoka ocena” (od tylu punktów)
            <input className={INPUT} inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
          </label>
          <label className={LABEL}>
            Próg „do sprawdzenia” (niżej: odrzucone)
            <input className={INPUT} inputMode="decimal" value={medium} onChange={(e) => setMedium(e.target.value)} />
          </label>
        </div>
      </Card>

      <Card title="Klientki z bazy i zablokowane domeny">
        <div className="grid gap-3 md:grid-cols-2">
          <label className={LABEL}>
            Słowa „prośba o wynajem” (mail od klientki z bazy, która nie ma otwartego sygnału → „Do sprawdzenia”)
            <textarea className={`${TEXTAREA} min-h-[140px] font-mono text-[12.5px]`} value={rental} onChange={(e) => setRental(e.target.value)} />
          </label>
          <label className={LABEL}>
            Zablokowane domeny (nigdy nie dają sygnału; jedna pod drugą)
            <textarea className={`${TEXTAREA} min-h-[140px] font-mono text-[12.5px]`} value={domains} onChange={(e) => setDomains(e.target.value)} />
          </label>
        </div>
      </Card>

      <ErrorNote message={error} />
      {info && <p className="m-0 text-[13px] text-[var(--c-muted)]">{info}</p>}
      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void save()}>
          {busy ? "Zapisywanie…" : "Zapisz"}
        </button>
        <button type="button" className={BTN_GHOST} disabled={busy} onClick={reset}>
          Przywróć domyślne
        </button>
      </div>
    </div>
  );
}
