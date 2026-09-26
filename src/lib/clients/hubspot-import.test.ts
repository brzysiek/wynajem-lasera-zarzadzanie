import { describe, expect, it } from "vitest";
import { mapDevices, normalizeNip, parseDistanceKm, parseMoney, planHubspotImport, type HsCompany, type HsContact } from "./hubspot-import";

// Kopia reguł normalizePolishPhone (src/lib/reminders.ts) — wstrzykiwana, bo
// reminders.ts ciągnie Prismę i nie ładuje się w vitest.
function normalizePhone(raw: string): string | null {
  const digits = raw.trim().replace(/[^\d+]/g, "");
  if (/^\+\d{9,15}$/.test(digits)) return digits;
  if (/^48\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{9}$/.test(digits)) return `+48${digits}`;
  return null;
}

let seq = 0;
function contact(p: Partial<HsContact>): HsContact {
  seq += 1;
  return {
    id: p.id ?? `c${seq}`,
    firstname: null,
    lastname: null,
    email: null,
    phone: null,
    mobilephone: null,
    company: null,
    address: null,
    city: null,
    zip: null,
    country: null,
    nip: null,
    ustalona_cena_transportu: null,
    odlegosc_od_bazy: null,
    tagi: null,
    urzadzenie: null,
    createdate: "2025-01-01T00:00:00Z",
    companyIds: [],
    ...p,
  };
}
const company = (p: Partial<HsCompany> & { id: string }): HsCompany => ({
  name: null,
  address: null,
  city: null,
  zip: null,
  country: null,
  ...p,
});
const plan = (contacts: HsContact[], companies: HsCompany[] = []) =>
  planHubspotImport({ contacts, companies }, { normalizePhone });

describe("grupowanie kontaktów w klientów", () => {
  it("kontakty jednej firmy HubSpot → jeden klient, osoba główna = najstarsza", () => {
    const { clients, report } = plan(
      [
        contact({ id: "b", firstname: "Ola", companyIds: ["f1"], createdate: "2025-03-01T00:00:00Z" }),
        contact({ id: "a", firstname: "Ewa", companyIds: ["f1"], createdate: "2024-01-01T00:00:00Z" }),
      ],
      [company({ id: "f1", name: "Gabinet Róża", city: "Kraków" })],
    );
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ key: "company:f1", hubspotCompanyId: "f1", name: "Gabinet Róża", city: "Kraków" });
    expect(clients[0].contacts.map((c) => [c.hubspotContactId, c.isPrimary])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(report.multiPersonClients).toHaveLength(1);
  });

  it("kontakt bez firmy z tym samym NIP dołącza do klienta firmowego", () => {
    const { clients } = plan(
      [
        contact({ id: "a", nip: "944-228-55-99", companyIds: ["f1"] }),
        contact({ id: "b", nip: "9442285599" }),
      ],
      [company({ id: "f1", name: "EsteGH" })],
    );
    expect(clients).toHaveLength(1);
    expect(clients[0].nip).toBe("9442285599");
    expect(clients[0].contacts).toHaveLength(2);
  });

  it("dwa kontakty bez firmy z tym samym NIP → jeden klient", () => {
    const { clients } = plan([contact({ nip: "1234567890", company: "Salon X" }), contact({ nip: "1234567890" })]);
    expect(clients).toHaveLength(1);
    expect(clients[0].key).toBe("nip:1234567890");
  });

  it("bez firmy i NIP → osobny klient; nazwa: firma z kontaktu → imię i nazwisko → e-mail", () => {
    const { clients } = plan([
      contact({ company: "Studio Urody" }),
      contact({ firstname: "Anna", lastname: "Nowak" }),
      contact({ email: "Ktos@Example.com" }),
    ]);
    expect(clients.map((c) => c.name).sort()).toEqual(["Anna Nowak", "Studio Urody", "ktos@example.com"].sort());
    expect(clients.every((c) => c.contacts.length === 1 && c.contacts[0].isPrimary)).toBe(true);
  });

  it("osoby prywatne bez firmy nie są łączone po nazwie, ale trafiają do raportu duplikatów", () => {
    const { clients, report } = plan([contact({ company: "Gabinet Kosmetyczny" }), contact({ company: "gabinet  kosmetyczny" })]);
    expect(clients).toHaveLength(2);
    expect(report.possibleDuplicateNames).toEqual([{ name: "gabinet kosmetyczny", count: 2 }]);
  });
});

describe("raport konfliktów", () => {
  it("ten sam NIP w dwóch różnych firmach", () => {
    const { report } = plan(
      [contact({ nip: "1234567890", companyIds: ["f1"] }), contact({ nip: "1234567890", companyIds: ["f2"] })],
      [company({ id: "f1", name: "A" }), company({ id: "f2", name: "B" })],
    );
    expect(report.nipAcrossCompanies).toEqual([{ nip: "1234567890", companies: ["A", "B"] }]);
  });

  it("ten sam e-mail u kilku kontaktów, bez względu na wielkość liter", () => {
    const { report } = plan([contact({ email: "x@y.pl", firstname: "A" }), contact({ email: "X@Y.pl", firstname: "B" })]);
    expect(report.duplicateEmails).toEqual([{ email: "x@y.pl", contacts: ["A", "B"] }]);
  });

  it("kontakt bez e-maila i bez telefonu", () => {
    const { report } = plan([contact({ firstname: "Nikt" })]);
    expect(report.noEmailNoPhone).toEqual(["Nikt"]);
  });

  it("nieprawidłowy NIP → raport, traktowany jak brak NIP", () => {
    const { clients, report } = plan([contact({ nip: "123", firstname: "Z" })]);
    expect(clients[0].nip).toBeNull();
    expect(report.unparsedNips).toEqual([{ contact: "Z", value: "123" }]);
  });
});

describe("telefony", () => {
  it("normalizuje do E.164, a gdy brak `phone` bierze `mobilephone`", () => {
    const { clients } = plan([contact({ mobilephone: "501 234 567" })]);
    expect(clients[0].contacts[0].phone).toBe("+48501234567");
  });

  it("nieparsowalny zostaje jako surowy tekst i trafia do raportu", () => {
    const { clients, report } = plan([contact({ phone: "tel. biuro", firstname: "Q" })]);
    expect(clients[0].contacts[0].phone).toBe("tel. biuro");
    expect(report.unparsedPhones).toEqual([{ contact: "Q", value: "tel. biuro" }]);
  });
});

describe("mapowanie pól", () => {
  it("tagi: blokada i źródło, reszta tylko jako surowy tag", () => {
    const { clients } = plan([contact({ tagi: "nie planujemy współpracy;pobranie oferty ze strony;były klient" })]);
    expect(clients[0]).toMatchObject({
      statusOverride: "NIE_KONTAKTOWAC",
      source: "FORMULARZ_WWW",
      legacyHubspotTag: "nie planujemy współpracy; pobranie oferty ze strony; były klient",
    });
  });

  it("urządzenia z kilku osób klienta sumują się, bez duplikatów", () => {
    const { clients } = plan(
      [contact({ urzadzenie: "Lightsheer;RersurFX", companyIds: ["f"] }), contact({ urzadzenie: "Lightsheer", companyIds: ["f"] })],
      [company({ id: "f", name: "F" })],
    );
    expect(clients[0].deviceInterests.sort()).toEqual(["LIGHTSHEER", "RESURFX"]);
  });

  it("kraj domyślnie Polska", () => {
    expect(plan([contact({})]).clients[0].country).toBe("Polska");
  });

  it("parseMoney", () => {
    expect(parseMoney("150")).toEqual({ value: "150.00", invalid: false });
    expect(parseMoney("150,50 zł")).toEqual({ value: "150.50", invalid: false });
    expect(parseMoney("do ustalenia")).toEqual({ value: null, invalid: true });
    expect(parseMoney(null)).toEqual({ value: null, invalid: false });
  });

  it("parseDistanceKm", () => {
    expect(parseDistanceKm("35 km")).toBe("35.0");
    expect(parseDistanceKm("12,5km")).toBe("12.5");
    expect(parseDistanceKm("daleko")).toBeNull();
  });

  it("mapDevices ignoruje nieznane wartości", () => {
    expect(mapDevices("AlmaHarmonyXL;Cooltech;Coś")).toEqual(["ALMA_HARMONY", "COOLTECH"]);
  });

  it("normalizeNip", () => {
    expect(normalizeNip("PL 944 228 55 99")).toEqual({ nip: "9442285599", invalid: false });
    expect(normalizeNip("")).toEqual({ nip: null, invalid: false });
  });
});
