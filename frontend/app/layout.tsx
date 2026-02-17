// frontend/app/layout.tsx

import "./globals.css";
import Sidebar from "@/components/layout/sidebar";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="flex h-full overflow-hidden">
        <Sidebar />
        <main className="flex-1 h-full overflow-hidden p-6">
          {children}
        </main>
      </body>
    </html>
  );
}