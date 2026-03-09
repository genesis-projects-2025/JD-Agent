// frontend/app/(dashboard)/layout.tsx
"use client";

import Sidebar from "@/components/layout/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full flex h-full">
      <Sidebar />
      <main className="flex-1 relative h-[100dvh] overflow-hidden bg-surface-50">
        {children}
      </main>
    </div>
  );
}
