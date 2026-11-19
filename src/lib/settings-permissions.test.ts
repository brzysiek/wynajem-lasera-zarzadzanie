import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_GROUPS } from "./settings-nav";

// Wniosek 55: STAFF edytuje Ustawienia poza Użytkownikami, Integracjami, Messengerem / Instagramem
// i Importami — tam API odrzuca zapis (403 dla nie-ADMIN). Test pilnuje obu stron granicy.
const API = join(__dirname, "..", "app", "api");
const src = (r: string) => readFileSync(join(API, r, "route.ts"), "utf8");

const ADMIN_ONLY = [
  "users",
  "users/[id]",
  "users/[id]/tokens",
  "users/[id]/tokens/[tokenId]",
  "users/[id]/api-calls",
  "users/[id]/invite",
  "integrations/fakturownia",
  "integrations/fakturownia/test",
  "integrations/google-calendar/test",
  "integrations/google-calendar/calendars",
  "integrations/hubspot",
  "integrations/hubspot/test",
  "integrations/szybkisms",
  "integrations/szybkisms/test",
  "integrations/meta/subscription",
  "history/calendar/import",
  "history/calendar/preview",
  "history/invoices/import",
  "history/invoices/preview",
  "history/invoices/excel",
  "clients/import/preview",
  "clients/import/run",
  "leads/import/preview",
  "leads/import/run",
  "reminders/run-check",
  "reminders/run-send",
];

const STAFF_EDITABLE = [
  "pricing",
  "pricing/delivery",
  "vehicles",
  "vehicles/[id]",
  "cost-categories",
  "cost-categories/[id]",
  "auto-mail/cennik",
  "auto-mail/cennik/test",
  "auto-mail/cennik/attachments",
  "auto-mail/cennik/attachments/[id]",
  "mail-intake/config",
  "playbook",
  "integrations/hubspot/new-deals",
  "porzadki/wykluczenia",
  "porzadki/wykluczenia/[id]",
  "reminders/settings",
];

describe("granica uprawnień Ustawień (wniosek 55)", () => {
  it("pozycje tylko do podglądu dla STAFF mają API tylko dla ADMIN", () => {
    for (const r of ADMIN_ONLY) {
      const body = src(r);
      expect(body, r).toContain("requireAdminSession()");
      expect(body, r).not.toContain("requireStaffSession()");
    }
  });
  it("pozostałe pozycje edytuje też STAFF (ADMIN i STAFF, nie KIEROWCA)", () => {
    for (const r of STAFF_EDITABLE) {
      const body = src(r);
      expect(body, r).toContain("requireStaffSession()");
      expect(body, r).not.toContain("requireAdminSession()");
    }
  });
  it("w menu nie ma pozycji, której nie opisano w tym teście (restricted = tylko podgląd)", () => {
    const restricted = SETTINGS_GROUPS.flatMap((g) => g.items).filter((i) => i.restricted);
    expect(restricted.length).toBe(4);
  });
});
