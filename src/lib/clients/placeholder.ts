// Zastępcze dane z HubSpota — czyste reguły (vitest, bez @/). Adresy typu
// brak10@brak.pl i firmy bez nazwy (albo z domeną zastępczą) to nie dane
// klienta, tylko wypełniacze; nie wolno po nich łączyć osób w jednego klienta
// ani dopasowywać (zlepek „Joanna Bakalarz”, wniosek W-0001).

export const PLACEHOLDER_DOMAINS = ["brak.pl", "brak.com", "brak.com.pl", "example.com", "example.pl", "test.pl", "test.com", "nomail.pl", "noemail.pl", "brakmaila.pl", "brak-maila.pl"];

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  return PLACEHOLDER_DOMAINS.includes(domain) || /^(brak|nie|nie-ma|niema|none|no)[-_.]?\d*$/.test(local);
}

export function isPlaceholderDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return PLACEHOLDER_DOMAINS.includes(domain.trim().toLowerCase().replace(/^www\./, ""));
}

// Firma HubSpot, która nie może grupować osób: bez nazwy albo z domeną zastępczą.
export function isPlaceholderCompany(c: { name: string | null; domain?: string | null }): boolean {
  return !c.name?.trim() || isPlaceholderDomain(c.domain ?? null);
}
