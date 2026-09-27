"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { BASE_PATH } from "@/lib/base-path";
import type { ClientListRow } from "@/lib/clients/list-load";
import type { ClientStatus } from "@/lib/clients/status";
import { BASE } from "@/lib/clients/geo-rules";
import { STATUS_BADGE, dm, wd } from "./format";

// Widok „Mapa” na /klienci (etap 1): klientki z przefiltrowanej listy jako
// pinezki w kolorach statusów, baza w Skawinie, odległość w linii prostej.
// Współrzędne z Nominatim (OpenStreetMap) — uzupełniane partiami z przycisku;
// biuro może przeciągnąć pinezkę, gdy adres trafił obok.

const COLOR: Record<ClientStatus, string> = {
  STALY: "#2F7A68",
  NOWY: "#1B6FA8",
  USPIONY: "#E08A5C",
  BYLY: "#9AA1A8",
  NIE_KONTAKTOWAC: "#5C6166",
  POTENCJALNY: "#A9D2EC",
};

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

export function MapView({ rows, canEdit }: { rows: ClientListRow[]; canEdit: boolean }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [editPins, setEditPins] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onMap = useMemo(() => rows.filter((r) => r.geo), [rows]);
  const pending = rows.filter((r) => r.geoPending).length;
  const noAddress = rows.filter((r) => !r.geo && !r.geoPending).length;

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
      layer.current = L.layerGroup().addTo(m);
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
      icon: L.divIcon({ className: "", html: `<span style="display:block;width:16px;height:16px;background:#0C3450;border:2px solid #fff;box-shadow:0 0 0 1px #0C3450"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
    })
      .bindTooltip(BASE.label)
      .addTo(g);
    for (const r of onMap) {
      const approx = r.geo!.precision === "MIEJSCOWOSC";
      const icon = L.divIcon({
        className: "",
        html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${COLOR[r.status]};border:2px ${approx ? "dashed" : "solid"} #fff;box-shadow:0 0 0 1px rgba(12,52,80,.55);opacity:${approx ? 0.7 : 1}"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const mk = L.marker([r.geo!.lat, r.geo!.lng], { icon, title: r.shortName ?? r.name, draggable: editPins }).bindPopup(popupHtml(r));
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
  }, [ready, onMap, editPins, router]);

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
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR[s] }} />
              {STATUS_BADGE[s].label}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 bg-[#0C3450]" />
            baza
          </span>
          <span>przerywana obwódka = tylko miejscowość</span>
        </span>
      </div>
      <div ref={box} className="h-[calc(100vh-300px)] min-h-[460px] w-full" aria-label="Mapa klientek" />
      <div className="px-3.5 py-2 text-[11.5px] text-[#5C6166]">
        Filtry i wyszukiwarka nad mapą działają także tutaj. Pinezka stoi pod adresem dostawy z „Paszportu dostawy”, a bez niego — pod adresem firmy. Odległości w linii prostej od bazy w Skawinie.
      </div>
    </div>
  );
}
