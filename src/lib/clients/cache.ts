// Dane kontaktu zapisywane na WYNAJMIE (Rental.contact*Cache) z danych
// klienta z panelu. Te pola czytają dziś faktury (NIP), przypomnienia SMS
// (telefon), widok kierowcy (adres, telefon) i przychody (nazwa) — więc
// format jest CELOWO taki sam, jak przy przypisaniu kontaktu z HubSpota
// (src/app/api/rentals/[id]/contact/route.ts): adres „ulica, kod miasto,
// kraj” (jak formatHubspotAddress), cena „150” (nie „150.00”). Bez
// zależności — testowane w vitest.

export function formatClientAddress(c: {
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
}): string | null {
  const cityLine = [c.zip, c.city].filter(Boolean).join(" ");
  const parts = [c.street, cityLine, c.country].map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : null;
}

// „+48601000111” → „+48 601 000 111” — czytelne dla kierowcy, a
// normalizePolishPhone (SMS) i tak zdejmuje spacje.
export function readablePhone(phone: string | null): string | null {
  if (!phone) return null;
  const m = phone.match(/^\+48(\d{3})(\d{3})(\d{3})$/);
  return m ? `+48 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

// Decimal „150.00” → „150”, „150.50” → „150.5”.
export function plainAmount(v: { toString(): string } | string | null): string | null {
  if (v == null) return null;
  const n = Number(v.toString());
  return Number.isFinite(n) ? String(n) : null;
}

export type ClientCacheSource = {
  name: string;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  nip: string | null;
  transportPriceNet: { toString(): string } | string | null;
};

export type ContactCacheSource = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

export function clientCacheFields(c: ClientCacheSource) {
  return {
    contactCompanyCache: c.name,
    contactAddressCache: formatClientAddress(c),
    contactNipCache: c.nip,
    contactTransportPriceCache: plainAmount(c.transportPriceNet),
  };
}

export function contactCacheFields(p: ContactCacheSource) {
  return {
    contactNameCache: [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || null,
    contactPhoneCache: readablePhone(p.phone),
    contactEmailCache: p.email,
  };
}
