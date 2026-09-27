"use client";

import { useEffect, useMemo, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";

type Scope = "GENERAL" | "VEHICLE" | "DEVICE";

type CategoryOption = { id: string; name: string; scope: Scope };
type TargetOption = { id: string; name: string };

type CostRow = {
  id: string;
  amount: string;
  date: string;
  scope: Scope;
  categoryId: string;
  categoryName: string;
  description: string | null;
  deviceId: string | null;
  deviceName: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
};

// Paleta premium (src/components/shell-tokens.ts) — spójna z resztą
// dashboardów Finanse.
const C = {
  bg: "#F2F4F6",
  surface: "#FFFFFF",
  border: "#E9EDF1",
  text: "#4A4A4A",
  muted: "#6F7378",
  faint: "#9AA1A8",
  brand: "#1B6FA8",
  brandSoft: "#EAF4FB",
  accent: "#E08A5C",
  purple: "#7C3AED",
  purpleSoft: "#F3EBFF",
  red: "#D93025",
};

const SCOPE_LABEL: Record<Scope, string> = { GENERAL: "Ogólny", VEHICLE: "Pojazd", DEVICE: "Urządzenie" };

function fmtPln(amount: string): string {
  const n = Number(amount);
  return `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)} zł`;
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

function AssocTag({ scope, name }: { scope: Scope; name: string }) {
  if (scope === "VEHICLE") {
    return (
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold"
        style={{ background: C.brandSoft, color: C.brand }}
      >
        🚐 {name}
      </span>
    );
  }
  if (scope === "DEVICE") {
    return (
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold"
        style={{ background: C.purpleSoft, color: C.purple }}
      >
        ⚙ {name}
      </span>
    );
  }
  return <span style={{ color: C.faint }}>—</span>;
}

// Formularz "Dodaj koszt" (sekcja 5.2) — modal/panel, nie rozwijana karta jak
// w mockupie (to celowe uproszczenie mockupu dla czytelności specyfikacji).
function CostFormModal({
  mode,
  initial,
  categories,
  vehicles,
  devices,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: CostRow | null;
  categories: CategoryOption[];
  vehicles: TargetOption[];
  devices: TargetOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [scope, setScope] = useState<Scope>(initial?.scope ?? "GENERAL");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [vehicleId, setVehicleId] = useState(initial?.vehicleId ?? "");
  const [deviceId, setDeviceId] = useState(initial?.deviceId ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [date, setDate] = useState(initial?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopedCategories = useMemo(() => categories.filter((c) => c.scope === scope), [categories, scope]);

  function changeScope(next: Scope) {
    setScope(next);
    // Zmiana zakresu resetuje kategorię (lista się zmienia) i cel (sekcja 5.2).
    setCategoryId("");
    setVehicleId("");
    setDeviceId("");
  }

  async function submit() {
    setError(null);
    const amountNum = Number(amount.replace(",", "."));
    if (!categoryId) return setError("Wybierz kategorię.");
    if (scope === "VEHICLE" && !vehicleId) return setError("Wybierz pojazd.");
    if (scope === "DEVICE" && !deviceId) return setError("Wybierz urządzenie.");
    if (!Number.isFinite(amountNum) || amountNum < 0) return setError("Podaj poprawną kwotę netto (≥ 0).");
    if (!date) return setError("Podaj datę.");

    setSaving(true);
    try {
      const body = {
        scope,
        categoryId,
        vehicleId: scope === "VEHICLE" ? vehicleId : null,
        deviceId: scope === "DEVICE" ? deviceId : null,
        amount: amountNum,
        date,
        description: description.trim() || null,
      };
      const url = mode === "create" ? `${BASE_PATH}/api/costs` : `${BASE_PATH}/api/costs/${initial!.id}`;
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się zapisać kosztu.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div
        className="w-full max-w-[520px] rounded-[14px] p-5"
        style={{ background: C.surface }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[16px] font-semibold" style={{ color: C.text }}>
          {mode === "create" ? "Dodaj koszt" : "Edytuj koszt"}
        </h2>

        <div className="mb-3.5 flex flex-wrap gap-4">
          <Field label="Zakres" className="min-w-[140px] flex-1">
            <select
              value={scope}
              onChange={(e) => changeScope(e.target.value as Scope)}
              className="w-full rounded-lg border px-2.5 py-2 text-[13.5px]"
              style={{ borderColor: C.border, color: C.text }}
            >
              <option value="GENERAL">Ogólny</option>
              <option value="VEHICLE">Pojazd</option>
              <option value="DEVICE">Urządzenie</option>
            </select>
          </Field>

          {scope !== "GENERAL" && (
            <Field label={scope === "VEHICLE" ? "Pojazd" : "Urządzenie"} className="min-w-[140px] flex-1">
              <select
                value={scope === "VEHICLE" ? vehicleId : deviceId}
                onChange={(e) => (scope === "VEHICLE" ? setVehicleId(e.target.value) : setDeviceId(e.target.value))}
                className="w-full rounded-lg border px-2.5 py-2 text-[13.5px]"
                style={{ borderColor: C.border, color: C.text }}
              >
                <option value="">Wybierz…</option>
                {(scope === "VEHICLE" ? vehicles : devices).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Kategoria" className="min-w-[140px] flex-1">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-lg border px-2.5 py-2 text-[13.5px]"
              style={{ borderColor: C.border, color: C.text }}
            >
              <option value="">Wybierz…</option>
              {scopedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mb-3.5 flex gap-4">
          <Field label="Kwota netto" className="flex-1">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="np. 1200"
              className="w-full rounded-lg border px-2.5 py-2 text-[13.5px]"
              style={{ borderColor: C.border, color: C.text }}
            />
          </Field>
          <Field label="Data" className="flex-1">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border px-2.5 py-2 text-[13.5px]"
              style={{ borderColor: C.border, color: C.text }}
            />
          </Field>
        </div>

        <Field label="Opis (opcjonalnie)" className="mb-4">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="np. kampania Google Ads wrzesień"
            className="w-full rounded-lg border px-2.5 py-2 text-[13.5px]"
            style={{ borderColor: C.border, color: C.text }}
          />
        </Field>

        {error && (
          <p className="mb-3 text-[13px]" style={{ color: C.red }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-[13px] font-semibold" style={{ color: C.muted }}>
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
            style={{ background: C.accent }}
          >
            {mode === "create" ? "Dodaj koszt" : "Zapisz"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.03em]" style={{ color: C.muted }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function CostEntriesManager({
  initialFrom,
  initialTo,
  categories,
  vehicles,
  devices,
}: {
  initialFrom: string;
  initialTo: string;
  categories: CategoryOption[];
  vehicles: TargetOption[];
  devices: TargetOption[];
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | Scope>("all");

  const [modal, setModal] = useState<{ mode: "create" | "edit"; row: CostRow | null } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/costs?from=${from}&to=${to}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się wczytać kosztów.");
      setCosts(Array.isArray(data?.costs) ? data.costs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return costs
      .filter((c) => scopeFilter === "all" || c.scope === scopeFilter)
      .filter((c) => {
        if (!q) return true;
        const haystack = [c.categoryName, c.description ?? "", c.vehicleName ?? "", c.deviceName ?? "", SCOPE_LABEL[c.scope]]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [costs, search, scopeFilter]);

  async function handleDelete(row: CostRow) {
    if (!window.confirm(`Usunąć koszt „${row.categoryName}" (${fmtPln(row.amount)})? Tej operacji nie można cofnąć.`)) return;
    try {
      const res = await fetch(`${BASE_PATH}/api/costs/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Nie udało się usunąć kosztu.");
      }
      setCosts((prev) => prev.filter((c) => c.id !== row.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Błąd.");
    }
  }

  const countLabel = (() => {
    const n = filtered.length;
    const word = n === 1 ? "wpis" : n >= 2 && n <= 4 ? "wpisy" : "wpisów";
    return `${n} ${word}`;
  })();

  return (
    <div>
      <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: C.border, background: C.surface }}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-[22px] sm:px-7">
          <h1 className="m-0 text-[21px] font-normal italic" style={{ color: C.accent }}>
            Wpisy kosztów
          </h1>
          <button
            type="button"
            onClick={() => setModal({ mode: "create", row: null })}
            className="rounded-lg px-4 py-2.5 text-[13px] font-bold text-white"
            style={{ background: C.accent }}
          >
            + Dodaj koszt
          </button>
        </div>

        {/* Własny, niezależny filtr okresu — nie współdzielony z Przychody/Koszty. */}
        <div className="mt-4 flex flex-wrap items-center gap-3 px-4 sm:px-7" style={{ color: C.muted }}>
          <label className="flex items-center gap-1.5 text-[13px]">
            Od
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border px-2 py-1 text-[13px]"
              style={{ borderColor: C.border, color: C.text }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[13px]">
            Do
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border px-2 py-1 text-[13px]"
              style={{ borderColor: C.border, color: C.text }}
            />
          </label>
        </div>

        <div className="px-4 py-6 sm:px-7">
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Szukaj po opisie, kategorii, powiązaniu…"
              className="min-w-[180px] flex-1 rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: C.border, color: C.text }}
            />
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as "all" | Scope)}
              className="min-w-[150px] rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: C.border, color: C.text }}
            >
              <option value="all">Wszystkie zakresy</option>
              <option value="GENERAL">Ogólny</option>
              <option value="VEHICLE">Pojazd</option>
              <option value="DEVICE">Urządzenie</option>
            </select>
            <span className="ml-auto whitespace-nowrap text-[12px]" style={{ color: C.faint }}>
              {countLabel}
            </span>
          </div>

          {error && (
            <p className="mb-3 text-[13px]" style={{ color: C.red }}>
              {error}
            </p>
          )}
          {loading ? (
            <p className="py-8 text-center text-[13.5px]" style={{ color: C.muted }}>
              Ładowanie…
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-[13.5px]" style={{ color: C.muted }}>
              Brak kosztów spełniających kryteria.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Data", "Zakres", "Kategoria", "Powiązane z", "Opis", "Kwota", ""].map((h, i) => (
                      <th
                        key={h + i}
                        className="border-b px-2.5 pb-2 text-[10.5px] font-bold uppercase tracking-[0.03em]"
                        style={{ borderColor: C.border, color: C.faint, textAlign: i === 5 ? "right" : "left" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td className="border-b px-2.5 py-[11px] text-[13.5px] whitespace-nowrap" style={{ borderColor: C.border }}>
                        {fmtDate(row.date)}
                      </td>
                      <td className="border-b px-2.5 py-[11px] text-[13.5px]" style={{ borderColor: C.border }}>
                        {SCOPE_LABEL[row.scope]}
                      </td>
                      <td className="border-b px-2.5 py-[11px] text-[13.5px] font-semibold" style={{ borderColor: C.border }}>
                        {row.categoryName}
                      </td>
                      <td className="border-b px-2.5 py-[11px] text-[13.5px]" style={{ borderColor: C.border }}>
                        <AssocTag scope={row.scope} name={row.vehicleName ?? row.deviceName ?? ""} />
                      </td>
                      <td className="border-b px-2.5 py-[11px] text-[13.5px]" style={{ borderColor: C.border, color: C.muted }}>
                        {row.description || ""}
                      </td>
                      <td
                        className="border-b px-2.5 py-[11px] text-right text-[13.5px]"
                        style={{ borderColor: C.border, fontVariantNumeric: "tabular-nums" }}
                      >
                        {fmtPln(row.amount)}
                      </td>
                      <td className="border-b px-2.5 py-[11px] text-right whitespace-nowrap" style={{ borderColor: C.border }}>
                        <button
                          type="button"
                          onClick={() => setModal({ mode: "edit", row })}
                          className="rounded px-1.5 py-1 text-[14px]"
                          style={{ color: C.faint }}
                          aria-label="Edytuj"
                          title="Edytuj"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(row)}
                          className="rounded px-1.5 py-1 text-[14px]"
                          style={{ color: C.faint }}
                          aria-label="Usuń"
                          title="Usuń"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modal && (
        <CostFormModal
          mode={modal.mode}
          initial={modal.row}
          categories={categories}
          vehicles={vehicles}
          devices={devices}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
