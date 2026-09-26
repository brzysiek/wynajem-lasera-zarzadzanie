import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Inwentaryzacja tras API pod kątem roli AGENT (instrukcja „Rola i
// uprawnienia agenta”, kryteria odbioru): każdy handler ZAPISU (POST/PATCH/
// PUT/DELETE) musi albo odrzucać agenta (requireStaffSession /
// requireAdminSession / requireDriverFinanceSession / jawna blokada roli
// AGENT / sekret crona / publiczne trasy logowania), albo być na liście
// AGENT_WRITES poniżej. Nowa trasa, która po cichu wpuszcza agenta, wywali
// ten test — trzeba ją świadomie dopisać tutaj.

const API_DIR = join(__dirname, "..", "app", "api");

// Zapisy dozwolone agentowi — każdy z własnymi ograniczeniami w handlerze
// (np. tylko notatka, tylko własne zadania, wymagane źródło zmiany).
const AGENT_WRITES = [
  "PATCH activities/[id]",
  "POST clients/[id]/activity",
  "POST clients/[id]/contacts",
  "PATCH clients/[id]/contacts/[contactId]",
  "POST clients/[id]/qualification",
  "PATCH clients/[id]",
  "POST clients/[id]/tasks",
  "POST history/decide",
  "POST history/invoices/decide",
  "POST history/rematch",
  "POST leads/[id]/activity",
  "POST leads/[id]/task",
  "POST tasks",
  "PATCH tasks/[id]",
  "POST tasks/[id]/comments",
];

const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

type Handler = { route: string; method: string; body: string };

function handlers(): Handler[] {
  return routeFiles(API_DIR).flatMap((file) => {
    const src = readFileSync(file, "utf8");
    const route = relative(API_DIR, file).replace(/\/route\.ts$/, "");
    const re = /export async function (GET|POST|PATCH|PUT|DELETE)\(/g;
    const starts = [...src.matchAll(re)].map((m) => ({ method: m[1], index: m.index ?? 0 }));
    return starts.map((s, i) => ({
      route,
      method: s.method,
      body: src.slice(s.index, starts[i + 1]?.index ?? src.length),
    }));
  });
}

function deniesAgent(h: Handler): boolean {
  const b = h.body;
  if (h.route.startsWith("auth/")) return true; // logowanie / reset hasła — publiczne
  if (/CRON_SECRET|verifyCronSecret|cronAuthorized/.test(b)) return true;
  if (/requireStaffSession\(\)|requireAdminSession\(\)|requireDriverFinanceSession\(\)/.test(b)) return true;
  if (/requireSession\(OFFICE_ROLES\)/.test(b)) return true;
  if (/role === "AGENT"\)\s*\{\s*return NextResponse\.json\(\{ message: "Brak uprawnień\." \}, \{ status: 403 \}\)/.test(b)) return true;
  return false;
}

function allowsAgent(h: Handler): boolean {
  return /requireSession\((OFFICE_AND_AGENT|ADMIN_AND_AGENT)\)/.test(h.body);
}

describe("trasy API a rola AGENT", () => {
  const all = handlers();
  const writes = all.filter((h) => (WRITE_METHODS as readonly string[]).includes(h.method));

  it("znajduje trasy API", () => {
    expect(writes.length).toBeGreaterThan(50);
  });

  it("każdy zapis albo odrzuca agenta, albo jest na liście dozwolonych", () => {
    const unclassified = writes.filter((h) => !deniesAgent(h) && !allowsAgent(h)).map((h) => `${h.method} ${h.route}`);
    expect(unclassified).toEqual([]);
  });

  it("agent może zapisywać dokładnie w dozwolonych miejscach", () => {
    const agentWrites = writes.filter((h) => allowsAgent(h) && !deniesAgent(h)).map((h) => `${h.method} ${h.route}`);
    expect(agentWrites.sort()).toEqual([...AGENT_WRITES].sort());
  });

  it("zabronione operacje są zablokowane dla agenta", () => {
    const find = (method: string, route: string) => writes.find((h) => h.method === method && h.route === route);
    const forbidden: [string, string][] = [
      ["POST", "sms/send"], // wysyłka SMS
      ["POST", "leads/[id]/sms"],
      ["POST", "message-templates"], // szablony SMS
      ["PATCH", "message-templates/[id]"],
      ["DELETE", "message-templates/[id]"],
      ["POST", "reminders/settings"], // ustawienia
      ["POST", "integrations/hubspot"],
      ["POST", "view"], // tryb kierowcy
      ["POST", "rentals"], // rezerwacje
      ["PATCH", "rentals/[id]"],
      ["DELETE", "rentals/[id]"],
      ["PATCH", "devices/[id]"], // urządzenia
      ["POST", "devices/[id]/sync"],
      ["POST", "fakturownia/invoices/[id]/send-ksef"], // faktury
      ["POST", "fakturownia/invoices/[id]/create-draft"],
      ["PATCH", "fakturownia/invoices/[id]/paid"],
      ["POST", "rentals/[id]/invoice"],
      ["POST", "rentals/[id]/invoice-link"],
      ["DELETE", "clients/[id]/contacts/[contactId]"], // usuwanie
      ["DELETE", "tasks/[id]"],
      ["DELETE", "tasks"],
      ["POST", "users"], // użytkownicy
      ["PATCH", "users/[id]"],
      ["DELETE", "users/[id]"],
      ["PATCH", "leads/[id]"], // etap sygnału
      ["POST", "leads"],
      ["POST", "clients"],
      ["POST", "leads/import/run"],
    ];
    for (const [method, route] of forbidden) {
      const h = find(method, route);
      expect(h, `${method} ${route} istnieje`).toBeDefined();
      expect(deniesAgent(h!), `${method} ${route} odrzuca agenta`).toBe(true);
    }
  });

  it("zapisy agenta z ograniczeniami mają je w kodzie", () => {
    const body = (method: string, route: string) => writes.find((h) => h.method === method && h.route === route)!.body;
    expect(body("PATCH", "clients/[id]")).toContain("AGENT_CLIENT_FIELDS");
    expect(body("PATCH", "clients/[id]")).toContain("parseProvenance(body, { required: isAgent })");
    expect(body("PATCH", "clients/[id]/contacts/[contactId]")).toContain('required: session.user.role === "AGENT"');
    expect(body("POST", "clients/[id]/contacts")).toContain('required: session.user.role === "AGENT"');
    expect(body("PATCH", "tasks/[id]")).toContain("Agent zmienia tylko własne zadania.");
    expect(body("POST", "leads/[id]/activity")).toContain("Agent dodaje tylko notatki.");
    expect(body("POST", "clients/[id]/activity")).toContain("Agent dodaje tylko notatki.");
    expect(body("POST", "clients/[id]/qualification")).toContain("Agent może tylko przenieść kontakt do klientów.");
    expect(body("PATCH", "activities/[id]")).toContain("activity.userId !== session.user.id");
  });
});
