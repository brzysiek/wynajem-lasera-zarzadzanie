// Źródło, pewność i paczka zmiany — dopisywane do wpisu w dzienniku zmian.
// Dla roli AGENT przy zmianie danych klienta źródło i pewność są wymagane
// (instrukcja „Dziennik porządków”, 3C). Czysty moduł (bez Prismy).

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type Provenance = { source: string | null; confidence: Confidence | null; batch: string | null };

export const CONFIDENCE_LABEL: Record<Confidence, string> = { HIGH: "wysoka", MEDIUM: "średnia", LOW: "niska" };

const CONFIDENCE_ALIASES: Record<string, Confidence> = {
  high: "HIGH",
  wysoka: "HIGH",
  medium: "MEDIUM",
  srednia: "MEDIUM",
  średnia: "MEDIUM",
  low: "LOW",
  niska: "LOW",
};

// Klucze, pod którymi przychodzi proweniencja — z formularzy panelu
// (changeSource / changeConfidence / changeBatch; „source” to już pole
// klienta = źródło pozyskania) albo po polsku z API agenta (zrodlo / pewnosc
// / paczka).
export const PROVENANCE_KEYS = ["changeSource", "changeConfidence", "changeBatch", "zrodlo", "pewnosc", "paczka"] as const;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export function parseProvenance(
  body: Record<string, unknown>,
  opts: { required: boolean },
): { ok: true; value: Provenance } | { ok: false; message: string } {
  const source = str(body.changeSource ?? body.zrodlo, 2000);
  const rawConfidence = str(body.changeConfidence ?? body.pewnosc, 16);
  const batch = str(body.changeBatch ?? body.paczka, 64);

  let confidence: Confidence | null = null;
  if (rawConfidence) {
    confidence = CONFIDENCE_ALIASES[rawConfidence.toLowerCase()] ?? null;
    if (!confidence) return { ok: false, message: "Pewność: wysoka, średnia albo niska." };
  }
  if (opts.required && !source) return { ok: false, message: "Podaj źródło zmiany (np. mail, faktura, rejestr)." };
  if (opts.required && !confidence) return { ok: false, message: "Podaj pewność zmiany (wysoka, średnia, niska)." };
  return { ok: true, value: { source, confidence, batch } };
}
