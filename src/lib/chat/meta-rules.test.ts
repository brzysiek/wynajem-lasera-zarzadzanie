import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractContactKeys, fallbackChatName, namesMatch, parseMetaPayload, verifyMetaSignature } from "./meta-rules";

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyMetaSignature", () => {
  const body = '{"object":"page"}';
  it("przyjmuje poprawny podpis", () => expect(verifyMetaSignature(body, sign(body, "sekret"), "sekret")).toBe(true));
  it("odrzuca zły sekret, zmienione ciało, brak nagłówka i brak sekretu", () => {
    expect(verifyMetaSignature(body, sign(body, "inny"), "sekret")).toBe(false);
    expect(verifyMetaSignature(`${body} `, sign(body, "sekret"), "sekret")).toBe(false);
    expect(verifyMetaSignature(body, null, "sekret")).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "sekret"), undefined)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zzzz", "sekret")).toBe(false);
  });
});

describe("parseMetaPayload", () => {
  const page = "PAGE1";
  const inbound = { object: "page", entry: [{ id: page, time: 1, messaging: [{ sender: { id: "U1" }, recipient: { id: page }, timestamp: 1780000000000, message: { mid: "m1", text: "Dzień dobry, czy wynajmujecie Almę?" } }] }] };
  it("wiadomość klientki", () => {
    expect(parseMetaPayload(inbound)).toEqual([{ channel: "MESSENGER", pageId: page, userId: "U1", mid: "m1", text: "Dzień dobry, czy wynajmujecie Almę?", attachments: [], at: new Date(1780000000000), outbound: false }]);
  });
  it("echo naszej odpowiedzi: użytkownikiem jest adresat", () => {
    const echo = { object: "page", entry: [{ id: page, messaging: [{ sender: { id: page }, recipient: { id: "U1" }, timestamp: 1780000100000, message: { mid: "m2", text: "Tak, zapraszam", is_echo: true } }] }] };
    expect(parseMetaPayload(echo)[0]).toMatchObject({ userId: "U1", outbound: true, mid: "m2" });
  });
  it("Instagram i załączniki", () => {
    const ig = { object: "instagram", entry: [{ id: "IG1", messaging: [{ sender: { id: "S1" }, recipient: { id: "IG1" }, timestamp: 1780000000000, message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://x/y.jpg" } }] } }] }] };
    expect(parseMetaPayload(ig)[0]).toMatchObject({ channel: "INSTAGRAM", text: null, attachments: [{ type: "image", url: "https://x/y.jpg" }] });
  });
  it("standby (głównym odbiorcą jest inna aplikacja, np. HubSpot): ta sama obsługa co messaging", () => {
    const standby = {
      object: "page",
      entry: [
        {
          id: page,
          standby: [
            { sender: { id: "U1" }, recipient: { id: page }, timestamp: 1780000000000, message: { mid: "s1", text: "Pytanie przy HubSpocie" } },
            { sender: { id: page }, recipient: { id: "U1" }, timestamp: 1780000100000, message: { mid: "s2", text: "Odpowiedź z HubSpota", is_echo: true } },
          ],
        },
      ],
    };
    expect(parseMetaPayload(standby).map((e) => [e.mid, e.userId, e.outbound])).toEqual([["s1", "U1", false], ["s2", "U1", true]]);
    // ta sama wiadomość w messaging i standby → dwa zdarzenia o tym samym mid (zapis i tak jeden)
    const both = { object: "page", entry: [{ id: page, messaging: [standby.entry[0].standby![0]], standby: [standby.entry[0].standby![0]] }] };
    expect(parseMetaPayload(both).map((e) => e.mid)).toEqual(["s1", "s1"]);
  });
  it("pomija zdarzenia bez wiadomości i błędne ładunki", () => {
    expect(parseMetaPayload({ object: "page", entry: [{ id: page, messaging: [{ sender: { id: "U1" }, recipient: { id: page }, timestamp: 1, read: { watermark: 1 } }] }] })).toEqual([]);
    expect(parseMetaPayload({ object: "user", entry: [] })).toEqual([]);
    expect(parseMetaPayload(null)).toEqual([]);
    expect(parseMetaPayload("x")).toEqual([]);
  });
});

describe("klucze i imiona", () => {
  it("telefon i e-mail z treści", () => {
    expect(extractContactKeys("Mój numer 601 234 567, mail Anna.K@Gmail.com")).toEqual({ phone: "+48601234567", email: "anna.k@gmail.com" });
    expect(extractContactKeys("bez danych")).toEqual({ phone: null, email: null });
    expect(extractContactKeys(null)).toEqual({ phone: null, email: null });
  });
  it("namesMatch: kolejność, ogonki, wymaga dwóch słów", () => {
    expect(namesMatch("Anna Klęczar", "Klęczar Anna")).toBe(true);
    expect(namesMatch("Anna Klęczar", "anna kleczar")).toBe(true);
    expect(namesMatch("Anna Klęczar", "Anna Kowalska")).toBe(false);
    expect(namesMatch("Anna", "Anna Klęczar")).toBe(false);
    expect(namesMatch("Anna Klęczar", "Anna Maria Klęczar")).toBe(true);
    expect(namesMatch(null, "Anna Klęczar")).toBe(false);
  });
  it("podpis zastępczy", () => expect(fallbackChatName("INSTAGRAM", "1234567890")).toBe("Instagram 7890"));
});
