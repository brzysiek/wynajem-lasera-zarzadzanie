import { NextRequest, NextResponse } from "next/server";
import { type DevicePricingCategory } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";
import { PRICING_CATEGORY_VALUES, categoryHasVariants, isAllowedVariant } from "@/lib/pricing/variants";

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const devices = await prisma.device.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ devices });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const shortName = typeof body?.shortName === "string" ? body.shortName.trim() : "";
  const color = typeof body?.color === "string" ? body.color.trim() : "";
  const googleCalendarId = typeof body?.googleCalendarId === "string" ? body.googleCalendarId.trim() : "";

  if (!name || !shortName || !COLOR_PATTERN.test(color) || !googleCalendarId) {
    logWarn("device_create_rejected", { userId: session.user.id });
    return NextResponse.json(
      { message: "Uzupełnij nazwę, skrót, poprawny kolor (#RRGGBB) i kalendarz Google." },
      { status: 400 },
    );
  }

  let pricingCategory: DevicePricingCategory | null = null;
  if (typeof body?.pricingCategory === "string" && (PRICING_CATEGORY_VALUES as string[]).includes(body.pricingCategory)) {
    pricingCategory = body.pricingCategory as DevicePricingCategory;
  }
  let variantOptions: string[] | undefined;
  if (
    pricingCategory &&
    categoryHasVariants(pricingCategory) &&
    Array.isArray(body?.variantOptions) &&
    body.variantOptions.every((v: unknown) => typeof v === "string" && isAllowedVariant(pricingCategory as DevicePricingCategory, v))
  ) {
    const unique = [...new Set(body.variantOptions as string[])];
    if (unique.length > 0) variantOptions = unique;
  }

  const device = await prisma.device.create({
    data: { name, shortName, color, googleCalendarId, active: true, pricingCategory, variantOptions },
  });

  logInfo("device_created", { userId: session.user.id, deviceId: device.id });

  return NextResponse.json({ device });
}
