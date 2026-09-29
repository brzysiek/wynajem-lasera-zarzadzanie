import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordChanges, type ChangeActor, type ChangeEntry } from "@/lib/changelog/record";
import { rentalDurationDays } from "@/lib/pricing/duration";
import { warsawYmd } from "@/lib/clients/day-route";
import { loadDeliverySettings } from "@/lib/clients/delivery";
import { zoneFor } from "@/lib/clients/delivery-rules";
import {
  PRICE_SOURCES,
  PRICE_SOURCE_LABEL,
  TERMS_DEVICE_LABEL,
  deviceCodeFor,
  expectedClientPrice,
  isTermsDevice,
  parseInvoiceMode,
  termsDeviation,
  type ClientPriceRow,
  type InvoiceMode,
} from "@/lib/clients/terms-rules";

// Warunki handlowe klienta (karta klienta, etap C): tabela cen (ClientPrice),
// odczyt dla formularza rezerwacji i ostrzeżenia „cena ≠ warunki” w kalendarzu.

export type ClientPriceDto = ClientPriceRow & { id: string; source: string | null; sourceRef: string | null; since: string | null };

export async function loadClientPrices(clientId: string): Promise<ClientPriceDto[]> {
  const rows = await prisma.clientPrice.findMany({ where: { clientId }, orderBy: [{ device: "asc" }, { days: "asc" }] });
  return rows.map((r) => ({ id: r.id, device: r.device, days: r.days, priceNet: Number(r.priceNet), source: r.source, sourceRef: r.sourceRef, since: (r.since ?? r.updatedAt).toISOString() }));
}

type PriceInput = { device: string; days: number; priceNet: number; source: string | null; sourceRef: string | null; since?: Date | null };

// Wniosek 28: źródło wersji w dzienniku — „mail · oferta 30.10 · od 31.08.2025”.
function versionSource(r: { source: string | null; sourceRef: string | null; since?: Date | null }): string | null {
  const parts = [r.source ? (PRICE_SOURCE_LABEL[r.source] ?? r.source) : null, r.sourceRef, r.since ? `od ${r.since.toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" })}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseSince(v: unknown): Date | null {
  return typeof v === "string" && DAY_RE.test(v) ? new Date(`${v}T12:00:00`) : null;
}

export function parsePrices(raw: unknown): { ok: true; rows: PriceInput[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: "prices: lista { device, days, priceNet }." };
  const rows: PriceInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!o || !isTermsDevice(o.device)) return { ok: false, message: "Nieznane urządzenie w tabeli cen." };
    const days = Number(o.days);
    if (!Number.isInteger(days) || days < 1 || days > 31) return { ok: false, message: "Liczba dni 1–31." };
    const price = Number(String(o.priceNet ?? "").replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(price) || price <= 0 || price > 100000) return { ok: false, message: `${TERMS_DEVICE_LABEL[o.device]}, ${days} d.: podaj cenę netto.` };
    const key = `${o.device}|${days}`;
    if (seen.has(key)) return { ok: false, message: `${TERMS_DEVICE_LABEL[o.device]}, ${days} d. — podwójny wiersz.` };
    seen.add(key);
    const source = typeof o.source === "string" && (PRICE_SOURCES as readonly string[]).includes(o.source) ? o.source : null;
    const sourceRef = typeof o.sourceRef === "string" && o.sourceRef.trim() ? o.sourceRef.trim().slice(0, 191) : null;
    rows.push({ device: o.device, days, priceNet: Math.round(price * 100) / 100, source, sourceRef, since: parseSince(o.since) });
  }
  return { ok: true, rows };
}

const label = (r: { device: string; days: number }) => `Cena · ${TERMS_DEVICE_LABEL[r.device as keyof typeof TERMS_DEVICE_LABEL] ?? r.device} · ${r.days} d.`;

// Zapis całej tabeli cen (biuro) — dodane, zmienione i usunięte wiersze trafiają
// do dziennika zmian klienta. Wniosek 28: zmiana ceny = nowa wersja od
// podanej daty (domyślnie dziś); przyszłe rezerwacje — dopiero po „Zastosuj”.
export async function saveClientPrices(clientId: string, rows: PriceInput[], actor: { userId: string }): Promise<{ ok: true; changed: number } | { ok: false; status: number; message: string }> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) return { ok: false, status: 404, message: "Nie znaleziono klienta." };
  const current = await prisma.clientPrice.findMany({ where: { clientId } });
  const key = (r: { device: string; days: number }) => `${r.device}|${r.days}`;
  const now = new Map(current.map((r) => [key(r), r]));
  const next = new Map(rows.map((r) => [key(r), r]));
  const entries: ChangeEntry[] = [];
  const entry = (r: { device: string; days: number }, before: string | null, after: string | null): ChangeEntry => ({ entity: "CLIENT", entityId: clientId, operation: "FIELD_CHANGE", clientId, field: label(r), before, after });
  const sources: (string | null)[] = [];

  await prisma.$transaction(async (tx) => {
    for (const [k, r] of now) {
      if (!next.has(k)) {
        await tx.clientPrice.delete({ where: { id: r.id } });
        entries.push(entry(r, r.priceNet.toString(), null));
      }
    }
    for (const [k, r] of next) {
      const old = now.get(k);
      const priceNet = new Prisma.Decimal(r.priceNet);
      const data = { priceNet, source: r.source, sourceRef: r.sourceRef };
      if (!old) {
        await tx.clientPrice.create({ data: { clientId, device: r.device, days: r.days, ...data, since: r.since ?? new Date() } });
        entries.push(entry(r, null, r.priceNet.toFixed(2)));
        sources.push(versionSource({ ...r, since: r.since ?? new Date() }));
      } else if (!old.priceNet.equals(priceNet) || old.source !== r.source || old.sourceRef !== r.sourceRef || (r.since && old.since?.getTime() !== r.since.getTime())) {
        const since = r.since ?? (!old.priceNet.equals(priceNet) ? new Date() : old.since);
        await tx.clientPrice.update({ where: { id: old.id }, data: { ...data, since } });
        if (!old.priceNet.equals(priceNet)) {
          entries.push(entry(r, old.priceNet.toString(), r.priceNet.toFixed(2)));
          sources.push(versionSource({ ...r, since }));
        }
      }
    }
    // Źródło wersji w dzienniku: jedno na zapis (zwykle zmienia się jeden wiersz).
    const src = [...new Set(sources.filter(Boolean))].join("; ") || null;
    await recordChanges(tx, { ...actor, provenance: src ? { source: src, confidence: null, batch: null } : null }, entries);
  });
  return { ok: true, changed: entries.length };
}

// Jedna cena — wyjątek z karty klienta (autozapis), z rezerwacji („zmień i
// zapisz w warunkach”) albo propozycja agenta cennik_klienta po akceptacji:
// dodaj, zmień (nowa wersja od `since`, domyślnie dziś) albo usuń (priceNet
// null). Przyszłe rezerwacje — dopiero po „Zastosuj” na karcie (wniosek 28).
export async function upsertClientPrice(
  clientId: string,
  row: { device: string; days: number; priceNet: number | null; source: string | null; sourceRef: string | null; since?: Date | null },
  actor: ChangeActor,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isTermsDevice(row.device)) return { ok: false, message: "Nieznane urządzenie." };
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) return { ok: false, message: "Nie znaleziono klienta." };
  const where = { clientId_device_days: { clientId, device: row.device, days: row.days } };
  const old = await prisma.clientPrice.findUnique({ where });
  await prisma.$transaction(async (tx) => {
    const priceChanged = row.priceNet == null ? old != null : !old || !old.priceNet.equals(new Prisma.Decimal(row.priceNet));
    const since = row.since ?? (priceChanged ? new Date() : (old?.since ?? new Date()));
    if (row.priceNet == null) {
      if (old) await tx.clientPrice.delete({ where });
    } else {
      const data = { priceNet: new Prisma.Decimal(row.priceNet), source: row.source, sourceRef: row.sourceRef, since };
      await tx.clientPrice.upsert({ where, create: { clientId, device: row.device, days: row.days, ...data }, update: data });
    }
    if (!priceChanged) return;
    const src = row.priceNet == null ? null : versionSource({ source: row.source, sourceRef: row.sourceRef, since });
    await recordChanges(tx, { ...actor, provenance: actor.provenance ?? (src ? { source: src, confidence: null, batch: null } : null) }, [
      { entity: "CLIENT", entityId: clientId, operation: "FIELD_CHANGE", clientId, field: label(row), before: old?.priceNet.toString() ?? null, after: row.priceNet?.toFixed(2) ?? null },
    ]);
  });
  return { ok: true };
}

// ------------------------------------------------------------------ formularz rezerwacji

export type ClientTermsDto = {
  clientId: string;
  clientName: string;
  // Wniosek 28: wyjątki z datą wersji (dymek „warunki klienta od DD.MM”).
  prices: (ClientPriceRow & { since: string | null })[];
  // Transport ustalony (tylko on trafia do rezerwacji) i skąd kwota.
  transportNet: number | null;
  transportSource: string | null;
  // Ręczne ceny z wcześniejszych rezerwacji (urządzenie × dni × kwota, ile
  // razy) — 2+ razy ta sama → „Ustawić jako warunki?”.
  manualPrices: { device: string; days: number; priceNet: number; count: number }[];
  paymentForm: "GOTOWKA" | "PRZELEW" | "OBA" | null;
  invoiceMode: InvoiceMode | null;
  invoicePartDefault: number | null;
  // Inna rezerwacja klienta tego samego dnia dostawy z transportem —
  // „2 urządzenia jednego dnia = 1 kurs”.
  transportTakenBy: string | null;
  // Wniosek 15: podpowiedź ze strefy (trasa od bazy do adresu domyślnego) —
  // tylko gdy klient nie ma stałej kwoty transportu i strefa ma stawkę.
  zone: { code: string; km: number; priceNet: number } | null;
};

export async function loadTermsForRental(q: { clientId?: string | null; hubspotContactId?: string | null; day?: string | null; excludeRentalId?: string | null }): Promise<ClientTermsDto | null> {
  let clientId = q.clientId ?? null;
  if (!clientId && q.hubspotContactId) {
    const c = await prisma.clientContact.findUnique({ where: { hubspotContactId: q.hubspotContactId }, select: { clientId: true } });
    clientId = c?.clientId ?? null;
  }
  if (!clientId) return null;
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      shortName: true,
      transportPriceNet: true,
      transportSource: true,
      distanceKm: true,
      paymentForm: true,
      invoiceMode: true,
      invoicePartDefault: true,
      prices: { select: { device: true, days: true, priceNet: true, since: true, updatedAt: true } },
      deliveryAddresses: { where: { isDefault: true }, take: 1, select: { distanceKm: true } },
    },
  });
  if (!c) return null;

  let zone: ClientTermsDto["zone"] = null;
  const km = c.deliveryAddresses[0]?.distanceKm ?? c.distanceKm;
  if (c.transportPriceNet == null && km != null) {
    const z = zoneFor(Number(km), (await loadDeliverySettings()).zones);
    if (z?.priceNet != null) zone = { code: z.code, km: Number(km), priceNet: z.priceNet };
  }

  let transportTakenBy: string | null = null;
  if (q.day && /^\d{4}-\d{2}-\d{2}$/.test(q.day)) {
    // Dzień dostawy = dzień początku (wynajmy całodniowe: 12:00 UTC) — okno ±1 dzień, filtr po dniu warszawskim.
    const from = new Date(`${q.day}T00:00:00Z`);
    const around = await prisma.rental.findMany({
      where: {
        clientId,
        deletedInGoogle: false,
        eventType: "WYNAJEM",
        startsAt: { gte: new Date(from.getTime() - 86_400_000), lt: new Date(from.getTime() + 2 * 86_400_000) },
        ...(q.excludeRentalId ? { id: { not: q.excludeRentalId } } : {}),
      },
      select: { title: true, startsAt: true, finance: { select: { transportPriceNet: true } } },
    });
    const same = around.find((r) => warsawYmd(r.startsAt) === q.day && (r.finance?.transportPriceNet == null || Number(r.finance.transportPriceNet) > 0));
    transportTakenBy = same?.title ?? null;
  }

  const manualRows = await prisma.rental.findMany({
    where: { clientId, deletedInGoogle: false, finance: { baseRentalPriceSource: "MANUAL" } },
    select: { eventType: true, startsAt: true, endsAt: true, device: { select: { pricingCategory: true } }, finance: { select: { deviceVariant: true, baseRentalPriceNet: true } } },
    take: 200,
    orderBy: { startsAt: "desc" },
  });
  const manual = new Map<string, { device: string; days: number; priceNet: number; count: number }>();
  for (const r of manualRows) {
    const code = deviceCodeFor(r.eventType, r.device.pricingCategory, r.finance?.deviceVariant ?? null);
    if (!code || !r.finance) continue;
    const days = rentalDurationDays(r.startsAt, r.endsAt);
    const priceNet = Number(r.finance.baseRentalPriceNet);
    const k = `${code}|${days}|${priceNet}`;
    const cur = manual.get(k) ?? { device: code, days, priceNet, count: 0 };
    cur.count++;
    manual.set(k, cur);
  }

  return {
    clientId: c.id,
    clientName: c.shortName ?? c.name,
    prices: c.prices.map((p) => ({ device: p.device, days: p.days, priceNet: Number(p.priceNet), since: (p.since ?? p.updatedAt).toISOString() })),
    transportNet: c.transportPriceNet != null ? Number(c.transportPriceNet) : null,
    transportSource: c.transportSource,
    manualPrices: [...manual.values()],
    paymentForm: (c.paymentForm as ClientTermsDto["paymentForm"]) ?? null,
    invoiceMode: parseInvoiceMode(c.invoiceMode),
    invoicePartDefault: c.invoicePartDefault != null ? Number(c.invoicePartDefault) : null,
    transportTakenBy,
    zone,
  };
}

// ------------------------------------------------------------------ kalendarz

type RentalForCheck = {
  id: string;
  clientId: string | null;
  eventType: "WYNAJEM" | "SZKOLENIE";
  startsAt: Date;
  endsAt: Date;
  device: { pricingCategory: Parameters<typeof deviceCodeFor>[1] };
  finance: { baseRentalPriceNet: Prisma.Decimal; baseRentalPriceSource: string; deviceVariant: string | null } | null;
};

// Rezerwacje, w których cena wynajmu różni się od warunków klienta o > 10%:
// id → opis do dymka w kalendarzu.
export async function termsWarnings(rentals: RentalForCheck[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const withFinance = rentals.filter((r) => r.clientId && r.finance && r.finance.baseRentalPriceSource !== "PULSE_CALCULATED");
  if (!withFinance.length) return out;
  const clientIds = [...new Set(withFinance.map((r) => r.clientId!))];
  const prices = await prisma.clientPrice.findMany({ where: { clientId: { in: clientIds } }, select: { clientId: true, device: true, days: true, priceNet: true } });
  const byClient = new Map<string, ClientPriceRow[]>();
  for (const p of prices) byClient.set(p.clientId, [...(byClient.get(p.clientId) ?? []), { device: p.device, days: p.days, priceNet: Number(p.priceNet) }]);
  for (const r of withFinance) {
    const list = byClient.get(r.clientId!);
    if (!list) continue;
    // Brak ceny dla tego wariantu, a klient ma w tabeli tylko inny — porównanie z nim.
    const exp = expectedClientPrice(list, r.eventType, r.device.pricingCategory, r.finance!.deviceVariant, rentalDurationDays(r.startsAt, r.endsAt));
    const dev = termsDeviation(Number(r.finance!.baseRentalPriceNet), exp?.priceNet ?? null);
    if (dev)
      out.set(
        r.id,
        `Cena wynajmu ${Number(r.finance!.baseRentalPriceNet)} zł różni się o ${Math.round(dev.pct * 100)}% od warunków klienta (${exp!.otherVariant ? `${TERMS_DEVICE_LABEL[exp!.code]}: ` : ""}${dev.expected} zł)${exp!.otherVariant ? " — klient nie ma w warunkach tego wariantu" : ""}`,
      );
  }
  return out;
}
