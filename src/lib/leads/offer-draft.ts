import { prisma } from "@/lib/prisma";
import { CATEGORY_TO_INTEREST, DEVICE_INTEREST_LABEL, type DeviceInterestKey } from "@/lib/clients/labels";
import { expectedClientPrice } from "@/lib/clients/terms-rules";
import { loadTermsForRental } from "@/lib/clients/terms";
import type { DevicePricingCategory } from "@prisma/client";

// Złote zasady, pkt 6 — „Przygotuj ofertę”: szkic maila z konkretnym
// urządzeniem, 2 wolnymi terminami z kalendarza, ceną (warunki klienta albo
// cennik) i transportem (warunki albo strefa). Temat z „Oferta” — po wysłaniu
// z kontakt@ automat przesunie sygnał do „Oferta wysłana” (V3).

export type OfferDraft = {
  to: string | null;
  subject: string;
  body: string;
  device: string | null;
  freeDates: string[];
  freeByDevice: { device: string; dates: string[] }[];
  priceNet: number | null;
  transportNet: number | null;
};

const d2 = (d: Date) => d.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const short = (d: Date) => d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

// 2 najbliższe dni (bez niedziel, 45 dni od startu), w które co najmniej jedno
// aktywne urządzenie z kategorii jest wolne przez cały wynajem.
export async function freeDatesFor(categories: DevicePricingCategory[], start: Date, days: number) {
  const devices = await prisma.device.findMany({ where: { active: true, pricingCategory: { in: categories } }, select: { id: true, pricingCategory: true, variantOptions: true } });
  const end = new Date(start.getTime() + 45 * 86_400_000);
  const rentals = devices.length
    ? await prisma.rental.findMany({ where: { deviceId: { in: devices.map((d) => d.id) }, deletedInGoogle: false, startsAt: { lt: end }, endsAt: { gt: start } }, select: { deviceId: true, startsAt: true, endsAt: true } })
    : [];
  const dates: Date[] = [];
  for (let d = start; d < end && dates.length < 2; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (d.getDay() === 0) continue;
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
    if (devices.some((dev) => !rentals.some((r) => r.deviceId === dev.id && r.startsAt < to && r.endsAt > d))) dates.push(d);
  }
  return { devices, dates };
}

export async function buildOfferDraft(leadId: string, now = new Date()): Promise<OfferDraft | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { clientId: true, contactEmail: true, deviceInterest: true, requestedFrom: true, requestedDays: true, owner: { select: { name: true } }, clientContact: { select: { email: true } } },
  });
  if (!lead) return null;
  const interests = (Array.isArray(lead.deviceInterest) ? lead.deviceInterest : []).filter((x): x is DeviceInterestKey => typeof x === "string" && x in DEVICE_INTEREST_LABEL && x !== "SZKOLENIE");
  const interest = interests[0] ?? null;
  const categories = interest ? (Object.entries(CATEGORY_TO_INTEREST).filter(([, v]) => v === interest).map(([k]) => k) as DevicePricingCategory[]) : [];
  const days = lead.requestedDays && lead.requestedDays > 0 ? lead.requestedDays : 1;

  // Wolne terminy: od jutra (albo od zgłoszonego terminu) przez 45 dni — dzień,
  // w którym co najmniej jedno urządzenie tej kategorii nie ma wynajmu.
  const start = dayStart(new Date(Math.max(now.getTime() + 86_400_000, lead.requestedFrom?.getTime() ?? 0)));
  let freeDates: Date[] = [];
  let category: DevicePricingCategory | null = null;
  let variant: string | null = null;
  if (categories.length) {
    const found = await freeDatesFor(categories, start, days);
    freeDates = found.dates;
    category = found.devices[0]?.pricingCategory ?? categories[0];
    const opts = found.devices[0] && Array.isArray(found.devices[0].variantOptions) ? (found.devices[0].variantOptions as unknown[]).filter((x): x is string => typeof x === "string") : [];
    variant = opts.find((v) => v !== "single_flex") ?? null;
  }
  // Przegląd 29.09 07:15, pkt 8: bez wskazanego urządzenia — wolne terminy
  // każdego urządzenia do wyboru w podpowiedzi follow-upu.
  const freeByDevice: { device: string; dates: string[] }[] = [];
  if (!interest) {
    for (const key of Object.keys(DEVICE_INTEREST_LABEL) as DeviceInterestKey[]) {
      if (key === "SZKOLENIE") continue;
      const cats = Object.entries(CATEGORY_TO_INTEREST).filter(([, v]) => v === key).map(([k]) => k) as DevicePricingCategory[];
      if (!cats.length) continue;
      const found = await freeDatesFor(cats, start, days);
      if (found.devices.length && found.dates.length) freeByDevice.push({ device: DEVICE_INTEREST_LABEL[key], dates: found.dates.map(short) });
    }
  }

  const terms = lead.clientId ? await loadTermsForRental({ clientId: lead.clientId }) : null;
  let priceNet: number | null = null;
  if (category) {
    priceNet = terms ? (expectedClientPrice(terms.prices, "WYNAJEM", category, variant, days)?.priceNet ?? null) : null;
    if (priceNet == null) {
      const rule = await prisma.priceRule.findFirst({ where: { pricingCategory: category, durationDays: days, ...(variant ? { variant } : {}) }, select: { priceNet: true } });
      priceNet = rule ? Number(rule.priceNet) : null;
    }
  }
  const transportNet = terms ? (terms.transportNet ?? terms.zone?.priceNet ?? null) : null;

  const device = interest ? DEVICE_INTEREST_LABEL[interest] : null;
  const dayWord = days === 1 ? "1 dzień" : `${days} dni`;
  const lines = [
    "Dzień dobry,",
    "",
    `dziękuję za rozmowę. Proponuję wynajem ${device ?? "urządzenia"} (${dayWord}).`,
    "",
    freeDates.length ? `Wolne terminy: ${freeDates.map(d2).join(" albo ")}.` : "Wolne terminy: [do uzupełnienia z kalendarza].",
    priceNet != null ? `Cena: ${priceNet.toLocaleString("pl-PL")} zł netto za wynajem${transportNet != null ? ` + transport ${transportNet.toLocaleString("pl-PL")} zł netto` : " + transport [do uzupełnienia]"}.` : "Cena: [do uzupełnienia] zł netto + transport.",
    "",
    freeDates.length === 2 ? `Który termin rezerwuję – ${d2(freeDates[0])} czy ${d2(freeDates[1])}?` : "Który termin rezerwuję?",
    "",
    "Pozdrawiam,",
    lead.owner?.name ?? "",
    "WynajemLasera.pl",
  ];
  return {
    to: lead.contactEmail ?? lead.clientContact?.email ?? null,
    subject: `Oferta wynajmu ${device ?? "urządzenia"} – WynajemLasera.pl`,
    body: lines.join("\n"),
    device,
    freeDates: freeDates.map(short),
    freeByDevice,
    priceNet,
    transportNet,
  };
}
