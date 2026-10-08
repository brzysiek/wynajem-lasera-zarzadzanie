import { describe, expect, it } from "vitest";
import { DEFAULT_RESERVATION_MAIL, buildMimeMessage, firstName, renderAutoMail, renderDraftMail, reservationSummary } from "./auto-mail-render";

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

describe("reservationSummary + stopka", () => {
  it("pomija puste pola i pokazuje wartości jak z formularza", () => {
    const rows = reservationSummary({ devicesText: "Observ 520x", dateFromRaw: "2026-11-02", daysRaw: "tydzień (Observ)", city: "", message: "Proszę o kontakt po 17\nMiejscowość: Kraków" });
    expect(rows).toEqual([
      { label: "Urządzenie", value: "Observ 520x" },
      { label: "Termin od", value: "2026-11-02" },
      { label: "Liczba dni", value: "tydzień (Observ)" },
      { label: "Szczegóły", value: "Proszę o kontakt po 17" },
    ]);
    expect(reservationSummary({ devicesText: null, dateFromRaw: null, daysRaw: null, city: null, message: null })).toEqual([]);
  });
  it("{zgloszenie} i stopka trafiają do treści", () => {
    const r = renderAutoMail(DEFAULT_RESERVATION_MAIL, {
      name: "anna",
      summary: [{ label: "Urządzenie", value: "LightSheer Desire" }, { label: "Termin od", value: "2026-11-02" }],
      footer: "Pozdrawiam\nAnna Ślizowska\nwynajemlasera.pl",
    });
    expect(r.subject).toBe("Otrzymaliśmy Twoją rezerwację — WynajemLasera.pl");
    expect(r.text).toContain("Dzień dobry Anna,");
    expect(r.text).toContain("Urządzenie: LightSheer Desire\nTermin od: 2026-11-02");
    expect(r.text.trimEnd().endsWith("wynajemlasera.pl")).toBe(true);
    expect(r.html).toContain("Urządzenie: LightSheer Desire<br>");
  });
  it("puste zgłoszenie nie zostawia dziury ani znacznika", () => {
    const r = renderAutoMail(DEFAULT_RESERVATION_MAIL, { name: null, summary: [] });
    expect(r.text).not.toContain("{zgloszenie}");
    expect(r.text).not.toContain("\n\n\n");
  });
});

describe("stopka w HTML", () => {
  const footer = '<table><tr><td><img src="https://wynajemlasera.pl/logo.png" width="120" alt="logo"></td><td><b>Anna</b><br>+48 531 574 115</td></tr></table>';
  it("HTML w stopce przy zwykłej treści nie jest escapowany", () => {
    const r = renderAutoMail({ subject: "S", body: "Dzień dobry {imie},\n\nCennik w załączniku." }, { name: "Ola", footer });
    expect(r.html).toContain('<img src="https://wynajemlasera.pl/logo.png"');
    expect(r.html).toContain("<p style=\"margin:0 0 12px\">Dzień dobry Ola,</p>");
    expect(r.html).not.toContain("&lt;table");
    expect(r.text).toContain("Anna\n+48 531 574 115"); // wersja tekstowa bez znaczników
    expect(r.text).not.toContain("<");
  });
  it("treść HTML + stopka tekstowa też się łączą", () => {
    const r = renderAutoMail({ subject: "S", body: "<p>Dzień dobry</p>" }, { name: null, footer: "Pozdrawiam\nAnna" });
    expect(r.html).toContain("<p>Dzień dobry</p>");
    expect(r.html).toContain("Pozdrawiam<br>Anna");
  });
  it("usuwa skrypty, ramki, atrybuty on* i javascript:", () => {
    const dirty = '<p onclick="x()">a</p><script>alert(1)</script><iframe src="//e"></iframe><a href="javascript:alert(1)">l</a><img src="https://a/b.png" onerror="y()">';
    const r = renderAutoMail({ subject: "S", body: "Treść" }, { name: null, footer: dirty });
    expect(r.html).not.toMatch(/script|iframe|onclick|onerror|javascript:/i);
    expect(r.html).toContain('<img src="https://a/b.png"');
  });
});

describe("szkic odpowiedzi (wniosek 44)", () => {
  it("renderDraftMail: zwykły tekst bez podstawiania znaczników, stopka HTML dołączona", () => {
    const r = renderDraftMail("Dzień dobry {imie},\n\nProponuję termin <12.11>.", '<table><tr><td><img src="https://wynajemlasera.pl/ania.png"></td><td><b>Ania</b></td></tr></table>');
    expect(r.html).toContain("Dzień dobry {imie},"); // nie podstawiamy
    expect(r.html).toContain("&lt;12.11&gt;");
    expect(r.html).toContain('<img src="https://wynajemlasera.pl/ania.png"');
    expect(r.text).toContain("Dzień dobry {imie},");
    expect(r.text.trimEnd().endsWith("Ania")).toBe(true);
  });
  it("renderDraftMail bez stopki", () => {
    const r = renderDraftMail("Sama treść", "");
    expect(r.text).toBe("Sama treść");
    expect(r.html).toContain("Sama treść");
  });
  it("buildMimeMessage: nagłówki odpowiedzi w wątku", () => {
    const raw = buildMimeMessage({ from: "kontakt@wynajemlasera.pl", to: "k@example.com", subject: "Re: Wynajem", html: "<p>x</p>", text: "x", attachments: [], inReplyTo: "abc123@mail.gmail.com", boundary: "B" });
    expect(raw).toContain("In-Reply-To: <abc123@mail.gmail.com>");
    expect(raw).toContain("References: <abc123@mail.gmail.com>");
    const already = buildMimeMessage({ from: "a@b.pl", to: "k@example.com", subject: "S", html: "x", text: "x", attachments: [], inReplyTo: "<id@x>\r\nBcc: zly@x.pl", boundary: "B" });
    expect(already).toContain("In-Reply-To: <id@xBcc:zly@x.pl>"); // brak wstrzyknięcia nagłówka
    expect(already).not.toMatch(/^Bcc:/m);
    expect(buildMimeMessage({ from: "a@b.pl", to: "k@example.com", subject: "S", html: "x", text: "x", attachments: [], boundary: "B" })).not.toContain("In-Reply-To");
  });
});
