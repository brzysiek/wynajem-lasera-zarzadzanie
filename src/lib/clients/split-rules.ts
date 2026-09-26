// „Wydziel do nowego klienta” — walidacja wejścia (czysty moduł, vitest,
// bez @/). Z klienta-zlepka wybrane osoby przechodzą do nowego klienta
// razem ze swoimi wynajmami, sygnałami, e-mailami i SMS-ami; opcjonalnie
// faktury po NIP-ie nabywcy i grupy z dopasowań.
import { normalizeNip } from "./hubspot-import";

export type SplitInput = {
  contactIds: string[];
  name: string;
  nip: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  invoiceNip: string | null; // faktury klienta z tym NIP-em nabywcy przechodzą do nowego
  historyKeys: string[]; // grupy z kalendarzy (klucze z dopasowań) — przypisz nowemu
};

const text = (v: unknown, max = 191) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim().length > 0))] : []);

// Klucze polskie (API agenta: osoby_ids, nazwa, nip, ulica, kod, miasto,
// faktury_nip, klucze_dopasowan) albo angielskie (panel).
export function parseSplitInput(b: Record<string, unknown>): { ok: true; value: SplitInput } | { ok: false; message: string } {
  const contactIds = list(b.contactIds ?? b.osoby_ids);
  if (!contactIds.length) return { ok: false, message: "Wybierz osoby do wydzielenia." };
  if (contactIds.length > 100) return { ok: false, message: "Za dużo osób naraz (maks. 100)." };
  const name = text(b.name ?? b.nazwa);
  if (!name) return { ok: false, message: "Podaj nazwę nowego klienta." };
  const nipRaw = text(b.nip, 32);
  const nip = normalizeNip(nipRaw);
  if (nip.invalid) return { ok: false, message: "NIP nowego klienta musi mieć 10 cyfr." };
  const invRaw = text(b.invoiceNip ?? b.faktury_nip, 32);
  const invoiceNip = normalizeNip(invRaw);
  if (invoiceNip.invalid) return { ok: false, message: "NIP faktur musi mieć 10 cyfr." };
  const historyKeys = list(b.historyKeys ?? b.klucze_dopasowan).slice(0, 200);
  return {
    ok: true,
    value: {
      contactIds,
      name,
      nip: nip.nip ?? invoiceNip.nip ?? null,
      street: text(b.street ?? b.ulica),
      zip: text(b.zip ?? b.kod, 16),
      city: text(b.city ?? b.miasto),
      invoiceNip: invoiceNip.nip ?? null,
      historyKeys,
    },
  };
}
