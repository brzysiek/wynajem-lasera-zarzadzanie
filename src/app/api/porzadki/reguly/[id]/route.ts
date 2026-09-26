import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { listRules } from "@/lib/porzadki/cleanup-rules";

// Zmiana / usunięcie reguły porządków — tylko ADMIN.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const data: Prisma.CleanupRuleUpdateInput = {};
  if (body && "body" in body) {
    const text = typeof body.body === "string" ? body.body.trim().slice(0, 5000) : "";
    if (!text) return NextResponse.json({ message: "Treść reguły nie może być pusta." }, { status: 400 });
    data.body = text;
  }
  if (body && "example" in body) data.example = typeof body.example === "string" && body.example.trim() ? body.example.trim().slice(0, 5000) : null;
  try {
    await prisma.cleanupRule.update({ where: { id }, data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return NextResponse.json({ message: "Reguła nie istnieje." }, { status: 404 });
    throw err;
  }
  return NextResponse.json({ rules: await listRules() });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  await prisma.cleanupRule.deleteMany({ where: { id } });
  return NextResponse.json({ rules: await listRules() });
}
