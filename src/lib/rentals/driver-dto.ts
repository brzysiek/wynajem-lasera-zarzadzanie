import type { Device, Rental, RentalFinance } from "@prisma/client";

// Wniosek 31: konto KIEROWCA dostaje z GET /api/rentals tylko to, czego potrzebuje
// kalendarz kierowcy — bez cen wynajmu, faktur, ceny transportu, historii SMS,
// e-maila i NIP. Lista pól jest jawna (whitelist): nowe pole w modelu Rental nie
// trafia do kierowcy samo.

export type DriverRentalSource = Rental & {
  device: Device;
  driver: { id: string; name: string; driverColor: string | null } | null;
  vehicle: { id: string; name: string } | null;
  finance: RentalFinance | null;
};

const num = (d: { toString(): string } | null | undefined): number => (d ? Number(d.toString()) : 0);

// Ile gotówki kierowca ma odebrać (wynajem gotówką + transport gotówką) — ta sama
// reguła co baner w DriverFinancePanel (kwota brutto przy VAT, inaczej netto).
export function cashToCollect(f: RentalFinance | null, eventType: string): number | null {
  if (!f) return null;
  const rental = f.paymentMethod === "CASH" ? (f.vatApplicable ? num(f.totalGross) : num(f.totalNet)) : 0;
  const transportSep = eventType !== "SZKOLENIE" && f.transportPaidSeparately && num(f.transportTotalGross) > 0;
  const transportIsCash = transportSep && f.transportPaymentMethod !== "TRANSFER";
  const transport = transportIsCash ? (f.transportVatApplicable ? num(f.transportTotalGross) : num(f.transportTotalNet)) : 0;
  return Math.round((rental + transport) * 100) / 100;
}

export function driverFinanceView(f: RentalFinance | null, eventType: string) {
  if (!f) return null;
  return {
    deviceVariant: f.deviceVariant,
    pulseCounterStart: f.pulseCounterStart,
    pulseCounterEnd: f.pulseCounterEnd,
    pulseCalculationStatus: f.pulseCalculationStatus,
    capUsedHS: f.capUsedHS,
    capCountHS: f.capCountHS,
    membraneUsed: f.membraneUsed,
    membraneCount: f.membraneCount,
    paymentMethod: f.paymentMethod,
    transportPaidSeparately: f.transportPaidSeparately,
    transportPaymentMethod: f.transportPaymentMethod,
    transportCashCollected: f.transportCashCollected,
    deliveryDurationMinutes: f.deliveryDurationMinutes,
    pickupDurationMinutes: f.pickupDurationMinutes,
    pickupVehicleId: f.pickupVehicleId,
    deliveryNotes: f.deliveryNotes,
    pickupNotes: f.pickupNotes,
    confirmedAt: f.confirmedAt,
    // Kafelki kalendarza (też kierowcy) liczą z tego ikony „brak raportu” i
    // „faktura” (report-alerts.ts, invoice-alerts.ts). Sam znacznik VAT i
    // wewnętrzny numer zapisu w Fakturowni — bez numeru faktury, kwot i dat.
    vatApplicable: f.vatApplicable,
    fakturowniaInvoiceId: f.fakturowniaInvoiceId,
    cashToCollect: cashToCollect(f, eventType),
  };
}

export function toDriverRental(r: DriverRentalSource) {
  return {
    id: r.id,
    deviceId: r.deviceId,
    device: { id: r.device.id, name: r.device.name, shortName: r.device.shortName, color: r.device.color, active: r.device.active, pricingCategory: r.device.pricingCategory, variantOptions: r.device.variantOptions },
    title: r.title,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    allDay: r.allDay,
    eventType: r.eventType,
    clientId: r.clientId,
    hubspotContactId: r.hubspotContactId,
    driverId: r.driverId,
    driver: r.driver,
    vehicleId: r.vehicleId,
    vehicle: r.vehicle,
    // Osoba i telefon na miejscu, adres, godziny i uwaga z biura dla kierowcy.
    contactNameCache: r.contactNameCache,
    contactPhoneCache: r.contactPhoneCache,
    contactCompanyCache: r.contactCompanyCache,
    contactAddressCache: r.contactAddressCache,
    deliveryAddress: r.deliveryAddress,
    deliveryTime: r.deliveryTime,
    pickupTime: r.pickupTime,
    internalNotes: r.internalNotes,
    trainingPlace: r.trainingPlace,
    trainingLead: r.trainingLead,
    trainingParticipants: r.trainingParticipants,
    finance: driverFinanceView(r.finance, r.eventType),
  };
}
