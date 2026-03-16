// frontend/app/layout.tsx

import "./globals.css";
import { AuthProvider } from "@/components/providers/auth-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ErrorBoundary } from "@/components/error-boundary";
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

export const metadata = {
  title: "JD Intelligence — Pulse Pharma",
  description:
    "Enterprise job description management and approval system for Pulse Pharma.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} h-full`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="w-full h-full overflow-hidden bg-white selection:bg-primary-100 selection:text-primary-900 flex">
        <ErrorBoundary>
          <Suspense fallback={null}>
            {/* QueryProvider must wrap AuthProvider so auth hooks can use React Query too */}
            <QueryProvider>
              <AuthProvider>{children}</AuthProvider>
            </QueryProvider>
          </Suspense>
        </ErrorBoundary>
      </body>
    </html>
  );
}
