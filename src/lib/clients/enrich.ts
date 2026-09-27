import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { changedFields } from "@/lib/changelog/diff";
import { fieldEntries, recordChanges } from "@/lib/changelog/record";
import { isLocked, readFieldMeta, stampFieldMeta } from "@/lib/clients/profile-fields";
import { parseCeidg, parseWhiteList, planEnrichment, type RegistryFields } from "@/lib/integrations/registry-parse";
import { logInfo, logWarn } from "@/lib/logger";

// Uzupełnianie danych klienta po NIP (sekcja 5): Biała lista MF (publiczne
// API, bez klucza) i CEIDG (token CEIDG_API_TOKEN w .env — ustawia
// użytkownik). Przy zmianie NIP, z przycisku na karcie i co miesiąc (cron
// historii, porcjami). Pola zmienione ręcznie (lockedManual) zostają;
// nazwa i adres tylko, gdy puste. Źródło w pochodzeniu pola: bialalista /
// ceidg; wpis w dzienniku.

const TIMEOUT_MS = 8000;
const WL_URL = "https://wl-api.mf.gov.pl/api/search/nip";
const CEIDG_URL = "https://dane.biznes.gov.pl/api/ceidg/v2/firma";

const today = () => new Date().toISOString().slice(0, 10);

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

export async function fetchWhiteList(nip: string): Promise<RegistryFields | null> {
  const r = await fetchJson(`${WL_URL}/${nip}?date=${today()}`);
  if (!r.ok) throw new Error(`Biała lista: HTTP ${r.status}`);
  return parseWhiteList(r.body);
}

export async function fetchCeidg(nip: string): Promise<RegistryFields | null> {
  const token = process.env.CEIDG_API_TOKEN;
  if (!token) return null;
  const r = await fetchJson(`${CEIDG_URL}?nip=${nip}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (r.status === 404 || r.status === 204) return null;
  if (!r.ok) throw new Error(`CEIDG: HTTP ${r.status}`);
  return parseCeidg(r.body);
}

export type EnrichResult = { ok: true; updated: string[]; sources: string[]; warnings: string[] } | { ok: false; message: string };

export async function enrichClient(clientId: string, actor: { userId: string | null }): Promise<EnrichResult> {
  const c = await prisma.client.findUnique({ where: { id: clientId } });
  if (!c) return { ok: false, message: "Nie znaleziono klienta." };
  if (!c.nip || !/^\d{10}$/.test(c.nip)) return { ok: false, message: "Klient nie ma poprawnego NIP." };

  const warnings: string[] = [];
  const [wl, ceidg] = await Promise.all([
    fetchWhiteList(c.nip).catch((e: unknown) => (warnings.push(e instanceof Error ? e.message : String(e)), null)),
    fetchCeidg(c.nip).catch((e: unknown) => (warnings.push(e instanceof Error ? e.message : String(e)), null)),
  ]);
  if (!process.env.CEIDG_API_TOKEN) warnings.push("CEIDG pominięte — brak tokenu CEIDG_API_TOKEN w .env.");

  const meta = readFieldMeta(c.fieldMeta);
  const current = c as unknown as Record<string, unknown>;
  const locked = (f: string) => isLocked(meta, f);
  // Biała lista: REGON, VAT, rachunki, adres; CEIDG: forma, data, PKD (i REGON, gdy WL nie ma).
  const fromWl = wl ? planEnrichment(current, wl, locked) : {};
  const fromCeidg = ceidg ? planEnrichment(current, ceidg, (f) => locked(f) || f in fromWl) : {};
  const plan: Record<string, { value: unknown; source: "bialalista" | "ceidg" }> = {};
  for (const [k, v] of Object.entries(fromWl)) plan[k] = { value: v, source: "bialalista" };
  for (const [k, v] of Object.entries(fromCeidg)) plan[k] = { value: v, source: "ceidg" };

  const data: Record<string, unknown> = {};
  for (const [k, { value }] of Object.entries(plan)) data[k] = k === "businessStartDate" ? new Date(`${value as string}T12:00:00.000Z`) : value;
  const changes = changedFields(current, data);
  let nextMeta = meta;
  for (const source of ["bialalista", "ceidg"] as const) {
    const fields = Object.keys(plan).filter((k) => plan[k].source === source);
    if (fields.length) nextMeta = stampFieldMeta(nextMeta, fields, { source, sourceRef: c.nip, by: actor.userId, at: new Date(), lock: false });
  }
  // Pola bez zmian, ale potwierdzone rejestrem — odświeżamy datę weryfikacji.
  for (const [source, found] of [
    ["bialalista", wl],
    ["ceidg", ceidg],
  ] as const) {
    const confirmed = Object.keys(found ?? {}).filter((k) => !(k in plan) && !locked(k) && current[k] != null && !["name", "street", "zip", "city"].includes(k));
    if (confirmed.length) nextMeta = stampFieldMeta(nextMeta, confirmed, { source, sourceRef: c.nip, by: actor.userId, at: new Date(), lock: false });
  }

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: { ...(data as Prisma.ClientUpdateInput), fieldMeta: nextMeta as unknown as Prisma.InputJsonValue, enrichedAt: new Date() },
    });
    for (const source of ["bialalista", "ceidg"] as const) {
      const own = changes.filter((ch) => plan[ch.field]?.source === source);
      if (own.length) {
        await recordChanges(tx, { userId: actor.userId ?? "", provenance: { source: source === "bialalista" ? "Biała lista MF" : "CEIDG", confidence: "HIGH", batch: null } }, fieldEntries("CLIENT", clientId, clientId, own));
      }
    }
  });
  logInfo("client_enriched", { clientId, updated: Object.keys(plan), wl: !!wl, ceidg: !!ceidg, warnings: warnings.length });
  if (warnings.length) logWarn("client_enrich_warnings", { clientId, warnings });
  return { ok: true, updated: Object.keys(plan), sources: [wl ? "Biała lista" : null, ceidg ? "CEIDG" : null].filter((x): x is string => !!x), warnings };
}

// Co miesiąc: porcja klientów z NIP-em nieuzupełnianych od 30 dni (limity
// publicznego API Białej listy — nie wszyscy naraz).
export async function enrichStaleClients(limit = 20): Promise<{ processed: number; updated: number; failed: number }> {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const clients = await prisma.client.findMany({
    where: { archivedAt: null, nip: { not: null }, OR: [{ enrichedAt: null }, { enrichedAt: { lt: monthAgo } }] },
    orderBy: [{ enrichedAt: { sort: "asc", nulls: "first" } }],
    take: limit,
    select: { id: true },
  });
  let updated = 0;
  let failed = 0;
  for (const c of clients) {
    const r = await enrichClient(c.id, { userId: null }).catch(() => ({ ok: false as const, message: "błąd" }));
    if (!r.ok) failed++;
    else if (r.updated.length) updated++;
  }
  return { processed: clients.length, updated, failed };
}
