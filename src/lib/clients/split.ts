import { prisma } from "@/lib/prisma";
import { refreshFutureRentalCaches } from "@/lib/clients/refresh";
import { toLogValue } from "@/lib/changelog/diff";
import { parseProvenance } from "@/lib/changelog/provenance";
import { recordChanges } from "@/lib/changelog/record";
import { decideHistoryLogged } from "@/lib/history/decide-logged";
import type { SplitInput } from "@/lib/clients/split-rules";

// „Wydziel do nowego klienta” (wniosek W-0002): z klienta-zlepka wybrane
// osoby przechodzą do nowego klienta razem ze swoimi wynajmami (po osobie
// kontaktowej), sygnałami (po osobie albo jej e-mailu / telefonie) z osią
// czasu i zadaniami, e-mailami i SMS-ami. Opcjonalnie faktury po NIP-ie
// nabywcy i grupy z dopasowań. Wszystko w jednej transakcji, dziennik:
// SPLIT na obu klientach. HubSpot bez zmian.

export type SplitMoved = Record<string, number>;
export type SplitResult = { ok: true; newClientId: string; moved: SplitMoved } | { ok: false; status: number; message: string };

// Co przejdzie z wybranymi osobami — podgląd przed wydzieleniem.
export async function previewSplit(sourceId: string, contactIds: string[]) {
  const contacts = await prisma.clientContact.findMany({ where: { clientId: sourceId, id: { in: contactIds } }, select: { id: true, email: true, phone: true, phone2: true } });
  const ids = contacts.map((c) => c.id);
  const emails = contacts.map((c) => c.email?.toLowerCase()).filter((x): x is string => !!x);
  const phones = contacts.flatMap((c) => [c.phone, c.phone2]).filter((x): x is string => !!x);
  const leadWhere = {
    clientId: sourceId,
    OR: [{ clientContactId: { in: ids } }, ...(emails.length ? [{ contactEmail: { in: emails } }] : []), ...(phones.length ? [{ contactPhone: { in: phones } }] : [])],
  };
  const [rentals, leads, emailsCount, sms, invoices] = await Promise.all([
    prisma.rental.count({ where: { clientId: sourceId, clientContactId: { in: ids } } }),
    ids.length ? prisma.lead.count({ where: leadWhere }) : 0,
    prisma.emailMessage.count({ where: { clientId: sourceId, clientContactId: { in: ids } } }),
    phones.length ? prisma.message.count({ where: { clientId: sourceId, recipient: { in: phones } } }) : 0,
    prisma.clientInvoice.groupBy({ by: ["buyerTaxNo", "buyerName"], where: { clientId: sourceId }, _count: { _all: true } }),
  ]);
  return {
    rentals,
    leads,
    emails: emailsCount,
    sms,
    invoicesByNip: invoices.filter((i) => i.buyerTaxNo).map((i) => ({ nip: i.buyerTaxNo!, buyerName: i.buyerName, count: i._count._all })),
  };
}

export async function splitClient(
  sourceId: string,
  input: SplitInput,
  body: Record<string, unknown>,
  actor: { userId: string; role: string },
  opts: { approvedById?: string | null } = {},
): Promise<SplitResult> {
  const provenance = parseProvenance(body, { required: actor.role === "AGENT" });
  if (!provenance.ok) return { ok: false, status: 400, message: provenance.message };

  const source = await prisma.client.findUnique({ where: { id: sourceId }, include: { contacts: { select: { id: true, email: true, phone: true, phone2: true, isPrimary: true, createdAt: true } } } });
  if (!source) return { ok: false, status: 404, message: "Nie znaleziono klienta." };
  if (source.archivedAt) return { ok: false, status: 409, message: "Klient jest w archiwum." };
  const moving = source.contacts.filter((c) => input.contactIds.includes(c.id));
  if (moving.length !== input.contactIds.length) return { ok: false, status: 400, message: "Część wskazanych osób nie należy do tego klienta." };
  const staying = source.contacts.filter((c) => !input.contactIds.includes(c.id));
  if (!staying.length) return { ok: false, status: 400, message: "Przy kliencie musi zostać co najmniej jedna osoba — przy wszystkich zmień po prostu dane klienta." };

  const ids = moving.map((c) => c.id);
  const emails = moving.map((c) => c.email?.toLowerCase()).filter((x): x is string => !!x);
  const phones = moving.flatMap((c) => [c.phone, c.phone2]).filter((x): x is string => !!x);
  const moved: SplitMoved = {};

  const newClientId = await prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: {
        name: input.name,
        nip: input.nip,
        street: input.street,
        zip: input.zip,
        city: input.city,
        country: "Polska",
        // Bez source / legacyHubspotTag ze zlepka — to cechy rekordu
        // źródłowego (np. FORMULARZ_WWW „Joanny Bakalarz”), nie nowego klienta.
        source: null,
        // Wydzielany z klienta — jest klientem, nie kontaktem z zapytania.
        ...(source.qualifiedAt ? { qualifiedAt: new Date(), qualifiedReason: "MANUAL" } : {}),
      },
    });
    const to = { clientId: created.id };

    moved.osoby = (await tx.clientContact.updateMany({ where: { id: { in: ids } }, data: { ...to, isPrimary: false } })).count;
    await tx.clientContact.update({ where: { id: moving.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0].id }, data: { isPrimary: true } });
    if (moving.some((c) => c.isPrimary) || !staying.some((c) => c.isPrimary)) {
      await tx.clientContact.updateMany({ where: { clientId: sourceId }, data: { isPrimary: false } });
      await tx.clientContact.update({ where: { id: staying.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0].id }, data: { isPrimary: true } });
    }

    moved.wynajmy = (await tx.rental.updateMany({ where: { clientId: sourceId, clientContactId: { in: ids } }, data: to })).count;

    const leads = await tx.lead.findMany({
      where: {
        clientId: sourceId,
        OR: [{ clientContactId: { in: ids } }, ...(emails.length ? [{ contactEmail: { in: emails } }] : []), ...(phones.length ? [{ contactPhone: { in: phones } }] : [])],
      },
      select: { id: true },
    });
    const leadIds = leads.map((l) => l.id);
    if (leadIds.length) {
      moved.sygnaly = (await tx.lead.updateMany({ where: { id: { in: leadIds } }, data: to })).count;
      moved.notatki = (await tx.leadActivity.updateMany({ where: { leadId: { in: leadIds } }, data: to })).count;
      moved.zadania = (await tx.task.updateMany({ where: { leadId: { in: leadIds } }, data: to })).count;
    }
    moved.emaile = (await tx.emailMessage.updateMany({ where: { clientId: sourceId, clientContactId: { in: ids } }, data: to })).count;
    if (phones.length) moved.sms = (await tx.message.updateMany({ where: { clientId: sourceId, recipient: { in: phones } }, data: to })).count;
    // Faktury z NIP-em nabywcy nowego klienta: ze zlepka oraz jeszcze
    // nieprzypisane / podpowiedziane (decyzji biura u innych klientów nie ruszamy).
    if (input.invoiceNip) {
      moved.faktury = (
        await tx.clientInvoice.updateMany({
          where: {
            buyerTaxNo: input.invoiceNip,
            OR: [{ clientId: sourceId }, { matchedByUserId: null, matchState: { in: ["UNMATCHED", "SUGGESTED"] } }],
          },
          data: { ...to, matchState: "CONFIRMED", matchMethod: "MANUAL", matchScore: 1, matchedByUserId: actor.userId },
        })
      ).count;
    }

    const trace = { z: { id: source.id, nazwa: source.name } };
    await recordChanges(tx, { userId: actor.userId, provenance: provenance.value, approvedById: opts.approvedById }, [
      { entity: "CLIENT", entityId: created.id, clientId: created.id, operation: "SPLIT", before: toLogValue(trace), after: toLogValue({ nazwa: input.name, przeniesiono: moved }) },
      { entity: "CLIENT", entityId: sourceId, clientId: sourceId, operation: "SPLIT", before: toLogValue({ osoby: source.contacts.length }), after: toLogValue({ wydzielono: { id: created.id, nazwa: input.name }, przeniesiono: moved }) },
    ]);
    return created.id;
  });

  // Grupy z dopasowań — przypisanie tworzy aliasy (kolejne wydarzenia same).
  if (input.historyKeys.length) {
    const r = await decideHistoryLogged({ action: "assign", keys: input.historyKeys, clientId: newClientId }, actor.userId, { approvedById: opts.approvedById });
    moved.historia = r.events;
  }
  await refreshFutureRentalCaches({ clientId: newClientId, clientFields: true });
  return { ok: true, newClientId, moved };
}
