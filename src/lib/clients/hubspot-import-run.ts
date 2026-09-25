import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { logInfo } from "@/lib/logger";
import { fetchAllHubspotCompanies, fetchAllHubspotContacts } from "@/lib/integrations/hubspot-crm";
import { planHubspotImport, type ImportReport, type PlannedClient } from "@/lib/clients/hubspot-import";

// Wykonanie importu klientów z HubSpota (CRM, etap 1B) — podgląd i zapis.
// ZASADA: panel dalej działa jak dotąd. Import pisze WYŁĄCZNIE do nowych
// tabel (clients, client_contacts) i do nowych kolumn rentals.clientId /
// clientContactId. Pola contact*Cache i hubspotContactId na wynajmach NIE
// są ruszane. Do HubSpota nic nie jest zapisywane (tylko odczyt).
//
// Idempotentny i wznawialny: klucze to hubspotCompanyId / hubspotContactId,
// więc powtórne uruchomienie tylko dokłada brakujące rekordy. Zapis idzie
// partiami (współdzielony hosting ma limity czasu pojedynczego zapytania) —
// UI woła runHubspotImportBatch w pętli, aż `remaining` = 0.

async function loadPlan() {
  const [contacts, companies] = await Promise.all([fetchAllHubspotContacts(), fetchAllHubspotCompanies()]);
  return planHubspotImport({ contacts, companies }, { normalizePhone: normalizePolishPhone });
}

// Które zaplanowane kontakty/firmy już są w bazie (z poprzedniego przebiegu).
async function loadExisting(clients: PlannedClient[]) {
  const contactIds = clients.flatMap((c) => c.contacts.map((p) => p.hubspotContactId));
  const companyIds = clients.map((c) => c.hubspotCompanyId).filter((id): id is string => Boolean(id));
  const [contacts, companies] = await Promise.all([
    prisma.clientContact.findMany({ where: { hubspotContactId: { in: contactIds } }, select: { hubspotContactId: true, clientId: true } }),
    prisma.client.findMany({ where: { hubspotCompanyId: { in: companyIds } }, select: { hubspotCompanyId: true, id: true } }),
  ]);
  return {
    clientIdByContact: new Map(contacts.map((c) => [c.hubspotContactId as string, c.clientId])),
    clientIdByCompany: new Map(companies.map((c) => [c.hubspotCompanyId as string, c.id])),
  };
}

function existingClientId(plan: PlannedClient, existing: Awaited<ReturnType<typeof loadExisting>>): string | null {
  if (plan.hubspotCompanyId) {
    const id = existing.clientIdByCompany.get(plan.hubspotCompanyId);
    if (id) return id;
  }
  for (const p of plan.contacts) {
    const id = existing.clientIdByContact.get(p.hubspotContactId);
    if (id) return id;
  }
  return null;
}

const isDone = (plan: PlannedClient, existing: Awaited<ReturnType<typeof loadExisting>>) =>
  plan.contacts.every((p) => existing.clientIdByContact.has(p.hubspotContactId));

export type RentalLinkPreview = {
  rentalsWithHubspot: number;
  willLink: number;
  alreadyLinked: number;
  orphans: { id: string; title: string; startsAt: string; contactName: string | null }[];
};

async function previewRentalLinks(plannedContactIds: Set<string>): Promise<RentalLinkPreview> {
  const rentals = await prisma.rental.findMany({
    where: { hubspotContactId: { not: null }, deletedInGoogle: false },
    select: { id: true, title: true, startsAt: true, hubspotContactId: true, clientId: true, contactNameCache: true },
    orderBy: { startsAt: "desc" },
  });
  const orphans = rentals.filter((r) => !plannedContactIds.has(r.hubspotContactId as string));
  return {
    rentalsWithHubspot: rentals.length,
    alreadyLinked: rentals.filter((r) => r.clientId).length,
    willLink: rentals.filter((r) => !r.clientId && plannedContactIds.has(r.hubspotContactId as string)).length,
    orphans: orphans.map((r) => ({
      id: r.id,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      contactName: r.contactNameCache,
    })),
  };
}

export type ImportPreview = {
  report: ImportReport;
  clientsToCreate: number;
  contactsToCreate: number;
  contactsIntoExistingClients: number;
  alreadyImportedContacts: number;
  rentals: RentalLinkPreview;
};

export async function previewHubspotImport(): Promise<ImportPreview> {
  const { clients, report } = await loadPlan();
  const existing = await loadExisting(clients);
  let clientsToCreate = 0;
  let contactsToCreate = 0;
  let contactsIntoExistingClients = 0;
  let alreadyImportedContacts = 0;
  for (const plan of clients) {
    const clientId = existingClientId(plan, existing);
    if (!clientId) clientsToCreate += 1;
    for (const p of plan.contacts) {
      if (existing.clientIdByContact.has(p.hubspotContactId)) alreadyImportedContacts += 1;
      else {
        contactsToCreate += 1;
        if (clientId) contactsIntoExistingClients += 1;
      }
    }
  }
  const plannedContactIds = new Set(clients.flatMap((c) => c.contacts.map((p) => p.hubspotContactId)));
  const rentals = await previewRentalLinks(plannedContactIds);
  return { report, clientsToCreate, contactsToCreate, contactsIntoExistingClients, alreadyImportedContacts, rentals };
}

async function writeClient(plan: PlannedClient, clientId: string | null) {
  await prisma.$transaction(async (tx) => {
    let id = clientId;
    let hasPrimary = false;
    if (!id) {
      const created = await tx.client.create({
        data: {
          name: plan.name,
          nip: plan.nip,
          street: plan.street,
          zip: plan.zip,
          city: plan.city,
          country: plan.country,
          transportPriceNet: plan.transportPriceNet,
          distanceKm: plan.distanceKm,
          deviceInterests: plan.deviceInterests.length ? plan.deviceInterests : undefined,
          statusOverride: plan.statusOverride,
          source: plan.source,
          legacyHubspotTag: plan.legacyHubspotTag,
          hubspotCompanyId: plan.hubspotCompanyId,
          hubspotSnapshot: plan.snapshot,
        },
      });
      id = created.id;
    } else {
      hasPrimary = (await tx.clientContact.count({ where: { clientId: id, isPrimary: true } })) > 0;
    }
    const already = new Set(
      (
        await tx.clientContact.findMany({
          where: { hubspotContactId: { in: plan.contacts.map((p) => p.hubspotContactId) } },
          select: { hubspotContactId: true },
        })
      ).map((c) => c.hubspotContactId),
    );
    for (const p of plan.contacts) {
      if (already.has(p.hubspotContactId)) continue;
      // Do istniejącego klienta osoba główna tylko, jeśli jej jeszcze nie ma
      // — nigdy dwie główne osoby na klienta.
      const isPrimary = clientId ? !hasPrimary && p.isPrimary : p.isPrimary;
      if (isPrimary) hasPrimary = true;
      await tx.clientContact.create({
        data: {
          clientId: id,
          firstName: p.firstName,
          lastName: p.lastName,
          phone: p.phone,
          email: p.email,
          isPrimary,
          hubspotContactId: p.hubspotContactId,
          hubspotSnapshot: p.snapshot,
        },
      });
    }
  });
}

export type RentalLinkResult = { linked: number; distancesSet: number; orphans: RentalLinkPreview["orphans"] };

// Po zapisaniu wszystkich klientów: podpięcie istniejących wynajmów przez
// hubspotContactId (tylko tych jeszcze niepodpiętych — idempotentne) i
// odległość klienta z najnowszego wynajmu, który ją ma (spec 5.2).
// Cache kontaktu na wynajmach NIE jest nadpisywany.
async function linkRentals(): Promise<RentalLinkResult> {
  const contacts = await prisma.clientContact.findMany({
    where: { hubspotContactId: { not: null } },
    select: { id: true, clientId: true, hubspotContactId: true },
  });
  let linked = 0;
  for (const c of contacts) {
    const res = await prisma.rental.updateMany({
      where: { hubspotContactId: c.hubspotContactId, clientId: null },
      data: { clientId: c.clientId, clientContactId: c.id },
    });
    linked += res.count;
  }

  const withDistance = await prisma.rental.findMany({
    where: { clientId: { not: null }, contactDistanceKm: { not: null }, deletedInGoogle: false },
    select: { clientId: true, contactDistanceKm: true },
    orderBy: { startsAt: "desc" },
  });
  const latestByClient = new Map<string, (typeof withDistance)[number]["contactDistanceKm"]>();
  for (const r of withDistance) if (!latestByClient.has(r.clientId as string)) latestByClient.set(r.clientId as string, r.contactDistanceKm);
  for (const [clientId, distanceKm] of latestByClient) {
    await prisma.client.update({ where: { id: clientId }, data: { distanceKm } });
  }

  const known = new Set(contacts.map((c) => c.hubspotContactId as string));
  const preview = await previewRentalLinks(known);
  return { linked, distancesSet: latestByClient.size, orphans: preview.orphans };
}

export type ImportBatchResult = {
  processed: number;
  remaining: number;
  totalClients: number;
  finished: boolean;
  rentals: RentalLinkResult | null;
};

export async function runHubspotImportBatch(batchSize = 40): Promise<ImportBatchResult> {
  const { clients } = await loadPlan();
  const existing = await loadExisting(clients);
  const pending = clients.filter((plan) => !isDone(plan, existing));
  const batch = pending.slice(0, batchSize);
  for (const plan of batch) await writeClient(plan, existingClientId(plan, existing));

  const remaining = pending.length - batch.length;
  const rentals = remaining === 0 ? await linkRentals() : null;
  logInfo("hubspot_import_batch", {
    processed: batch.length,
    remaining,
    totalClients: clients.length,
    linkedRentals: rentals?.linked ?? null,
  });
  return { processed: batch.length, remaining, totalClients: clients.length, finished: remaining === 0, rentals };
}
