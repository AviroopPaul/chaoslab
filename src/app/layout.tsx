import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ChaosLab — System Design Visualizer",
  description:
    "Build a backend architecture on a whiteboard canvas, crank users from 10 to 100M+, and watch the system hold up or melt down in real time.",
};

/**
 * Runs synchronously while the browser parses <head> — before first paint —
 * so `data-theme` is correct by the time anything renders (SPEC.md
 * "no-flash init"). Priority: persisted choice -> OS preference -> dark.
 * Wrapped in try/catch since `localStorage`/`matchMedia` can throw (private
 * browsing, disabled storage, etc.); any failure just falls back to dark,
 * matching the static `data-theme="dark"` already on `<html>`.
 */
const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("chaoslab.theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
