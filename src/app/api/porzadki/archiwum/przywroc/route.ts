import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { parseTypeIds, restoreRecords } from "@/lib/porzadki/archive";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";
import { logInfo } from "@/lib/logger";

// Przywrócenie z archiwum (pojedynczo i hurtem) — tylko ADMIN.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const target = parseTypeIds(await req.json().catch(() => null));
  if (!target) return NextResponse.json({ message: "Podaj type (client|lead) i ids." }, { status: 400 });
  try {
    const count = await restoreRecords(target.type, target.ids, { userId: session.user.id, role: session.user.role });
    logInfo("archive_restore", { userId: session.user.id, type: target.type, count });
    return NextResponse.json({ restored: count });
  } catch (err) {
    return porzadkiErrorResponse(err, "archive_restore_failed", session.user.id);
  }
}
