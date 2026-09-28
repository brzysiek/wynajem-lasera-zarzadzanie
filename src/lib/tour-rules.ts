// Przewodniki po panelu (wniosek 19) — czyste reguły (vitest bez "@/").

// „Cześć Aniu!” — wołacz imienia z powitania (pierwsze słowo nazwy konta).
const VOCATIVE: Record<string, string> = { Ania: "Aniu", Tomek: "Tomku", Łukasz: "Łukaszu", Klaudiusz: "Klaudiuszu", Kasia: "Kasiu", Basia: "Basiu", Ola: "Olu", Ewa: "Ewo" };
export function vocative(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  if (VOCATIVE[first]) return VOCATIVE[first];
  if (/[sczn]ia$/i.test(first)) return first.replace(/a$/, "u");
  return first;
}
