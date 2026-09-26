import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { mergeClients } from "@/lib/clients/merge";
import { loadClientDetail } from "@/lib/clients/load";
import { logInfo } from "@/lib/logger";

// Scalenie duplikatu ({ sourceId }) w tego klienta — ADMIN/STAFF/AGENT
// (AGENT: wymagane źródło i pewność). Duplikat trafia do archiwum
// („duplikat”), wszystko z niego przechodzi tutaj; wpisy w dzienniku.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const result = await mergeClients(id, typeof body.sourceId === "string" ? body.sourceId : "", body, { userId: session.user.id, role: session.user.role });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  logInfo("clients_merged", { userId: session.user.id, targetId: id, sourceId: body.sourceId, moved: result.moved });
  return NextResponse.json({ moved: result.moved, detail: await loadClientDetail(id) });
}
