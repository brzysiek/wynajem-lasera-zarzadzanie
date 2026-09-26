import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { deleteArchived, parseTypeIds } from "@/lib/porzadki/archive";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";
import { logInfo } from "@/lib/logger";

// Trwałe usunięcie z archiwum — tylko ADMIN, z potwierdzeniem liczbą
// usuwanych rekordów ({ type, ids, confirm: ids.length }). Bez blokad dla
// rekordów z historią (decyduje człowiek). HubSpot bez zmian — jego ID
// trafiają na listę blokad importu.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const target = parseTypeIds(body);
  if (!target) return NextResponse.json({ message: "Podaj type (client|lead) i ids." }, { status: 400 });
  if (Number(body?.confirm) !== target.ids.length) {
    return NextResponse.json({ message: `Potwierdź, wpisując liczbę usuwanych rekordów (${target.ids.length}).` }, { status: 400 });
  }
  try {
    const r = await deleteArchived(target.type, target.ids, { userId: session.user.id, role: session.user.role });
    logInfo("archive_delete", { userId: session.user.id, type: target.type, deleted: r.deleted, blocked: r.blocked });
    return NextResponse.json(r);
  } catch (err) {
    return porzadkiErrorResponse(err, "archive_delete_failed", session.user.id);
  }
}
