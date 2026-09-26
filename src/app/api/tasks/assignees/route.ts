import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";

// Osoby, którym można przypisać zadanie (ADMIN/STAFF — ta sama reguła co
// assigneeIsAllowed w /api/tasks). Tylko id i imię — dla panelu Zadań, także
// dla STAFF i AGENT, którzy nie mają dostępu do /api/users.
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const users = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "STAFF"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json({ users });
}
