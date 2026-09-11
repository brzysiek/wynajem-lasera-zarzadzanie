import type { CostScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Spójność scope/deviceId/vehicleId + categoryId.scope — wołane po stronie
// API dla POST i PATCH /api/costs (docs/prompt-claude-code-dashboard-kosztow.md,
// sekcja 1.6). NIE polegać wyłącznie na walidacji frontendowej.
export async function validateCostConsistency(input: {
  scope: CostScope;
  deviceId: string | null;
  vehicleId: string | null;
  categoryId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { scope, deviceId, vehicleId, categoryId } = input;

  if (scope === "DEVICE") {
    if (!deviceId) return { ok: false, message: "Zakres „Urządzenie” wymaga wybrania urządzenia." };
    if (vehicleId) return { ok: false, message: "Koszt urządzenia nie może mieć przypisanego pojazdu." };
  } else if (scope === "VEHICLE") {
    if (!vehicleId) return { ok: false, message: "Zakres „Pojazd” wymaga wybrania pojazdu." };
    if (deviceId) return { ok: false, message: "Koszt pojazdu nie może mieć przypisanego urządzenia." };
  } else {
    if (deviceId || vehicleId) {
      return { ok: false, message: "Koszt ogólny nie może mieć przypisanego pojazdu ani urządzenia." };
    }
  }

  const category = await prisma.costCategory.findUnique({ where: { id: categoryId }, select: { scope: true } });
  if (!category) return { ok: false, message: "Nie znaleziono kategorii." };
  if (category.scope !== scope) {
    return { ok: false, message: "Kategoria nie pasuje do wybranego zakresu kosztu." };
  }

  return { ok: true };
}
