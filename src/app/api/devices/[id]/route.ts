import { NextRequest, NextResponse } from "next/server";
import { Prisma, type DevicePricingCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";
import { PRICING_CATEGORY_VALUES, categoryHasVariants, isAllowedVariant } from "@/lib/pricing/variants";

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: {
    name?: string;
    shortName?: string;
    color?: string;
    googleCalendarId?: string;
    active?: boolean;
    pricingCategory?: DevicePricingCategory | null;
    variantOptions?: string[] | typeof Prisma.DbNull;
  } = {};

  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body?.shortName === "string" && body.shortName.trim()) data.shortName = body.shortName.trim();
  if (typeof body?.color === "string") {
    if (!COLOR_PATTERN.test(body.color.trim())) {
      logWarn("device_update_rejected", { userId: session.user.id, deviceId: id, reason: "invalid_color" });
      return NextResponse.json({ message: "Kolor musi być w formacie #RRGGBB." }, { status: 400 });
    }
    data.color = body.color.trim();
  }
  if (typeof body?.googleCalendarId === "string" && body.googleCalendarId.trim()) {
    data.googleCalendarId = body.googleCalendarId.trim();
  }
  if (typeof body?.active === "boolean") data.active = body.active;

  // --- konfiguracja cennika (moduł finansowy) ---
  let effectiveCategory: DevicePricingCategory | null | undefined;

  if ("pricingCategory" in (body ?? {})) {
    const raw = body.pricingCategory;
    if (raw === null || raw === "") {
      data.pricingCategory = null;
      effectiveCategory = null;
    } else if (typeof raw === "string" && (PRICING_CATEGORY_VALUES as string[]).includes(raw)) {
      data.pricingCategory = raw as DevicePricingCategory;
      effectiveCategory = raw as DevicePricingCategory;
    } else {
      return NextResponse.json({ message: "Nieprawidłowa kategoria cennika." }, { status: 400 });
    }
  }

  if ("variantOptions" in (body ?? {})) {
    if (effectiveCategory === undefined) {
      const current = await prisma.device.findUnique({ where: { id }, select: { pricingCategory: true } });
      effectiveCategory = current?.pricingCategory ?? null;
    }
    const raw = body.variantOptions;
    if (raw == null || !effectiveCategory || !categoryHasVariants(effectiveCategory)) {
      data.variantOptions = Prisma.DbNull;
    } else if (Array.isArray(raw) && raw.every((v) => typeof v === "string" && isAllowedVariant(effectiveCategory as DevicePricingCategory, v))) {
      const unique = [...new Set(raw as string[])];
      data.variantOptions = unique.length > 0 ? unique : Prisma.DbNull;
    } else {
      return NextResponse.json({ message: "Nieprawidłowe warianty głowicy dla wybranej kategorii." }, { status: 400 });
    }
  } else if (data.pricingCategory !== undefined) {
    // Zmiana kategorii bez podania wariantów — stare mogą już nie pasować.
    data.variantOptions = Prisma.DbNull;
  }

  if (Object.keys(data).length === 0) {
    logWarn("device_update_rejected", { userId: session.user.id, deviceId: id, reason: "no_changes" });
    return NextResponse.json({ message: "Brak zmian do zapisania." }, { status: 400 });
  }

  const device = await prisma.device.update({ where: { id }, data });
  logInfo("device_updated", { userId: session.user.id, deviceId: id, fields: Object.keys(data) });

  return NextResponse.json({ device });
}
