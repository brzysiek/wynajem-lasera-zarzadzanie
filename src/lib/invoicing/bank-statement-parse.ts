// Parser eksportu "Lista operacji" z mBanku (panel firmowy) — format:
// kilkanaście linii nagłówka/metadanych (dane klienta, okres, lista
// rachunków, podsumowanie), potem wiersz nagłówków kolumn
// "#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;" i dalej
// wiersze danych, średnikami rozdzielane, pola w cudzysłowach:
//   2026-09-03;"DERMA HARMONIA KLAUDIA GĄDEK, WYNAJEM LASERA ...";"mBiznes konto...";"Sprzedaż towarów i usług";897,90 PLN;;
// Budowany na realnym pliku od użytkownika, nie zgadywany — patrz
// bank-statement-parse.test.ts dla dokładnych przykładów wierszy.

export type BankTransaction = {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // dodatnia = wpływ, ujemna = wydatek
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// "897,90 PLN", "-217,71 PLN", "25 751,57 PLN" (spacja jako separator tysięcy).
const AMOUNT_RE = /^(-?[\d\s ]+,\d{2})\s*PLN$/;

// mBank cytuje pola opisowe w cudzysłowach, ale same cudzysłowy nigdy się w
// nich nie podwajają (nie trzeba obsługiwać escapowania `""`) — prosty,
// stanowy split wystarcza, pełny parser CSV byłby przerostem formy.
function splitSemicolons(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ";" && !inQuotes) {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

export function parseBankStatementCsv(csv: string): BankTransaction[] {
  const rows: BankTransaction[] = [];
  for (const line of csv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = splitSemicolons(line);
    const date = fields[0]?.trim();
    // Wiersze nagłówka/metadanych nie zaczynają się od daty — to najprostszy,
    // niezawodny sposób je pominąć bez liczenia linii (format nagłówka mBanku
    // bywał różny między eksportami).
    if (!date || !DATE_RE.test(date)) continue;

    const description = (fields[1] ?? "").trim();
    const amountRaw = (fields[4] ?? "").trim();
    const amountMatch = amountRaw.match(AMOUNT_RE);
    if (!amountMatch) continue;
    const amount = Number(amountMatch[1].replace(/[\s ]/g, "").replace(",", "."));
    if (!Number.isFinite(amount)) continue;

    rows.push({ date, description, amount });
  }
  return rows;
}
