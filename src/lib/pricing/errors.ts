// Rzucany przez funkcje w src/lib/pricing/ przy niepoprawnych danych wejściowych
// (np. licznik końcowy < początkowy). API route łapie to i zwraca 400 z tą
// wiadomością — jest pisana pod wyświetlenie użytkownikowi (biuru / kierowcy).
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}
