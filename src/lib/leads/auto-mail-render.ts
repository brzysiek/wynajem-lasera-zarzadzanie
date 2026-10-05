// Mail automatyczny z cennikiem (04.10.2026) — składanie treści i wiadomości
// MIME. Czyste funkcje (vitest bez "@/"); wysyłka: src/lib/leads/auto-mail.ts.

export const AUTO_MAIL_TEMPLATE_KEY = "www_cennik_auto";
export const AUTO_MAIL_FROM = "kontakt@wynajemlasera.pl";
export const AUTO_MAIL_MAX_ATTEMPTS = 5;
// Gmail przyjmuje do 25 MB po zakodowaniu (base64 ≈ +37%).
export const AUTO_MAIL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const AUTO_MAIL_MAX_TOTAL_BYTES = 17 * 1024 * 1024;

export const DEFAULT_AUTO_MAIL = {
  subject: "Cennik oraz aktualna oferta - wynajemlasera.pl",
  body: "Dzień dobry {imie},\n\ndziękujemy za zainteresowanie. W załączniku przesyłamy aktualny cennik i katalog urządzeń.\n\nW razie pytań prosimy o kontakt.\n\nPozdrawiamy\nZespół wynajemlasera.pl",
};

// Mail potwierdzający rezerwację (brief Tomka, 5.10.2026). {zgloszenie} —
// blok „co od Ciebie otrzymaliśmy” z pominięciem pustych pól.
export const DEFAULT_RESERVATION_MAIL = {
  subject: "Otrzymaliśmy Twoją rezerwację — WynajemLasera.pl",
  body:
    "Dzień dobry {imie},\n\ndziękujemy za zgłoszenie rezerwacji. Oto, co od Ciebie otrzymaliśmy:\n\n{zgloszenie}\n\n" +
    "Co dalej? Sprawdzamy dostępność urządzenia w wybranym terminie i zadzwonimy, żeby go potwierdzić. " +
    "Rezerwacja jest bezpłatna i niezobowiązująca: bez zaliczek, a przesunięcie lub odwołanie terminu nic nie kosztuje.\n\n" +
    "Masz pytanie? Zadzwoń do Ani: +48 531 574 115 albo odpisz na tę wiadomość.",
};

export type SummaryRow = { label: string; value: string };

// Blok zgłoszenia do maila potwierdzającego — wartości tak, jak wybrała
// klientka (surowe pola formularza), puste pomijane.
export function reservationSummary(f: { devicesText: string | null; dateFromRaw: string | null; daysRaw: string | null; city: string | null; message: string | null }): SummaryRow[] {
  const msg = (f.message ?? "").split("\n").filter((l) => !/^(Firma|Miejscowość|Termin szkolenia|Formularz):/.test(l)).join("\n").trim();
  return (
    [
      { label: "Urządzenie", value: f.devicesText },
      { label: "Termin od", value: f.dateFromRaw },
      { label: "Liczba dni", value: f.daysRaw },
      { label: "Miejscowość gabinetu", value: f.city },
      { label: "Szczegóły", value: msg || null },
    ] as { label: string; value: string | null }[]
  ).filter((r): r is SummaryRow => !!r.value?.trim());
}

export function firstName(full: string | null | undefined): string | null {
  const w = (full ?? "").trim().split(/\s+/)[0];
  if (!w || /@|\d/.test(w)) return null;
  return w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
}

function fill(s: string, name: string | null): string {
  return name ? s.replace(/\{imie\}/g, name) : s.replace(/[ \t]*\{imie\}/g, "");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function linkify(escaped: string): string {
  return escaped
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}">${u}</a>`)
    .replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, (_m, pre: string, e: string) => `${pre}<a href="mailto:${e}">${e}</a>`);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Treść z ekranu ustawień: zwykły tekst (akapity, linki klikalne) albo HTML,
// gdy zaczyna się od „<”. {imie} = imię z formularza (brak → znika),
// {zgloszenie} = blok zgłoszenia (puste wiersze pominięte), footer — wspólna
// stopka (podpis) doklejana na końcu obu maili automatycznych.
export function renderAutoMail(
  tpl: { subject: string; body: string },
  vars: { name: string | null; summary?: SummaryRow[]; footer?: string | null },
): { subject: string; html: string; text: string } {
  const name = firstName(vars.name);
  const subject = fill(tpl.subject, name).trim();
  const summaryText = (vars.summary ?? []).map((r) => `${r.label}: ${r.value}`).join("\n");
  const withFooter = vars.footer?.trim() ? `${tpl.body.trim()}\n\n${vars.footer.trim()}` : tpl.body;
  const body = fill(withFooter, name).replace(/\{zgloszenie\}/g, summaryText).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (body.startsWith("<")) return { subject, html: body, text: stripHtml(body) };
  const paras = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return { subject, html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">\n${paras}\n</div>`, text: body };
}

const b64 = (s: string | Buffer) => (typeof s === "string" ? Buffer.from(s, "utf8") : s).toString("base64");
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
// RFC 2047 — nagłówki muszą być ASCII.
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export type MimeAttachment = { filename: string; mime: string; data: Buffer };

export function buildMimeMessage(m: {
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: MimeAttachment[];
  boundary?: string;
}): string {
  const bound = m.boundary ?? `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const mixed = `mix_${bound}`;
  const alt = `alt_${bound}`;
  const from = m.fromName ? `${encWord(m.fromName.replace(/["\r\n]/g, ""))} <${m.from}>` : m.from;
  const lines = [
    `From: ${from}`,
    `To: ${m.to}`,
    `Reply-To: ${m.from}`,
    `Subject: ${encWord(m.subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    "X-Auto-Response-Suppress: All",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(m.text)),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(m.html)),
    `--${alt}--`,
  ];
  for (const a of m.attachments) {
    const safe = a.filename.replace(/["\r\n\\]/g, "");
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.mime}; name="${encWord(safe)}"`,
      `Content-Disposition: attachment; filename="${encWord(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(a.data.toString("base64")),
    );
  }
  lines.push(`--${mixed}--`, "");
  return lines.join("\r\n");
}
