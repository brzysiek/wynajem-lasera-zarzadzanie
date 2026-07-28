"use client";

import { useState } from "react";

export type SmsTemplateDto = { id: string; key: string; label: string; body: string; locked: boolean };

async function api(url: string, init?: RequestInit) {
  const res = await fetch(`/wynajem${url}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function TemplateRow({
  template,
  onSaved,
  onDeleted,
}: {
  template: SmsTemplateDto;
  onSaved: (t: SmsTemplateDto) => void;
  onDeleted: (id: string) => void;
}) {
  const [label, setLabel] = useState(template.label);
  const [body, setBody] = useState(template.body);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = label !== template.label || body !== template.body;

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    const payload: Record<string, string> = { body };
    if (!template.locked) payload.label = label;
    const { ok, data } = await api(`/api/message-templates/${template.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się zapisać szablonu.");
      return;
    }
    onSaved(data.template);
  }

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    const { ok, data } = await api(`/api/message-templates/${template.id}`, { method: "DELETE" });
    setIsDeleting(false);
    if (!ok) {
      setError(data?.message || "Nie udało się usunąć szablonu.");
      return;
    }
    onDeleted(template.id);
  }

  return (
    <div id={`template-${template.id}`} className="rounded-md border border-gray-200 bg-gray-50 p-3 scroll-mt-20">
      <div className="mb-2 flex items-center justify-between gap-2">
        {template.locked ? (
          <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
            {label}
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-normal text-gray-600">wbudowany</span>
          </span>
        ) : (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Nazwa szablonu"
            className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1 text-sm font-medium text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        )}
        {!template.locked &&
          (confirmingDelete ? (
            <span className="flex flex-none items-center gap-2 text-xs">
              <span className="text-gray-600">Na pewno?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? "Usuwanie…" : "Tak, usuń"}
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="text-gray-500 hover:underline">
                Anuluj
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="flex-none rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
            >
              Usuń
            </button>
          ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
      />
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {dirty && (
        <div className="mt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {isSaving ? "Zapisywanie…" : "Zapisz"}
          </button>
        </div>
      )}
    </div>
  );
}

function NewTemplateForm({ onCreated }: { onCreated: (t: SmsTemplateDto) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="self-start rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        + Nowy szablon
      </button>
    );
  }

  async function handleCreate() {
    setIsSaving(true);
    setError(null);
    const { ok, data } = await api("/api/message-templates", {
      method: "POST",
      body: JSON.stringify({ label, body }),
    });
    setIsSaving(false);
    if (!ok) {
      setError(data?.message || "Nie udało się dodać szablonu.");
      return;
    }
    onCreated(data.template);
    setLabel("");
    setBody("");
    setIsOpen(false);
  }

  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-white p-3">
      <div className="flex flex-col gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nazwa szablonu"
          className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Treść wiadomości"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
        />
        {error && <p className="text-xs text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCreate}
            disabled={isSaving || !label.trim() || !body.trim()}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {isSaving ? "Dodawanie…" : "Dodaj"}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              setError(null);
            }}
            className="text-xs text-gray-500 hover:underline"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}

export function SmsTemplatesPanel({ initialTemplates }: { initialTemplates: SmsTemplateDto[] }) {
  const [templates, setTemplates] = useState(initialTemplates);

  function handleSaved(updated: SmsTemplateDto) {
    setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  function handleDeleted(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  function handleCreated(created: SmsTemplateDto) {
    setTemplates((prev) => [...prev, created]);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Szablony SMS</h2>
      <p className="mb-4 text-sm text-gray-500">
        Szablony przypomnień (wbudowane) oraz dowolne własne szablony dostępne przy ręcznej wysyłce SMS. Dostępne
        znaczniki: <code className="rounded bg-gray-100 px-1 py-0.5">{"{klient}"}</code>{" "}
        <code className="rounded bg-gray-100 px-1 py-0.5">{"{urzadzenie}"}</code>{" "}
        <code className="rounded bg-gray-100 px-1 py-0.5">{"{data_start}"}</code>{" "}
        <code className="rounded bg-gray-100 px-1 py-0.5">{"{data_koniec}"}</code>{" "}
        <code className="rounded bg-gray-100 px-1 py-0.5">{"{telefon_obslugi}"}</code>
      </p>
      <div className="flex flex-col gap-3">
        {templates.map((t) => (
          <TemplateRow key={t.id} template={t} onSaved={handleSaved} onDeleted={handleDeleted} />
        ))}
        <NewTemplateForm onCreated={handleCreated} />
      </div>
    </div>
  );
}
