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
  // Porządki: wnioski (statusy decyzyjne i tak tylko ADMIN — rules.ts), uwagi.
  "POST porzadki/wnioski",
  "PATCH porzadki/wnioski/[id]",
  "POST porzadki/wnioski/[id]/komentarze",
  "POST porzadki/wnioski/[id]/powiazania",
  "POST porzadki/uwagi",
  "PATCH porzadki/uwagi/[id]",
  "POST porzadki/uwagi/[id]/wniosek",
  // API agenta (token, /api/agent/*) — te same reguły co w panelu.
  "POST agent/wnioski",
  "PATCH agent/wnioski/[id]",
  "POST agent/wnioski/[id]/komentarze",
  "POST agent/uwagi",
  "PATCH agent/uwagi/[id]",
  "POST agent/dziennik",
  "PATCH agent/klienci/[id]",
  "PATCH agent/klienci/[id]/kontakty/[contactId]",
  // Scalanie duplikatów (instrukcja „Rola agenta”: scalanie dozwolone,
  // ze źródłem i pewnością; duplikat trafia do archiwum „duplikat”).
  "POST clients/[id]/merge",
  "POST agent/klienci/[id]/scal",
  // Serwer MCP (konektor claude.ai) — narzędzia z listy MCP_TOOLS niżej.
  "POST mcp",
  // Propozycje zmian (etap D): zgłaszanie; decyzje tylko ADMIN.
  "POST porzadki/propozycje",
  "POST agent/propozycje",
];

// Narzędzia MCP — dokładna lista; nowe narzędzie trzeba świadomie dopisać.
const MCP_TOOLS = [
  "reguly_porzadkow", "klienci_lista", "klient", "sygnaly_lista", "sygnal", "kalendarz_wynajmy", "dopasowania", "faktury",
  "fv_bez_faktury", "archiwum", "dziennik", "wnioski_lista", "wniosek", "uwagi_lista", "zadania_lista", "osoby_biura",
  "klient_zmien", "osoba_zmien", "osoba_dodaj", "klienci_scal", "przenies_do_klientow", "notatka_klient", "notatka_sygnal",
  "zadanie_utworz", "zadanie_zmien", "zadanie_komentarz", "wniosek_utworz", "wniosek_zmien", "wniosek_komentarz",
  "uwaga_utworz", "uwaga_zmien", "dziennik_wpis", "propozycje_dodaj", "propozycje_lista",
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

// Publiczne z definicji trasy OAuth konektora MCP: rejestracja klienta
// (tylko adresy powrotu claude.ai/claude.com) i endpoint tokenu (kod + PKCE
// albo token odświeżający). Same nie dają dostępu do danych.
const OAUTH_PUBLIC = ["POST oauth/register", "POST oauth/token"];

function deniesAgent(h: Handler): boolean {
  const b = h.body;
  if (h.route.startsWith("auth/")) return true; // logowanie / reset hasła — publiczne
  if (OAUTH_PUBLIC.includes(`${h.method} ${h.route}`)) return true;
  if (/CRON_SECRET|verifyCronSecret|cronAuthorized/.test(b)) return true;
  if (/requireStaffSession\(\)|requireAdminSession\(\)|requireDriverFinanceSession\(\)/.test(b)) return true;
  if (/requireSession\(OFFICE_ROLES\)/.test(b)) return true;
  if (/role === "AGENT"\)\s*\{\s*return NextResponse\.json\(\{ message: "Brak uprawnień\." \}, \{ status: 403 \}\)/.test(b)) return true;
  return false;
}

function allowsAgent(h: Handler): boolean {
  return /requireSession\((OFFICE_AND_AGENT|ADMIN_AND_AGENT)\)/.test(h.body) || /return withAgent\(req, /.test(h.body) || /await resolveAgent\(req\)/.test(h.body);
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
      ["POST", "porzadki/dziennik/[id]/cofnij"], // cofanie zmian — ADMIN
      ["DELETE", "porzadki/wnioski/[id]/powiazania"],
      ["POST", "porzadki/reguly"], // reguły — ADMIN
      ["PATCH", "porzadki/reguly/[id]"],
      ["DELETE", "porzadki/reguly/[id]"],
      ["POST", "porzadki/archiwum"], // archiwizacja — ADMIN (agent tylko proponuje)
      ["POST", "porzadki/archiwum/przywroc"],
      ["POST", "porzadki/archiwum/usun"], // trwałe usuwanie — ADMIN
      ["POST", "porzadki/propozycje/decyzja"], // akceptacja propozycji — ADMIN
      ["PATCH", "porzadki/propozycje/[id]"],
      ["POST", "porzadki/propozycje/klasy"],
      ["DELETE", "porzadki/propozycje/klasy"],
    ];
    for (const [method, route] of forbidden) {
      const h = find(method, route);
      expect(h, `${method} ${route} istnieje`).toBeDefined();
      expect(deniesAgent(h!), `${method} ${route} odrzuca agenta`).toBe(true);
    }
  });

  it("każda trasa /api/agent/* wymaga tokenu agenta", () => {
    const agentRoutes = all.filter((h) => h.route.startsWith("agent/"));
    expect(agentRoutes.length).toBeGreaterThan(10);
    expect(agentRoutes.filter((h) => !/return withAgent\(req, /.test(h.body)).map((h) => `${h.method} ${h.route}`)).toEqual([]);
  });

  it("API agenta: zmiana klienta wymaga paczki, tokeny zarządza ADMIN", () => {
    const body = (method: string, route: string) => all.find((h) => h.method === method && h.route === route)!.body;
    expect(body("PATCH", "agent/klienci/[id]")).toContain("requireBatch: true");
    expect(body("PATCH", "agent/klienci/[id]/kontakty/[contactId]")).toContain("requireBatch: true");
    for (const [m, r] of [
      ["POST", "users/[id]/tokens"],
      ["DELETE", "users/[id]/tokens/[tokenId]"],
      ["GET", "users/[id]/api-calls"],
    ]) {
      expect(body(m, r), `${m} ${r}`).toContain("requireAdminSession()");
    }
  });

  it("MCP: 401 wskazuje metadane OAuth, zgodę wydaje ADMIN, narzędzia bez zakazanych operacji", () => {
    const body = (method: string, route: string) => all.find((h) => h.method === method && h.route === route)!.body;
    const mcpRoute = readFileSync(join(API_DIR, "mcp", "route.ts"), "utf8");
    expect(mcpRoute).toContain("resource_metadata=");
    expect(body("POST", "mcp")).toContain("status: 401, headers: UNAUTHORIZED_HEADERS()");
    expect(body("POST", "oauth/authorize")).toContain("requireAdminSession()");
    const tools = readFileSync(join(__dirname, "mcp", "tools.ts"), "utf8");
    const names = [...tools.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]);
    expect(names.sort()).toEqual([...MCP_TOOLS].sort());
    for (const forbidden of ["sms", "sendSms", "archiveRecords", "deleteArchived", "restoreRecords", "rental.create", "rental.update", "rental.delete", "@/lib/integrations/fakturownia", "@/lib/integrations/szybkisms", "gmail.compose", ".delete(", "deleteMany"]) {
      expect(tools, forbidden).not.toContain(forbidden);
    }
    const server = readFileSync(join(__dirname, "oauth", "server.ts"), "utf8");
    expect(server).toContain("verifyPkce(verifier, row.codeChallenge)");
    expect(server).toContain("usedAt: null");
    expect(server).toContain('agent?.role !== "AGENT"');
  });

  it("agent przydziela zadania tylko osobom z agentAssignable (Tomek, Ania)", () => {
    const body = (method: string, route: string) => all.find((h) => h.method === method && h.route === route)!.body;
    for (const [m, r] of [
      ["POST", "tasks"],
      ["PATCH", "tasks/[id]"],
      ["POST", "clients/[id]/tasks"],
      ["POST", "leads/[id]/task"],
    ]) {
      expect(body(m, r), `${m} ${r}`).toContain("agentMayAssign(");
    }
    expect(body("GET", "tasks/assignees")).toContain("agentAssignees()");
    const tools = readFileSync(join(__dirname, "mcp", "tools.ts"), "utf8");
    expect(tools).toContain("const people = await agentAssignees();");
    expect(readFileSync(join(__dirname, "agent-api", "assignees.ts"), "utf8")).toContain("agentAssignable: true");
  });

  it("zapisy agenta z ograniczeniami mają je w kodzie", () => {
    const body = (method: string, route: string) => writes.find((h) => h.method === method && h.route === route)!.body;
    // Zmiana klienta i osoby: wspólna logika w src/lib/clients/update.ts.
    expect(body("PATCH", "clients/[id]")).toContain("patchClient(id, body, { userId: session.user.id, role: session.user.role })");
    expect(body("PATCH", "clients/[id]/contacts/[contactId]")).toContain("patchContact(");
    const update = readFileSync(join(__dirname, "clients", "update.ts"), "utf8");
    expect(update).toContain("AGENT_CLIENT_FIELDS");
    expect(update).toContain("parseProvenance(body, { required: isAgent })");
    expect(update).toContain('parseProvenance(body, { required: actor.role === "AGENT" })');
    expect(body("POST", "clients/[id]/contacts")).toContain('required: session.user.role === "AGENT"');
    expect(body("PATCH", "tasks/[id]")).toContain("Agent zmienia tylko własne zadania.");
    expect(body("POST", "leads/[id]/activity")).toContain("Agent dodaje tylko notatki.");
    expect(body("POST", "clients/[id]/activity")).toContain("Agent dodaje tylko notatki.");
    expect(body("POST", "clients/[id]/qualification")).toContain("Agent może tylko przenieść kontakt do klientów.");
    expect(body("PATCH", "activities/[id]")).toContain("activity.userId !== session.user.id");
    expect(body("POST", "porzadki/archiwum/usun")).toContain("Number(body?.confirm) !== target.ids.length");
    const merge = readFileSync(join(__dirname, "clients", "merge.ts"), "utf8");
    expect(merge).toContain('parseProvenance(body, { required: actor.role === "AGENT" })');
  });
});
