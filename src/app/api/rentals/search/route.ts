import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { logDebug } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ rentals: [] });
  }

  const rentals = await prisma.rental.findMany({
    where: {
      deletedInGoogle: false,
      OR: [
        { title: { contains: q } },
        { contactNameCache: { contains: q } },
        { device: { name: { contains: q } } },
      ],
    },
    include: { device: true },
    orderBy: { startsAt: "desc" },
    take: 20,
  });

  logDebug("rental_search", { query: q, resultCount: rentals.length });

  return NextResponse.json({
    rentals: rentals.map((r) => ({
      id: r.id,
      title: r.title,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      contactNameCache: r.contactNameCache,
      contactPhoneCache: r.contactPhoneCache,
      device: { id: r.device.id, name: r.device.name },
    })),
  });
}
