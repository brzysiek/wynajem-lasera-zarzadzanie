import { NextRequest, NextResponse } from "next/server";
import { Prisma, type PaymentMethod, type PriceSource } from "@prisma/client";
import { requireDriverFinanceSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { logInfo, logWarn } from "@/lib/logger";
import { PricingError, recalculateFinance, resolveBasePrice } from "@/lib/pricing";
import { loadPricingContext, loadPricingSettings, parseTransportPrice } from "@/lib/finance";
import { resolveVehicleId } from "@/lib/rental-vehicle";

// Pola, które rola KIEROWCA może edytować — wyłącznie na wydarzeniach
// przypisanych do niej (spec 5). Whitelist egzekwowana twardo: klucz w body
// spoza listy → 400 (nie ciche ignorowanie — łatwiej wychwycić błąd
// uprawnień po stronie klienta).
const DRIVER_EDITABLE_FIELDS = [
  "capUsedHS",
  "capCountHS",
  "membraneUsed",
  "membraneCount",
  "pulseCounterStart",
  "pulseCounterEnd",
  "cashCollected",
  "transportCashCollected",
  "deliveryDurationMinutes",
  "pickupDurationMinutes",
  "pickupVehicleId",
  "deliveryNotes",
  "pickupNotes",
  "confirmed",
] as const;

const MAX_CAP_COUNT = 20;
const MAX_MEMBRANE_COUNT = 20;
const MAX_DURATION_MIN = 24 * 60;

function bad(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireDriverFinanceSession();
  if (!session) return bad("Brak uprawnień.", 403);

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return bad("Nieprawidłowe dane.");
  }

  for (const key of Object.keys(body)) {
    if (!(DRIVER_EDITABLE_FIELDS as readonly string[]).includes(key)) {
      return bad(`Pole „${key}” jest poza zakresem edycji kierowcy.`);
    }
  }

  const rental = await prisma.rental.findUnique({ where: { id }, include: { device: true, finance: true } });
  if (!rental) return bad("Nie znaleziono wynajmu.", 404);

  // KIEROWCA — tylko własne przypisane wynajmy. ADMIN/STAFF bez tego warunku
  // (biuro poprawia dane po kierowcy).
  if (session.user.role === "KIEROWCA" && rental.driverId !== session.user.id) {
    logWarn("driver_finance_forbidden", { userId: session.user.id, rentalId: id });
    return bad("Brak dostępu do tego wynajmu.", 403);
  }

  // --- walidacja i normalizacja pól z body ---
  let capUsedHS: boolean | null | undefined;
  let capCountHS: number | undefined;
  let membraneUsed: boolean | null | undefined;
  let membraneCount: number | undefined;
  let cashCollected: boolean | null | undefined;
  let transportCashCollected: boolean | null | undefined;
  let pulseCounterStart: number | null | undefined;
  let pulseCounterEnd: number | null | undefined;
  let deliveryDurationMinutes: number | null | undefined;
  let pickupDurationMinutes: number | null | undefined;
  let pickupVehicleId: string | null | undefined;
  let deliveryNotes: string | null | undefined;
  let pickupNotes: string | null | undefined;
  let confirmed: boolean | undefined;

  if ("capUsedHS" in body) {
    if (body.capUsedHS !== null && typeof body.capUsedHS !== "boolean") return bad("Nieprawidłowa wartość pola „nakładka HS”.");
    capUsedHS = body.capUsedHS;
  }
  if ("capCountHS" in body) {
    const num = typeof body.capCountHS === "number" ? body.capCountHS : Number(body.capCountHS);
    if (!Number.isInteger(num) || num < 1 || num > MAX_CAP_COUNT) {
      return bad(`Liczba nakładek HS musi być liczbą całkowitą od 1 do ${MAX_CAP_COUNT}.`);
    }
    capCountHS = num;
  }
  if ("membraneUsed" in body) {
    if (body.membraneUsed !== null && typeof body.membraneUsed !== "boolean") return bad("Nieprawidłowa wartość pola „membrany”.");
    membraneUsed = body.membraneUsed;
  }
  if ("membraneCount" in body) {
    const num = typeof body.membraneCount === "number" ? body.membraneCount : Number(body.membraneCount);
    if (!Number.isInteger(num) || num < 1 || num > MAX_MEMBRANE_COUNT) {
      return bad(`Liczba membran musi być liczbą całkowitą od 1 do ${MAX_MEMBRANE_COUNT}.`);
    }
    membraneCount = num;
  }
  if ("cashCollected" in body) {
    if (body.cashCollected !== null && typeof body.cashCollected !== "boolean") return bad("Nieprawidłowa wartość pola „gotówka odebrana”.");
    cashCollected = body.cashCollected;
  }
  if ("transportCashCollected" in body) {
    if (body.transportCashCollected !== null && typeof body.transportCashCollected !== "boolean") {
      return bad("Nieprawidłowa wartość pola „gotówka za transport odebrana”.");
    }
    transportCashCollected = body.transportCashCollected;
  }
  for (const field of ["pulseCounterStart", "pulseCounterEnd"] as const) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw === null || raw === "") {
      if (field === "pulseCounterStart") pulseCounterStart = null;
      else pulseCounterEnd = null;
      continue;
    }
    const num = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(num) || num < 0) return bad("Liczniki impulsów muszą być nieujemnymi liczbami całkowitymi.");
    if (field === "pulseCounterStart") pulseCounterStart = num;
    else pulseCounterEnd = num;
  }
  for (const field of ["deliveryDurationMinutes", "pickupDurationMinutes"] as const) {
    if (!(field in body)) continue;
    const raw = body[field];
    const value = raw === null || raw === "" ? null : typeof raw === "number" ? raw : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > MAX_DURATION_MIN)) {
      return bad("Czas dostawy / odbioru podaj w minutach (liczba całkowita 0–1440).");
    }
    if (field === "deliveryDurationMinutes") deliveryDurationMinutes = value;
    else pickupDurationMinutes = value;
  }
  if ("pickupVehicleId" in body) {
    const resolved = await resolveVehicleId(body.pickupVehicleId);
    if (!resolved.ok) return resolved.response;
    pickupVehicleId = resolved.vehicleId;
  }
  for (const field of ["deliveryNotes", "pickupNotes"] as const) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw !== null && typeof raw !== "string") return bad("Nieprawidłowa uwaga kierowcy.");
    const value = raw === null ? null : raw.trim();
    if (field === "deliveryNotes") deliveryNotes = value;
    else pickupNotes = value;
  }
  if ("confirmed" in body) {
    if (typeof body.confirmed !== "boolean") return bad("Nieprawidłowa wartość pola „potwierdzenie odbioru”.");
    confirmed = body.confirmed;
  }

  const existing = rental.finance;
  const settings = await loadPricingSettings();

  // Stan efektywny = to, co przyszło w patchu, w brakujących miejscach
  // dotychczasowa wartość z bazy.
  const effCapUsed = capUsedHS !== undefined ? capUsedHS : existing?.capUsedHS ?? null;
  const effCapCount = effCapUsed ? (capCountHS !== undefined ? capCountHS : existing?.capCountHS ?? 1) : 1;
  const effMembraneUsed = membraneUsed !== undefined ? membraneUsed : existing?.membraneUsed ?? null;
  const effMembraneCount = effMembraneUsed ? (membraneCount !== undefined ? membraneCount : existing?.membraneCount ?? 1) : 1;
  const effStart = pulseCounterStart !== undefined ? pulseCounterStart : existing?.pulseCounterStart ?? null;
  const effEnd = pulseCounterEnd !== undefined ? pulseCounterEnd : existing?.pulseCounterEnd ?? null;
  const effCash = cashCollected !== undefined ? cashCollected : existing?.cashCollected ?? null;
  const effTransportCash =
    transportCashCollected !== undefined ? transportCashCollected : existing?.transportCashCollected ?? null;
  const effDeliveryMin =
    deliveryDurationMinutes !== undefined ? deliveryDurationMinutes : existing?.deliveryDurationMinutes ?? null;
  const effPickupMin =
    pickupDurationMinutes !== undefined ? pickupDurationMinutes : existing?.pickupDurationMinutes ?? null;
  const effPickupVehicleId =
    pickupVehicleId !== undefined ? pickupVehicleId : existing?.pickupVehicleId ?? null;
  const effDeliveryNotes = deliveryNotes !== undefined ? deliveryNotes : existing?.deliveryNotes ?? null;
  const effPickupNotes = pickupNotes !== undefined ? pickupNotes : existing?.pickupNotes ?? null;

  // Potwierdzenie odbioru — JEDYNY jawny, globalny sygnał "rozliczenie
  // kompletne" (niezależny od tego, które pojedyncze pole akurat przyszło w
  // tym zapisie). `confirmed: true` zapisuje znacznik czasu tylko przy
  // PIERWSZYM potwierdzeniu (idempotentne przy ponownym true — nie
  // nadpisuje wcześniejszej daty); `confirmed: false` jawnie cofa
  // potwierdzenie (np. pomyłka, biuro chce poprawić dane po kierowcy).
  const effConfirmedAt =
    confirmed === undefined ? existing?.confirmedAt ?? null : confirmed ? existing?.confirmedAt ?? new Date() : null;

  // Pola transportu ustala biuro w sekcji „Finanse" — kierowca ich nie rusza.
  const transportPriceNet = existing?.transportPriceNet ?? parseTransportPrice(rental.transportPrice);
  const transportPaidSeparately = existing?.transportPaidSeparately ?? false;
  const transportVatApplicable = existing?.transportVatApplicable ?? false;

  // Snapshot ceny nakładki HS w momencie PIERWSZEGO zaznaczenia (spec 3.4) —
  // późniejsza zmiana cap_fee_hs_net w ustawieniach nie rusza już zapisanej
  // kwoty historycznej.
  let capFeeNet = existing?.capFeeNet ?? null;
  if (effCapUsed && capFeeNet == null) {
    capFeeNet = settings.capFeeHsNet;
  }

  // Snapshot ceny membrany Cooltech — ta sama zasada co nakładka HS wyżej:
  // tylko przy pierwszym zaznaczeniu, potem zamrożona.
  let membraneFeeNet = existing?.membraneFeeNet ?? null;
  if (effMembraneUsed && membraneFeeNet == null) {
    membraneFeeNet = settings.membraneFeeCooltechNet;
  }

  const ctx = await loadPricingContext(rental);

  // Cena bazowa + parametry ustalane przez biuro. Jeśli biuro jeszcze nie
  // dotknęło finansów (sekcja „Finanse" to Faza 3), tworzymy rekord z ceną z
  // cennika i TYMCZASOWYM paymentMethod = CASH — biuro nadpisze przy pełnej
  // edycji.
  let baseRentalPriceNet: Prisma.Decimal;
  let baseRentalPriceSource: PriceSource;
  let vatApplicable: boolean;
  let vatRate: Prisma.Decimal;
  let paymentMethod: PaymentMethod;

  if (existing) {
    baseRentalPriceNet = existing.baseRentalPriceNet;
    baseRentalPriceSource = existing.baseRentalPriceSource;
    vatApplicable = existing.vatApplicable;
    vatRate = existing.vatRate;
    paymentMethod = existing.paymentMethod;
  } else {
    const resolved = resolveBasePrice({
      eventType: rental.eventType,
      pricingCategory: ctx.pricingCategory,
      deviceVariant: ctx.deviceVariant,
      durationDays: ctx.durationDays,
      priceRules: ctx.priceRules,
    });
    baseRentalPriceNet = resolved.priceNet ?? new Prisma.Decimal(0);
    baseRentalPriceSource = resolved.source;
    vatApplicable = false;
    vatRate = settings.vatRateDefault;
    paymentMethod = "CASH";
  }

  let computed;
  try {
    computed = recalculateFinance(ctx, {
      baseRentalPriceNet,
      baseRentalPriceSource,
      pulseCounterStart: effStart,
      pulseCounterEnd: effEnd,
      capUsedHS: effCapUsed,
      capCountHS: effCapCount,
      capFeeNet,
      membraneUsed: effMembraneUsed,
      membraneCount: effMembraneCount,
      membraneFeeNet,
      vatApplicable,
      vatRate,
      transportPriceNet,
      transportPaidSeparately,
      transportVatApplicable,
    });
  } catch (err) {
    if (err instanceof PricingError) return bad(err.message);
    throw err;
  }

  const financeData = {
    baseRentalPriceNet: computed.baseRentalPriceNet,
    baseRentalPriceSource: computed.baseRentalPriceSource,
    pulseCounterStart: effStart,
    pulseCounterEnd: effEnd,
    pulseCalculationStatus: computed.pulseCalculationStatus,
    pulseSurchargeNet: computed.pulseSurchargeNet,
    capUsedHS: effCapUsed,
    capCountHS: effCapCount,
    capFeeNet,
    membraneUsed: effMembraneUsed,
    membraneCount: effMembraneCount,
    membraneFeeNet,
    cashCollected: effCash,
    transportCashCollected: effTransportCash,
    deliveryDurationMinutes: effDeliveryMin,
    pickupDurationMinutes: effPickupMin,
    pickupVehicleId: effPickupVehicleId,
    deliveryNotes: effDeliveryNotes,
    pickupNotes: effPickupNotes,
    confirmedAt: effConfirmedAt,
    totalNet: computed.totalNet,
    totalGross: computed.totalGross,
    transportTotalNet: computed.transportTotalNet,
    transportTotalGross: computed.transportTotalGross,
  };

  // Jedyny zapis tego endpointu (dawniej też Rental.driverNotes obok — usunięte,
  // uwagi kierowcy żyją teraz na RentalFinance), więc bez $transaction.
  await prisma.rentalFinance.upsert({
    where: { rentalId: id },
    create: {
      rentalId: id,
      ...financeData,
      deviceVariant: ctx.deviceVariant,
      vatApplicable,
      vatRate,
      paymentMethod,
      transportPriceNet,
      transportPaidSeparately,
      transportVatApplicable,
    },
    update: financeData,
  });

  logInfo("driver_finance_updated", { userId: session.user.id, rentalId: id, fields: Object.keys(body) });

  const updated = await prisma.rental.findUniqueOrThrow({ where: { id }, include: { device: true, finance: true } });
  return NextResponse.json({ rental: updated });
}
