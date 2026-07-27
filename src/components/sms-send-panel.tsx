"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ContactSummary = {
  id: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
};

type Template = { daysBefore: 1 | 3 | 7; label: string; body: string };

export function SmsSendPanel({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pickedContact, setPickedContact] = useState<ContactSummary | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phone, setPhone] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      return;
    }

    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const res = await fetch(
          `/wynajem/api/integrations/hubspot/contacts/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setSearchError(data?.message || "Wyszukiwanie kontaktów nie powiodło się.");
          setResults(null);
        } else {
          setResults(data?.contacts ?? []);
        }
      } catch {
        // Aborted by a newer keystroke — ignore.
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function pickContact(c: ContactSummary) {
    setPickedContact(c);
    setPhone(c.phone ?? "");
    setQuery("");
    setResults(null);
  }

  function clearContact() {
    setPickedContact(null);
    setPhone("");
  }

  function applyTemplate(key: string) {
    setTemplateKey(key);
    const template = templates.find((t) => String(t.daysBefore) === key);
    if (template) setMessage(template.body);
  }

  async function handleSend() {
    setIsSending(true);
    setSendError(null);
    setSendSuccess(false);
    try {
      const res = await fetch("/wynajem/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSendError(data?.message || "Nie udało się wysłać wiadomości.");
        return;
      }
      setSendSuccess(true);
      setMessage("");
      setTemplateKey("");
      clearContact();
      router.refresh();
    } finally {
      setIsSending(false);
    }
  }

  const canSend = phone.trim().length > 0 && message.trim().length > 0 && !isSending;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Wyślij SMS</h2>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-sm text-gray-700">
          Odbiorca
          {pickedContact ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="text-sm text-gray-800">
                <span className="font-medium">
                  {[pickedContact.firstname, pickedContact.lastname].filter(Boolean).join(" ") || "(bez nazwy)"}
                </span>
                {pickedContact.company && <span className="text-gray-500"> · {pickedContact.company}</span>}
              </span>
              <button
                type="button"
                onClick={clearContact}
                className="flex-none rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Odepnij
              </button>
            </div>
          ) : (
            <div>
              <input
                value={query}
                onChange={(e) => {
                  const value = e.target.value;
                  setQuery(value);
                  if (value.trim().length < 3) {
                    setResults(null);
                    setSearchError(null);
                  }
                }}
                placeholder="Szukaj kontaktu w HubSpot (min. 3 znaki)…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
              {isSearching && <p className="mt-1 text-xs text-gray-400">Szukanie…</p>}
              {searchError && <p className="mt-1 text-xs text-red-700">{searchError}</p>}
              {results && results.length === 0 && !isSearching && (
                <p className="mt-1 text-xs text-gray-400">Brak wyników.</p>
              )}
              {results && results.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200">
                  {results.map((c) => {
                    const name = [c.firstname, c.lastname].filter(Boolean).join(" ") || "(bez nazwy)";
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => pickContact(c)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          <span className="font-medium text-gray-900">{name}</span>
                          {c.company && <span className="text-gray-500"> · {c.company}</span>}
                          {c.phone && <span className="block text-xs text-gray-500">{c.phone}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Numer telefonu
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="np. 500 100 200"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Wstaw gotowy szablon (opcjonalnie)
          <select
            value={templateKey}
            onChange={(e) => applyTemplate(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          >
            <option value="">— wpisz treść ręcznie —</option>
            {templates.map((t) => (
              <option key={t.daysBefore} value={t.daysBefore}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Treść wiadomości
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
          />
        </label>

        {sendError && <p className="text-sm text-red-700">{sendError}</p>}
        {sendSuccess && <p className="text-sm text-green-700">Wysłano.</p>}

        <div>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {isSending ? "Wysyłanie…" : "Wyślij SMS"}
          </button>
        </div>
      </div>
    </div>
  );
}
