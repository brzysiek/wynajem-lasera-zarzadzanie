// Szanse sprzedaży (karta klienta, sekcja „Szanse sprzedaży”; MCP
// szansa_dodaj) — walidacja. Czysty moduł (vitest bez "@/").
import { parseDay } from "./profile-fields";

export const OPPORTUNITY_STAGES = ["pomysl", "rozmowa", "oferta", "decyzja", "wygrana", "przegrana"] as const;
export const OPPORTUNITY_CHANCES = ["wysoka", "srednia", "niska", "sprawdzic"] as const;
export type OpportunityInput = {
  device: string;
  stage: (typeof OPPORTUNITY_STAGES)[number];
  chance: (typeof OPPORTUNITY_CHANCES)[number] | null;
  lastContact: Date | null;
  returnAt: Date | null;
  note: string | null;
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").trim();
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Klucze angielskie (panel) albo polskie (agent: urzadzenie, etap, szansa,
// ostatni_kontakt, wrocic, opis). partial = zmiana istniejącej szansy.
export function parseOpportunityInput(b: Record<string, unknown>, opts: { partial?: boolean } = {}): { ok: true; value: Partial<OpportunityInput> } | { ok: false; message: string } {
  const out: Partial<OpportunityInput> = {};
  const has = (...k: string[]) => k.some((x) => x in b);
  if (!opts.partial || has("device", "urzadzenie")) {
    const device = text(b.device ?? b.urzadzenie, 191);
    if (!device) return { ok: false, message: "Podaj urządzenie / temat szansy (urzadzenie)." };
    out.device = device;
  }
  if (!opts.partial || has("stage", "etap")) {
    const raw = text(b.stage ?? b.etap, 32);
    const stage = raw ? (fold(raw).replace(/[^a-z]/g, "") as OpportunityInput["stage"]) : "rozmowa";
    if (!(OPPORTUNITY_STAGES as readonly string[]).includes(stage)) return { ok: false, message: `etap: ${OPPORTUNITY_STAGES.join(", ")}.` };
    out.stage = stage;
  }
  if (has("chance", "szansa") || !opts.partial) {
    const raw = text(b.chance ?? b.szansa, 16);
    const chance = raw ? (fold(raw).replace(/[^a-z]/g, "") as OpportunityInput["chance"]) : null;
    if (chance && !(OPPORTUNITY_CHANCES as readonly string[]).includes(chance)) return { ok: false, message: `szansa: ${OPPORTUNITY_CHANCES.join(", ")}.` };
    out.chance = chance;
  }
  for (const [key, alias] of [
    ["lastContact", "ostatni_kontakt"],
    ["returnAt", "wrocic"],
  ] as const) {
    if (!has(key, alias) && opts.partial) continue;
    const d = parseDay(b[key] ?? b[alias]);
    if (d === "invalid") return { ok: false, message: `${alias}: data RRRR-MM-DD.` };
    out[key] = d;
  }
  if (has("note", "opis") || !opts.partial) out.note = text(b.note ?? b.opis, 2000);
  return { ok: true, value: out };
}
