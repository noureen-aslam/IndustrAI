import Link from "next/link";
import {
  LucideProps,
  MessageSquare,
  Activity,
  Upload,
  AlertTriangle,
  Clock3,
  FileText,
  ShieldCheck,
} from "lucide-react";
import React from "react";

const navItems = [
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Graph", href: "/graph", icon: Activity },
  { label: "Admin", href: "/admin", icon: Upload },
  { label: "Contradictions", href: "/contradictions", icon: AlertTriangle },
];

const recentChats = [
  { label: "Safety checklist review", href: "/chat?session=safety", icon: Clock3 },
  { label: "Valve maintenance summary", href: "/chat?session=valve", icon: FileText },
  { label: "Compliance guidance", href: "/chat?session=compliance", icon: ShieldCheck },
];

interface NavItemProps {
  href: string;
  label: string;
  Icon: React.ComponentType<LucideProps>;
}

function NavItem({ href, label, Icon }: NavItemProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-3xl px-4 py-3 text-sm font-semibold text-text-primary transition hover:bg-slate-900/80"
    >
      <Icon className="h-5 w-5 text-accent-blue" />
      {label}
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col gap-6 border-r border-slate-800 bg-bg-surface p-6 lg:flex">
      <div className="rounded-[28px] border border-slate-800 bg-slate-950/70 p-5 shadow-sm shadow-slate-950/40">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-text-secondary">IndustrAI</p>
            <h2 className="mt-2 text-xl font-semibold text-text-primary">Industrial intelligence</h2>
          </div>
          <ShieldCheck className="h-6 w-6 text-accent-blue" />
        </div>
        <p className="mt-4 text-sm leading-6 text-text-secondary">
          Search sources, inspect results, and keep your compliance knowledge within reach.
        </p>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => (
          <NavItem key={item.href} href={item.href} label={item.label} Icon={item.icon} />
        ))}
      </nav>

      <div className="rounded-[28px] border border-slate-800 bg-slate-950/70 p-5 shadow-sm shadow-slate-950/40">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-text-primary">Recent chats</p>
          <span className="rounded-full bg-slate-800/80 px-2 py-1 text-[11px] uppercase tracking-[0.24em] text-text-secondary">
            Live
          </span>
        </div>
        <div className="space-y-3">
          {recentChats.map((chat) => (
            <Link
              key={chat.href}
              href={chat.href}
              className="flex items-center gap-3 rounded-3xl border border-slate-800 bg-bg-surface/80 px-4 py-3 text-sm transition hover:border-slate-700 hover:bg-slate-900"
            >
              <chat.icon className="h-4 w-4 text-accent-blue" />
              <span className="text-text-secondary">{chat.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-auto rounded-[28px] border border-slate-800 bg-slate-950/70 p-5 text-sm text-text-secondary shadow-sm shadow-slate-950/40">
        <p className="font-semibold text-text-primary">Need a quick start?</p>
        <p className="mt-3 leading-6">
          Use the sidebar to move between chat, graph, admin, and contradiction workflows without losing context.
        </p>
      </div>
    </aside>
  );
}
