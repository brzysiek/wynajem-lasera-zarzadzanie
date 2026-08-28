import { NextRequest, NextResponse } from "next/server";
import { Prisma, type DevicePricingCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo } from "@/lib/logger";
import { PRICING_CATEGORY_VALUES, categoryHasVariants, isAllowedVariant } from "@/lib/pricing/variants";

// Klucze PricingSetting, które wolno edytować z tej strony.
const EDITABLE_SETTING_KEYS = ["cap_fee_hs_net", "vat_rate_default", "alma_pulse_rate_net"];

function decOrNull(raw: unknown): { ok: true; value: Prisma.Decimal } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") return { ok: false };
  try {
    const d = new Prisma.Decimal(typeof raw === "string" ? raw.replace(",", ".") : (raw as number));
    if (!d.isFinite() || d.isNegative()) return { ok: false };
    return { ok: true, value: d };
  } catch {
    return { ok: false };
  }
}

function intOrNull(raw: unknown): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0) return "invalid";
  return n;
}

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const [priceRules, pulseTiers, settings] = await Promise.all([
    prisma.priceRule.findMany({ orderBy: [{ pricingCategory: "asc" }, { variant: "asc" }, { durationDays: "asc" }] }),
    prisma.pulseTier.findMany({ orderBy: [{ durationDays: "asc" }, { order: "asc" }] }),
    prisma.pricingSetting.findMany({ orderBy: { key: "asc" } }),
  ]);

  return NextResponse.json({
    priceRules: priceRules.map((r) => ({ ...r, priceNet: r.priceNet.toString() })),
    pulseTiers: pulseTiers.map((t) => ({
      ...t,
      priceNet: t.priceNet.toString(),
      overflowStepPriceNet: t.overflowStepPriceNet ? t.overflowStepPriceNet.toString() : null,
    })),
    settings: settings.map((s) => ({ key: s.key, value: s.value.toString() })),
  });
}

// Batch: panel wysyła cały diff na „Zapisz". Wszystko w jednej transakcji.
export async function PATCH(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });

  const priceRuleUpdates: { id: string; priceNet: Prisma.Decimal }[] = [];
  for (const row of Array.isArray(body.priceRules) ? body.priceRules : []) {
    if (typeof row?.id !== "string") return NextResponse.json({ message: "Brak id reguły cenowej." }, { status: 400 });
    const price = decOrNull(row.priceNet);
    if (!price.ok) return NextResponse.json({ message: "Cena musi być liczbą ≥ 0." }, { status: 400 });
    priceRuleUpdates.push({ id: row.id, priceNet: price.value });
  }

  const newPriceRules: {
    pricingCategory: DevicePricingCategory;
    variant: string | null;
    durationDays: number;
    priceNet: Prisma.Decimal;
  }[] = [];
  for (const row of Array.isArray(body.newPriceRules) ? body.newPriceRules : []) {
    if (typeof row?.pricingCategory !== "string" || !(PRICING_CATEGORY_VALUES as string[]).includes(row.pricingCategory)) {
      return NextResponse.json({ message: "Nieprawidłowa kategoria w nowym wierszu cennika." }, { status: 400 });
    }
    const category = row.pricingCategory as DevicePricingCategory;
    const variant = typeof row.variant === "string" && row.variant ? row.variant : null;
    if (variant && !isAllowedVariant(category, variant)) {
      return NextResponse.json({ message: `Wariant „${variant}” nie należy do kategorii.` }, { status: 400 });
    }
    if (categoryHasVariants(category) && !variant) {
      return NextResponse.json({ message: "Ta kategoria wymaga wariantu w wierszu cennika." }, { status: 400 });
    }
    const days = intOrNull(row.durationDays);
    if (days === "invalid" || days === null || days < 1) {
      return NextResponse.json({ message: "Liczba dni musi być dodatnią liczbą całkowitą." }, { status: 400 });
    }
    const price = decOrNull(row.priceNet);
    if (!price.ok) return NextResponse.json({ message: "Cena w nowym wierszu musi być liczbą ≥ 0." }, { status: 400 });
    newPriceRules.push({ pricingCategory: category, variant, durationDays: days, priceNet: price.value });
  }

  const deletePriceRuleIds: string[] = Array.isArray(body.deletePriceRuleIds)
    ? body.deletePriceRuleIds.filter((x: unknown): x is string => typeof x === "string")
    : [];

  const pulseTierUpdates: {
    id: string;
    maxPulses: number | null;
    priceNet: Prisma.Decimal;
    overflowStepPulses: number | null;
    overflowStepPriceNet: Prisma.Decimal | null;
  }[] = [];
  for (const row of Array.isArray(body.pulseTiers) ? body.pulseTiers : []) {
    if (typeof row?.id !== "string") return NextResponse.json({ message: "Brak id progu impulsów." }, { status: 400 });
    const price = decOrNull(row.priceNet);
    if (!price.ok) return NextResponse.json({ message: "Cena progu musi być liczbą ≥ 0." }, { status: 400 });
    const maxPulses = intOrNull(row.maxPulses);
    if (maxPulses === "invalid") return NextResponse.json({ message: "„Max impulsów” musi być liczbą całkowitą ≥ 0." }, { status: 400 });
    const stepPulses = intOrNull(row.overflowStepPulses);
    if (stepPulses === "invalid") return NextResponse.json({ message: "„Krok nadwyżki (impulsy)” musi być liczbą całkowitą ≥ 0." }, { status: 400 });
    const stepPrice = row.overflowStepPriceNet === null || row.overflowStepPriceNet === "" ? null : decOrNull(row.overflowStepPriceNet);
    if (stepPrice && !stepPrice.ok) return NextResponse.json({ message: "„Krok nadwyżki (zł)” musi być liczbą ≥ 0." }, { status: 400 });
    pulseTierUpdates.push({
      id: row.id,
      maxPulses,
      priceNet: price.value,
      overflowStepPulses: stepPulses,
      overflowStepPriceNet: stepPrice ? stepPrice.value : null,
    });
  }

  const settingUpdates: { key: string; value: Prisma.Decimal }[] = [];
  for (const row of Array.isArray(body.settings) ? body.settings : []) {
    if (typeof row?.key !== "string" || !EDITABLE_SETTING_KEYS.includes(row.key)) {
      return NextResponse.json({ message: "Nieznany klucz ustawienia cennika." }, { status: 400 });
    }
    const value = decOrNull(row.value);
    if (!value.ok) return NextResponse.json({ message: "Wartość ustawienia musi być liczbą ≥ 0." }, { status: 400 });
    settingUpdates.push({ key: row.key, value: value.value });
  }

  await prisma.$transaction(async (tx) => {
    for (const u of priceRuleUpdates) {
      await tx.priceRule.update({ where: { id: u.id }, data: { priceNet: u.priceNet } });
    }
    for (const id of deletePriceRuleIds) {
      await tx.priceRule.deleteMany({ where: { id } });
    }
    for (const r of newPriceRules) {
      await tx.priceRule.create({ data: r });
    }
    for (const u of pulseTierUpdates) {
      await tx.pulseTier.update({
        where: { id: u.id },
        data: {
          maxPulses: u.maxPulses,
          priceNet: u.priceNet,
          overflowStepPulses: u.overflowStepPulses,
          overflowStepPriceNet: u.overflowStepPriceNet,
        },
      });
    }
    for (const u of settingUpdates) {
      await tx.pricingSetting.upsert({
        where: { key: u.key },
        create: { key: u.key, value: u.value },
        update: { value: u.value },
      });
    }
  });

  logInfo("pricing_updated", {
    userId: session.user.id,
    priceRuleUpdates: priceRuleUpdates.length,
    newPriceRules: newPriceRules.length,
    deletedPriceRules: deletePriceRuleIds.length,
    pulseTierUpdates: pulseTierUpdates.length,
    settingUpdates: settingUpdates.length,
  });

  return NextResponse.json({ ok: true });
}
