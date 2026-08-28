import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { AppFooter } from "@/components/app-footer";
import { BASE_PATH } from "@/lib/base-path";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    <html lang="pl" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className={`min-h-full flex flex-col text-gray-900 ${isDev ? "bg-amber-50" : "bg-gray-50"}`}>
        <div className="flex min-h-0 flex-1 flex-col">
          <Providers>{children}</Providers>
        </div>
        <AppFooter />
      </body>
    </html>
  );
}
