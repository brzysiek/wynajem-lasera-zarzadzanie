import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { setProposalStatuses } from "@/lib/porzadki/proposals";
import { isStatus } from "@/lib/porzadki/rules";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";
import { logInfo } from "@/lib/logger";
import type { ProposalStatusKey } from "@/lib/porzadki/labels";

// Wniosek 30: szybka zmiana statusu z listy — jeden albo wiele wniosków
// ({ items: [{ id, status }], comment?, duplicateOfId? }), także „Cofnij”.
// Tylko ADMIN (także w setProposalStatuses); agent komentuje.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const raw = Array.isArray(body?.items) ? (body.items as unknown[]) : [];
  const items = raw
    .map((x) => x as { id?: unknown; status?: unknown })
    .filter((x): x is { id: string; status: ProposalStatusKey } => typeof x.id === "string" && isStatus(x.status))
    .slice(0, 200);
  if (!items.length) return NextResponse.json({ message: "Zaznacz wnioski i status." }, { status: 400 });
  try {
    const changed = await setProposalStatuses(items, { userId: session.user.id, role: session.user.role }, {
      comment: typeof body?.comment === "string" ? body.comment.slice(0, 2000) : null,
      duplicateOfId: typeof body?.duplicateOfId === "string" ? body.duplicateOfId : null,
    });
    logInfo("proposal_status_bulk", { userId: session.user.id, count: changed.length });
    return NextResponse.json({ changed });
  } catch (err) {
    return porzadkiErrorResponse(err, "proposal_status_bulk_failed", session.user.id);
  }
}
