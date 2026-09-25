// Normalizacja tytułów historycznych wydarzeń z kalendarzy urządzeń
// (docs/crm/prompt-claude-code-crm-3-historia.md, 2.2). Tytuły to wolny
// tekst biura — reguły zaprojektowane na prawdziwej próbce (25.09.2026), np.
// „Klaudia Sobota Bundz  Krakówdwie głowice”, „SHA Quattro do potwierdz.”,
// „Cooltech serwis 9.00”, „SZKOLENIE KOLBER”, „P. Kolber Krio”.
// Czysta funkcja (vitest bez aliasu "@/"). Oryginalny tytuł zostaje w bazie
// do wyświetlania — tu powstaje wyłącznie klucz do porównań i grupowania.

export type HistoryKind = "WYNAJEM" | "SZKOLENIE" | "INNE";

// Jedno miejsce do rozszerzania listy słów technicznych.
export const TECH_WORDS = new Set([
  // techniczne / organizacyjne
  "do", "potwierdz", "potwierdzenia", "potwierdzic", "potw", "rezerwacja", "rezerwacji", "wstepna", "wstepnie",
  "p", "pani", "pan", "panie", "fv", "gl", "dni", "dzien", "dnia", "od", "rano", "godz", "ok", "tel", "i", "z", "w", "na",
  // urządzenia i zabiegi (nazwy z kalendarzy)
  "lightsheer", "light", "sheer", "ls", "quattro", "kwatro", "desire", "alma", "harmony", "xl", "ipixel", "pixel",
  "dye", "vl", "cooltech", "krio", "kriolipoliza", "resur", "resurfx", "fx", "observ", "et", "et400", "laser",
  // formy prawne z nazw nabywców na fakturach („… Sp. z o.o.”, „… s.c.”, „PHU …”)
  "sp", "spolka", "o", "oo", "zoo", "s", "c", "sc", "sa", "ska", "jawna", "komandytowa", "cywilna", "ograniczona",
  "ograniczonej", "odpowiedzialnoscia", "odpowiedzialnosci", "phu", "fhu", "ppuh", "pphu", "phuh", "firma",
  "handlowo", "uslugowa", "uslugowe", "przedsiebiorstwo",
]);

// Tytuł zawierający któreś z tych słów to nie wynajem u klienta (serwis,
// blokada terminu itp.) — od razu „pominięte”.
const OTHER_MARKERS = [/\bserwis/, /\bprzeglad/, /\bblokad/, /\burlop/, /\bnapraw/, /\bsprzet u\b/];

// ł nie rozkłada się w NFD — zamieniane ręcznie.
export function stripDiacritics(s: string): string {
  return s.replace(/ł/g, "l").replace(/Ł/g, "L").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export type NormalizedTitle = { key: string; tokens: string[]; kind: HistoryKind };

export function normalizeTitle(title: string): NormalizedTitle {
  let s = stripDiacritics(title.toLowerCase());
  const training = /szkolen/.test(s);
  const other = OTHER_MARKERS.some((re) => re.test(s));

  s = s
    // godziny: 08:00, 9.00, 9:30
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, " ")
    // głowice w każdej postaci, także sklejone: „krakowdwie glowice”, „2gl”, „1 gl.”
    .replace(/(jedna|dwie|mala|duza|\d)?\s*glowic\w*/g, " ")
    .replace(/\b\d?\s*gl\b\.?/g, " ")
    .replace(/szkolen\w*/g, " ")
    // wszystko poza literami → spacja (emoji, znaki, cyfry, myślniki)
    .replace(/[^a-z\s]/g, " ");

  const tokens = s.split(/\s+/).filter((t) => t.length > 0 && !TECH_WORDS.has(t));
  const key = tokens.join(" ");
  const kind: HistoryKind = other || key === "" ? "INNE" : training ? "SZKOLENIE" : "WYNAJEM";
  return { key, tokens, kind };
}

// Najmocniejsze sygnały z opisu wydarzenia (2.2): telefony, e-maile, NIP-y.
// Normalizacja telefonu wstrzykiwana (normalizePolishPhone — ta sama co SMS).
export function extractSignals(
  text: string,
  normalizePhone: (raw: string) => string | null,
): { phones: string[]; emails: string[]; nips: string[] } {
  const plain = text.replace(/<[^>]+>/g, " ");
  const emails = [...new Set((plain.match(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))];
  const nips = [
    ...new Set(
      (plain.match(/\b(?:nip[:\s]*)?\d{3}-?\d{3}-?\d{2}-?\d{2}\b/gi) ?? [])
        .filter((m) => /nip/i.test(m) || /-/.test(m))
        .map((m) => m.replace(/\D/g, ""))
        .filter((d) => d.length === 10),
    ),
  ];
  const phones = [
    ...new Set(
      (plain.match(/(?:\+?48[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g) ?? [])
        .map((m) => normalizePhone(m))
        .filter((p): p is string => Boolean(p)),
    ),
  ];
  return { phones, emails, nips };
}
