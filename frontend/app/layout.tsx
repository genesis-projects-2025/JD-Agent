// frontend/app/layout.tsx

import "./globals.css";
import { AuthProvider } from "@/components/providers/auth-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { Suspense } from "react";
import { Inter } from "next/font/google";

const inter = Inter({
 subsets: ["latin"],
 variable: "--font-inter",
 display: "swap",
});

export const metadata = {
 title: "Pulse Pharma — JD Intelligence",
 description:
 "Enterprise job description management and approval system for Pulse Pharma.",
 icons: {
 icon: "https://company-logo-wtn.s3.ap-southeast-2.amazonaws.com/logo.png",
 apple: "https://company-logo-wtn.s3.ap-southeast-2.amazonaws.com/logo.png",
 },
};

export default function RootLayout({
 children,
}: {
 children: React.ReactNode;
}) {
 return (
  <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
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
