import { describe, expect, it } from "vitest";
import { bounceRecipients, isOfferMail, planMailForLead, type MailLead } from "./mail-rules";

const at = (day: number, h = 12) => new Date(2026, 8, day, h);
const now = at(28, 12); // pn 28.09
const lead = (p: Partial<MailLead> = {}): MailLead => ({ stage: "SYGNAL", firstContactAt: null, lastContactAt: null, createdAt: at(25), ...p });

describe("automaty mailowe (lejek v2, V3)", () => {
  it("oferta: temat z „ofert”, ale nie automatyczny cennik ani jego wątek", () => {
    expect(isOfferMail("Wynajemlasera - Oferta na sezon 2026/2027")).toBe(true);
    expect(isOfferMail("oferta współpracy Cooltech")).toBe(true);
    expect(isOfferMail("Cennik oraz aktualna oferta - wynajemlasera.pl")).toBe(false);
    expect(isOfferMail("Re: Cennik oraz aktualna oferta - wynajemlasera.pl")).toBe(false);
    expect(isOfferMail("Re: wynajem Observ 520x")).toBe(false);
  });

  it("mail z ofertą: Nowe / W kontakcie → Oferta wysłana z follow-upem +3 dni rob.", () => {
    const p = planMailForLead(lead(), { direction: "OUT", subject: "Oferta na sezon", sentAt: at(28, 9) }, now);
    expect(p).toMatchObject({ stage: "OFERTA", nextStepType: "FOLLOW_UP_OFERTY", followUpNo: 1, firstContactAt: at(28, 9) });
    expect(p!.nextActionAt).toEqual(new Date(2026, 9, 1, 10));
    // do przodu: Rezerwacja zostaje
    expect(planMailForLead(lead({ stage: "REZERWACJA", firstContactAt: at(20) }), { direction: "OUT", subject: "Oferta", sentAt: at(28, 9) }, now)).not.toHaveProperty("stage");
  });

  it("zwykły mail: nietknięte → W kontakcie; odpowiedź klientki → krok na dziś", () => {
    expect(planMailForLead(lead(), { direction: "OUT", subject: "Re: wynajem", sentAt: at(28, 9) }, now)).toMatchObject({ stage: "WYWIAD", nextStepNote: "sprawdzić odpowiedź na maila" });
    expect(planMailForLead(lead(), { direction: "IN", subject: "Pytanie", sentAt: at(28, 9) }, now)).toMatchObject({ stage: "WYWIAD", nextActionAt: now });
    const inContact = planMailForLead(lead({ stage: "OFERTA", firstContactAt: at(26) }), { direction: "IN", subject: "Re: Oferta", sentAt: at(28, 9) }, now);
    expect(inContact).toMatchObject({ lastContactAt: at(28, 9) });
    expect(inContact).not.toHaveProperty("stage");
  });

  it("bez zmian: automatyczny cennik, mail sprzed sygnału, stara historia", () => {
    expect(planMailForLead(lead(), { direction: "OUT", subject: "Cennik oraz aktualna oferta - wynajemlasera.pl", sentAt: at(28, 9) }, now)).toBeNull();
    expect(planMailForLead(lead(), { direction: "OUT", subject: "Oferta", sentAt: at(24) }, now)).toBeNull();
    expect(planMailForLead(lead({ createdAt: at(1) }), { direction: "OUT", subject: "Oferta", sentAt: at(10) }, now)).toBeNull();
  });

  it("odbity mail: adres z X-Failed-Recipients", () => {
    expect(bounceRecipients({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)", "x-failed-recipients": "Nikola@Example.pl" })).toEqual(["nikola@example.pl"]);
    expect(bounceRecipients({ from: "klientka@example.pl", subject: "Oferta" })).toEqual([]);
  });
});
