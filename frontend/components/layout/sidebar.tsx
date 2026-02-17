// components/layout/sidebar.tsx - IMPROVED VERSION

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  MessageSquare, 
  CheckCircle2, 
  FileText,
  Settings,
  HelpCircle
} from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();

  const links = [
    { 
      name: "Dashboard", 
      href: "/dashboard", 
      icon: LayoutDashboard,
      description: "Overview & stats"
    },
    { 
      name: "JD Interview", 
      href: "/questionnaire", 
      icon: MessageSquare,
      description: "Create new JD"
    },
    { 
      name: "Approvals", 
      href: "/approvals", 
      icon: CheckCircle2,
      description: "Review & approve"
    },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href);

  return (
    <aside className="w-72 h-screen bg-gradient-to-b from-neutral-900 via-neutral-900 to-neutral-800 text-white flex flex-col border-r border-neutral-800 shadow-2xl">
      {/* Logo Section */}
      <div className="p-6 border-b border-neutral-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-lg shadow-primary-900/50">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">JD Intelligence</h1>
            <p className="text-xs text-neutral-400">Pulse Pharma</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        {links.map((link) => {
          const Icon = link.icon;
          const active = isActive(link.href);
          
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`
                group relative flex items-center gap-3 px-4 py-3.5 rounded-xl 
                transition-all duration-200 ease-out
                ${active 
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' 
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
                }
              `}
            >
              {/* Active Indicator */}
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-r-full" />
              )}
              
              {/* Icon */}
              <Icon className={`w-5 h-5 transition-transform ${active ? 'scale-110' : 'group-hover:scale-105'}`} />
              
              {/* Text */}
              <div className="flex-1">
                <div className={`font-medium text-sm ${active ? 'text-white' : ''}`}>
                  {link.name}
                </div>
                <div className="text-xs opacity-60 mt-0.5">
                  {link.description}
                </div>
              </div>

              {/* Hover Effect */}
              {!active && (
                <div className="absolute inset-0 bg-gradient-to-r from-primary-600/0 to-primary-600/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer Section */}
      <div className="p-4 border-t border-neutral-800/50 space-y-2">
        <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800/50 transition-all text-sm">
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </button>
        <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800/50 transition-all text-sm">
          <HelpCircle className="w-4 h-4" />
          <span>Help & Support</span>
        </button>
      </div>
    </aside>
  );
}