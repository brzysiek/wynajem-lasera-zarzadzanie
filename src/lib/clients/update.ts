import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncClientFieldsToDefault } from "@/lib/clients/delivery";
import { normalizePolishPhone } from "@/lib/reminders";
import { parseClientPatch, parseContactInput } from "@/lib/clients/validate";
import { CLIENT_CACHE_KEYS, CONTACT_CACHE_KEYS, refreshFutureRentalCaches } from "@/lib/clients/refresh";
import { normalizeAddressPatch } from "@/lib/clients/address";
import { AGENT_CLIENT_FIELDS, AGENT_PROPOSAL_CLIENT_FIELDS } from "@/lib/permissions";
import { changedFields } from "@/lib/changelog/diff";
import { parseProvenance } from "@/lib/changelog/provenance";
import { fieldEntries, recordChanges } from "@/lib/changelog/record";
import { enrichClient } from "@/lib/clients/enrich";
import { logWarn } from "@/lib/logger";
import { CLIENT_JSON_FIELDS, CONTACT_JSON_FIELDS, readFieldMeta, stampFieldMeta } from "@/lib/clients/profile-fields";

// Kwota zmieniona? (Decimal „70” vs tekst „70.00” to ta sama kwota.)
function amountChanged(before: Prisma.Decimal | null, after: string | null | undefined): boolean {
  if (before == null || after == null) return (before == null) !== (after == null);
  return !before.equals(new Prisma.Decimal(after));
}

// Pola JSON: null w PATCH = wyczyść (Prisma.DbNull).
function jsonNulls<T extends Record<string, unknown>>(data: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...data };
  for (const k of keys) if (k in out && out[k] === null) out[k] = Prisma.DbNull;
  return out as T;
}

// Pochodzenie zmienionych pól (sekcja 3 karty): źródło z provenance albo
// „panel” / „agent”; zmiana ręczna blokuje pole dla synchronizacji.
function stamp(meta: unknown, fields: string[], actor: UpdateActor, provenance: { source: string | null; batch: string | null }) {
  if (!fields.length) return undefined;
  return stampFieldMeta(readFieldMeta(meta), fields, {
    source: provenance.source ?? (actor.role === "AGENT" ? "agent" : "panel"),
    sourceRef: provenance.batch,
    by: actor.userId,
    at: new Date(),
    lock: true,
  }) as unknown as Prisma.InputJsonValue;
}

// Zmiana danych klienta i osoby kontaktowej — wspólna dla panelu
// (PATCH /api/clients/...) i API agenta (PATCH /api/agent/klienci/...).
// Każda zmiana pola trafia do dziennika zmian (przed → po). Rola AGENT: tylko
// pola z AGENT_CLIENT_FIELDS i obowiązkowo źródło + pewność zmiany; API
// agenta wymaga dodatkowo paczki (requireBatch).

export type UpdateActor = { userId: string; role: string };
export type UpdateResult = { ok: true; refreshedRentals: number; changed: number } | { ok: false; status: number; message: string };

export async function patchClient(
  id: string,
  body: Record<string, unknown>,
  actor: UpdateActor,
  opts: { requireBatch?: boolean; approvedById?: string | null } = {},
): Promise<UpdateResult> {
  const isAgent = actor.role === "AGENT";
  const provenance = parseProvenance(body, { required: isAgent });
  if (!provenance.ok) return { ok: false, status: 400, message: provenance.message };
  if (opts.requireBatch && !provenance.value.batch) return { ok: false, status: 400, message: "Podaj paczkę zmiany (paczka, np. P-2026-09-27-01)." };

  const parsed = parseClientPatch(body);
  if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
  if (isAgent) {
    // Propozycja zaakceptowana przez ADMIN (approvedById) może zmienić też pola,
    // które agent wolno tylko proponować (warunki handlowe).
    const allowed: readonly string[] = opts.approvedById ? AGENT_PROPOSAL_CLIENT_FIELDS : AGENT_CLIENT_FIELDS;
    const denied = Object.keys(parsed.data).filter((k) => !allowed.includes(k));
    if (denied.length) return { ok: false, status: 403, message: `Pole poza zakresem agenta: ${denied.join(", ")}.` };
  }
  const { deviceInterests, ...rest } = parsed.data;

  const current = await prisma.client.findUnique({ where: { id } });
  if (!current) return { ok: false, status: 404, message: "Nie znaleziono klienta." };
  // Wniosek 11: kod i miasto z pola „ulica”, „51 Urzędnicza”, „Krakow”…
  const addr = normalizeAddressPatch(rest, { street: current.street, zip: current.zip, city: current.city, country: current.country });
  if (!addr.ok) return { ok: false, status: 400, message: addr.message };
  Object.assign(rest, addr.patch);
  Object.assign(parsed.data, addr.patch);
  // Wniosek 15: nowa kwota transportu obowiązuje od dziś, chyba że podano datę.
  if (!("transportPriceSince" in parsed.data) && "transportPriceNet" in parsed.data && amountChanged(current.transportPriceNet, parsed.data.transportPriceNet)) {
    const since = parsed.data.transportPriceNet == null ? null : new Date();
    Object.assign(rest, { transportPriceSince: since });
    Object.assign(parsed.data, { transportPriceSince: since });
  }
  // Wniosek 28: nowa kwota transportu = „ustalona” (agent po akceptacji —
  // „propozycja agenta”), chyba że podano źródło; wyczyszczona — bez źródła.
  if (!("transportSource" in parsed.data) && "transportPriceNet" in parsed.data && amountChanged(current.transportPriceNet, parsed.data.transportPriceNet)) {
    const src = parsed.data.transportPriceNet == null ? null : isAgent ? "AGENT" : "USTALONE";
    Object.assign(rest, { transportSource: src });
    Object.assign(parsed.data, { transportSource: src });
  }
  const changes = changedFields(current as unknown as Record<string, unknown>, parsed.data);

  const fieldMeta = stamp(current.fieldMeta, changes.map((c) => c.field), actor, provenance.value);
  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id },
      data: {
        ...(jsonNulls(rest, CLIENT_JSON_FIELDS) as Prisma.ClientUpdateInput),
        ...(deviceInterests ? { deviceInterests: deviceInterests.length ? deviceInterests : Prisma.DbNull } : {}),
        ...(fieldMeta ? { fieldMeta } : {}),
      },
    });
    await recordChanges(tx, { userId: actor.userId, provenance: provenance.value, approvedById: opts.approvedById }, fieldEntries("CLIENT", id, id, changes));
  });

  // Tylko faktyczna zmiana pól z wynajmu odświeża PRZYSZŁE wynajmy (zakończone
  // zostają z danymi z tamtego dnia — refresh.ts).
  const touchesRentals = changes.some((c) => (CLIENT_CACHE_KEYS as readonly string[]).includes(c.field));
  const refreshedRentals = touchesRentals ? await refreshFutureRentalCaches({ clientId: id, clientFields: true }) : 0;
  // Stare pola paszportu dostawy → adres domyślny (ClientDeliveryAddress).
  if (changes.some((c) => c.field === "deliveryAddress" || c.field === "deliveryNotes" || c.field === "openingHours")) await syncClientFieldsToDefault(id);
  // Warunki handlowe (wniosek 28): przyszłe rezerwacje NIE przeliczają się
  // same — karta klienta pokazuje „Zmienia N przyszłych rezerwacji ·
  // Zastosuj” (GET/POST /api/clients/[id]/terms-sync), decyduje biuro.
  // Nowy / zmieniony NIP → uzupełnienie z Białej listy i CEIDG w tle
  // (błąd rejestru nie wpływa na zapis).
  if (changes.some((c) => c.field === "nip") && parsed.data.nip) {
    void enrichClient(id, { userId: actor.role === "AGENT" ? null : actor.userId }).catch((err) => logWarn("client_enrich_after_nip_failed", { clientId: id, message: err instanceof Error ? err.message : String(err) }));
  }
  return { ok: true, refreshedRentals, changed: changes.length };
}

export async function patchContact(
  clientId: string,
  contactId: string,
  body: Record<string, unknown>,
  actor: UpdateActor,
  opts: { requireBatch?: boolean; approvedById?: string | null } = {},
): Promise<UpdateResult> {
  const contact = await prisma.clientContact.findFirst({ where: { id: contactId, clientId } });
  if (!contact) return { ok: false, status: 404, message: "Nie znaleziono osoby." };

  const provenance = parseProvenance(body, { required: actor.role === "AGENT" });
  if (!provenance.ok) return { ok: false, status: 400, message: provenance.message };
  if (opts.requireBatch && !provenance.value.batch) return { ok: false, status: 400, message: "Podaj paczkę zmiany (paczka, np. P-2026-09-27-01)." };
  const parsed = parseContactInput(body, { normalizePhone: normalizePolishPhone });
  if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
  // Zdjęcie oznaczenia głównej osoby tylko przez wskazanie innej jako głównej.
  const { isPrimary, ...data } = parsed.data;
  const changes = changedFields(contact as unknown as Record<string, unknown>, { ...data, ...(isPrimary ? { isPrimary: true } : {}) });

  const fieldMeta = stamp(contact.fieldMeta, changes.map((c) => c.field).filter((f) => f !== "isPrimary"), actor, provenance.value);
  await prisma.$transaction(async (tx) => {
    if (isPrimary) await tx.clientContact.updateMany({ where: { clientId }, data: { isPrimary: false } });
    await tx.clientContact.update({
      where: { id: contactId },
      data: { ...(jsonNulls(data, CONTACT_JSON_FIELDS) as Prisma.ClientContactUpdateInput), ...(isPrimary ? { isPrimary: true } : {}), ...(fieldMeta ? { fieldMeta } : {}) },
    });
    await recordChanges(tx, { userId: actor.userId, provenance: provenance.value, approvedById: opts.approvedById }, fieldEntries("CONTACT", contactId, clientId, changes));
  });

  const touchesRentals = CONTACT_CACHE_KEYS.some((k) => k in data);
  const refreshedRentals = touchesRentals ? await refreshFutureRentalCaches({ clientId, contactId }) : 0;
  return { ok: true, refreshedRentals, changed: changes.length };
}
