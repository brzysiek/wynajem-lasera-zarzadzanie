"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const res = await fetch("/wynajem/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => null);

    setIsSubmitting(false);
    setMessage(data?.message || "Jeśli podany adres istnieje w naszym systemie, wysłaliśmy na niego link do resetu hasła.");
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Reset hasła</h1>
          <p className="mt-1 text-sm text-gray-500">
            Podaj adres e-mail powiązany z kontem, a wyślemy na niego link do ustawienia nowego hasła.
          </p>
        </div>

        {!message && (
          <>
            <div className="space-y-1">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {isSubmitting ? "Wysyłanie…" : "Wyślij link do resetu"}
            </button>
          </>
        )}

        {message && <p className="text-sm text-gray-700">{message}</p>}

        <p className="text-center text-sm">
          <Link href="/login" className="text-gray-500 hover:text-gray-700">
            Wróć do logowania
          </Link>
        </p>
      </form>
    </div>
  );
}
