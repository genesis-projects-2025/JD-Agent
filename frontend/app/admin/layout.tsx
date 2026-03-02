"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, LogOut, FileText } from "lucide-react";
import { useEffect, useState } from "react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Protect routes
    const token = localStorage.getItem("admin_token");
    const role = localStorage.getItem("user_role");

    if (!token || role !== "ADMIN") {
      router.push("/admin/login");
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("user_role");
    router.push("/admin/login");
  };

  if (!mounted) return null; // Prevent hydration errors

  const navItems = [
    { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "Role Models (JDs)", href: "/admin/jds", icon: FileText },
    { label: "Employees", href: "/admin/users", icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shadow-xl z-10">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-sm">
              🚀
            </div>
            Admin Hub
          </h2>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? "bg-blue-600/10 text-blue-400 font-semibold"
                    : "hover:bg-slate-800 hover:text-white"
                }`}
              >
                <item.icon
                  className={`w-5 h-5 ${isActive ? "text-blue-500" : ""}`}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-slate-400 hover:bg-slate-800 hover:text-red-400 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 z-0 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-800">
            {navItems.find((i) => pathname.startsWith(i.href))?.label ||
              "Admin Console"}
          </h1>
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full border border-slate-200">
              Role: Master Admin
            </div>
            <div className="w-9 h-9 bg-gradient-to-tr from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold shadow-sm border-2 border-white">
              M
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8 bg-slate-50/50">
          {children}
        </div>
      </main>
    </div>
  );
}
