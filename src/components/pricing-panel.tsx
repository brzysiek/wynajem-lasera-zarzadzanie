"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DevicePricingCategory } from "@prisma/client";
import { BASE_PATH } from "@/lib/base-path";
import {
  PRICING_CATEGORY_LABELS,
  PRICING_CATEGORY_VALUES,
  VARIANT_OPTIONS_BY_CATEGORY,
  categoryHasVariants,
  variantLabel,
} from "@/lib/pricing/variants";

export type PriceRuleDto = {
  id: string;
  pricingCategory: DevicePricingCategory;
  variant: string | null;
  durationDays: number;
  priceNet: string;
};
export type PulseTierDto = {
  id: string;
  durationDays: number;
  order: number;
  maxPulses: number | null;
  priceNet: string;
  isOverflowTier: boolean;
  overflowStepPulses: number | null;
  overflowStepPriceNet: string | null;
};
export type SettingDto = { key: string; value: string };

const SETTING_LABELS: Record<string, string> = {
  cap_fee_hs_net: "Cena nakładki HS (netto, zł)",
  vat_rate_default: "Domyślna stawka VAT (%)",
  alma_pulse_rate_net: "Stawka za impuls Alma (netto, zł)",
};

type NewRule = { key: string; pricingCategory: DevicePricingCategory; variant: string; durationDays: string; priceNet: string };

function numInput(value: string, onChange: (v: string) => void, extra = "") {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      className={`w-28 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none ${extra}`}
    />
  );
}

export function PricingPanel({
  initialPriceRules,
  initialPulseTiers,
  initialSettings,
}: {
  initialPriceRules: PriceRuleDto[];
  initialPulseTiers: PulseTierDto[];
  initialSettings: SettingDto[];
}) {
  const router = useRouter();
  const [priceRules, setPriceRules] = useState(initialPriceRules);
  const [deletedRuleIds, setDeletedRuleIds] = useState<Set<string>>(new Set());
  const [newRules, setNewRules] = useState<NewRule[]>([]);
  const [pulseTiers, setPulseTiers] = useState(initialPulseTiers);
  const [settings, setSettings] = useState<Record<string, string>>(
    Object.fromEntries(initialSettings.map((s) => [s.key, s.value])),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rulesByCategory = useMemo(() => {
    const map = new Map<DevicePricingCategory, PriceRuleDto[]>();
    for (const r of priceRules) {
      const list = map.get(r.pricingCategory) ?? [];
      list.push(r);
      map.set(r.pricingCategory, list);
    }
    return map;
  }, [priceRules]);

  const tiersByDuration = useMemo(() => {
    const map = new Map<number, PulseTierDto[]>();
    for (const t of pulseTiers) {
      const list = map.get(t.durationDays) ?? [];
      list.push(t);
      map.set(t.durationDays, list);
    }
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [pulseTiers]);

  function editRule(id: string, priceNet: string) {
    setPriceRules((prev) => prev.map((r) => (r.id === id ? { ...r, priceNet } : r)));
  }
  function editTier(id: string, patch: Partial<PulseTierDto>) {
    setPulseTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setSaved(false);

    const payload = {
      priceRules: priceRules
        .filter((r) => !deletedRuleIds.has(r.id))
        .map((r) => ({ id: r.id, priceNet: r.priceNet })),
      deletePriceRuleIds: [...deletedRuleIds],
      newPriceRules: newRules.map((r) => ({
        pricingCategory: r.pricingCategory,
        variant: r.variant || null,
        durationDays: r.durationDays,
        priceNet: r.priceNet,
      })),
      pulseTiers: pulseTiers.map((t) => ({
        id: t.id,
        maxPulses: t.maxPulses,
        priceNet: t.priceNet,
        overflowStepPulses: t.overflowStepPulses,
        overflowStepPriceNet: t.overflowStepPriceNet,
      })),
      settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    };

    const res = await fetch(`${BASE_PATH}/api/pricing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    setIsSaving(false);
    if (!res.ok) {
      setError(data?.message || "Nie udało się zapisać cennika.");
      return;
    }
    setSaved(true);
    setNewRules([]);
    setDeletedRuleIds(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      {/* --- Ceny podstawowe --- */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Ceny podstawowe</h2>
        <p className="mb-4 text-sm text-gray-500">Cena netto wynajmu wg kategorii, wariantu głowicy i liczby dni.</p>

        {PRICING_CATEGORY_VALUES.map((category) => {
          const rows = rulesByCategory.get(category) ?? [];
          const catNewRules = newRules.filter((r) => r.pricingCategory === category);
          return (
            <div key={category} className="mb-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-800">{PRICING_CATEGORY_LABELS[category]}</h3>
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-gray-400">
                  <tr>
                    <th className="py-1 pr-3">Wariant</th>
                    <th className="py-1 pr-3">Dni</th>
                    <th className="py-1 pr-3">Cena netto (zł)</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const deleted = deletedRuleIds.has(r.id);
                    return (
                      <tr key={r.id} className={deleted ? "opacity-40" : ""}>
                        <td className="py-1 pr-3 text-gray-700">{r.variant ? variantLabel(category, r.variant) : "—"}</td>
                        <td className="py-1 pr-3 text-gray-700">{r.durationDays}</td>
                        <td className="py-1 pr-3">{numInput(r.priceNet, (v) => editRule(r.id, v))}</td>
                        <td className="py-1">
                          <button
                            type="button"
                            onClick={() =>
                              setDeletedRuleIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(r.id)) next.delete(r.id);
                                else next.add(r.id);
                                return next;
                              })
                            }
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            {deleted ? "przywróć" : "usuń"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {catNewRules.map((nr) => (
                    <tr key={nr.key} className="bg-blue-50/40">
                      <td className="py-1 pr-3">
                        {categoryHasVariants(category) ? (
                          <select
                            value={nr.variant}
                            onChange={(e) =>
                              setNewRules((prev) => prev.map((x) => (x.key === nr.key ? { ...x, variant: e.target.value } : x)))
                            }
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                          >
                            <option value="">— wariant —</option>
                            {VARIANT_OPTIONS_BY_CATEGORY[category].map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-1 pr-3">
                        {numInput(
                          nr.durationDays,
                          (v) => setNewRules((prev) => prev.map((x) => (x.key === nr.key ? { ...x, durationDays: v } : x))),
                          "w-16",
                        )}
                      </td>
                      <td className="py-1 pr-3">
                        {numInput(nr.priceNet, (v) =>
                          setNewRules((prev) => prev.map((x) => (x.key === nr.key ? { ...x, priceNet: v } : x))),
                        )}
                      </td>
                      <td className="py-1">
                        <button
                          type="button"
                          onClick={() => setNewRules((prev) => prev.filter((x) => x.key !== nr.key))}
                          className="text-xs font-medium text-gray-500 hover:underline"
                        >
                          anuluj
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                onClick={() =>
                  setNewRules((prev) => [
                    ...prev,
                    { key: crypto.randomUUID(), pricingCategory: category, variant: "", durationDays: "", priceNet: "" },
                  ])
                }
                className="mt-1 text-xs font-medium text-blue-600 hover:underline"
              >
                + dodaj wiersz
              </button>
            </div>
          );
        })}
      </section>

      {/* --- Progi impulsów --- */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Progi impulsów — LightSheer (taryfa elastyczna)</h2>
        <p className="mb-4 text-sm text-gray-500">
          Cena zależy od zużytych impulsów. Ostatni próg z „krokiem nadwyżki” dolicza kolejne kroki powyżej „max impulsów”
          poprzedniego progu.
        </p>
        {tiersByDuration.map(([duration, tiers]) => (
          <div key={duration} className="mb-5">
            <h3 className="mb-2 text-sm font-semibold text-gray-800">{duration} dni</h3>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-400">
                <tr>
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">Max impulsów</th>
                  <th className="py-1 pr-3">Cena netto (zł)</th>
                  <th className="py-1 pr-3">Krok nadwyżki (impulsy)</th>
                  <th className="py-1 pr-3">Krok nadwyżki (zł)</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1 pr-3 text-gray-500">{t.order}</td>
                    <td className="py-1 pr-3">
                      {numInput(t.maxPulses == null ? "" : String(t.maxPulses), (v) =>
                        editTier(t.id, { maxPulses: v === "" ? null : Number(v) }),
                      )}
                      {t.maxPulses == null && <span className="ml-1 text-xs text-gray-400">bez limitu</span>}
                    </td>
                    <td className="py-1 pr-3">{numInput(t.priceNet, (v) => editTier(t.id, { priceNet: v }))}</td>
                    <td className="py-1 pr-3">
                      {t.isOverflowTier
                        ? numInput(t.overflowStepPulses == null ? "" : String(t.overflowStepPulses), (v) =>
                            editTier(t.id, { overflowStepPulses: v === "" ? null : Number(v) }),
                          )
                        : "—"}
                    </td>
                    <td className="py-1 pr-3">
                      {t.isOverflowTier
                        ? numInput(t.overflowStepPriceNet ?? "", (v) =>
                            editTier(t.id, { overflowStepPriceNet: v === "" ? null : v }),
                          )
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {/* --- Pojedyncze wartości --- */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Pojedyncze wartości</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.keys(SETTING_LABELS).map((key) => (
            <label key={key} className="flex flex-col gap-1 text-sm text-gray-700">
              {SETTING_LABELS[key]}
              <input
                value={settings[key] ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.value }))}
                inputMode="decimal"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
          ))}
        </div>
      </section>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {saved && <p className="text-sm text-green-700">Zapisano.</p>}

      <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-gray-50 px-4 py-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {isSaving ? "Zapisywanie…" : "Zapisz cennik"}
        </button>
      </div>
    </div>
  );
}
