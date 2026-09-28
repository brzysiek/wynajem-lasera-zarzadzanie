// Notatka z HubSpota / panelu: nieudana próba kontaktu czy rozmowa (wniosek 18,
// przegląd 29.09, pkt 2). Nieudana próba nie jest interakcją — liczy się jako
// próba (●○○), nie jako pierwszy kontakt i nie kwalifikuje klienta.
// Czysty moduł (vitest bez "@/"). Ten sam wzorzec w migracji
// 20261007100000_lejek_v2_poprawki (SQL REGEXP).

export const FAILED_ATTEMPT_RE =
  /(nieudan|zaj[eę]t|niedost[eę]pn|zablokowan|nie odbiera|nie odebra|poczta g[lł]osowa|dzwoni[cć] jutro|brak odpowiedzi|nie ma zasi[eę]gu|abonent (jest )?niedost|nie mog[eę] si[eę] dodzwoni)/i;

export function isFailedAttemptNote(text: string | null | undefined): boolean {
  return FAILED_ATTEMPT_RE.test(text ?? "");
}

// Z listy notatek: pierwsza prawdziwa rozmowa (albo null) i liczba nieudanych prób.
export function contactFromNotes(notes: { text: string; at: Date | null }[]): { firstContactAt: Date | null; attempts: number } {
  let first: Date | null = null;
  let attempts = 0;
  for (const n of notes) {
    if (!n.text.trim()) continue;
    if (isFailedAttemptNote(n.text)) attempts++;
    else if (n.at && (!first || n.at < first)) first = n.at;
  }
  return { firstContactAt: first, attempts: Math.min(attempts, 3) };
}
