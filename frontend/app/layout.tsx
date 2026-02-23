// frontend/app/layout.tsx

import "./globals.css";
import Sidebar from "@/components/layout/sidebar";
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
        <Sidebar />
        <main className="flex-1 h-full overflow-y-auto p-6">{children}</main>
      </body>
    </html>
  );
}
