import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { refreshFutureRentalCaches } from "@/lib/clients/refresh";
import { changedFields, toLogValue } from "@/lib/changelog/diff";
import { parseProvenance } from "@/lib/changelog/provenance";
import { fieldEntries, recordChanges, type ChangeEntry } from "@/lib/changelog/record";

// Scalanie duplikatów: wszystko z klienta „źródłowego” przechodzi na
// docelowego (osoby, wynajmy, historia, faktury, sygnały, notatki, zadania,
// SMS-y, e-maile, uwagi, aliasy, powiązania wniosków), puste pola docelowego
// uzupełniają się ze źródłowego, a źródłowy trafia do archiwum z powodem
// „duplikat” (nie jest usuwany). W HubSpocie nic się nie zmienia.
// Dziennik: MERGE (co przeniesiono) + zmiany pól docelowego + ARCHIVE.

export type MergeResult = { ok: true; moved: Record<string, number> } | { ok: false; status: number; message: string };

const FILL_FIELDS = ["nip", "clinicType", "source", "transportPriceNet", "distanceKm", "legacyHubspotTag"] as const;
const ADDRESS_FIELDS = ["street", "zip", "city", "country"] as const;

export async function mergeClients(
  targetId: string,
  sourceId: string,
  body: Record<string, unknown>,
  actor: { userId: string; role: string },
  opts: { approvedById?: string | null } = {},
): Promise<MergeResult> {
  if (!sourceId || sourceId === targetId) return { ok: false, status: 400, message: "Wskaż innego klienta do scalenia." };
  const provenance = parseProvenance(body, { required: actor.role === "AGENT" });
  if (!provenance.ok) return { ok: false, status: 400, message: provenance.message };

  const [target, source] = await Promise.all([prisma.client.findUnique({ where: { id: targetId } }), prisma.client.findUnique({ where: { id: sourceId } })]);
  if (!target || !source) return { ok: false, status: 404, message: "Nie znaleziono klienta." };
  if (target.archivedAt) return { ok: false, status: 409, message: "Klient docelowy jest w archiwum." };
  if (source.archivedAt) return { ok: false, status: 409, message: "Klient scalany jest już w archiwum." };

  // Uzupełnienie pustych pól docelowego (adres tylko w całości).
  const fill: Record<string, unknown> = {};
  for (const k of FILL_FIELDS) if (target[k] == null && source[k] != null) fill[k] = source[k];
  if (!target.street && !target.city && (source.street || source.city)) for (const k of ADDRESS_FIELDS) fill[k] = source[k];
  const interests = [...new Set([...(Array.isArray(target.deviceInterests) ? target.deviceInterests : []), ...(Array.isArray(source.deviceInterests) ? source.deviceInterests : [])])];
  if (interests.length !== (Array.isArray(target.deviceInterests) ? target.deviceInterests.length : 0)) fill.deviceInterests = interests;
  if (source.notes && source.notes !== target.notes) fill.notes = [target.notes, source.notes].filter(Boolean).join("\n\n");
  if (!target.qualifiedAt && source.qualifiedAt) {
    fill.qualifiedAt = source.qualifiedAt;
    fill.qualifiedReason = source.qualifiedReason;
  }
  if (!target.statusOverride && source.statusOverride) fill.statusOverride = source.statusOverride;
  const changes = changedFields(target as unknown as Record<string, unknown>, fill);

  const moved: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    const where = { clientId: sourceId };
    const data = { clientId: targetId };
    // Osoba główna zostaje u docelowego; gdy docelowy nie ma osób — przejmuje główną źródłowego.
    const targetHasContacts = (await tx.clientContact.count({ where: { clientId: targetId } })) > 0;
    moved.osoby = (await tx.clientContact.updateMany({ where, data: targetHasContacts ? { ...data, isPrimary: false } : data })).count;
    moved.wynajmy = (await tx.rental.updateMany({ where, data })).count;
    moved.historia = (await tx.rentalHistory.updateMany({ where, data })).count;
    moved.faktury = (await tx.clientInvoice.updateMany({ where, data })).count;
    moved.sygnaly = (await tx.lead.updateMany({ where, data })).count;
    moved.notatki = (await tx.leadActivity.updateMany({ where, data })).count;
    moved.zadania = (await tx.task.updateMany({ where, data })).count;
    moved.sms = (await tx.message.updateMany({ where, data })).count;
    moved.emaile = (await tx.emailMessage.updateMany({ where, data })).count;
    moved.uwagi = (await tx.remark.updateMany({ where, data })).count;
    moved.aliasy = (await tx.clientAlias.updateMany({ where, data })).count;
    const links = await tx.proposalClient.findMany({ where: { clientId: sourceId }, select: { proposalId: true } });
    for (const l of links) {
      await tx.proposalClient.upsert({ where: { proposalId_clientId: { proposalId: l.proposalId, clientId: targetId } }, create: { proposalId: l.proposalId, clientId: targetId }, update: {} });
    }
    await tx.proposalClient.deleteMany({ where: { clientId: sourceId } });

    // hubspotCompanyId jest unikalny — przenosimy tylko, gdy docelowy nie ma.
    const companyId = !target.hubspotCompanyId && source.hubspotCompanyId ? source.hubspotCompanyId : null;
    await tx.client.update({
      where: { id: sourceId },
      data: {
        archivedAt: new Date(),
        archiveReason: "DUPLIKAT",
        archiveNote: `Scalono do: ${target.name} (${targetId})`,
        archivedById: actor.userId,
        archiveBatch: provenance.value.batch,
        ...(companyId ? { hubspotCompanyId: null } : {}),
      },
    });
    const { deviceInterests, ...rest } = fill;
    await tx.client.update({
      where: { id: targetId },
      data: {
        ...(rest as Prisma.ClientUpdateInput),
        ...(deviceInterests ? { deviceInterests: deviceInterests as Prisma.InputJsonValue } : {}),
        ...(companyId ? { hubspotCompanyId: companyId } : {}),
      },
    });

    const entries: ChangeEntry[] = [
      {
        entity: "CLIENT",
        entityId: targetId,
        clientId: targetId,
        operation: "MERGE",
        field: null,
        before: toLogValue({ scalony: { id: source.id, nazwa: source.name, nip: source.nip, miasto: source.city } }),
        after: toLogValue({ przeniesiono: moved }),
      },
      ...fieldEntries("CLIENT", targetId, targetId, changes),
      { entity: "CLIENT", entityId: sourceId, clientId: sourceId, operation: "ARCHIVE", before: "null", after: toLogValue({ reason: "DUPLIKAT", note: `Scalono do: ${target.name}` }) },
    ];
    await recordChanges(tx, { userId: actor.userId, provenance: provenance.value, approvedById: opts.approvedById }, entries);
  });

  // Przeniesione wynajmy: przyszłe dostają dane klienta docelowego.
  if (moved.wynajmy) await refreshFutureRentalCaches({ clientId: targetId, clientFields: true });
  return { ok: true, moved };
}
