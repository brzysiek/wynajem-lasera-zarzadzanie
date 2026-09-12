"use client";

import { useState, type FormEvent } from "react";
import { BASE_PATH } from "@/lib/base-path";

type Scope = "GENERAL" | "VEHICLE" | "DEVICE";

export type CostCategoryDto = {
  id: string;
  name: string;
  scope: Scope;
  active: boolean;
  usageCount: number;
};

const SCOPE_SECTIONS: { scope: Scope; label: string }[] = [
  { scope: "GENERAL", label: "Ogólne" },
  { scope: "VEHICLE", label: "Pojazd" },
  { scope: "DEVICE", label: "Urządzenie" },
];

async function api(url: string, init?: RequestInit) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function CategoryRow({ cat, onChanged }: { cat: CostCategoryDto; onChanged: (updated: CostCategoryDto) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [error, setError] = useState<string | null>(null);

  async function saveName() {
    if (!name.trim() || name.trim() === cat.name) return setEditing(false);
    const { ok, data } = await api(`/api/cost-categories/${cat.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!ok) return setError(data?.message || "Nie udało się zapisać.");
    onChanged({ ...cat, name: name.trim() });
    setEditing(false);
  }

  async function toggleActive() {
    const { ok, data } = await api(`/api/cost-categories/${cat.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !cat.active }),
    });
    if (!ok) return setError(data?.message || "Nie udało się zapisać.");
    onChanged({ ...cat, active: !cat.active });
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-2.5 last:border-0">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
              if (e.key === "Escape") { setName(cat.name); setEditing(false); }
            }}
            onBlur={() => void saveName()}
            className="w-full max-w-[260px] rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        ) : (
          <span className={`truncate text-sm font-semibold ${cat.active ? "text-gray-900" : "text-gray-400 line-through"}`}>
            {cat.name}
          </span>
        )}
        <span className="flex-none text-xs text-gray-400">{cat.usageCount} wpisów</span>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          onClick={() => void toggleActive()}
          className="rounded-full border px-2.5 py-1 text-[11px] font-bold"
          style={
            cat.active
              ? { color: "#1E9E6B", borderColor: "#CFEEDE", background: "#E7F7F0" }
              : { color: "#9CA3AF", borderColor: "#E2E6EC" }
          }
        >
          {cat.active ? "Aktywna" : "Nieaktywna"}
        </button>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Zmień nazwę"
            title="Zmień nazwę"
          >
            ✎
          </button>
        )}
      </div>
    </div>
  );
}

function ScopeSection({
  scope,
  label,
  categories,
  onChanged,
  onAdded,
}: {
  scope: Scope;
  label: string;
  categories: CostCategoryDto[];
  onChanged: (updated: CostCategoryDto) => void;
  onAdded: (created: CostCategoryDto) => void;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    const { ok, data } = await api("/api/cost-categories", {
      method: "POST",
      body: JSON.stringify({ name: newName.trim(), scope }),
    });
    setAdding(false);
    if (!ok) return setError(data?.message || "Nie udało się dodać kategorii.");
    onAdded({ id: data.category.id, name: data.category.name, scope, active: true, usageCount: 0 });
    setNewName("");
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
        <span className="text-xs text-gray-400">{categories.length}</span>
      </div>
      {categories.length === 0 ? (
        <p className="py-3 text-sm text-gray-400">Brak kategorii w tym zakresie.</p>
      ) : (
        categories.map((c) => <CategoryRow key={c.id} cat={c} onChanged={onChanged} />)
      )}
      <form onSubmit={addCategory} className="mt-3 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nowa kategoria…"
          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={adding || !newName.trim()}
          className="rounded-md bg-[#1B6FA8] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          + Dodaj
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function CostCategoriesPanel({ initialCategories }: { initialCategories: CostCategoryDto[] }) {
  const [categories, setCategories] = useState(initialCategories);

  function onChanged(updated: CostCategoryDto) {
    setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }
  function onAdded(created: CostCategoryDto) {
    setCategories((prev) => [...prev, created]);
  }

  return (
    <div className="max-w-2xl space-y-4">
      {SCOPE_SECTIONS.map(({ scope, label }) => (
        <ScopeSection
          key={scope}
          scope={scope}
          label={label}
          categories={categories.filter((c) => c.scope === scope)}
          onChanged={onChanged}
          onAdded={onAdded}
        />
      ))}
    </div>
  );
}
