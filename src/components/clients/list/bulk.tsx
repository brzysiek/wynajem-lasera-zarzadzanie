"use client";

import { useEffect, useState } from "react";
import { api } from "../client-forms";

// Zbiorcze „Zadanie dla Ani” z listy klientów — jedno zadanie na klienta
// (POST /api/clients/[id]/tasks, te same reguły przydziału co na karcie).

const INPUT = "h-11 w-full border border-[#D6DADE] bg-white px-3 text-[15px] text-[#3A3A3A] outline-none focus:border-[#1B6FA8]";

export function BulkTaskDialog({ clients, onClose, onDone }: { clients: { id: string; name: string }[]; onClose: () => void; onDone: (created: number) => void }) {
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ title: "Kontakt z klientką", dueDate: "", assigneeId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api<{ users: { id: string; name: string }[] }>("/api/tasks/assignees", "GET").then(({ ok, data }) => {
      if (!alive || !ok) return;
      setUsers(data.users);
      const ania = data.users.find((u) => /^ania\b|^anna\b/i.test(u.name));
      if (ania) setF((p) => (p.assigneeId ? p : { ...p, assigneeId: ania.id }));
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    let created = 0;
    const failed: string[] = [];
    for (const c of clients) {
      const { ok } = await api(`/api/clients/${c.id}/tasks`, "POST", { title: f.title, dueDate: f.dueDate || null, assigneeId: f.assigneeId || undefined });
      if (ok) created++;
      else failed.push(c.name);
    }
    setBusy(false);
    if (failed.length) return setError(`Nie udało się dla: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}`);
    onDone(created);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex w-full max-w-md flex-col gap-3 bg-white p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Zadanie dla zaznaczonych">
        <h2 className="card-display m-0 text-[22px] font-medium text-[#0C3450]">
          Zadanie dla {clients.length} {clients.length === 1 ? "klienta" : "klientów"}
        </h2>
        <p className="m-0 text-[14px] text-[#5C6166]">Osobne zadanie przy każdym kliencie — widoczne na karcie i w panelu Zadań.</p>
        <input className={INPUT} autoFocus placeholder="Co zrobić?" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input type="date" aria-label="Termin" className={INPUT} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          <select aria-label="Dla kogo" className={INPUT} value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
            <option value="">dla mnie</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="m-0 bg-[#FBF0E7] px-3 py-2 text-[14px] text-[#B8612F]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-[46px] border border-[#A9D2EC] bg-white px-[18px] text-[15px] text-[#1B6FA8]">
            Anuluj
          </button>
          <button type="button" disabled={busy || !f.title.trim()} onClick={() => void save()} className="h-[46px] border border-[#1B6FA8] bg-[#1B6FA8] px-[22px] text-[15px] font-medium text-white disabled:opacity-50">
            {busy ? "Tworzenie…" : "Utwórz zadania"}
          </button>
        </div>
      </div>
    </div>
  );
}
