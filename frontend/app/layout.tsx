import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "IndustrAI",
  description: "Industrial document intelligence platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-primary text-text-primary`}>        
        <div className="min-h-screen bg-primary">
          <div className="lg:flex lg:min-h-screen">
            <Sidebar />
            <div className="flex-1 px-4 py-6 lg:px-8">{children}</div>
          </div>
          <nav className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-bg-surface/95 p-3 backdrop-blur-xl lg:hidden">
            <div className="flex items-center justify-around text-text-secondary">
              <a href="/chat" className="text-sm font-semibold text-text-primary">Chat</a>
              <a href="/graph" className="text-sm font-semibold text-text-primary">Graph</a>
              <a href="/admin" className="text-sm font-semibold text-text-primary">Admin</a>
              <a href="/contradictions" className="text-sm font-semibold text-text-primary">Contradictions</a>
            </div>
          </nav>
        </div>
      </body>
    </html>
  );
}
