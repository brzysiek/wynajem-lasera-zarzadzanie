"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";

const DAY_LABEL: Record<1 | 3 | 7, string> = { 1: "1 dzień przed", 3: "3 dni przed", 7: "7 dni przed" };

// Clickable "zakolejkowane" badge used everywhere a QUEUED ReminderRule is
// shown (upcoming queue panel, SMS history, rental detail): clicking it opens
// a popup that lets an admin edit the message before it goes out, or cancel
// the send entirely.
export function QueueCancelBadge({
  ruleId,
  daysBefore,
  initialMessageBody,
  onSaved,
  onCancelled,
}: {
  ruleId: string;
  daysBefore: 1 | 3 | 7;
  initialMessageBody: string;
  onSaved?: (body: string) => void;
  onCancelled?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Kliknij, aby edytować treść lub anulować wysyłkę"
        className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200"
      >
        zakolejkowane
      </button>
      {open && (
        <QueueEditModal
          ruleId={ruleId}
          daysBefore={daysBefore}
          initialMessageBody={initialMessageBody}
          onClose={() => setOpen(false)}
          onSaved={(body) => {
            onSaved?.(body);
            router.refresh();
          }}
          onCancelled={() => {
            onCancelled?.();
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function QueueEditModal({
  ruleId,
  daysBefore,
  initialMessageBody,
  onClose,
  onSaved,
  onCancelled,
}: {
  ruleId: string;
  daysBefore: 1 | 3 | 7;
  initialMessageBody: string;
  onClose: () => void;
  onSaved: (body: string) => void;
  onCancelled: () => void;
}) {
  const [mode, setMode] = useState<"edit" | "confirmCancel">("edit");
  const [body, setBody] = useState(initialMessageBody);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/reminders/queue/${ruleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageBody: body }),
    });
    const data = await res.json().catch(() => null);
    setIsSaving(false);
    if (!res.ok) {
      setError(data?.message || "Nie udało się zapisać zmian.");
      return;
    }
    onSaved(body);
    onClose();
  }

  async function handleCancel() {
    setIsCancelling(true);
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/reminders/queue/${ruleId}/cancel`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setIsCancelling(false);
    if (!res.ok) {
      setError(data?.message || "Nie udało się anulować.");
      return;
    }
    onCancelled();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Zakolejkowane przypomnienie — {DAY_LABEL[daysBefore]}</h3>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {mode === "edit" ? (
          <>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Treść wiadomości
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </label>
            {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode("confirmCancel");
                }}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Anuluj wysyłkę…
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Zamknij
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !body.trim()}
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {isSaving ? "Zapisywanie…" : "Zapisz zmiany"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700">
              Na pewno anulować to przypomnienie? Powiadomienie <strong>{DAY_LABEL[daysBefore]}</strong> nie zostanie
              wysłane automatycznie — w razie potrzeby trzeba będzie je wysłać ręcznie.
            </p>
            {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode("edit");
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Wróć
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isCancelling ? "Anulowanie…" : "Tak, anuluj wysyłkę"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
