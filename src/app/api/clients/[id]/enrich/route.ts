import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { enrichClient } from "@/lib/clients/enrich";
import { loadClientDetail } from "@/lib/clients/load";

// „Uzupełnij po NIP” na karcie klienta (ADMIN/STAFF): Biała lista MF
// i CEIDG. Pola zmienione ręcznie zostają.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const r = await enrichClient(id, { userId: session.user.id });
  if (!r.ok) return NextResponse.json({ message: r.message }, { status: 400 });
  return NextResponse.json({ updated: r.updated, sources: r.sources, warnings: r.warnings, detail: await loadClientDetail(id) });
}
