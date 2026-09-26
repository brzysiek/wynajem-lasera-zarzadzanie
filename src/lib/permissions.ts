// Uprawnienia ról — jedno miejsce prawdy dla proxy (strony), strażników API
// (src/lib/auth-guards.ts) i testów. Czyste stałe i funkcje bez importów —
// używalne również w middleware.
//
// Zasada dla roli AGENT (agent AI „Klaudiusz”, asystent biura): domyślnie
// ZABLOKOWANY. requireStaffSession() dalej przepuszcza tylko ADMIN/STAFF,
// więc każdy endpoint, którego tu jawnie nie otwarto, zwraca agentowi 403.
// Agent czyta, porządkuje dane klientów i przygotowuje zadania; nie kontaktuje
// się z klientami (SMS, e-mail), nie zmienia rezerwacji, niczego nie usuwa.

export type AppRole = "ADMIN" | "STAFF" | "KIEROWCA" | "AGENT";

// Biuro (jak requireStaffSession).
export const OFFICE_ROLES: readonly AppRole[] = ["ADMIN", "STAFF"];
// Biuro + agent — odczyt modułów CRM i zapisy dozwolone agentowi.
export const OFFICE_AND_AGENT: readonly AppRole[] = ["ADMIN", "STAFF", "AGENT"];
// Admin + agent — np. odczyt faktur (Finanse → Faktury VAT), „FV bez faktury”.
export const ADMIN_AND_AGENT: readonly AppRole[] = ["ADMIN", "AGENT"];

export function hasRole(role: string | undefined | null, allowed: readonly AppRole[]): boolean {
  return !!role && (allowed as readonly string[]).includes(role);
}

// Strony dostępne agentowi (ścieżki bez basePath). Reszta — Ustawienia,
// Przychody, Koszty, nowa rezerwacja — przekierowuje na kalendarz (proxy.ts).
const AGENT_PAGE_PREFIXES = [
  "/kalendarz",
  "/nadchodzace",
  "/sygnaly",
  "/klienci",
  "/urzadzenia",
  "/finanse/faktury",
  "/wysylka-sms",
];
const AGENT_BLOCKED_PAGES = ["/kalendarz/wynajem/nowy"];

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function agentMayOpenPage(path: string): boolean {
  if (path === "/" || path === "") return true;
  if (AGENT_BLOCKED_PAGES.some((p) => underPrefix(path, p))) return false;
  return AGENT_PAGE_PREFIXES.some((p) => underPrefix(path, p));
}

// Pola klienta, które agent może zmieniać (PATCH /api/clients/[id]). Bez
// ceny transportu, odległości i notatki biura — to dane biura/finansów.
export const AGENT_CLIENT_FIELDS = [
  "name",
  "nip",
  "street",
  "zip",
  "city",
  "country",
  "clinicType",
  "source",
  "deviceInterests",
  "statusOverride",
] as const;
