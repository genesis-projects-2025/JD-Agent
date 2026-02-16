"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Sidebar() {
  const pathname = usePathname();

  const links = [
    { name: "Dashboard", href: "/dashboard" },
    { name: "JD Interview", href: "/questionnaire" },
    { name: "Approvals", href: "/approvals" },
  ];

  return (
    <aside className="w-64 h-screen bg-zinc-900 text-white p-6 flex flex-col gap-8">
      <div className="text-xl font-bold tracking-tight">JD Agent</div>
      <nav className="flex flex-col gap-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`px-4 py-2 rounded-lg transition-colors ${
              pathname === link.href
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
          >
            {link.name}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
