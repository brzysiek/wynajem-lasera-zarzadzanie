import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
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
