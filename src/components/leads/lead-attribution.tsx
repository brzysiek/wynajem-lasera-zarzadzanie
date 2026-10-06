"use client";

import { useState } from "react";
import { groupAttribution, shortenId, type Attribution } from "@/lib/leads/attribution-view";

// „Skąd przyszło” (wniosek 41): zwijana sekcja karty sygnału z atrybucją z
// formularza WWW. Puste pola ukryte, długie ID skrócone, klik = kopiowanie
// pełnej wartości. Wartości od odwiedzających to zwykły tekst (bez linków).
function Row({ label, value, shorten }: { label: string; value: string; shorten: boolean }) {
  const [copied, setCopied] = useState(false);
  // ID (gclid, fbclid, fbp…) skracamy; adresy (strona wejścia, referrer) tylko obcinamy CSS-em.
  const long = shorten && value.length > 28;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* schowek niedostępny — wartość jest w podpowiedzi (title) */
    }
  }
  return (
    <div className="flex items-baseline gap-2 text-[12.5px]">
      <span className="w-[150px] flex-none text-[var(--c-muted)]">{label}</span>
      <button
        type="button"
        onClick={() => void copy()}
        title={`${value}\n(kliknij, żeby skopiować)`}
        className="min-w-0 truncate text-left font-mono text-[12px] text-[var(--c-text)] hover:text-[var(--c-brand-deep)]"
      >
        {copied ? "✓ skopiowano" : long ? shortenId(value) : value}
      </button>
    </div>
  );
}

export function LeadAttribution({ attribution }: { attribution: Attribution | null }) {
  const groups = groupAttribution(attribution);
  if (!groups.length) return null;
  return (
    <details className="group rounded-lg border border-[var(--c-border)] px-3 py-2">
      <summary className="cursor-pointer select-none text-sm font-semibold text-[var(--c-navy)]">Skąd przyszło</summary>
      <div className="mt-2 flex flex-col gap-3">
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--c-faint)]">{g.title}</div>
            {g.rows.map((r) => (
              <Row key={r.key} label={r.label} value={r.value} shorten={r.key !== "landing_url" && r.key !== "referrer"} />
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
