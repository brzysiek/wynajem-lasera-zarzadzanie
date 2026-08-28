import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

// Feeds the "Kierowca" <select> in the rental form. Only an admin assigns
// drivers, so the list is admin-only.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const drivers = await prisma.user.findMany({
    where: { role: "KIEROWCA" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return NextResponse.json({ drivers });
}
