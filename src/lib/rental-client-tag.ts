// Klient zapisany w wydarzeniu Google (wniosek 23): extendedProperties.private
// .clientId oraz, awaryjnie (np. skopiowane wydarzenie), znacznik w opisie
// „[klient:<id>]”. Czysty moduł (vitest bez aliasu "@/").

const TAG = /\s*\[klient:([A-Za-z0-9_-]{6,191})\]\s*/g;

// Id klienta ze znacznika w opisie (ostatni, gdy jest kilka) albo null.
export function parseClientTag(description: string | null | undefined): string | null {
  if (!description) return null;
  const all = [...description.matchAll(TAG)];
  return all.length ? all[all.length - 1][1] : null;
}

// Opis bez znacznika — do pokazania i edycji w panelu.
export function stripClientTag(description: string | null | undefined): string | null {
  if (description == null) return null;
  const out = description.replace(TAG, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || null;
}

// Opis ze znacznikiem na końcu (jeden), albo bez — gdy klienta brak.
export function withClientTag(description: string | null | undefined, clientId: string | null): string | null {
  const base = stripClientTag(description);
  if (!clientId) return base;
  return base ? `${base}\n\n[klient:${clientId}]` : `[klient:${clientId}]`;
}
