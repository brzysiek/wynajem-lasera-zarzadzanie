import { prisma } from "@/lib/prisma";
import { getMessageFull, type GmailMeta } from "@/lib/integrations/gmail-read";
import { htmlToText, type ClassifiedEmail, type MessageHeaders } from "@/lib/gmail/parse";
import { interestsFromText } from "@/lib/history/invoices";
import { CATEGORY_TO_INTEREST, DEVICE_INTEREST_LABEL, type DeviceInterestKey } from "@/lib/clients/labels";
import { createLead, LeadError } from "@/lib/leads/actions";
import { freeDatesFor } from "@/lib/leads/offer-draft";
import { FUNNEL_FROM } from "@/lib/leads/funnel";
import { recordChanges } from "@/lib/changelog/record";
import { logError, logInfo } from "@/lib/logger";
import {
  DEFAULT_CONFIG,
  decideNewPerson,
  displayName,
  extractNip,
  extractPhone,
  mergeConfig,
  rejectReason,
  rentalRequestWords,
  scoreText,
  type IntakeConfig,
} from "@/lib/leads/mail-intake-rules";
import type { DevicePricingCategory } from "@prisma/client";

// Mail przychodzący od nowej osoby → sygnał (wniosek 43, 09.10.2026). Źródło:
// skrzynka odbiorcza kontakt@ przez istniejącą synchronizację Gmaila (co 5 min).
// Filtr regułowy w panelu — bez API modelu, bez push, bez ŻADNYCH zmian w
// Gmailu (etykiety, archiwizacja). Zapisujemy tylko decyzję i powód; treść maila
// jest czytana w pamięci (telefon, NIP, punktacja) i nigdzie nie przechowywana.

const CONFIG_KEY = "mail_intake_config";
const RECENT_MS = 3 * 86_400_000; // starsze maile (backfill, wznowienie po przerwie) nie zakładają sygnałów
const SENDER_DEDUPE_MS = 30 * 86_400_000;
const OPEN = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"] as const;
const BODY_MAX = 20_000;

export class IntakeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function loadIntakeConfig(): Promise<IntakeConfig> {
  const row = await prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
  if (!row?.value) return DEFAULT_CONFIG;
  try {
    return mergeConfig(JSON.parse(row.value));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveIntakeConfig(raw: unknown): Promise<IntakeConfig> {
  const cfg = mergeConfig(raw);
  await prisma.setting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: JSON.stringify(cfg) }, update: { value: JSON.stringify(cfg) } });
  return cfg;
}

export type IntakeCandidate = { meta: GmailMeta; headers: MessageHeaders; from: string[]; to: string[]; cc: string[]; known: ClassifiedEmail | null };

async function bodyText(mailbox: string, id: string): Promise<string> {
  try {
    const full = await getMessageFull(mailbox, id);
    return (full.text ?? (full.html ? htmlToText(full.html) : "")).slice(0, BODY_MAX);
  } catch (err) {
    logError("mail_intake_body_failed", err, { id });
    return "";
  }
}

const noShkolenie = (d: DeviceInterestKey[]) => d.filter((x) => x !== "SZKOLENIE");

// Wywoływane z synchronizacji Gmaila dla wiadomości z ostatnich dni. Nie rzuca
// wyjątków (nie psuje synchronizacji historii).
export async function processMailIntake(
  mailbox: string,
  candidates: IntakeCandidate[],
  ctx: { isOwn: (a: string) => boolean; excluded: (a: string) => boolean },
): Promise<{ created: number; queued: number; rejected: number }> {
  const out = { created: 0, queued: 0, rejected: 0 };
  try {
    const now = Date.now();
    const fresh = candidates.filter(
      (c) =>
        c.meta.labelIds.includes("INBOX") &&
        now - c.meta.internalDate <= RECENT_MS &&
        c.from.length > 0 &&
        !c.from.some(ctx.isOwn) &&
        [...c.to, ...c.cc].some(ctx.isOwn),
    );
    if (!fresh.length) return out;
    const seen = new Set((await prisma.mailIntake.findMany({ where: { mailbox, gmailMessageId: { in: fresh.map((c) => c.meta.id) } }, select: { gmailMessageId: true } })).map((r) => r.gmailMessageId));
    const cfg = await loadIntakeConfig();
    for (const c of fresh) {
      if (seen.has(c.meta.id)) continue;
      try {
        const r = await processOne(mailbox, c, cfg, ctx);
        if (r) out[r]++;
      } catch (err) {
        logError("mail_intake_failed", err, { id: c.meta.id });
      }
    }
    if (out.created || out.queued || out.rejected) logInfo("mail_intake", out);
  } catch (err) {
    logError("mail_intake_run_failed", err);
  }
  return out;
}

async function store(mailbox: string, c: IntakeCandidate, data: { kind: "NEW_PERSON" | "KNOWN_CLIENT"; status: string; reason: string; score?: number; matched?: string[]; devices?: DeviceInterestKey[]; phone?: string | null; nip?: string | null; clientId?: string | null }) {
  const subject = c.headers["subject"]?.slice(0, 1000) ?? null;
  return prisma.mailIntake.create({
    data: {
      mailbox,
      gmailMessageId: c.meta.id,
      gmailThreadId: c.meta.threadId,
      rfcMessageId: c.headers["message-id"]?.slice(0, 500) ?? null,
      fromAddress: c.from[0],
      fromName: displayName(c.headers["from"]),
      subject,
      snippet: c.meta.snippet.slice(0, 300),
      receivedAt: new Date(c.meta.internalDate),
      kind: data.kind,
      status: data.status,
      reason: data.reason.slice(0, 160),
      score: data.score ?? 0,
      matched: data.matched?.length ? data.matched : undefined,
      devices: data.devices?.length ? data.devices : undefined,
      phone: data.phone ?? null,
      nip: data.nip ?? null,
      clientId: data.clientId ?? null,
    },
  });
}

async function processOne(mailbox: string, c: IntakeCandidate, cfg: IntakeConfig, ctx: { isOwn: (a: string) => boolean; excluded: (a: string) => boolean }): Promise<"created" | "queued" | "rejected" | null> {
  const from = c.from[0];
  // (a) oczywiste śmieci — zapis z powodem; maile automatyczne od klientek z bazy pomijamy po cichu.
  const reason = rejectReason({ from, headers: c.headers, labelIds: c.meta.labelIds, own: false, excluded: ctx.excluded(from), blockedDomains: cfg.blockedDomains });
  if (reason) {
    if (c.known) return null;
    await store(mailbox, c, { kind: "NEW_PERSON", status: "SMIEC", reason });
    return "rejected";
  }
  // Ten sam nadawca w ostatnich 30 dniach (kolejka, odrzucone, założony sygnał) — nie dublujemy.
  if (await prisma.mailIntake.count({ where: { fromAddress: from, status: { not: "SMIEC" }, createdAt: { gte: new Date(Date.now() - SENDER_DEDUPE_MS) } } })) return null;
  const subject = c.headers["subject"] ?? "";

  // (b) nadawca w bazie: historia jak dotąd; prośba o wynajem → „Do sprawdzenia”, o ile klientka nie ma otwartego sygnału.
  if (c.known) {
    if (c.known.direction !== "IN") return null;
    const words = rentalRequestWords(`${subject}\n${c.meta.snippet}`, cfg);
    if (!words.length) return null;
    if (await hasOpenLead(c.known.clientId)) return null;
    await store(mailbox, c, { kind: "KNOWN_CLIENT", status: "DO_SPRAWDZENIA", reason: `klientka z bazy prosi o wynajem (${words.slice(0, 4).join(", ")})`, matched: words, clientId: c.known.clientId });
    return "queued";
  }

  // (c) nowa osoba — punktacja z tematu, skrótu i treści (treści nie zapisujemy).
  const body = await bodyText(mailbox, c.meta.id);
  const text = `${subject}\n${c.meta.snippet}\n${body}`;
  const { score, matched } = scoreText(text, cfg);
  const phone = extractPhone(body || c.meta.snippet);
  const nip = extractNip(body || c.meta.snippet);
  const devices = noShkolenie(interestsFromText(text));

  // Twardy klucz (telefon / NIP) pasuje do klientki z bazy → jak (b), propozycja dopięcia.
  const keyClient = await findClientByKeys(phone, nip);
  if (keyClient) {
    if (await hasOpenLead(keyClient.id)) return null;
    await store(mailbox, c, { kind: "KNOWN_CLIENT", status: "DO_SPRAWDZENIA", reason: `telefon / NIP pasuje do klienta: ${keyClient.name}`, score, matched, devices, phone, nip, clientId: keyClient.id });
    return "queued";
  }

  const decision = decideNewPerson(score, cfg);
  if (decision === "ODRZUCONY") {
    await store(mailbox, c, { kind: "NEW_PERSON", status: "AUTO_ODRZUCONY", reason: `niska punktacja (${score})`, score, matched, devices, phone, nip });
    return "rejected";
  }
  const row = await store(mailbox, c, { kind: "NEW_PERSON", status: "DO_SPRAWDZENIA", reason: `punktacja ${score}`, score, matched, devices, phone, nip });
  if (decision === "SYGNAL_AUTO") {
    // Tryb automatyczny: wysoka punktacja zakłada sygnał od razu (wpis w dzienniku).
    await createLeadFromIntake(row.id, { userId: null, auto: true });
    return "created";
  }
  return "queued";
}

async function hasOpenLead(clientId: string): Promise<boolean> {
  return (await prisma.lead.count({ where: { clientId, archivedAt: null, stage: { in: [...OPEN] }, createdAt: { gte: FUNNEL_FROM } } })) > 0;
}

async function findClientByKeys(phone: string | null, nip: string | null): Promise<{ id: string; name: string } | null> {
  if (phone) {
    const c = await prisma.clientContact.findFirst({ where: { OR: [{ phone }, { phone2: phone }] }, select: { client: { select: { id: true, name: true } } } });
    if (c?.client) return c.client;
  }
  if (nip) {
    const c = await prisma.client.findFirst({ where: { nip, archivedAt: null }, select: { id: true, name: true } });
    if (c) return c;
  }
  return null;
}

// „Sygnał” w kolejce, „To jednak sygnał” przy odrzuconych, albo automat. Zakłada
// sygnał typu EMAIL (czas na kontakt liczony od maila), dopina mail do historii
// klientki i zapisuje decyzję. Idempotentne.
export async function createLeadFromIntake(id: string, actor: { userId: string | null; auto?: boolean }): Promise<{ leadId: string }> {
  const it = await prisma.mailIntake.findUnique({ where: { id } });
  if (!it) throw new IntakeError("Nie ma takiej pozycji.", 404);
  if (it.status === "SYGNAL" && it.leadId) return { leadId: it.leadId };
  const devices = (Array.isArray(it.devices) ? it.devices : []).filter((x): x is DeviceInterestKey => typeof x === "string");
  const message = [it.subject, it.snippet].filter(Boolean).join("\n").slice(0, 1500) || null;
  let leadId: string;
  try {
    leadId = await createLead(
      { type: "EMAIL", clientId: it.clientId, contactName: it.fromName, contactPhone: it.phone, contactEmail: it.fromAddress, deviceInterest: devices, requestedFrom: null, requestedDays: null, message, location: null, sourceRef: `gmail:${it.gmailMessageId}` },
      actor.userId,
      { source: actor.auto ? "AUTO_MAIL_IN" : undefined, createdAt: it.receivedAt },
    );
  } catch (err) {
    // Ten mail już ma sygnał (np. z naszej oferty) — podpinamy istniejący.
    const dup = err instanceof LeadError ? await prisma.lead.findFirst({ where: { sourceRef: `gmail:${it.gmailMessageId}`, archivedAt: null }, select: { id: true } }) : null;
    if (!dup) throw err instanceof LeadError ? new IntakeError(err.message, err.status) : err;
    leadId = dup.id;
  }
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clientId: true } });
  // Mail do historii klientki (jak maile z synchronizacji) — treści nie zapisujemy.
  if (lead?.clientId) {
    await prisma.emailMessage.createMany({
      data: [{ mailbox: it.mailbox, gmailMessageId: it.gmailMessageId, gmailThreadId: it.gmailThreadId, rfcMessageId: it.rfcMessageId, direction: "IN", fromAddress: it.fromAddress, toAddresses: [it.mailbox], subject: it.subject, snippet: it.snippet, hasAttachments: false, sentAt: it.receivedAt, clientId: lead.clientId, matchMethod: "EMAIL" }],
      skipDuplicates: true,
    });
  }
  await prisma.leadActivity.create({
    data: { leadId, clientId: lead?.clientId ?? null, type: "SYSTEM", body: `${actor.auto ? "auto · " : ""}Sygnał z maila${it.subject ? `: „${it.subject.slice(0, 120)}”` : ""} (od ${it.fromAddress})`, userId: actor.userId },
  });
  await prisma.mailIntake.update({ where: { id }, data: { status: "SYGNAL", leadId, decidedById: actor.userId, decidedAt: new Date() } });
  await recordChanges(prisma, { userId: actor.userId ?? "" }, [{ entity: "LEAD", entityId: leadId, clientId: lead?.clientId ?? null, operation: "CREATE", field: "z_maila", after: (it.subject ?? "(bez tematu)").slice(0, 120) }]);
  return { leadId };
}

// „+ sygnał z tego maila” z historii klientki / podglądu wątku (pkt 9): bierze
// zapisaną wiadomość (temat, skrót) i zakłada sygnał dla jej klientki. Jeśli ten
// mail jest już w kolejce — rozstrzyga tę pozycję.
export async function createLeadFromEmailMessage(emailMessageId: string, userId: string): Promise<{ leadId: string }> {
  const m = await prisma.emailMessage.findUnique({ where: { id: emailMessageId } });
  if (!m) throw new IntakeError("Nie ma takiej wiadomości.", 404);
  if (!m.clientId) throw new IntakeError("Ta wiadomość nie jest przypisana do klienta.", 400);
  const existing = await prisma.mailIntake.findUnique({ where: { mailbox_gmailMessageId: { mailbox: m.mailbox, gmailMessageId: m.gmailMessageId } }, select: { id: true } });
  const text = `${m.subject ?? ""}\n${m.snippet ?? ""}`;
  const row =
    existing ??
    (await prisma.mailIntake.create({
      data: {
        mailbox: m.mailbox,
        gmailMessageId: m.gmailMessageId,
        gmailThreadId: m.gmailThreadId,
        rfcMessageId: m.rfcMessageId,
        fromAddress: m.direction === "IN" ? m.fromAddress : (Array.isArray(m.toAddresses) ? String((m.toAddresses as unknown[])[0] ?? m.fromAddress) : m.fromAddress),
        subject: m.subject,
        snippet: m.snippet,
        receivedAt: m.sentAt,
        kind: "KNOWN_CLIENT",
        status: "DO_SPRAWDZENIA",
        reason: "ręcznie z historii klienta",
        devices: noShkolenie(interestsFromText(text)),
        clientId: m.clientId,
      },
    }));
  return createLeadFromIntake(row.id, { userId });
}

export async function rejectIntake(id: string, userId: string): Promise<void> {
  const it = await prisma.mailIntake.findUnique({ where: { id }, select: { status: true } });
  if (!it) throw new IntakeError("Nie ma takiej pozycji.", 404);
  if (it.status === "SYGNAL") throw new IntakeError("Z tej pozycji powstał już sygnał.", 409);
  await prisma.mailIntake.update({ where: { id }, data: { status: "ODRZUCONY_RECZNIE", decidedById: userId, decidedAt: new Date() } });
}

// Rekomendacja agenta (Klaudiusz) dla pozycji „Do sprawdzenia” — decyzję podejmuje człowiek.
export async function setRecommendation(id: string, rec: "SYGNAL" | "NIE", note: string | null): Promise<void> {
  const it = await prisma.mailIntake.findUnique({ where: { id }, select: { status: true } });
  if (!it) throw new IntakeError("Nie ma takiej pozycji.", 404);
  if (it.status !== "DO_SPRAWDZENIA") throw new IntakeError("Ta pozycja nie czeka już na decyzję.", 409);
  await prisma.mailIntake.update({ where: { id }, data: { recommendation: rec, recommendationNote: note?.trim().slice(0, 1000) || null, recommendedAt: new Date() } });
}

export type IntakeItem = {
  id: string;
  kind: string;
  status: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string;
  reason: string | null;
  score: number;
  matched: string[];
  devices: string[];
  phone: string | null;
  nip: string | null;
  clientId: string | null;
  clientName: string | null;
  recommendation: string | null;
  recommendationNote: string | null;
  gmailUrl: string;
  freeDates: string[];
};

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const d2 = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

async function toItems(rows: Awaited<ReturnType<typeof prisma.mailIntake.findMany>>, withFree: boolean): Promise<IntakeItem[]> {
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x))];
  const clients = clientIds.length ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, shortName: true } }) : [];
  const start = new Date(Date.now() + 86_400_000);
  const out: IntakeItem[] = [];
  for (const [i, r] of rows.entries()) {
    const devices = strs(r.devices);
    let freeDates: string[] = [];
    // Wolne terminy z kalendarza tylko dla pierwszych 15 pozycji (koszt zapytań).
    if (withFree && i < 15 && devices[0]) {
      const cats = Object.entries(CATEGORY_TO_INTEREST).filter(([, v]) => v === devices[0]).map(([k]) => k) as DevicePricingCategory[];
      if (cats.length) freeDates = (await freeDatesFor(cats, new Date(start.getFullYear(), start.getMonth(), start.getDate()), 1)).dates.map(d2);
    }
    const client = clients.find((c) => c.id === r.clientId);
    out.push({
      id: r.id,
      kind: r.kind,
      status: r.status,
      fromAddress: r.fromAddress,
      fromName: r.fromName,
      subject: r.subject,
      snippet: r.snippet,
      receivedAt: r.receivedAt.toISOString(),
      reason: r.reason,
      score: r.score,
      matched: strs(r.matched),
      devices: devices.map((d) => DEVICE_INTEREST_LABEL[d as DeviceInterestKey] ?? d),
      phone: r.phone,
      nip: r.nip,
      clientId: r.clientId,
      clientName: client ? (client.shortName ?? client.name) : null,
      recommendation: r.recommendation,
      recommendationNote: r.recommendationNote,
      gmailUrl: `https://mail.google.com/mail/u/${encodeURIComponent(r.mailbox)}/#inbox/${encodeURIComponent(r.gmailThreadId)}`,
      freeDates,
    });
  }
  return out;
}

// Kolejka „Do sprawdzenia” + odrzucone automatycznie z ostatnich 14 dni.
export async function listIntakes(): Promise<{ queue: IntakeItem[]; rejected: IntakeItem[]; mode: IntakeConfig["mode"] }> {
  const [queue, rejected, cfg] = await Promise.all([
    prisma.mailIntake.findMany({ where: { status: "DO_SPRAWDZENIA" }, orderBy: { receivedAt: "desc" }, take: 100 }),
    prisma.mailIntake.findMany({ where: { status: "AUTO_ODRZUCONY", createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } }, orderBy: { receivedAt: "desc" }, take: 100 }),
    loadIntakeConfig(),
  ]);
  return { queue: await toItems(queue, true), rejected: await toItems(rejected, false), mode: cfg.mode };
}

export async function countQueue(): Promise<number> {
  return prisma.mailIntake.count({ where: { status: "DO_SPRAWDZENIA" } });
}

// Porządki: śmieci 14 dni, odrzucone automatycznie 14 dni, reszta 90 dni.
export async function cleanupIntakes(now = new Date()): Promise<number> {
  const day = 86_400_000;
  const r1 = await prisma.mailIntake.deleteMany({ where: { status: { in: ["SMIEC", "AUTO_ODRZUCONY"] }, createdAt: { lt: new Date(now.getTime() - 14 * day) } } });
  const r2 = await prisma.mailIntake.deleteMany({ where: { status: { in: ["SYGNAL", "ODRZUCONY_RECZNIE"] }, createdAt: { lt: new Date(now.getTime() - 90 * day) } } });
  return r1.count + r2.count;
}
