// Początek śledzenia wpłat z wyciągów (ustalony z użytkownikiem): import CSV
// dopasowuje przelewy tylko do faktur wystawionych od tej daty — nigdy
// wstecz. Faktury starsze nie są sprawdzane (karta: „nie sprawdzono”).
export const BANK_STATEMENT_SINCE = "2026-09-01";
