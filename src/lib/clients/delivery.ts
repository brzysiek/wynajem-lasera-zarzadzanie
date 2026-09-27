import { Prisma, type ClientDeliveryAddress } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { recordChanges, type ChangeActor, type ChangeEntry } from "@/lib/changelog/record";
import { geocodeAddress, reverseGeocode } from "@/lib/clients/geocode";
import { geoKey, mapAddress } from "@/lib/clients/geo-rules";
import { regionFromZip } from "@/lib/clients/region";
import { osrmRoute } from "@/lib/clients/routing";
import {
  ADDRESS_TEXT_FIELDS,
  formatAddressLine,
  parseAddressInput,
  parseBase,
  parseZones,
  addressNeedsGeo,
  sameAddress,
  type AddressInput,
  type DeliveryBase,
  type TransportZone,
} from "@/lib/clients/delivery-rules";

// Paszport dostawy (karta klienta, etap B): adresy dostawy klienta, trasa od
// bazy (Nominatim + OSRM), uwagi kierowców. Adres domyślny jest lustrzany do
// starych pól klienta (deliveryAddress, deliveryNotes, openingHours,
// distanceKm, lat/lng) — z nich dalej czytają mapa, lista i API agenta.

export const BASE_SETTING_KEY = "delivery_base";
export const ZONES_SETTING_KEY = "transport_zones";

export async function loadDeliverySettings(): Promise<{ base: DeliveryBase; zones: TransportZone[] }> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [BASE_SETTING_KEY, ZONES_SETTING_KEY] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { base: parseBase(get(BASE_SETTING_KEY)), zones: parseZones(get(ZONES_SETTING_KEY)) };
}

// Zmiana bazy: nowe współrzędne z Nominatim i przeliczenie wszystkich tras.
export async function saveDeliverySettings(input: { baseAddress?: string; zonePrices?: Record<string, number | null> }): Promise<{ ok: true } | { ok: false; message: string }> {
  const current = await loadDeliverySettings();
  if (input.baseAddress !== undefined && input.baseAddress.trim() !== current.base.address) {
    const text = input.baseAddress.trim();
    const parts = mapAddress({ street: text, zip: null, city: null, deliveryAddress: text });
    if (!parts) return { ok: false, message: "Podaj adres bazy z kodem i miejscowością." };
    let hit;
    try {
      hit = await geocodeAddress(parts);
    } catch {
      return { ok: false, message: "Nie udało się połączyć z OpenStreetMap — spróbuj za chwilę." };
    }
    if (!hit || hit.precision !== "ADRES") return { ok: false, message: "Nie znaleziono dokładnego adresu bazy na mapie." };
    const base: DeliveryBase = { address: text, lat: hit.lat, lng: hit.lng };
    await prisma.$transaction([
      prisma.setting.upsert({ where: { key: BASE_SETTING_KEY }, create: { key: BASE_SETTING_KEY, value: JSON.stringify(base) }, update: { value: JSON.stringify(base) } }),
      prisma.clientDeliveryAddress.updateMany({ data: { routeCalculatedAt: null } }),
    ]);
  }
  if (input.zonePrices) {
    const value = JSON.stringify(Object.fromEntries(current.zones.map((z) => [z.code, input.zonePrices![z.code] ?? null])));
    await prisma.setting.upsert({ where: { key: ZONES_SETTING_KEY }, create: { key: ZONES_SETTING_KEY, value }, update: { value } });
  }
  return { ok: true };
}

// ------------------------------------------------------------------ DTO

export type DeliveryFeedbackDto = { id: string; text: string; createdAt: string; driverName: string | null; rentalId: string | null; rentalAt: string | null };

export type DeliveryAddressDto = {
  id: string;
  label: string;
  isDefault: boolean;
  street: string | null;
  zip: string | null;
  city: string | null;
  line: string;
  located: boolean;
  geoPrecision: string | null;
  geoState: string | null;
  geoCounty: string | null;
  distanceKm: number | null;
  durationMin: number | null;
  // true = km i minuty z trasy OSRM; false = dawna wartość z wynajmów / brak.
  routeAuto: boolean;
  usualStartTime: string | null;
  entrance: string | null;
  floor: string | null;
  parking: string | null;
  power: string | null;
  receiver: string | null;
  openingHours: string | null;
  officeNotes: string | null;
  feedback: DeliveryFeedbackDto[];
};

const FEEDBACK_INCLUDE = {
  feedback: {
    orderBy: { createdAt: "desc" as const },
    take: 30,
    include: { driver: { select: { name: true } }, rental: { select: { startsAt: true } } },
  },
};

type AddressWithFeedback = Prisma.ClientDeliveryAddressGetPayload<{ include: typeof FEEDBACK_INCLUDE }>;

function toDto(a: AddressWithFeedback): DeliveryAddressDto {
  return {
    id: a.id,
    label: a.label,
    isDefault: a.isDefault,
    street: a.street,
    zip: a.zip,
    city: a.city,
    line: formatAddressLine(a),
    located: a.lat != null && a.lng != null,
    geoPrecision: a.geoPrecision,
    geoState: a.geoState,
    geoCounty: a.geoCounty,
    distanceKm: a.distanceKm != null ? Number(a.distanceKm) : null,
    durationMin: a.durationMin,
    routeAuto: a.routeCalculatedAt != null,
    usualStartTime: a.usualStartTime,
    entrance: a.entrance,
    floor: a.floor,
    parking: a.parking,
    power: a.power,
    receiver: a.receiver,
    openingHours: a.openingHours,
    officeNotes: a.officeNotes,
    feedback: a.feedback.map((f) => ({
      id: f.id,
      text: f.text,
      createdAt: f.createdAt.toISOString(),
      driverName: f.driver?.name ?? null,
      rentalId: f.rentalId,
      rentalAt: f.rental?.startsAt.toISOString() ?? null,
    })),
  };
}

const ORDER = [{ isDefault: "desc" as const }, { createdAt: "asc" as const }];

export async function loadClientAddresses(clientId: string): Promise<DeliveryAddressDto[]> {
  const rows = await prisma.clientDeliveryAddress.findMany({ where: { clientId }, orderBy: ORDER, include: FEEDBACK_INCLUDE });
  return rows.map(toDto);
}

// Adres wynajmu: wybrany w rezerwacji, inaczej domyślny klienta.
export async function loadRentalAddress(rental: { deliveryAddressId: string | null; clientId: string | null }): Promise<DeliveryAddressDto | null> {
  if (rental.deliveryAddressId) {
    const a = await prisma.clientDeliveryAddress.findUnique({ where: { id: rental.deliveryAddressId }, include: FEEDBACK_INCLUDE });
    if (a) return toDto(a);
  }
  if (!rental.clientId) return null;
  const a = await prisma.clientDeliveryAddress.findFirst({ where: { clientId: rental.clientId }, orderBy: ORDER, include: FEEDBACK_INCLUDE });
  return a ? toDto(a) : null;
}

// Lista do wyboru w rezerwacji (bez uwag kierowców) — po kliencie albo po
// kontakcie HubSpot (nowa rezerwacja zna tylko kontakt).
export async function addressOptions(q: { clientId?: string | null; hubspotContactId?: string | null }) {
  let clientId = q.clientId ?? null;
  if (!clientId && q.hubspotContactId) {
    const c = await prisma.clientContact.findUnique({ where: { hubspotContactId: q.hubspotContactId }, select: { clientId: true } });
    clientId = c?.clientId ?? null;
  }
  if (!clientId) return { clientId: null, addresses: [] };
  const rows = await prisma.clientDeliveryAddress.findMany({ where: { clientId }, orderBy: ORDER });
  return {
    clientId,
    addresses: rows.map((a) => ({
      id: a.id,
      label: a.label,
      isDefault: a.isDefault,
      line: formatAddressLine(a),
      distanceKm: a.distanceKm != null ? Number(a.distanceKm) : null,
      durationMin: a.durationMin,
    })),
  };
}

// Adres wybrany w rezerwacji: musi być adresem klienta tej rezerwacji
// (clientId null = klient jeszcze nieznany — sprawdzamy tylko istnienie).
// undefined w body = bez zmiany.
export async function resolveDeliveryAddressId(raw: unknown, clientId: string | null): Promise<{ ok: true; id: string | null | undefined } | { ok: false; message: string }> {
  if (raw === undefined) return { ok: true, id: undefined };
  if (raw === null || raw === "") return { ok: true, id: null };
  if (typeof raw !== "string") return { ok: false, message: "Nieprawidłowy adres dostawy." };
  const a = await prisma.clientDeliveryAddress.findUnique({ where: { id: raw }, select: { clientId: true } });
  if (!a || (clientId && a.clientId !== clientId)) return { ok: false, message: "Wybrany adres nie należy do klienta tej rezerwacji." };
  return { ok: true, id: raw };
}

// ------------------------------------------------------------------ geokodowanie i trasa

const partsOf = (a: { street: string | null; zip: string | null; city: string | null }) => ({ street: a.street, zip: a.zip, city: a.city });

// Współrzędne (gdy zmienił się adres) i trasa od bazy (gdy brak albo nowe
// współrzędne). Rzuca przy błędzie sieci — wołający decyduje, co dalej.
async function refreshGeo(a: ClientDeliveryAddress, base: DeliveryBase): Promise<ClientDeliveryAddress> {
  const key = geoKey(partsOf(a));
  const data: Prisma.ClientDeliveryAddressUpdateInput = {};
  let geo: { lat: number; lng: number } | null = a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null;
  if (key !== a.geoQuery) {
    const hit = a.city || a.zip ? await geocodeAddress(partsOf(a)) : null;
    geo = hit ? { lat: hit.lat, lng: hit.lng } : null;
    Object.assign(data, {
      lat: hit?.lat ?? null,
      lng: hit?.lng ?? null,
      geoPrecision: hit?.precision ?? null,
      geoState: hit?.state?.slice(0, 64) ?? null,
      geoCounty: hit?.county?.slice(0, 64) ?? null,
      geoQuery: key,
      routeCalculatedAt: null,
    });
  }
  // Region bez kodu pocztowego liczymy z województwa / powiatu — adresom
  // z migracji (współrzędne bez województwa) dopytujemy je wstecznie.
  if (geo && !("geoQuery" in data) && a.geoState == null && regionFromZip(a.zip) == null) {
    const rev = await reverseGeocode(geo);
    if (rev) Object.assign(data, { geoState: rev.state?.slice(0, 64) ?? null, geoCounty: rev.county?.slice(0, 64) ?? null });
  }
  if (geo && (a.routeCalculatedAt == null || "geoQuery" in data)) {
    const route = await osrmRoute(base, geo);
    // Bez trasy (OSRM jej nie znalazł) też znaczymy datę — partia nie wraca w kółko.
    Object.assign(data, route ? { distanceKm: route.km, durationMin: route.min, routeCalculatedAt: new Date() } : { routeCalculatedAt: new Date() });
  }
  if (Object.keys(data).length === 0) return a;
  return prisma.clientDeliveryAddress.update({ where: { id: a.id }, data });
}

async function refreshGeoSafe(a: ClientDeliveryAddress): Promise<{ address: ClientDeliveryAddress; warning: string | null }> {
  const { base } = await loadDeliverySettings();
  try {
    const next = await refreshGeo(a, base);
    const warning = next.lat == null ? "Nie znaleziono adresu na mapie — sprawdź ulicę i miejscowość." : next.durationMin == null ? "Nie udało się policzyć trasy od bazy." : null;
    return { address: next, warning };
  } catch (err) {
    logWarn("delivery_route_failed", { addressId: a.id, message: err instanceof Error ? err.message : String(err) });
    return { address: a, warning: "Mapa (OpenStreetMap) nie odpowiada — odległość przeliczy się później z mapy klientek." };
  }
}

// Lustro adresu domyślnego w starych polach klienta.
export async function mirrorDefaultToClient(clientId: string): Promise<void> {
  const [c, a] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { street: true, zip: true, city: true, geoSource: true } }),
    prisma.clientDeliveryAddress.findFirst({ where: { clientId, isDefault: true } }),
  ]);
  if (!c || !a) return;
  const deliveryAddress = sameAddress(a, c) ? null : formatAddressLine(a) || null;
  const notes = { entrance: a.entrance, floor: a.floor, parking: a.parking, power: a.power, receiver: a.receiver };
  const data: Prisma.ClientUpdateInput = {
    deliveryAddress,
    deliveryNotes: Object.values(notes).some(Boolean) ? notes : Prisma.JsonNull,
    openingHours: a.openingHours,
  };
  if (a.distanceKm != null) data.distanceKm = a.distanceKm;
  if (a.lat != null && a.lng != null && c.geoSource !== "MANUAL") {
    const parts = mapAddress({ ...c, deliveryAddress });
    Object.assign(data, { lat: a.lat, lng: a.lng, geoSource: "NOMINATIM", geoPrecision: a.geoPrecision, geoQuery: parts ? geoKey(parts) : null, geocodedAt: new Date() });
  }
  await prisma.client.update({ where: { id: clientId }, data });
}

// Odwrotny kierunek: stare pola klienta zmienione zapisem klienta (API agenta
// „klient_zmien”, import) trafiają do adresu domyślnego — żeby paszport i
// widok kierowcy ich nie zgubiły.
export async function syncClientFieldsToDefault(clientId: string): Promise<void> {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { street: true, zip: true, city: true, deliveryAddress: true, deliveryNotes: true, openingHours: true } });
  if (!c) return;
  const text = c.deliveryAddress?.trim();
  const parts = text ? mapAddress({ ...c, deliveryAddress: text }) : { street: c.street, zip: c.zip, city: c.city };
  const n = (c.deliveryNotes && typeof c.deliveryNotes === "object" && !Array.isArray(c.deliveryNotes) ? c.deliveryNotes : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const data = {
    street: parts?.street ?? null,
    zip: parts?.zip?.slice(0, 8) ?? null,
    city: parts?.city ?? null,
    entrance: str(n.entrance),
    floor: str(n.floor),
    parking: str(n.parking),
    power: str(n.power),
    receiver: str(n.receiver),
    openingHours: c.openingHours,
  };
  const current = await prisma.clientDeliveryAddress.findFirst({ where: { clientId, isDefault: true } });
  if (!current && !data.city && !data.zip) return;
  const saved = current
    ? await prisma.clientDeliveryAddress.update({ where: { id: current.id }, data })
    : await prisma.clientDeliveryAddress.create({ data: { clientId, label: "Gabinet", isDefault: true, ...data } });
  await refreshGeoSafe(saved);
  await mirrorDefaultToClient(clientId);
}

// ------------------------------------------------------------------ zapis

type Actor = ChangeActor;

const FIELD_LABEL: Record<keyof AddressInput, string> = {
  label: "nazwa",
  street: "ulica",
  zip: "kod",
  city: "miejscowość",
  usualStartTime: "typowa godzina",
  entrance: "wejście",
  floor: "piętro / winda",
  parking: "parking",
  power: "prąd",
  receiver: "kto odbiera",
  openingHours: "godziny otwarcia",
  officeNotes: "uwagi biura",
};

function inputOf(a: ClientDeliveryAddress): AddressInput {
  return {
    label: a.label,
    street: a.street,
    zip: a.zip,
    city: a.city,
    usualStartTime: a.usualStartTime,
    ...(Object.fromEntries(ADDRESS_TEXT_FIELDS.map((f) => [f, a[f]])) as Record<(typeof ADDRESS_TEXT_FIELDS)[number], string | null>),
  };
}

function changeEntries(clientId: string, label: string, before: AddressInput | null, after: AddressInput | null, keys: (keyof AddressInput)[]): ChangeEntry[] {
  return keys.map((k) => ({
    entity: "CLIENT" as const,
    entityId: clientId,
    operation: "FIELD_CHANGE" as const,
    clientId,
    field: `Paszport dostawy · ${label} · ${FIELD_LABEL[k]}`,
    before: before?.[k] ?? null,
    after: after?.[k] ?? null,
  }));
}

export type SaveResult = { ok: true; warning: string | null } | { ok: false; status: number; message: string };

export async function createAddress(clientId: string, body: Record<string, unknown>, actor: Actor): Promise<SaveResult> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, _count: { select: { deliveryAddresses: true } } } });
  if (!client) return { ok: false, status: 404, message: "Nie znaleziono klienta." };
  const parsed = parseAddressInput(body, null);
  if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
  const makeDefault = client._count.deliveryAddresses === 0 || body.isDefault === true;
  const created = await prisma.$transaction(async (tx) => {
    if (makeDefault) await tx.clientDeliveryAddress.updateMany({ where: { clientId }, data: { isDefault: false } });
    const a = await tx.clientDeliveryAddress.create({ data: { clientId, ...parsed.value, isDefault: makeDefault } });
    await recordChanges(tx, actor, changeEntries(clientId, a.label, null, parsed.value, parsed.changed));
    return a;
  });
  const { warning } = await refreshGeoSafe(created);
  if (makeDefault) await mirrorDefaultToClient(clientId);
  return { ok: true, warning };
}

export async function updateAddress(clientId: string, addressId: string, body: Record<string, unknown>, actor: Actor): Promise<SaveResult> {
  const current = await prisma.clientDeliveryAddress.findFirst({ where: { id: addressId, clientId } });
  if (!current) return { ok: false, status: 404, message: "Nie znaleziono adresu." };
  const before = inputOf(current);
  const parsed = parseAddressInput(body, before);
  if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
  const makeDefault = body.isDefault === true && !current.isDefault;
  const saved = await prisma.$transaction(async (tx) => {
    if (makeDefault) await tx.clientDeliveryAddress.updateMany({ where: { clientId }, data: { isDefault: false } });
    const a = await tx.clientDeliveryAddress.update({ where: { id: addressId }, data: { ...parsed.value, ...(makeDefault ? { isDefault: true } : {}) } });
    const entries = changeEntries(clientId, a.label, before, parsed.value, parsed.changed);
    if (makeDefault) entries.push({ entity: "CLIENT", entityId: clientId, operation: "FIELD_CHANGE", clientId, field: "Paszport dostawy · adres domyślny", before: null, after: a.label });
    await recordChanges(tx, actor, entries);
    return a;
  });
  // Przeliczenie trasy też na życzenie ({ recalc: true }) — np. po zmianie bazy.
  const next = body.recalc === true ? { ...saved, geoQuery: null } : saved;
  const { warning } = await refreshGeoSafe(next);
  if (saved.isDefault) await mirrorDefaultToClient(clientId);
  return { ok: true, warning };
}

// Usunięcie adresu: rezerwacje z tym adresem wracają do domyślnego (FK SetNull),
// uwagi kierowców o nim znikają razem z nim. Domyślny przechodzi na kolejny.
export async function deleteAddress(clientId: string, addressId: string, actor: Actor): Promise<SaveResult> {
  const current = await prisma.clientDeliveryAddress.findFirst({ where: { id: addressId, clientId } });
  if (!current) return { ok: false, status: 404, message: "Nie znaleziono adresu." };
  await prisma.$transaction(async (tx) => {
    await tx.clientDeliveryAddress.delete({ where: { id: addressId } });
    if (current.isDefault) {
      const nextDefault = await tx.clientDeliveryAddress.findFirst({ where: { clientId }, orderBy: { createdAt: "asc" } });
      if (nextDefault) await tx.clientDeliveryAddress.update({ where: { id: nextDefault.id }, data: { isDefault: true } });
    }
    await recordChanges(tx, actor, [
      { entity: "CLIENT", entityId: clientId, operation: "FIELD_CHANGE", clientId, field: `Paszport dostawy · ${current.label}`, before: formatAddressLine(current), after: null },
    ]);
  });
  if (current.isDefault) await mirrorDefaultToClient(clientId);
  return { ok: true, warning: null };
}

// Pinezka przesunięta ręcznie na mapie klientek — te same współrzędne w
// adresie domyślnym (trasa przeliczy się z nowego punktu).
export async function syncManualPinToDefault(clientId: string, geo: { lat: number; lng: number } | null): Promise<void> {
  const a = await prisma.clientDeliveryAddress.findFirst({ where: { clientId, isDefault: true } });
  if (!a) return;
  await prisma.clientDeliveryAddress.update({
    where: { id: a.id },
    data: geo ? { lat: geo.lat, lng: geo.lng, geoPrecision: "ADRES", geoQuery: geoKey(partsOf(a)), routeCalculatedAt: null } : { geoQuery: null, routeCalculatedAt: null },
  });
}

// ------------------------------------------------------------------ partia z mapy klientek


// Klientki z historią bez żadnego adresu dostawy dostają „Gabinet” z adresu
// firmy; potem współrzędne i trasy dla adresów, którym ich brakuje.
export async function deliveryGeoBatch(deadline: number): Promise<{ done: number; remaining: number }> {
  const bare = await prisma.client.findMany({
    where: {
      archivedAt: null,
      deliveryAddresses: { none: {} },
      OR: [{ rentals: { some: {} } }, { history: { some: { matchState: { in: ["AUTO", "CONFIRMED"] } } } }, { invoices: { some: { matchState: { in: ["AUTO", "CONFIRMED"] } } } }],
      AND: [{ OR: [{ city: { not: null } }, { zip: { not: null } }] }],
    },
    select: { id: true, street: true, zip: true, city: true, lat: true, lng: true, geoPrecision: true, geoQuery: true, distanceKm: true, openingHours: true },
  });
  if (bare.length) {
    await prisma.clientDeliveryAddress.createMany({
      data: bare.map((c) => ({
        clientId: c.id,
        label: "Gabinet",
        isDefault: true,
        street: c.street,
        zip: c.zip,
        city: c.city,
        lat: c.lat,
        lng: c.lng,
        geoPrecision: c.geoPrecision,
        geoQuery: c.geoQuery,
        distanceKm: c.distanceKm,
        openingHours: c.openingHours,
      })),
    });
  }

  const all = await prisma.clientDeliveryAddress.findMany({ where: { client: { archivedAt: null } } });
  const todo = all.filter(addressNeedsGeo);
  const { base } = await loadDeliverySettings();
  let done = 0;
  for (const a of todo) {
    if (Date.now() > deadline) break;
    try {
      await refreshGeo(a, base);
    } catch (err) {
      logWarn("delivery_route_failed", { addressId: a.id, message: err instanceof Error ? err.message : String(err) });
      break;
    }
    if (a.isDefault) await mirrorDefaultToClient(a.clientId);
    done++;
  }
  return { done, remaining: todo.length - done };
}

export async function countPendingDeliveryGeo(): Promise<number> {
  const all = await prisma.clientDeliveryAddress.findMany({
    where: { client: { archivedAt: null } },
    select: { street: true, zip: true, city: true, geoQuery: true, lat: true, routeCalculatedAt: true, geoState: true },
  });
  return all.filter(addressNeedsGeo).length;
}

// ------------------------------------------------------------------ uwagi kierowcy

export async function addDeliveryFeedback(rental: { id: string; deliveryAddressId: string | null; clientId: string | null }, driverId: string, text: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const t = text.trim().slice(0, 2000);
  if (!t) return { ok: false, message: "Wpisz uwagę." };
  const address = await loadRentalAddress(rental);
  if (!address) return { ok: false, message: "Ten wynajem nie ma adresu z karty klienta — uwagę wpisz w notatce do dostawy." };
  await prisma.deliveryFeedback.create({ data: { addressId: address.id, rentalId: rental.id, driverId, text: t } });
  return { ok: true };
}
