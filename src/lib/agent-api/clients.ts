import { prisma } from "@/lib/prisma";
import { loadClientRows } from "@/lib/clients/load";
import type { ClientStatus } from "@/lib/clients/status";
import { loadUnassignedRentals } from "@/lib/clients/rental-match";
import { REGIONS, REGION_LABEL, type RegionKey } from "@/lib/clients/region";
import type { ClientListRow } from "@/lib/clients/list-load";
import { logError } from "@/lib/logger";

// Lista klientów dla API agenta: status i kwalifikacja z listy panelu
// (loadClientRows) + surowe dane do porządków (NIP, adres, osoby, data
// zmiany). Filtry: brak telefonu / NIP / miasta, status, miasto, zmienione od,
// kontakty z zapytań, wyszukiwanie.

export type AgentClientFilters = {
  missingPhone: boolean;
  missingNip: boolean;
  missingCity: boolean;
  status: string | null;
  city: string | null;
  changedSince: Date | null;
  inquiries: boolean | null; // true = tylko kontakty z zapytań, false = tylko klienci
  q: string | null;
  // Lista klientów 27.09.2026 (pkt 7).
  region?: string | null; // klucz (KRAKOWSKI…) albo nazwa („Świętokrzyskie”)
  beforeSeason?: boolean;
  noNextStep?: boolean;
};

export function parseRegion(v: string | null | undefined): RegionKey | null {
  if (!v) return null;
  const f = fold(v.trim());
  return REGIONS.find((k) => fold(k) === f || fold(REGION_LABEL[k]) === f) ?? null;
}

export type AgentClient = {
  id: string;
  name: string;
  status: ClientStatus;
  qualified: boolean;
  nip: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  clinicType: string | null;
  source: string | null;
  statusOverride: string | null;
  hubspotCompanyId: string | null;
  contacts: { id: string; firstName: string | null; lastName: string | null; phone: string | null; phone2: string | null; email: string | null; role: string | null; isPrimary: boolean; hubspotContactId: string | null }[];
  rentalsTotal: number;
  lastRentalAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
  shortName: string | null;
  region: RegionKey;
  rentals12m: number;
  nextRental: ClientListRow["nextRental"];
  rhythmDays: number | null;
  churnRisk: ClientListRow["rhythm"]["risk"];
  nextStep: ClientListRow["nextStep"];
  beforeSeason: boolean;
  check: string | null;
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");

export async function listAgentClients(f: AgentClientFilters): Promise<AgentClient[]> {
  // Rezerwacje bez klienta z propozycją — jak na liście w panelu (następny
  // wynajem, „przed sezonem”).
  const unassigned = await loadUnassignedRentals().catch((err) => {
    logError("agent_unassigned_rentals_failed", err);
    return [];
  });
  const region = parseRegion(f.region);
  const [rows, raw] = await Promise.all([
    loadClientRows(new Date(), { unassigned }),
    prisma.client.findMany({
      select: {
        id: true,
        nip: true,
        street: true,
        zip: true,
        city: true,
        country: true,
        statusOverride: true,
        hubspotCompanyId: true,
        updatedAt: true,
        contacts: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: { id: true, firstName: true, lastName: true, phone: true, phone2: true, email: true, role: true, isPrimary: true, hubspotContactId: true },
        },
      },
    }),
  ]);
  const byId = new Map(raw.map((r) => [r.id, r]));
  const q = f.q ? fold(f.q.trim()) : "";
  const qDigits = f.q ? f.q.replace(/\D/g, "").replace(/^48/, "") : "";
  const city = f.city ? fold(f.city.trim()) : "";

  const out: AgentClient[] = [];
  for (const r of rows) {
    const c = byId.get(r.id);
    if (!c) continue;
    const hasPhone = c.contacts.some((p) => p.phone || p.phone2);
    if (f.missingPhone && hasPhone) continue;
    if (f.missingNip && c.nip) continue;
    if (f.missingCity && c.city) continue;
    if (f.status && r.status !== f.status) continue;
    if (city && !fold(c.city ?? "").includes(city)) continue;
    if (f.changedSince && c.updatedAt < f.changedSince) continue;
    if (f.inquiries === true && r.qualified) continue;
    if (f.inquiries === false && !r.qualified) continue;
    if (region && r.region !== region) continue;
    if (f.beforeSeason && !r.beforeSeason) continue;
    if (f.noNextStep && r.nextStep) continue;
    if (q && !fold(r.search).includes(q) && !(qDigits.length >= 5 && r.phoneDigits.includes(qDigits))) continue;
    out.push({
      id: r.id,
      name: r.name,
      status: r.status,
      qualified: r.qualified,
      nip: c.nip,
      street: c.street,
      zip: c.zip,
      city: c.city,
      country: c.country,
      clinicType: r.clinicType,
      source: r.source,
      statusOverride: c.statusOverride,
      hubspotCompanyId: c.hubspotCompanyId,
      contacts: c.contacts,
      rentalsTotal: r.rentalsTotal,
      lastRentalAt: r.lastRentalAt,
      lastContactAt: r.lastContactAt,
      createdAt: r.createdAt,
      updatedAt: c.updatedAt.toISOString(),
      shortName: r.shortName,
      region: r.region,
      rentals12m: r.rentals12m,
      nextRental: r.nextRental,
      rhythmDays: r.rhythm.days,
      churnRisk: r.rhythm.risk,
      nextStep: r.nextStep,
      beforeSeason: r.beforeSeason,
      check: r.check,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "pl"));
}
