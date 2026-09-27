"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { BASE_PATH } from "@/lib/base-path";
import type { ClientListRow } from "@/lib/clients/list-load";
import type { ClientStatus } from "@/lib/clients/status";
import { BASE } from "@/lib/clients/geo-rules";
import { nearRoute, routeKm, type DayStop } from "@/lib/clients/day-route";
import { STATUS_BADGE, dm, wd } from "./format";

// Widok „Mapa” na /klienci (etap 1): klientki z przefiltrowanej listy jako
// pinezki w kolorach statusów, baza w Skawinie, odległość w linii prostej.
// Współrzędne z Nominatim (OpenStreetMap) — uzupełniane partiami z przycisku;
// biuro może przeciągnąć pinezkę, gdy adres trafił obok.

// Kolory statusów jak na liście, ale pełne i ciemniejsze tam, gdzie na
// wyszarzonym podkładzie ginęły (Były, Nie kontaktować).
const COLOR: Record<ClientStatus, string> = {
  STALY: "#2F7A68",
  NOWY: "#1B6FA8",
  USPIONY: "#D9733E",
  BYLY: "#6B7280",
  NIE_KONTAKTOWAC: "#3A3F44",
  POTENCJALNY: "#5FA3D0",
};
// Litera w pinezce — status czytelny bez rozróżniania kolorów.
const LETTER: Record<ClientStatus, string> = { STALY: "S", NOWY: "N", USPIONY: "U", BYLY: "B", NIE_KONTAKTOWAC: "×", POTENCJALNY: "P" };

// Pinezka-kropla 28×38: kolor statusu, biała obwódka, cień, litera w środku.
// Przybliżone położenie (tylko miejscowość) — przerywana obwódka.
function pinHtml(color: string, letter: string, opts: { approx?: boolean; faded?: boolean; halo?: boolean } = {}): string {
  const halo = opts.halo ? `<span class="wl-pulse"></span>` : "";
  return `<div class="wl-pin" style="opacity:${opts.faded ? 0.35 : 1}">${halo}<svg width="28" height="38" viewBox="0 0 28 38" aria-hidden="true">
    <path d="M14 36.5C14 36.5 2.5 22.3 2.5 14a11.5 11.5 0 1 1 23 0c0 8.3-11.5 22.5-11.5 22.5z" fill="${color}" stroke="#fff" stroke-width="2.5" ${opts.approx ? 'stroke-dasharray="4 3"' : ""}/>
    <circle cx="14" cy="14" r="6.8" fill="#fff"/>
    <text x="14" y="17.6" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="10" font-weight="700" fill="${color}">${letter}</text>
  </svg></div>`;
}

const BASE_PIN = `<div class="wl-pin"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="2" y="2" width="28" height="28" rx="6" fill="#0C3450" stroke="#fff" stroke-width="2.5"/>
  <path d="M9 16.5 16 10l7 6.5V23h-4.5v-4h-5v4H9z" fill="#fff"/>
</svg></div>`;

// Style tylko dla tej mapy: wyszarzony podkład (pinezki są wtedy wyraźne),
// podpisy nazw od przybliżenia 10, pulsujący pierścień „blisko trasy”.
const MAP_CSS = `
.wl-map .leaflet-tile-pane { filter: grayscale(0.9) contrast(0.92) brightness(1.06); }
.wl-map .wl-pin { position: relative; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
.wl-map .wl-pulse { position: absolute; left: 50%; top: 14px; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; border: 3px solid #E08A5C; animation: wl-pulse 1.6s ease-out infinite; }
@keyframes wl-pulse { 0% { transform: scale(.6); opacity: .9 } 100% { transform: scale(1.35); opacity: 0 } }
.wl-map .wl-label { background: #fff; border: 1px solid #C9D6E0; border-radius: 4px; box-shadow: 0 1px 3px rgba(12,52,80,.25); color: #0C3450; font: 600 11.5px/1.2 inherit; padding: 2px 6px; white-space: nowrap; }
.wl-map .wl-label::before { display: none; }
.wl-map:not(.wl-zoomed) .wl-label { display: none; }
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function popupHtml(r: ClientListRow): string {
  const next = r.nextRental ? `${wd(r.nextRental.at)} ${dm(r.nextRental.at)}${r.nextRental.unassigned ? " (bez klienta)" : ""}` : r.forecastAt ? `wg rytmu ok. ${dm(r.forecastAt)}` : "brak rezerwacji";
  const approx = r.geo?.precision === "MIEJSCOWOSC" ? `<div style="color:#B8612F;font-size:11px">położenie przybliżone — tylko miejscowość</div>` : "";
  return `<div style="font-family:inherit;font-size:12.5px;line-height:1.45;min-width:190px">
    <div style="font-size:14px;font-weight:600;color:#0C3450">${esc(r.shortName ?? r.name)}</div>
    <div style="color:#5C6166">${esc(STATUS_BADGE[r.status].label)}${r.city ? ` · ${esc(r.city)}` : ""}</div>
    ${approx}
    <div style="margin-top:4px">Następny wynajem: <b style="color:#1B6FA8">${esc(next)}</b></div>
    ${r.baseKm != null ? `<div style="color:#5C6166">${String(r.baseKm).replace(".", ",")} km od bazy (w linii prostej)</div>` : ""}
    ${r.deviceChips.length ? `<div style="color:#5C6166">${esc(r.deviceChips.join(", "))}</div>` : ""}
    <a href="${BASE_PATH}/klienci/${esc(r.id)}" style="display:inline-block;margin-top:4px;color:#1B6FA8">Otwórz kartę →</a>
  </div>`;
}

export function MapView({ rows, canEdit, todayIso }: { rows: ClientListRow[]; canEdit: boolean; todayIso: string }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const dayLayer = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [editPins, setEditPins] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Etap 2 — dzień dostaw: przystanki dnia i klientki blisko trasy.
  const [day, setDay] = useState("");
  const [radius, setRadius] = useState(15);
  const [stops, setStops] = useState<DayStop[] | null>(null);
  const [dayState, setDayState] = useState<"idle" | "loading" | "error">("idle");

  const onMap = useMemo(() => rows.filter((r) => r.geo), [rows]);
  const pending = rows.filter((r) => r.geoPending).length;
  const noAddress = rows.filter((r) => !r.geo && !r.geoPending).length;

  // Kandydatki do telefonu: wg rytmu powinny wynająć w tym albo następnym
  // miesiącu bez rezerwacji, albo minął ich typowy odstęp — i nie mają
  // rezerwacji w ciągu 14 dni od wybranego dnia.
  const near = useMemo(() => {
    if (!stops || !day) return [];
    const dayMs = new Date(`${day}T12:00:00Z`).getTime();
    const candidates = rows.filter((r) => {
      if (!r.geo || r.status === "NIE_KONTAKTOWAC" || r.status === "BYLY" || r.status === "POTENCJALNY") return false;
      if (r.nextRental && Math.abs(new Date(r.nextRental.at).getTime() - dayMs) < 14 * 86_400_000) return false;
      return r.rhythm.cells[12] === "F" || r.rhythm.cells[13] === "F" || (r.overdueRatio ?? 0) >= 1 || r.beforeSeason;
    });
    return nearRoute(stops, candidates.map((r) => ({ ...r, id: r.id, geo: { lat: r.geo!.lat, lng: r.geo!.lng } })), radius);
  }, [stops, day, rows, radius]);
  const nearIds = useMemo(() => new Set(near.map((n) => n.id)), [near]);

  async function loadDay(d: string) {
    setDay(d);
    setStops(null);
    if (!d) return setDayState("idle");
    setDayState("loading");
    try {
      const res = await fetch(`${BASE_PATH}/api/clients/map-day?dzien=${d}`);
      const data = (await res.json()) as { stops: DayStop[] };
      if (!res.ok) throw new Error();
      setStops(data.stops);
      setDayState("idle");
    } catch {
      setDayState("error");
    }
  }
  const plusDays = (n: number) => {
    const t = new Date(new Date(todayIso).getTime() + n * 86_400_000);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  };

  // Leaflet tylko w przeglądarce — import przy pierwszym wyświetleniu mapy.
  useEffect(() => {
    let alive = true;
    void import("leaflet").then((mod) => {
      if (!alive || !box.current || map.current) return;
      const L = mod.default;
      leaflet.current = L;
      const m = L.map(box.current, { zoomControl: true }).setView([BASE.lat, BASE.lng], 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · współrzędne: Nominatim',
      }).addTo(m);
      map.current = m;
      // Podpisy nazw dopiero po przybliżeniu — przy całym województwie by się nakładały.
      const zoomClass = () => box.current?.classList.toggle("wl-zoomed", m.getZoom() >= 10);
      m.on("zoomend", zoomClass);
      zoomClass();
      layer.current = L.layerGroup().addTo(m);
      dayLayer.current = L.layerGroup().addTo(m);
      setReady(true);
    });
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    const m = map.current;
    const g = layer.current;
    if (!ready || !L || !m || !g) return;
    g.clearLayers();
    L.marker([BASE.lat, BASE.lng], {
      title: BASE.label,
      zIndexOffset: 500,
      icon: L.divIcon({ className: "", html: BASE_PIN, iconSize: [32, 32], iconAnchor: [16, 16] }),
    })
      .bindTooltip(BASE.label)
      .addTo(g);
    for (const r of onMap) {
      const approx = r.geo!.precision === "MIEJSCOWOSC";
      const halo = nearIds.has(r.id);
      const icon = L.divIcon({
        className: "",
        html: pinHtml(COLOR[r.status], LETTER[r.status], { approx, halo, faded: !!stops && !halo }),
        iconSize: [28, 38],
        iconAnchor: [14, 37],
        popupAnchor: [0, -32],
        tooltipAnchor: [0, 2],
      });
      const mk = L.marker([r.geo!.lat, r.geo!.lng], { icon, title: r.shortName ?? r.name, draggable: editPins, zIndexOffset: halo ? 400 : 0, riseOnHover: true })
        .bindPopup(popupHtml(r))
        .bindTooltip(esc(r.shortName ?? r.name), { permanent: true, direction: "bottom", className: "wl-label", opacity: 1 });
      if (editPins) {
        mk.on("dragend", async () => {
          const p = mk.getLatLng();
          if (!window.confirm(`Przenieść pinezkę „${r.shortName ?? r.name}” w to miejsce?`)) {
            mk.setLatLng([r.geo!.lat, r.geo!.lng]);
            return;
          }
          const res = await fetch(`${BASE_PATH}/api/clients/${r.id}/geo`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: p.lat, lng: p.lng }) });
          setMsg(res.ok ? `Zapisano położenie: ${r.shortName ?? r.name}.` : "Nie udało się zapisać położenia.");
          if (res.ok) router.refresh();
        });
      }
      mk.addTo(g);
    }
    if (!fitted.current && onMap.length) {
      m.fitBounds(L.latLngBounds([[BASE.lat, BASE.lng], ...onMap.map((r) => [r.geo!.lat, r.geo!.lng] as [number, number])]), { padding: [30, 30], maxZoom: 11 });
      fitted.current = true;
    }
  }, [ready, onMap, editPins, router, nearIds, stops]);

  // Trasa dnia: baza → przystanki (wg godziny) → baza, w linii prostej.
  useEffect(() => {
    const L = leaflet.current;
    const m = map.current;
    const g = dayLayer.current;
    if (!ready || !L || !m || !g) return;
    g.clearLayers();
    if (!stops) return;
    const located = stops.filter((s) => s.geo);
    const path: [number, number][] = [[BASE.lat, BASE.lng], ...located.map((s) => [s.geo!.lat, s.geo!.lng] as [number, number]), [BASE.lat, BASE.lng]];
    if (located.length) L.polyline(path, { color: "#2B5B82", weight: 3, dashArray: "6 6", opacity: 0.85 }).addTo(g);
    located.forEach((s) => {
      const n = stops.indexOf(s) + 1;
      const bg = s.kind === "DOSTAWA" ? "#1B6FA8" : "#0C3450";
      L.marker([s.geo!.lat, s.geo!.lng], {
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: "",
          html: `<div class="wl-pin"><span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${bg};color:#fff;font:700 12px/1 Arial,sans-serif;border:2.5px solid #fff">${n}</span></div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 40],
        }),
      })
        .bindTooltip(`${n}. ${s.time ?? "bez godziny"} · ${s.kind === "DOSTAWA" ? "dostawa" : "odbiór"} · ${esc(s.clientName ?? s.title)}`)
        .addTo(g);
    });
    if (located.length) m.fitBounds(L.latLngBounds(path), { padding: [40, 40], maxZoom: 11 });
  }, [ready, stops]);

  async function fillCoordinates() {
    setBusy(true);
    setMsg("Szukanie współrzędnych w OpenStreetMap… (ok. 1 adres na sekundę)");
    let total = 0;
    try {
      for (let i = 0; i < 40; i++) {
        const res = await fetch(`${BASE_PATH}/api/clients/geocode`, { method: "POST" });
        const data = (await res.json().catch(() => null)) as { done: number; found: number; remaining: number; message?: string } | null;
        if (!res.ok || !data) throw new Error(data?.message ?? `HTTP ${res.status}`);
        total += data.found;
        setMsg(`Znaleziono ${total}… zostało ${data.remaining}.`);
        if (data.remaining === 0 || data.done === 0) break;
      }
      setMsg(`Gotowe — znaleziono ${total} adresów.`);
    } catch (e) {
      setMsg(`Przerwano: ${e instanceof Error ? e.message : "błąd"}. Można bezpiecznie uruchomić ponownie.`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="mx-4 mt-3 flex flex-col border border-[#E4E7EA] bg-white md:mx-7">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#E4E7EA] px-3.5 py-2 text-[12.5px] text-[#5C6166]">
        <span>
          Na mapie <b className="text-[#0C3450]">{onMap.length}</b> z {rows.length}
          {noAddress > 0 && ` · ${noAddress} bez adresu`}
          {pending > 0 && <span className="text-[#B8612F]"> · {pending} czeka na współrzędne</span>}
        </span>
        {canEdit && pending > 0 && (
          <button type="button" disabled={busy} onClick={() => void fillCoordinates()} className="h-[30px] rounded-[6px] bg-[#1B6FA8] px-3 text-[12.5px] font-medium text-white hover:bg-[#0C3450] disabled:opacity-50">
            {busy ? "Szukanie…" : "Uzupełnij współrzędne"}
          </button>
        )}
        {canEdit && onMap.length > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={editPins} onChange={(e) => setEditPins(e.target.checked)} />
            poprawiaj pinezki (przeciągnij)
          </label>
        )}
        {msg && <span className="text-[#1B6FA8]">{msg}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-3">
          {(["STALY", "NOWY", "USPIONY", "BYLY"] as ClientStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: COLOR[s] }}>
                {LETTER[s]}
              </span>
              {STATUS_BADGE[s].label}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="h-[18px] w-[18px] rounded-[4px] bg-[#0C3450]" />
            baza
          </span>
          <span>przerywana obwódka = tylko miejscowość</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#E4E7EA] bg-[#F7F9FB] px-3.5 py-2 text-[12.5px] text-[#3A3A3A]">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#0C3450]">Dzień dostaw</span>
        <input type="date" value={day} onChange={(e) => void loadDay(e.target.value)} className="h-[30px] rounded-[6px] border border-[#D6DADE] bg-white px-2 text-[12.5px]" aria-label="Dzień dostaw" />
        <button type="button" onClick={() => void loadDay(plusDays(0))} className="h-[30px] rounded-[6px] border border-[#D6DADE] bg-white px-2.5 hover:border-[#1B6FA8]">
          dziś
        </button>
        <button type="button" onClick={() => void loadDay(plusDays(1))} className="h-[30px] rounded-[6px] border border-[#D6DADE] bg-white px-2.5 hover:border-[#1B6FA8]">
          jutro
        </button>
        {day && (
          <>
            <label className="flex items-center gap-1.5">
              klientki blisko trasy do
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="h-[30px] rounded-[6px] border border-[#D6DADE] bg-white px-1.5">
                {[5, 10, 15, 20, 30].map((km) => (
                  <option key={km} value={km}>
                    {km} km
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void loadDay("")} className="text-[#1B6FA8] hover:text-[#0C3450]">
              wyłącz
            </button>
          </>
        )}
        {dayState === "loading" && <span className="text-[#5C6166]">wczytywanie…</span>}
        {dayState === "error" && <span className="text-[#B8612F]">nie udało się wczytać dnia</span>}
        {stops && (
          <span className="ml-auto text-[#5C6166]">
            {stops.length} {stops.length === 1 ? "przystanek" : "przystanków"} · ok. {routeKm(stops)} km w linii prostej
          </span>
        )}
      </div>
      <style>{MAP_CSS}</style>
      <div ref={box} className="wl-map h-[calc(100vh-340px)] min-h-[440px] w-full" aria-label="Mapa klientek" />
      {stops && (
        <div className="grid gap-4 border-t border-[#E4E7EA] px-3.5 py-3 text-[12.5px] lg:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#0C3450]">Trasa · {day.split("-").reverse().join(".")}</div>
            {stops.length === 0 ? (
              <div className="text-[#5C6166]">Brak dostaw i odbiorów tego dnia.</div>
            ) : (
              <ol className="flex flex-col gap-1">
                {stops.map((s, i) => (
                  <li key={s.key} className="flex gap-2">
                    <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10.5px] font-semibold text-white ${s.kind === "DOSTAWA" ? "bg-[#1B6FA8]" : "bg-[#0C3450]"}`}>{i + 1}</span>
                    <span className="min-w-0">
                      <b className="font-semibold">{s.time ?? "bez godziny"}</b> · {s.kind === "DOSTAWA" ? "dostawa" : "odbiór"} ·{" "}
                      {s.clientId ? (
                        <a href={`${BASE_PATH}/klienci/${s.clientId}`} className="text-[#1B6FA8] hover:underline">
                          {s.clientName}
                        </a>
                      ) : (
                        <span className="text-[#B8612F]">{s.title} (bez klienta)</span>
                      )}{" "}
                      <span className="text-[#5C6166]">
                        · {s.deviceName}
                        {s.driverName ? ` · ${s.driverName}` : ""}
                        {!s.geo ? " · brak pinezki" : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#B8612F]">
              Blisko trasy (do {radius} km) · {near.length} {near.length === 1 ? "klientka" : "klientek"} do telefonu
            </div>
            {near.length === 0 ? (
              <div className="text-[#5C6166]">Nikt, kto wg rytmu powinien wynająć, nie jest blisko tej trasy.</div>
            ) : (
              <ul className="flex flex-col gap-1">
                {near.slice(0, 15).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                    <a href={`${BASE_PATH}/klienci/${c.id}`} className="font-semibold text-[#0C3450] hover:text-[#1B6FA8]">
                      {c.shortName ?? c.name}
                    </a>
                    <span className="text-[#5C6166]">
                      {String(c.km).replace(".", ",")} km od: {c.nearStop} ·{" "}
                      {c.forecastAt ? `wg rytmu ok. ${dm(c.forecastAt)}` : (c.overdueRatio ?? 0) >= 1 ? "po terminie rytmu" : c.beforeSeason ? "przed sezonem" : "wg rytmu bez rezerwacji"}
                    </span>
                    {c.primaryPhone && (
                      <a href={`tel:${c.primaryPhone}`} className="text-[#1B6FA8] hover:underline">
                        zadzwoń
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="px-3.5 py-2 text-[11.5px] text-[#5C6166]">
        Filtry i wyszukiwarka nad mapą działają także tutaj. Pinezka stoi pod adresem dostawy z „Paszportu dostawy”, a bez niego — pod adresem firmy. Odległości w linii prostej od bazy w Skawinie.
      </div>
    </div>
  );
}
