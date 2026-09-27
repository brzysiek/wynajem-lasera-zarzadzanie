import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { archiveRecords, listArchive, parseArchiveInput, parseTypeIds } from "@/lib/porzadki/archive";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";
import { dayParam } from "@/lib/agent-api/token";
import { logInfo } from "@/lib/logger";
import { suggestDomainsForClients } from "@/lib/porzadki/exclusions";

// Archiwum: lista (odczyt — ADMIN/STAFF/AGENT) i archiwizacja (tylko ADMIN;
// agent tylko proponuje). Body: { type: "client"|"lead", ids, reason, note, batch? }.
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const from = dayParam(sp.get("od"));
  const to = dayParam(sp.get("do"));
  const rows = await listArchive({
    reason: sp.get("powod"),
    batch: sp.get("paczka"),
    userId: sp.get("kto"),
    type: sp.get("typ"),
    q: sp.get("q"),
    from: from instanceof Date ? from : null,
    to: to instanceof Date ? new Date(to.getTime() + 86_399_999) : null,
  });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const target = parseTypeIds(body);
  if (!target) return NextResponse.json({ message: "Podaj type (client|lead) i ids." }, { status: 400 });
  const input = parseArchiveInput(body);
  if (!input.ok) return NextResponse.json({ message: input.message }, { status: 400 });
  try {
    const count = await archiveRecords(target.type, target.ids, input.value, { userId: session.user.id, role: session.user.role });
    logInfo("archive_records", { userId: session.user.id, type: target.type, count });
    // Spoza branży → domeny osób do dodania na listę wykluczeń (wniosek 7).
    const suggestedDomains = input.value.reason === "SPOZA_BRANZY" && target.type === "client" ? await suggestDomainsForClients(target.ids) : [];
    return NextResponse.json({ archived: count, suggestedDomains });
  } catch (err) {
    return porzadkiErrorResponse(err, "archive_failed", session.user.id);
  }
}
