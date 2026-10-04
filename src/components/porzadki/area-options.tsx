import type { AreaDef } from "@/lib/porzadki/areas";

// Opcje obszaru wniosku ze słownika (proposal_areas): backlog panelu i
// skrzynka Tomka w osobnych grupach.
export function AreaOptions({ areas }: { areas: AreaDef[] }) {
  const dev = areas.filter((a) => a.dev);
  const inbox = areas.filter((a) => !a.dev);
  const opt = (a: AreaDef) => (
    <option key={a.key} value={a.key}>
      {a.label}
      {a.hint ? ` — ${a.hint}` : ""}
    </option>
  );
  if (!dev.length || !inbox.length) return <>{areas.map(opt)}</>;
  return (
    <>
      <optgroup label="Panel (backlog)">{dev.map(opt)}</optgroup>
      <optgroup label="Skrzynka Tomka — nie do implementacji">{inbox.map(opt)}</optgroup>
    </>
  );
}
