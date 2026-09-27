// Uzupełnianie danych klienta po NIP (prompt-code-karta-klienta.md, sekcja 5):
// odpowiedzi Białej listy MF (wl-api.mf.gov.pl, bez klucza) i CEIDG
// (dane.biznes.gov.pl, token) → pola klienta. Czysty moduł (vitest bez "@/").
// Parsowanie defensywne — pola nieobecne w odpowiedzi zostają null.

export type RegistryFields = Partial<{
  name: string;
  regon: string;
  vatStatus: string;
  bankAccounts: string[];
  street: string;
  zip: string;
  city: string;
  legalForm: string;
  businessStartDate: string; // RRRR-MM-DD
  pkd: { code: string; name: string | null; main: boolean }[];
}>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// „UL. RUDAWSKA 4, 32-064 RUDAWA” → ulica, kod, miasto.
export function splitAddress(raw: string | null): { street: string | null; zip: string | null; city: string | null } {
  if (!raw) return { street: null, zip: null, city: null };
  const m = raw.match(/^(.*?),?\s*(\d{2}-\d{3})\s+(.+)$/);
  if (!m) return { street: raw, zip: null, city: null };
  return { street: titleCase(m[1].replace(/,\s*$/, "")), zip: m[2], city: titleCase(m[3]) };
}

// Rejestry podają wersaliki — „UL. RUDAWSKA 4” → „ul. Rudawska 4”.
export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s.trim();
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (/^(ul\.|al\.|pl\.|os\.|i|w|z|nad|pod)$/.test(w) ? w : /^[ivx]{2,}$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("")
    .trim();
}

// Biała lista: { result: { subject: { name, statusVat, regon, workingAddress,
// residenceAddress, accountNumbers[] } } } — subject null = brak podmiotu.
export function parseWhiteList(body: unknown): RegistryFields | null {
  const subject = (body as { result?: { subject?: Record<string, unknown> | null } } | null)?.result?.subject;
  if (!subject || typeof subject !== "object") return null;
  const address = splitAddress(str(subject.workingAddress) ?? str(subject.residenceAddress));
  const accounts = Array.isArray(subject.accountNumbers) ? subject.accountNumbers.filter((a): a is string => typeof a === "string" && /^\d{26}$/.test(a)) : [];
  const out: RegistryFields = {};
  const name = str(subject.name);
  if (name) out.name = name;
  const regon = str(subject.regon);
  if (regon && /^\d{9}(\d{5})?$/.test(regon)) out.regon = regon;
  const vat = str(subject.statusVat);
  if (vat) out.vatStatus = vat;
  if (accounts.length) out.bankAccounts = accounts;
  if (address.street) out.street = address.street;
  if (address.zip) out.zip = address.zip;
  if (address.city) out.city = address.city;
  return out;
}

// CEIDG v2 (firma): { firma: [{ nazwa, dataRozpoczecia, wlasciciel: { regon },
// adresDzialalnosci: { ulica, budynek, lokal, kod, miasto }, pkd, pkdGlowny }] }.
export function parseCeidg(body: unknown): RegistryFields | null {
  const b = body as Record<string, unknown> | null;
  const list = (Array.isArray(b?.firma) ? b!.firma : Array.isArray(b?.firmy) ? b!.firmy : null) as Record<string, unknown>[] | null;
  const f = list?.[0];
  if (!f || typeof f !== "object") return null;
  const out: RegistryFields = { legalForm: "JDG" };
  const name = str(f.nazwa);
  if (name) out.name = name;
  const start = str(f.dataRozpoczecia);
  if (start && /^\d{4}-\d{2}-\d{2}/.test(start)) out.businessStartDate = start.slice(0, 10);
  const owner = (f.wlasciciel ?? {}) as Record<string, unknown>;
  const regon = str(owner.regon) ?? str(f.regon);
  if (regon && /^\d{9}(\d{5})?$/.test(regon)) out.regon = regon;
  const a = (f.adresDzialalnosci ?? {}) as Record<string, unknown>;
  const street = [str(a.ulica), [str(a.budynek), str(a.lokal)].filter(Boolean).join("/")].filter(Boolean).join(" ");
  if (street) out.street = titleCase(street.startsWith("ul.") ? street : `ul. ${street}`);
  if (str(a.kod)) out.zip = str(a.kod)!;
  if (str(a.miasto)) out.city = titleCase(str(a.miasto)!);
  const code = (v: unknown): { code: string; name: string | null } | null => {
    if (typeof v === "string") return /^\d{2}\.?\d{2}\.?[A-Z]$/i.test(v.trim()) ? { code: normPkd(v), name: null } : null;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const k = str(o.kod) ?? str(o.code);
      return k ? { code: normPkd(k), name: str(o.nazwa) ?? str(o.name) } : null;
    }
    return null;
  };
  const main = code(f.pkdGlowny);
  const all = (Array.isArray(f.pkd) ? f.pkd : []).map(code).filter((x): x is { code: string; name: string | null } => !!x);
  const pkd = [...(main ? [{ ...main, main: true }] : []), ...all.filter((p) => p.code !== main?.code).map((p) => ({ ...p, main: false }))];
  if (pkd.length) {
    if (!main) pkd[0].main = true;
    out.pkd = pkd;
  }
  return out;
}

function normPkd(v: string): string {
  const d = v.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 5)}`;
}

// Co zapisać: pola z rejestru, pomijając zablokowane ręcznie (lockedManual)
// i — dla nazwy i adresu — już wypełnione (nazwa robocza biura zostaje).
export function planEnrichment(
  current: Record<string, unknown>,
  found: RegistryFields,
  locked: (field: string) => boolean,
): RegistryFields {
  const out: RegistryFields = {};
  const fillOnly = new Set(["name", "street", "zip", "city"]);
  for (const [k, v] of Object.entries(found) as [keyof RegistryFields, RegistryFields[keyof RegistryFields]][]) {
    if (v == null || locked(k)) continue;
    const cur = current[k];
    if (fillOnly.has(k) && cur != null && cur !== "") continue;
    if (JSON.stringify(normalizeCurrent(k, cur)) === JSON.stringify(v)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function normalizeCurrent(k: string, v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (k === "businessStartDate" && typeof v === "string") return v.slice(0, 10);
  return v ?? null;
}
