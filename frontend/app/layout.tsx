// frontend/app/layout.tsx

import "./globals.css";
import Sidebar from "@/components/layout/sidebar";
import { AuthProvider } from "@/components/providers/auth-provider";
import { Suspense } from "react";
import { Inter, Outfit } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} h-full`}>
      <body className="flex h-full overflow-hidden bg-white selection:bg-primary-100 selection:text-primary-900">
        <Suspense fallback={null}>
          <AuthProvider>
            <Sidebar />
            <main className="flex-1 relative h-[100dvh] overflow-hidden bg-surface-50">
              {children}
            </main>
          </AuthProvider>
        </Suspense>
      </body>
    </html>
  );
}
