import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { logWarn } from "@/lib/logger";
import {
  fetchAllDeals,
  fetchDealAssociationCounts,
  fetchDealNotes,
  fetchDefaultPipelineStageIds,
  findHubspotContactByEmail,
  type HsDeal,
  type HsNote,
} from "@/lib/integrations/hubspot-deals";
import {
  HUBSPOT_STAGE_TO_LEAD,
  leadTitle,
  noteHtmlToText,
  planLeadFromDeal,
  shouldImportDeal,
  type LeadStageKey,
  type LeadTypeKey,
  type PlannedLead,
} from "@/lib/leads/parse-deal";
import { applyImportRules } from "@/lib/leads/call-list";
import { qualifyClient } from "@/lib/clients/qualify";

// Transakcje HubSpot → Sygnały (CRM, prompt 2A). Z HubSpota wyłącznie
// odczyt. Ustalone 26.09.2026: po imporcie etap prowadzi PANEL — przy
// kolejnych pobraniach dochodzą tylko nowe transakcje i nowe notatki, a
// brakujące dane formularza są uzupełniane (nic nie jest nadpisywane).
// Import i cron to ta sama funkcja (syncDeals), partiami — współdzielony
// hosting ma limity czasu zapytania.

const CURSOR_KEY = "leads_hubspot_cursor";
// Moment wdrożenia listy „Do obdzwonienia” — zapisywany przy pierwszym
// przebiegu tej wersji. Na listę trafiają tylko zapytania sprzed niego.
const CALL_LIST_UNTIL_KEY = "leads_call_list_until";

async function callListUntil(): Promise<Date> {
  const row = await prisma.setting.findUnique({ where: { key: CALL_LIST_UNTIL_KEY } });
  if (row) return new Date(row.value);
  const now = new Date();
  await prisma.setting.create({ data: { key: CALL_LIST_UNTIL_KEY, value: now.toISOString() } });
  return now;
}

const ADVANCED: LeadStageKey[] = ["WYWIAD", "OFERTA", "REZERWACJA", "WYGRANA"];

// E-mail wysłany z naszej skrzynki do tej osoby po wpłynięciu zapytania
// (Gmail — prompt 3C; e-maile z HubSpota były zsynchronizowane do Gmaila).
async function repliedByEmail(clientId: string | null, since: Date): Promise<boolean> {
  if (!clientId) return false;
  return (await prisma.emailMessage.count({ where: { clientId, direction: "OUT", sentAt: { gte: since } } })) > 0;
}
const LAST_SYNC_KEY = "leads_hubspot_last_sync";

type ContactRef = { id: string; clientId: string; phone: string | null };

async function loadLinkContext() {
  const contacts = await prisma.clientContact.findMany({ select: { id: true, clientId: true, hubspotContactId: true, email: true, phone: true } });
  const byHs = new Map<string, ContactRef>();
  const byEmail = new Map<string, ContactRef>();
  const byPhone = new Map<string, ContactRef>();
  for (const c of contacts) {
    const ref = { id: c.id, clientId: c.clientId, phone: c.phone };
    if (c.hubspotContactId) byHs.set(c.hubspotContactId, ref);
    if (c.email) byEmail.set(c.email.trim().toLowerCase(), ref);
    if (c.phone) byPhone.set(c.phone, ref);
  }
  return { byHs, byEmail, byPhone };
}
type LinkContext = Awaited<ReturnType<typeof loadLinkContext>>;

type LinkMethod = "contact" | "email" | "phone" | "newClient" | "none";

// Powiązanie z klientem (prompt 2, 2.3): kontakt HubSpot → e-mail → telefon.
function findExisting(plan: PlannedLead, deal: HsDeal, ctx: LinkContext): { ref: ContactRef; method: LinkMethod } | null {
  for (const id of deal.contactIds) {
    const ref = ctx.byHs.get(id);
    if (ref) return { ref, method: "contact" };
  }
  if (plan.email) {
    const ref = ctx.byEmail.get(plan.email);
    if (ref) return { ref, method: "email" };
  }
  if (plan.phone) {
    const ref = ctx.byPhone.get(plan.phone);
    if (ref) return { ref, method: "phone" };
  }
  return null;
}

function linkMethod(plan: PlannedLead, deal: HsDeal, ctx: LinkContext): LinkMethod {
  const found = findExisting(plan, deal, ctx);
  if (found) return found.method;
  return plan.email || plan.phone ? "newClient" : "none";
}

function splitName(full: string | null): { firstName: string | null; lastName: string | null } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  const cap = (s: string) => (s === s.toLowerCase() || s === s.toUpperCase() ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
  return { firstName: cap(parts[0]), lastName: parts.length > 1 ? parts.slice(1).map(cap).join(" ") : null };
}

// Klient z sygnału, gdy e-maila/telefonu nie ma w bazie (decyzja użytkownika:
// tworzymy automatycznie). Kontakt HubSpot o tym e-mailu dostaje mapowanie,
// żeby późniejszy import klientów z HubSpota nie utworzył duplikatu.
async function createClientForLead(plan: PlannedLead, ctx: LinkContext): Promise<ContactRef> {
  let hs: Awaited<ReturnType<typeof findHubspotContactByEmail>> = null;
  if (plan.email) {
    try {
      hs = await findHubspotContactByEmail(plan.email);
    } catch (err) {
      logWarn("leads_hubspot_contact_lookup_failed", { message: err instanceof Error ? err.message : String(err) });
    }
  }
  if (hs && ctx.byHs.has(hs.id)) return ctx.byHs.get(hs.id)!;

  const person = plan.personName ? splitName(plan.personName) : { firstName: hs?.firstname ?? null, lastName: hs?.lastname ?? null };
  const personLabel = [person.firstName, person.lastName].filter(Boolean).join(" ");
  const phone = plan.phone ?? (hs?.phone ? normalizePolishPhone(hs.phone) : null);
  const created = await prisma.client.create({
    data: {
      name: personLabel || plan.email || plan.phone || "Nowy klient",
      source: plan.fromForm ? "FORMULARZ_WWW" : null,
      deviceInterests: plan.devices.length ? plan.devices : undefined,
      contacts: {
        create: { ...person, email: plan.email, phone, hubspotContactId: hs?.id ?? null, isPrimary: true },
      },
    },
    select: { id: true, contacts: { select: { id: true } } },
  });
  const ref = { id: created.contacts[0].id, clientId: created.id, phone };
  if (hs) ctx.byHs.set(hs.id, ref);
  if (plan.email) ctx.byEmail.set(plan.email, ref);
  if (phone) ctx.byPhone.set(phone, ref);
  return ref;
}

function snapshot(deal: HsDeal): Prisma.InputJsonValue {
  const p = deal.properties;
  return {
    dealname: p.dealname ?? null,
    dealstage: p.dealstage ?? null,
    description: p.description ?? null,
    telefon_z_szansy: p.telefon_z_szansy ?? null,
    closed_lost_reason: p.closed_lost_reason ?? null,
    hs_lastmodifieddate: p.hs_lastmodifieddate ?? null,
  };
}

function noteActivities(notes: HsNote[], leadId: string, clientId: string | null) {
  return notes
    .map((n) => ({ n, text: noteHtmlToText(n.body) }))
    .filter(({ text }) => text.length > 0)
    .map(({ n, text }) => ({
      leadId,
      clientId,
      type: "NOTE" as const,
      body: text,
      hubspotEngagementId: n.id,
      createdAt: n.timestamp ? new Date(n.timestamp) : new Date(),
    }));
}

const earliest = (notes: HsNote[]) => {
  const t = notes.map((n) => (n.timestamp ? new Date(n.timestamp).getTime() : NaN)).filter((x) => !Number.isNaN(x));
  return t.length ? new Date(Math.min(...t)) : null;
};

async function createLeadFromDeal(deal: HsDeal, notes: HsNote[], ctx: LinkContext, calls: number, until: Date) {
  const base = planLeadFromDeal(deal.properties, normalizePolishPhone);
  let ref = findExisting(base, deal, ctx)?.ref ?? null;
  if (!ref && (base.email || base.phone)) ref = await createClientForLead(base, ctx);
  // Telefon z formularza, którego brakuje osobie kontaktowej — uzupełniamy.
  if (ref && base.phone && !ref.phone) {
    await prisma.clientContact.update({ where: { id: ref.id }, data: { phone: base.phone } });
    ref.phone = base.phone;
  }
  const emailed = await repliedByEmail(ref?.clientId ?? null, base.createdAt);
  const plan = applyImportRules(base, {
    hsStage: deal.properties.dealstage ?? null,
    createdAt: base.createdAt,
    handled: notes.length > 0 || calls > 0 || emailed,
    callListUntil: until,
  });
  // Kontakt już był (HubSpot / Gmail) → klient zakwalifikowany (prompt 2 v2, 1.0).
  if (ref && (emailed || notes.length > 0 || calls > 0 || ADVANCED.includes(plan.stage))) {
    await qualifyClient(ref.clientId, emailed ? "EMAIL_REPLY" : "HUBSPOT");
  }
  const client = ref ? await prisma.client.findUnique({ where: { id: ref.clientId }, select: { name: true } }) : null;
  const title = plan.fromForm && client ? leadTitle({ who: client.name, devices: plan.devices, days: plan.requestedDays, fallback: plan.title }) : plan.title;
  const firstNote = earliest(notes);

  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        hubspotDealId: deal.id,
        hubspotSnapshot: snapshot(deal),
        clientId: ref?.clientId ?? null,
        clientContactId: ref?.id ?? null,
        title,
        type: plan.type,
        stage: plan.stage,
        stageChangedAt: plan.stageChangedAt,
        deviceInterest: plan.devices.length ? plan.devices : undefined,
        requestedFrom: plan.requestedFrom,
        requestedDays: plan.requestedDays,
        message: plan.message,
        contactName: plan.personName,
        contactPhone: plan.phone,
        contactEmail: plan.email,
        firstContactAt: firstNote,
        lostReason: plan.lostReason,
        lostNote: plan.lostNote,
        callList: plan.callList,
        createdAt: plan.createdAt,
      },
      select: { id: true },
    });
    await tx.leadActivity.createMany({
      data: [
        {
          leadId: lead.id,
          clientId: ref?.clientId ?? null,
          type: "SYSTEM",
          body: plan.fromForm ? "Sygnał z formularza WWW (przez HubSpot)" : "Zaimportowano z HubSpota",
          createdAt: plan.createdAt,
        },
        ...noteActivities(notes, lead.id, ref?.clientId ?? null),
      ],
      skipDuplicates: true,
    });
  });
}

export type DealsSyncResult = {
  created: number;
  remaining: number;
  notesAdded: number;
  refreshed: number;
  notesError: string | null;
  callsError?: string | null;
  reclassified?: number;
};

export async function syncDeals(opts: { maxNew?: number; reclassify?: boolean } = {}): Promise<DealsSyncResult> {
  const maxNew = opts.maxNew ?? 25;
  const until = await callListUntil();
  const deals = (await fetchAllDeals()).filter((d) => shouldImportDeal(d.properties));
  const existing = await prisma.lead.findMany({
    where: { hubspotDealId: { not: null } },
    select: { id: true, hubspotDealId: true, clientId: true, firstContactAt: true, contactPhone: true, message: true, requestedFrom: true, requestedDays: true },
  });
  const byDeal = new Map(existing.map((l) => [l.hubspotDealId as string, l]));
  const cursorRow = await prisma.setting.findUnique({ where: { key: CURSOR_KEY } });
  const cursor = cursorRow ? new Date(cursorRow.value) : null;

  const fresh = deals
    .filter((d) => !byDeal.has(d.id))
    .sort((a, b) => (a.properties.createdate ?? "").localeCompare(b.properties.createdate ?? ""));
  const batch = fresh.slice(0, maxNew);
  const changed = deals.filter((d) => {
    if (!byDeal.has(d.id)) return false;
    const m = d.properties.hs_lastmodifieddate ? new Date(d.properties.hs_lastmodifieddate) : null;
    return !cursor || !m || m > cursor;
  });

  let notes = new Map<string, HsNote[]>();
  let notesError: string | null = null;
  try {
    notes = await fetchDealNotes([...batch, ...changed].map((d) => d.id));
  } catch (err) {
    // Brak zakresu do notatek nie blokuje sygnałów — tylko historia z HubSpota.
    notesError = err instanceof Error ? err.message : String(err);
    logWarn("leads_hubspot_notes_failed", { message: notesError });
  }

  let calls = new Map<string, number>();
  let callsError: string | null = null;
  if (batch.length) {
    try {
      calls = await fetchDealAssociationCounts(batch.map((d) => d.id), "calls");
    } catch (err) {
      callsError = err instanceof Error ? err.message : String(err);
      logWarn("leads_hubspot_calls_failed", { message: callsError });
    }
  }

  const ctx = await loadLinkContext();
  let created = 0;
  for (const deal of batch) {
    await createLeadFromDeal(deal, notes.get(deal.id) ?? [], ctx, calls.get(deal.id) ?? 0, until);
    created++;
  }

  // Istniejące sygnały: nowe notatki + uzupełnienie pustych pól formularza.
  let notesAdded = 0;
  let refreshed = 0;
  for (const deal of changed) {
    const lead = byDeal.get(deal.id)!;
    const dealNotes = notes.get(deal.id) ?? [];
    if (dealNotes.length) {
      const res = await prisma.leadActivity.createMany({ data: noteActivities(dealNotes, lead.id, lead.clientId), skipDuplicates: true });
      notesAdded += res.count;
    }
    const plan = planLeadFromDeal(deal.properties, normalizePolishPhone);
    const fill: Prisma.LeadUpdateInput = { hubspotSnapshot: snapshot(deal) };
    if (!lead.contactPhone && plan.phone) fill.contactPhone = plan.phone;
    if (!lead.message && plan.message) fill.message = plan.message;
    if (!lead.requestedFrom && plan.requestedFrom) fill.requestedFrom = plan.requestedFrom;
    if (!lead.requestedDays && plan.requestedDays) fill.requestedDays = plan.requestedDays;
    const first = earliest(dealNotes);
    if (!lead.firstContactAt && first) fill.firstContactAt = first;
    await prisma.lead.update({ where: { id: lead.id }, data: fill });
    refreshed++;
  }

  const remaining = fresh.length - batch.length;
  const now = new Date();
  if (remaining === 0) {
    // Kursor z 2-minutowym zapasem — zegar HubSpota i nasz nie muszą być zgodne.
    const next = new Date(now.getTime() - 2 * 60_000).toISOString();
    await prisma.setting.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value: next }, update: { value: next } });
  }
  await prisma.setting.upsert({
    where: { key: LAST_SYNC_KEY },
    create: { key: LAST_SYNC_KEY, value: now.toISOString() },
    update: { value: now.toISOString() },
  });
  const reclassified = opts.reclassify && remaining === 0 ? await reclassifyImportedLeads(until) : 0;
  return { created, remaining, notesAdded, refreshed, notesError, callsError, reclassified };
}

// Sygnały już zaimportowane (np. dociągnięte przez crona przed wdrożeniem
// listy) przeliczane wg nowych reguł — tylko te, na których nikt z biura
// jeszcze nie pracował (brak aktywności z autorem i prowadzącej osoby).
export async function reclassifyImportedLeads(until: Date): Promise<number> {
  const leads = await prisma.lead.findMany({
    where: { hubspotDealId: { not: null }, ownerId: null, activities: { none: { userId: { not: null } } } },
    select: {
      id: true,
      clientId: true,
      createdAt: true,
      stage: true,
      callList: true,
      lostReason: true,
      lostNote: true,
      hubspotDealId: true,
      hubspotSnapshot: true,
      _count: { select: { activities: { where: { hubspotEngagementId: { not: null } } } } },
    },
  });
  let calls = new Map<string, number>();
  try {
    calls = await fetchDealAssociationCounts(leads.map((l) => l.hubspotDealId as string), "calls");
  } catch {
    // brak zakresu do rozmów — opieramy się na notatkach i Gmailu
  }
  let changed = 0;
  for (const l of leads) {
    const snap = (l.hubspotSnapshot ?? {}) as Record<string, string | null>;
    const base = planLeadFromDeal({ ...snap, createdate: l.createdAt.toISOString() }, normalizePolishPhone);
    const emailed = await repliedByEmail(l.clientId, l.createdAt);
    const next = applyImportRules(base, {
      hsStage: snap.dealstage ?? null,
      createdAt: l.createdAt,
      handled: l._count.activities > 0 || (calls.get(l.hubspotDealId as string) ?? 0) > 0 || emailed,
      callListUntil: until,
    });
    if (l.clientId && (emailed || l._count.activities > 0 || ADVANCED.includes(next.stage))) {
      await qualifyClient(l.clientId, emailed ? "EMAIL_REPLY" : "HUBSPOT");
    }
    if (next.stage === l.stage && next.callList === l.callList && next.lostReason === l.lostReason) continue;
    await prisma.lead.update({
      where: { id: l.id },
      data: {
        stage: next.stage,
        callList: next.callList,
        lostReason: next.lostReason,
        lostNote: next.lostNote,
        ...(next.stage !== l.stage ? { stageChangedAt: new Date() } : {}),
      },
    });
    changed++;
  }
  return changed;
}

export async function lastDealsSync(): Promise<string | null> {
  return (await prisma.setting.findUnique({ where: { key: LAST_SYNC_KEY } }))?.value ?? null;
}

export type DealsImportPreview = {
  dealsTotal: number;
  importable: number;
  alreadyImported: number;
  toImport: number;
  skipped: number; // archiwum sprzed 09.2025 w „Sygnale” i inne lejki
  byType: Partial<Record<LeadTypeKey, number>>;
  byStage: Partial<Record<LeadStageKey, number>>;
  link: Record<LinkMethod, number>;
  missingStages: string[]; // etapy z mapowania, których nie ma w HubSpocie
  callList: number; // trafi do „Do obdzwonienia”
  archive: number; // nieobsłużone sprzed 2026 → przegrana „Archiwum”
  callsReadable: boolean; // czy rozmowy z HubSpota dało się odczytać
  reclassifyExisting: number; // sygnały już w panelu, które zostaną przeliczone
  sample: { title: string; type: LeadTypeKey; stage: LeadStageKey; createdAt: string; phone: boolean }[];
};

export async function previewDealsImport(): Promise<DealsImportPreview> {
  const [all, stages, existing, ctx] = await Promise.all([
    fetchAllDeals(),
    fetchDefaultPipelineStageIds(),
    prisma.lead.findMany({ where: { hubspotDealId: { not: null } }, select: { hubspotDealId: true } }),
    loadLinkContext(),
  ]);
  const importable = all.filter((d) => shouldImportDeal(d.properties));
  const done = new Set(existing.map((e) => e.hubspotDealId));
  const todo = importable.filter((d) => !done.has(d.id));
  const byType: DealsImportPreview["byType"] = {};
  const byStage: DealsImportPreview["byStage"] = {};
  const link: Record<LinkMethod, number> = { contact: 0, email: 0, phone: 0, newClient: 0, none: 0 };
  const until = await callListUntil();
  const ids = todo.map((d) => d.id);
  const noteCounts = ids.length ? await fetchDealAssociationCounts(ids, "notes").catch(() => new Map<string, number>()) : new Map<string, number>();
  let callCounts = new Map<string, number>();
  let callsReadable = true;
  if (ids.length) {
    try {
      callCounts = await fetchDealAssociationCounts(ids, "calls");
    } catch {
      callsReadable = false;
    }
  }
  let callList = 0;
  let archive = 0;
  const plans = [];
  for (const d of todo) {
    const base = planLeadFromDeal(d.properties, normalizePolishPhone);
    const found = findExisting(base, d, ctx);
    const emailed = await repliedByEmail(found?.ref.clientId ?? null, base.createdAt);
    const p = applyImportRules(base, {
      hsStage: d.properties.dealstage ?? null,
      createdAt: base.createdAt,
      handled: (noteCounts.get(d.id) ?? 0) > 0 || (callCounts.get(d.id) ?? 0) > 0 || emailed,
      callListUntil: until,
    });
    if (p.callList) callList++;
    if (p.lostReason === "ARCHIWUM_IMPORTU") archive++;
    byType[p.type] = (byType[p.type] ?? 0) + 1;
    byStage[p.stage] = (byStage[p.stage] ?? 0) + 1;
    link[linkMethod(base, d, ctx)]++;
    plans.push({ d, p });
  }
  const reclassifyExisting = await prisma.lead.count({
    where: { hubspotDealId: { not: null }, ownerId: null, activities: { none: { userId: { not: null } } } },
  });
  const stageIds = new Set(stages.map((s) => s.id));
  return {
    dealsTotal: all.length,
    importable: importable.length,
    alreadyImported: importable.length - todo.length,
    toImport: todo.length,
    skipped: all.length - importable.length,
    byType,
    byStage,
    link,
    missingStages: Object.keys(HUBSPOT_STAGE_TO_LEAD).filter((id) => !stageIds.has(id)),
    callList,
    archive,
    callsReadable,
    reclassifyExisting,
    sample: plans
      .sort((a, b) => b.p.createdAt.getTime() - a.p.createdAt.getTime())
      .slice(0, 8)
      .map(({ p }) => ({ title: p.title, type: p.type, stage: p.stage, createdAt: p.createdAt.toISOString(), phone: Boolean(p.phone) })),
  };
}
