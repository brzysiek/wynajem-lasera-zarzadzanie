import { describe, expect, it } from "vitest";
import { buildMimeMessage, firstName, renderAutoMail } from "./auto-mail-render";

describe("firstName", () => {
  it("bierze pierwsze słowo i poprawia wielkość liter", () => {
    expect(firstName("anna kowalska")).toBe("Anna");
    expect(firstName("ANNA")).toBe("Anna");
    expect(firstName("McKenzie")).toBe("McKenzie");
  });
  it("puste, e-mail albo cyfry → brak imienia", () => {
    expect(firstName(null)).toBeNull();
    expect(firstName("  ")).toBeNull();
    expect(firstName("jan@x.pl")).toBeNull();
    expect(firstName("600100200")).toBeNull();
  });
});

describe("renderAutoMail", () => {
  const tpl = { subject: "Cennik dla {imie}", body: "Dzień dobry {imie},\n\nCennik w załączniku.\nWięcej: https://wynajemlasera.pl/oferta.\n\nPytania: kontakt@wynajemlasera.pl" };
  it("wstawia imię, robi akapity i klikalne linki", () => {
    const r = renderAutoMail(tpl, { name: "anna nowak" });
    expect(r.subject).toBe("Cennik dla Anna");
    expect(r.text.startsWith("Dzień dobry Anna,")).toBe(true);
    expect(r.html).toContain('<a href="https://wynajemlasera.pl/oferta">https://wynajemlasera.pl/oferta</a>.');
    expect(r.html).toContain('<a href="mailto:kontakt@wynajemlasera.pl">');
    expect(r.html).toContain("Cennik w załączniku.<br>");
    expect(r.html.match(/<p /g)).toHaveLength(3);
  });
  it("bez imienia znaczniki znikają razem ze spacją", () => {
    const r = renderAutoMail(tpl, { name: null });
    expect(r.subject).toBe("Cennik dla");
    expect(r.text.startsWith("Dzień dobry,")).toBe(true);
  });
  it("treść w HTML przechodzi bez zmian, tekst bez znaczników", () => {
    const r = renderAutoMail({ subject: "S", body: "<p>Dzień dobry {imie}</p><p>A &amp; B</p>" }, { name: "Ola" });
    expect(r.html).toBe("<p>Dzień dobry Ola</p><p>A &amp; B</p>");
    expect(r.text).toBe("Dzień dobry Ola\nA & B");
  });
  it("escapuje znaki HTML w zwykłym tekście", () => {
    expect(renderAutoMail({ subject: "S", body: "a <b> & c" }, { name: null }).html).toContain("a &lt;b&gt; &amp; c");
  });
});

describe("buildMimeMessage", () => {
  const raw = buildMimeMessage({
    from: "kontakt@wynajemlasera.pl",
    fromName: "Anna — wynajemlasera.pl",
    to: "klient@example.com",
    subject: "Cennik oraz aktualna oferta - wynajemlasera.pl",
    html: "<p>Zażółć</p>",
    text: "Zażółć",
    attachments: [{ filename: "Cennik 2025 – wynajem.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 test") }],
    boundary: "X",
  });
  it("nagłówki ASCII, polskie znaki zakodowane", () => {
    const head = raw.split("\r\n\r\n")[0];
    expect(/^[\x00-\x7f]*$/.test(head)).toBe(true);
    expect(head).toContain("From: =?UTF-8?B?");
    expect(head).toContain("<kontakt@wynajemlasera.pl>");
    expect(head).toContain("Subject: Cennik oraz aktualna oferta - wynajemlasera.pl");
    expect(head).toContain('multipart/mixed; boundary="mix_X"');
  });
  it("tekst, HTML i załącznik z nazwą UTF-8", () => {
    expect(raw).toContain("Content-Type: text/plain");
    expect(raw).toContain("Content-Type: text/html");
    expect(raw).toContain(Buffer.from("<p>Zażółć</p>").toString("base64"));
    expect(raw).toContain("filename*=UTF-8''Cennik%202025%20%E2%80%93%20wynajem.pdf");
    expect(raw).toContain(Buffer.from("%PDF-1.4 test").toString("base64"));
    expect(raw.trimEnd().endsWith("--mix_X--")).toBe(true);
  });
});
