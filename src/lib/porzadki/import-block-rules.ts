// Blokada ponownego importu — czyste reguły (vitest, bez @/). Po ID z
// HubSpota, nigdy po e-mailu / telefonie: nowa transakcja tej samej osoby
// (nowe ID) przechodzi i tworzy nowe zapytanie.

// Transakcje do zaimportowania: nie ma ich jeszcze w panelu i nie są na
// liście blokad (usunięte trwale w panelu).
export function dealsToImport<T extends { id: string }>(deals: T[], existingIds: Set<string>, blocked: Set<string>): T[] {
  return deals.filter((d) => !existingIds.has(d.id) && !blocked.has(d.id));
}

type PlanLike = { key: string; hubspotCompanyId: string | null; contacts: { hubspotContactId: string }[] };

// Plan importu klientów bez zablokowanych firm i kontaktów. Firma, której
// wszystkie kontakty są zablokowane, też odpada (nie wraca jako pusta karta).
export function withoutBlocked<T extends PlanLike>(clients: T[], blockedContacts: Set<string>, blockedCompanies: Set<string>): T[] {
  return clients
    .filter((c) => !(c.hubspotCompanyId && blockedCompanies.has(c.hubspotCompanyId)))
    .map((c) => {
      const contacts = c.contacts.filter((p) => !blockedContacts.has(p.hubspotContactId));
      return { plan: { ...c, contacts }, hadContacts: c.contacts.length > 0 };
    })
    .filter(({ plan, hadContacts }) => plan.contacts.length > 0 || !hadContacts)
    .map(({ plan }) => plan);
}
