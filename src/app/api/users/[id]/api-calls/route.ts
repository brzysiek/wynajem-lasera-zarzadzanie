import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

// Ostatnie wywołania API agenta (kto, co, kiedy, status) — tylko ADMIN.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const rows = await prisma.apiCallLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 100, include: { token: { select: { name: true } } } });
  return NextResponse.json({
    calls: rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), method: r.method, path: r.path, status: r.status, durationMs: r.durationMs, token: r.token.name })),
  });
}
