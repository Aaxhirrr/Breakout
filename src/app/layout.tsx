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
  title: "Breakout",
  description: "Breakout: in-scene ad inserts for YouTube playback.",
};

import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { cn } from "@/lib/utils";
import { AuthGate } from "@/components/auth-gate";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          "antialiased bg-background text-foreground min-h-screen"
        )}
      >
        <AuthGate>
          <Header />
          <div className="flex pt-16 h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto p-4 md:p-6 md:ml-60">
              {children}
            </main>
          </div>
        </AuthGate>
      </body>
    </html>
  );
}
