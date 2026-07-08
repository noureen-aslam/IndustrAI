import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#0a0a0f",
        surface: "#12121a",
        elevated: "#1a1a26",
        "accent-orange": "#f97316",
        "accent-blue": "#3b82f6",
        "text-primary": "#f1f5f9",
        "text-secondary": "#94a3b8",
        border: "#2a2a3a",
        success: "#22c55e",
        warning: "#eab308",
        danger: "#ef4444",
      },
      borderRadius: {
        xl: "0.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
