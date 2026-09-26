import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { parseClientPatch, parseContactInput } from "@/lib/clients/validate";
import { CLIENT_CACHE_KEYS, CONTACT_CACHE_KEYS, refreshFutureRentalCaches } from "@/lib/clients/refresh";
import { AGENT_CLIENT_FIELDS } from "@/lib/permissions";
import { changedFields } from "@/lib/changelog/diff";
import { parseProvenance } from "@/lib/changelog/provenance";
import { fieldEntries, recordChanges } from "@/lib/changelog/record";

// Zmiana danych klienta i osoby kontaktowej — wspólna dla panelu
// (PATCH /api/clients/...) i API agenta (PATCH /api/agent/klienci/...).
// Każda zmiana pola trafia do dziennika zmian (przed → po). Rola AGENT: tylko
// pola z AGENT_CLIENT_FIELDS i obowiązkowo źródło + pewność zmiany; API
// agenta wymaga dodatkowo paczki (requireBatch).

export type UpdateActor = { userId: string; role: string };
export type UpdateResult = { ok: true; refreshedRentals: number; changed: number } | { ok: false; status: number; message: string };

export async function patchClient(id: string, body: Record<string, unknown>, actor: UpdateActor, opts: { requireBatch?: boolean } = {}): Promise<UpdateResult> {
  const isAgent = actor.role === "AGENT";
  const provenance = parseProvenance(body, { required: isAgent });
  if (!provenance.ok) return { ok: false, status: 400, message: provenance.message };
  if (opts.requireBatch && !provenance.value.batch) return { ok: false, status: 400, message: "Podaj paczkę zmiany (paczka, np. P-2026-09-27-01)." };

  const parsed = parseClientPatch(body);
  if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
  if (isAgent) {
    const denied = Object.keys(parsed.data).filter((k) => !(AGENT_CLIENT_FIELDS as readonly string[]).includes(k));
    if (denied.length) return { ok: false, status: 403, message: `Pole poza zakresem agenta: ${denied.join(", ")}.` };
  }
  const { deviceInterests, ...rest } = parsed.data;

  const current = await prisma.client.findUnique({ where: { id } });
  if (!current) return { ok: false, status: 404, message: "Nie znaleziono klienta." };
  const changes = changedFields(current as unknown as Record<string, unknown>, parsed.data);

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id },
      data: {
        ...rest,
        ...(deviceInterests ? { deviceInterests: deviceInterests.length ? deviceInterests : Prisma.DbNull } : {}),
      },
    });
    await recordChanges(tx, { userId: actor.userId, provenance: provenance.value }, fieldEntries("CLIENT", id, id, changes));
  });

  const touchesRentals = CLIENT_CACHE_KEYS.some((k) => k in parsed.data);
  const refreshedRentals = touchesRentals ? await refreshFutureRentalCaches({ clientId: id, clientFields: true }) : 0;
  return { ok: true, refreshedRentals, changed: changes.length };
}

export async function patchContact(
  clientId: string,
  contactId: string,
  body: Record<string, unknown>,
  actor: UpdateActor,
  opts: { requireBatch?: boolean } = {},
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

  await prisma.$transaction(async (tx) => {
    if (isPrimary) await tx.clientContact.updateMany({ where: { clientId }, data: { isPrimary: false } });
    await tx.clientContact.update({ where: { id: contactId }, data: { ...data, ...(isPrimary ? { isPrimary: true } : {}) } });
    await recordChanges(tx, { userId: actor.userId, provenance: provenance.value }, fieldEntries("CONTACT", contactId, clientId, changes));
  });

  const touchesRentals = CONTACT_CACHE_KEYS.some((k) => k in data);
  const refreshedRentals = touchesRentals ? await refreshFutureRentalCaches({ clientId, contactId }) : 0;
  return { ok: true, refreshedRentals, changed: changes.length };
}
