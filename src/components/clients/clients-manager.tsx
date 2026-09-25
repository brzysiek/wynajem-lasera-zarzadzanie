"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";
import { APP_CSS_VARS, CLIENT_STATUS_COLORS } from "@/components/shell-tokens";
import {
  CLINIC_TYPE_LABEL,
  DEVICE_INTEREST_KEYS,
  DEVICE_INTEREST_LABEL,
  SOURCE_LABEL,
  STATUS_HINT,
  STATUS_LABEL,
  type ClinicTypeKey,
  type DeviceInterestKey,
  type SourceKey,
} from "@/lib/clients/labels";
import type { ClientListRow } from "@/lib/clients/load";
import type { ClientStatus } from "@/lib/clients/status";
import { Avatar, DeviceTags, DownloadIcon, PhoneIcon, SearchIcon, SmsIcon, StarIcon, StatusChip, fmtAgo, fmtDate, fmtMoney } from "./ui";
import { ClientCard, type CardIntent } from "./client-card";
import { NewClientDialog } from "./client-forms";
import { useMediaQuery } from "./use-media-query";

// Lista klientów (/klienci) — wygląd wg docs/crm/mockup-klienci.html, logika
// wg docs/crm/prompt-claude-code-crm-1-klienci.md (3.2). Klientów jest
// < 1000, więc filtrowanie/wyszukiwanie odbywa się w przeglądarce, bez
// dodatkowych zapytań. Karta klienta: prawa kolumna od 1280 px, poniżej
// panel wysuwany nad listą.

const TILE_STATUSES: ClientStatus[] = ["STALY", "NOWY", "USPIONY", "BYLY", "POTENCJALNY"];
const TILE_TITLE: Record<ClientStatus, string> = {
  STALY: "Stali",
  NOWY: "Nowi",
  USPIONY: "Uśpieni",
  BYLY: "Byli",
  POTENCJALNY: "Potencjalni",
  NIE_KONTAKTOWAC: "Nie kontaktować",
};
// Kampanie przedsezonowe: luty i wrzesień (spec 3.2) — podpowiedź pokazujemy
// miesiąc wcześniej i w samym miesiącu kampanii.
const SEASON_MONTHS = new Set([0, 1, 7, 8]);

type SortKey = "last" | "name" | "revenue" | "created";
const SORT_LABEL: Record<SortKey, string> = {
  last: "Ostatni wynajem",
  name: "Nazwa",
  revenue: "Przychód",
  created: "Data dodania",
};

const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,0.95fr)_minmax(0,1.2fr)_minmax(0,1.15fr)_minmax(0,1fr)_76px] 2xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_76px]";

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: ClientListRow[]) {
  // Średnik + BOM: polski Excel otwiera to bez importu i z poprawnymi ogonkami.
  const header = ["Nazwa", "Osoba", "Telefon", "E-mail", "Miasto", "Status", "Ostatni wynajem", "Urządzenia"];
  const lines = rows.map((r) =>
    [
      r.name,
      r.primaryName,
      r.primaryPhone,
      r.primaryEmail,
      r.city,
      STATUS_LABEL[r.status],
      r.lastRentalAt ? fmtDate(r.lastRentalAt) : "",
      r.devices.map((d) => DEVICE_INTEREST_LABEL[d]).join(", "),
    ]
      .map(csvCell)
      .join(";"),
  );
  const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `klienci-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | "";
  onChange: (v: T | "") => void;
  options: { value: T; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--c-muted)] sm:flex-row sm:items-center sm:gap-1.5">
      <span>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T | "")}
        className={`h-7 w-full cursor-pointer truncate rounded-full sm:w-[132px] border px-2.5 text-xs transition-colors hover:border-[var(--c-brand)] focus:border-[var(--c-brand)] focus:outline-none ${
          value ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "border-[var(--c-border)] bg-white text-[var(--c-text)]"
        }`}
      >
        <option value="">Wszystkie</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ClientsManager({ rows, initialSelectedId }: { rows: ClientListRow[]; initialSelectedId: string | null }) {
  const router = useRouter();
  const wide = useMediaQuery("(min-width: 1280px)");

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [statuses, setStatuses] = useState<Set<ClientStatus>>(new Set());
  const [noPhone, setNoPhone] = useState(false);
  const [device, setDevice] = useState<DeviceInterestKey | "">("");
  const [city, setCity] = useState("");
  const [clinicType, setClinicType] = useState<ClinicTypeKey | "">("");
  const [source, setSource] = useState<SourceKey | "">("");
  const [sort, setSort] = useState<SortKey>("last");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [intent, setIntent] = useState<CardIntent>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const select = useCallback((id: string | null, nextIntent: CardIntent = null) => {
    setSelectedId(id);
    setIntent(nextIntent);
    // Adres odzwierciedla wybranego klienta (link do karty, odświeżenie
    // strony zostawia ją otwartą) — bez nawigacji i przeładowania listy.
    window.history.replaceState(null, "", `${BASE_PATH}/klienci${id ? `/${id}` : ""}`);
  }, []);

  useEffect(() => {
    if (!selectedId || wide) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, wide, select]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(TILE_STATUSES.map((s) => [s, 0])) as Record<ClientStatus, number>;
    for (const r of rows) if (r.status in c) c[r.status] += 1;
    return c;
  }, [rows]);

  const noPhoneCount = useMemo(() => rows.filter((r) => !r.hasPhone).length, [rows]);

  // Podpowiedź sezonowa: urządzenie, które wynajmowało najwięcej uśpionych
  // klientek — liczone wyłącznie z faktycznych wynajmów.
  const season = useMemo(() => {
    if (!SEASON_MONTHS.has(new Date().getMonth())) return null;
    const perDevice = new Map<DeviceInterestKey, number>();
    for (const r of rows) {
      if (r.status !== "USPIONY") continue;
      for (const d of r.rentedDevices) perDevice.set(d, (perDevice.get(d) ?? 0) + 1);
    }
    const [top] = [...perDevice.entries()].sort((a, b) => b[1] - a[1]);
    return top ? { device: top[0], count: top[1] } : null;
  }, [rows]);

  const cities = useMemo(
    () => [...new Set(rows.map((r) => r.city).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, "pl")),
    [rows],
  );

  const visible = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "").replace(/^48(?=\d{3,})/, "");
    const list = rows.filter((r) => {
      if (q.length >= 2) {
        const textHit = r.search.includes(q);
        const phoneHit = qDigits.length >= 3 && r.phoneDigits.includes(qDigits);
        if (!textHit && !phoneHit) return false;
      }
      if (statuses.size && !statuses.has(r.status)) return false;
      if (noPhone && r.hasPhone) return false;
      if (device && !r.devices.includes(device)) return false;
      if (city && r.city !== city) return false;
      if (clinicType && r.clinicType !== clinicType) return false;
      if (source && r.source !== source) return false;
      return true;
    });
    const byLast = (a: ClientListRow, b: ClientListRow) => {
      // Spec 3.2: ostatni wynajem malejąco, klienci bez wynajmów na końcu
      // (wg daty dodania).
      if (a.lastRentalAt && b.lastRentalAt) return b.lastRentalAt.localeCompare(a.lastRentalAt);
      if (a.lastRentalAt) return -1;
      if (b.lastRentalAt) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    };
    const sorters: Record<SortKey, (a: ClientListRow, b: ClientListRow) => number> = {
      last: byLast,
      name: (a, b) => a.name.localeCompare(b.name, "pl"),
      revenue: (a, b) => b.revenueNet - a.revenueNet || byLast(a, b),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    return list.sort(sorters[sort]);
  }, [rows, debounced, statuses, noPhone, device, city, clinicType, source, sort]);

  function toggleStatus(s: ClientStatus) {
    setNoPhone(false);
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function clearAll() {
    setStatuses(new Set());
    setNoPhone(false);
    setDevice("");
    setCity("");
    setClinicType("");
    setSource("");
    setQuery("");
  }

  const allActive = statuses.size === 0 && !noPhone;
  const anyFilter = !allActive || device || city || clinicType || source || debounced.trim().length >= 2;
  const viewTitle = noPhone
    ? "Bez telefonu"
    : statuses.size === 1
      ? TILE_TITLE[[...statuses][0]]
      : statuses.size > 1
        ? [...statuses].map((s) => TILE_TITLE[s]).join(" + ")
        : "Wszyscy klienci";

  const card = selectedId ? (
    <ClientCard
      key={selectedId}
      clientId={selectedId}
      intent={intent}
      onClose={() => select(null)}
      onChanged={() => router.refresh()}
    />
  ) : null;

  return (
    <div style={APP_CSS_VARS} className="text-[var(--c-text)]">
      <div className={wide && selectedId ? "grid grid-cols-[minmax(0,1fr)_400px] gap-5" : ""}>
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* Nagłówek */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-grow">
              <h1 className="m-0 text-[26px] font-semibold text-[var(--c-navy)]">Klienci</h1>
              <p className="mt-0.5 text-[13px] text-[var(--c-muted)]">
                {rows.length} {rows.length === 1 ? "klient" : "klientów"} · status liczony z historii wynajmów
              </p>
            </div>
            <button
              type="button"
              onClick={() => exportCsv(visible)}
              disabled={visible.length === 0}
              className="flex h-[34px] items-center gap-1.5 rounded-lg border border-[var(--c-border)] bg-white px-3 text-[13px] text-[var(--c-text)] transition-colors hover:border-[var(--c-brand)] hover:text-[var(--c-brand-deep)] disabled:opacity-40"
              title="Eksportuje klientów widocznych na liście (z uwzględnieniem filtrów)"
            >
              <DownloadIcon />
              Eksport CSV
            </button>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="h-[34px] rounded-lg bg-[var(--c-brand)] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)]"
            >
              + Nowy klient
            </button>
          </div>

          {/* Wyszukiwarka */}
          <label className="flex h-10 items-center gap-2.5 rounded-[10px] border border-[var(--c-border)] bg-white px-3.5 transition-colors focus-within:border-[var(--c-brand)]">
            <SearchIcon className="flex-none text-[var(--c-muted)]" />
            <span className="sr-only">Szukaj klienta</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj: gabinet, osoba, telefon, NIP, miasto, e-mail…"
              className="min-w-0 flex-grow bg-transparent text-sm outline-none placeholder:text-[var(--c-faint)]"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-xs text-[var(--c-muted)] hover:text-[var(--c-brand-deep)]">
                wyczyść
              </button>
            )}
          </label>

          {/* Kafelki segmentów */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6">
            {[{ key: "ALL" as const }, ...TILE_STATUSES.map((s) => ({ key: s }))].map(({ key }) => {
              const active = key === "ALL" ? allActive : statuses.has(key);
              const dot = key === "ALL" ? "var(--c-brand)" : CLIENT_STATUS_COLORS[key].dot;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => (key === "ALL" ? (setStatuses(new Set()), setNoPhone(false)) : toggleStatus(key))}
                  aria-pressed={active}
                  className={`flex flex-col gap-1 rounded-xl bg-white px-3 py-2.5 text-left transition-colors sm:px-3.5 sm:py-3 ${
                    active ? "border-2 border-[var(--c-brand)]" : "m-px border border-[var(--c-border)] hover:border-[var(--c-brand)]"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[13px] text-[var(--c-muted)]">
                    <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
                    {key === "ALL" ? "Wszyscy" : TILE_TITLE[key]}
                  </span>
                  <span className="text-[22px] font-semibold leading-[1.1] text-[var(--c-navy)] tabular-nums sm:text-[26px]">
                    {key === "ALL" ? rows.length : counts[key]}
                  </span>
                  <span className="hidden text-xs text-[var(--c-muted)] sm:block">{key === "ALL" ? "w bazie" : STATUS_HINT[key]}</span>
                </button>
              );
            })}
          </div>

          {/* Podpowiedzi */}
          {(season || noPhoneCount > 0) && (
            <div className="flex flex-col gap-3 lg:flex-row">
              {season && (
                <div className="flex flex-1 items-center gap-3 rounded-xl bg-[var(--c-accent-soft)] px-4 py-3">
                  <StarIcon className="flex-none text-[var(--c-accent-deep)]" />
                  <div className="flex-grow text-sm">
                    <strong className="font-semibold text-[var(--c-accent-deep)]">Przed sezonem:</strong> {season.count}{" "}
                    {season.count === 1 ? "uśpiona klientka wynajmowała" : "uśpionych klientek wynajmowało"}{" "}
                    {DEVICE_INTEREST_LABEL[season.device]}. Warto przypomnieć się z wolnymi terminami.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      clearAll();
                      setStatuses(new Set(["USPIONY"]));
                      setDevice(season.device);
                    }}
                    className="h-8 whitespace-nowrap rounded-lg bg-[var(--c-accent-deep)] px-3 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Pokaż listę
                  </button>
                </div>
              )}
              {noPhoneCount > 0 && (
                <div className="flex items-center gap-3 rounded-xl border border-[var(--c-border)] bg-white px-4 py-3 lg:w-[300px] lg:flex-none">
                  <PhoneIcon size={20} className="flex-none text-[var(--c-red)]" />
                  <div className="flex-grow text-sm">
                    <strong className="font-semibold text-[var(--c-red)]">
                      {noPhoneCount} {noPhoneCount === 1 ? "klient" : "klientów"}
                    </strong>{" "}
                    bez telefonu
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      clearAll();
                      setNoPhone(true);
                    }}
                    className="text-[13px] font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]"
                  >
                    Uzupełnij
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tabela */}
          <section aria-label="Lista klientów" className="overflow-hidden rounded-xl border border-[var(--c-border)] bg-white">
            <div className="flex flex-col gap-2.5 border-b border-[var(--c-border)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-sm font-semibold text-[var(--c-navy)]">{viewTitle}</span>
                <span className="text-[13px] text-[var(--c-muted)]">· {visible.length} na liście</span>
                {anyFilter && (
                  <button type="button" onClick={clearAll} className="text-xs font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                    wyczyść filtry
                  </button>
                )}
                <div className="flex-grow" />
                <label className="flex items-center gap-1.5 text-xs text-[var(--c-muted)]">
                  Sortuj:
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="h-7 cursor-pointer rounded-full border border-[var(--c-border)] bg-white px-2.5 text-xs text-[var(--c-text)] transition-colors hover:border-[var(--c-brand)] focus:border-[var(--c-brand)] focus:outline-none"
                  >
                    {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                      <option key={k} value={k}>
                        {SORT_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
                <FilterSelect
                  label="Urządzenie"
                  value={device}
                  onChange={setDevice}
                  options={DEVICE_INTEREST_KEYS.map((k) => ({ value: k, label: DEVICE_INTEREST_LABEL[k] }))}
                />
                <FilterSelect label="Miasto" value={city} onChange={setCity} options={cities.map((c) => ({ value: c, label: c }))} />
                <FilterSelect
                  label="Rodzaj"
                  value={clinicType}
                  onChange={setClinicType}
                  options={(Object.keys(CLINIC_TYPE_LABEL) as ClinicTypeKey[]).map((k) => ({ value: k, label: CLINIC_TYPE_LABEL[k] }))}
                />
                <FilterSelect
                  label="Źródło"
                  value={source}
                  onChange={setSource}
                  options={(Object.keys(SOURCE_LABEL) as SourceKey[]).map((k) => ({ value: k, label: SOURCE_LABEL[k] }))}
                />
              </div>
            </div>

            <div
              className={`${ROW_GRID} border-b border-[var(--c-border)] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-[var(--c-muted)]`}
            >
              <span>Klient</span>
              <span>Status</span>
              <span className="hidden md:block">Urządzenia</span>
              <span className="hidden truncate md:block" title="Ostatni wynajem">Ostatni wynajem</span>
              <span className="hidden 2xl:block">12 mies.</span>
              <span className="hidden truncate text-right md:block" title="Przychód netto">Przychód netto</span>
              <span className="hidden md:block" />
            </div>

            {rows.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-[var(--c-muted)]">
                Baza klientów jest pusta. Zaimportuj klientów z HubSpota w{" "}
                <Link href="/ustawienia/integracje/hubspot" className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                  Ustawienia → Integracje → HubSpot
                </Link>{" "}
                albo dodaj pierwszego klienta.
              </div>
            ) : visible.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-[var(--c-muted)]">
                Nikt nie pasuje do tych filtrów.{" "}
                <button type="button" onClick={clearAll} className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
                  Wyczyść filtry
                </button>
              </div>
            ) : (
              <ul>
                {visible.map((r) => {
                  const active = r.id === selectedId;
                  return (
                    <li
                      key={r.id}
                      className={`${ROW_GRID} cursor-pointer items-center border-b border-[var(--c-bg)] px-4 py-2.5 transition-colors ${
                        active ? "bg-[var(--c-brand-soft)] shadow-[inset_3px_0_0_var(--c-brand)]" : "hover:bg-[var(--c-bg)]"
                      }`}
                      onClick={() => select(r.id)}
                    >
                      <button
                        type="button"
                        aria-label={`Pokaż kartę klienta ${r.name}`}
                        className="flex min-w-0 items-center gap-3 text-left"
                        onClick={(e) => {
                          e.stopPropagation();
                          select(r.id);
                        }}
                      >
                        <Avatar name={r.name} id={r.id} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[var(--c-navy)]">{r.name}</span>
                          <span className="block truncate text-xs text-[var(--c-muted)]">
                            {[r.primaryName && r.primaryName !== r.name ? r.primaryName : null, r.city].filter(Boolean).join(" · ") ||
                              r.primaryEmail ||
                              "—"}
                          </span>
                        </span>
                      </button>
                      <div>
                        <StatusChip status={r.status} />
                      </div>
                      <div className="hidden md:block">
                        <DeviceTags devices={r.devices} />
                      </div>
                      <div className="hidden text-[13px] md:block">
                        {r.lastRentalAt ? (
                          <>
                            {fmtDate(r.lastRentalAt)}
                            <div className="text-[11px] text-[var(--c-muted)]">{fmtAgo(r.lastRentalAt)}</div>
                          </>
                        ) : (
                          <span className="text-[var(--c-faint)]">—</span>
                        )}
                      </div>
                      <div className="hidden text-[13px] tabular-nums 2xl:block">{r.rentals12m}</div>
                      <div className="hidden text-right text-[13px] font-medium tabular-nums md:block">
                        {r.revenueNet > 0 ? fmtMoney(r.revenueNet) : <span className="text-[var(--c-faint)]">—</span>}
                      </div>
                      <div className="hidden justify-end gap-1.5 md:flex" onClick={(e) => e.stopPropagation()}>
                        {r.primaryPhone ? (
                          <>
                            <a
                              href={`tel:${r.primaryPhone}`}
                              aria-label={`Zadzwoń do ${r.name}`}
                              title={r.primaryPhone}
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--c-brand-soft)] text-[var(--c-brand)] transition-colors hover:bg-[var(--c-brand)] hover:text-white"
                            >
                              <PhoneIcon />
                            </a>
                            <button
                              type="button"
                              aria-label={`Wyślij SMS do ${r.name}`}
                              onClick={() => select(r.id, "sms")}
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--c-brand-soft)] text-[var(--c-brand)] transition-colors hover:bg-[var(--c-brand)] hover:text-white"
                            >
                              <SmsIcon />
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-[var(--c-faint)]">brak tel.</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {wide && card && (
          <aside
            aria-label="Karta klienta"
            className="sticky top-0 self-start overflow-hidden rounded-xl border border-[var(--c-border)] bg-white"
            style={{ maxHeight: "calc(100vh - 7rem)" }}
          >
            {card}
          </aside>
        )}
      </div>

      {/* Poniżej 1280 px: karta jako panel wysuwany nad listą. */}
      {!wide && card && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Karta klienta">
          <button type="button" aria-label="Zamknij kartę" className="absolute inset-0 bg-black/25" onClick={() => select(null)} />
          <div className="relative h-full w-full max-w-[420px] overflow-hidden bg-white shadow-[-8px_0_28px_rgba(0,0,0,0.15)]">{card}</div>
        </div>
      )}

      {showNew && (
        <NewClientDialog
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            router.refresh();
            select(id);
          }}
        />
      )}
    </div>
  );
}
