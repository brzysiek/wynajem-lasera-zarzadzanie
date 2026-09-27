import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { listExclusions, removeExclusion } from "@/lib/porzadki/exclusions";

// Zdjęcie pozycji z listy wykluczeń (ADMIN) — ukryte przez nią maile wracają.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const applied = await removeExclusion(id);
  return NextResponse.json({ applied, rows: await listExclusions() });
}
