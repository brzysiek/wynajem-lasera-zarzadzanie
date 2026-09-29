import { zoneFor, type TransportZone } from "./delivery-rules";

// Wniosek 28: sugestia transportu z km (strefa adresu domyślnego, inaczej
// ostatnia znana odległość klienta) — tylko podpowiedź obok kwoty ustalonej.
export function transportSuggestion(d: {
  distanceKm: string | null;
  delivery: { addresses: { isDefault: boolean; distanceKm: number | null }[]; zones: TransportZone[] };
}): { km: number; zone: string; priceNet: number } | null {
  const a = d.delivery.addresses.find((x) => x.isDefault) ?? d.delivery.addresses[0];
  const km = a?.distanceKm ?? (d.distanceKm != null ? Number(d.distanceKm) : null);
  const z = zoneFor(km, d.delivery.zones);
  return km != null && z?.priceNet != null ? { km, zone: z.code, priceNet: z.priceNet } : null;
}
