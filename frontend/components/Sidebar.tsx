import Link from "next/link";
import { LucideProps, MessageSquare, Activity, Upload, AlertTriangle } from "lucide-react";

const navItems = [
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Graph", href: "/graph", icon: Activity },
  { label: "Admin", href: "/admin", icon: Upload },
  { label: "Contradictions", href: "/contradictions", icon: AlertTriangle },
];

interface NavItemProps {
  href: string;
  label: string;
  Icon: (props: LucideProps) => JSX.Element;
}

function NavItem({ href, label, Icon }: NavItemProps) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-text-primary transition hover:bg-slate-900">
      <Icon className="h-5 w-5 text-accent-blue" />
      {label}
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-slate-800 bg-bg-surface p-5 lg:flex">
      <div className="mb-10">
        <h1 className="text-xl font-semibold text-text-primary">IndustrAI</h1>
        <p className="mt-2 text-sm text-text-secondary">Industrial document intelligence platform.</p>
      </div>
      <nav className="space-y-2">
        {navItems.map((item) => (
          <NavItem key={item.href} href={item.href} label={item.label} Icon={item.icon} />
        ))}
      </nav>
    </aside>
  );
}
