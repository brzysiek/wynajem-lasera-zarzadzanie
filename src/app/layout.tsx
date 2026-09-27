import type { Metadata, Viewport } from "next";
import "./fonts/fonts.css";
import "./globals.css";
import { Providers } from "./providers";
import { AppFooter } from "@/components/app-footer";
import { BASE_PATH } from "@/lib/base-path";

// Czcionki (Jost — krój CAŁEJ aplikacji, spójny z wynajemlasera.pl; Geist /
// Geist Mono) ładowane z plików w repozytorium: src/app/fonts/fonts.css.
// Wcześniej next/font/google pobierał je z Google przy każdym buildzie i
// wdrożenie padało, gdy Google Fonts zwróciło nietypową odpowiedź.

export const metadata: Metadata = {
  title: "WynajemLasera.pl — Panel",
  description: "Zarządzanie wynajmem urządzeń — WynajemLasera.pl",
  // BASE_PATH is baked in per build (server 1 = /wynajem, server 2 = "");
  // the manifest itself uses relative URLs so it works under either prefix.
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  icons: {
    apple: `${BASE_PATH}/icons/apple-touch-icon.png`,
  },
  // Launch standalone (no Safari chrome) from the iOS Home Screen.
  appleWebApp: {
    capable: true,
    title: "WynajemLasera",
    statusBarStyle: "default",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#111827",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <html lang="pl" className="h-full antialiased">
      <body className={`min-h-full flex flex-col text-gray-900 ${isDev ? "bg-amber-50" : "bg-[#F2F4F6]"}`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Providers>{children}</Providers>
        </div>
        <AppFooter />
      </body>
    </html>
  );
}
