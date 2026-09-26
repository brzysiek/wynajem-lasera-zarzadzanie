import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { convertRemark } from "@/lib/porzadki/remarks";
import { porzadkiErrorResponse } from "@/lib/porzadki/http";

// Uwaga → wniosek (jednym kliknięciem): pola się kopiują, uwaga dostaje link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) ?? {};
  try {
    const p = await convertRemark(id, body, { userId: session.user.id, role: session.user.role });
    return NextResponse.json({ id: p.id, number: p.number });
  } catch (err) {
    return porzadkiErrorResponse(err, "remark_convert_failed", session.user.id);
  }
}
