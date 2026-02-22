import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      colors: {
        // Luminous Void Core Palette
        void: {
          DEFAULT: "#09090b",
          deepest: "#09090b",
          black: "#0a0a0a",
          panel: "#18181b",
          surface: "#27272a",
          elevated: "#3f3f46",
        },
        // Text Colors
        primary: "#fafafa",
        secondary: "#d4d4d8",
        tertiary: "#a1a1aa",
        quaternary: "#71717a",
        disabled: "#52525b",
        ghost: "#3f3f46",
        // DNA Bases (Soft Pastels)
        base: {
          a: "#86efac",  // adenine - emerald
          t: "#fda4af",  // thymine - rose
          c: "#7dd3fc",  // cytosine - sky
          g: "#fcd34d",  // guanine - amber
        },
        // Semantic Colors
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#3b82f6",
      },
      borderColor: {
        razor: "rgba(255, 255, 255, 0.05)",
        subtle: "rgba(255, 255, 255, 0.08)",
        medium: "rgba(255, 255, 255, 0.12)",
        strong: "rgba(255, 255, 255, 0.2)",
      },
      backgroundColor: {
        "hover-bg": "rgba(255, 255, 255, 0.03)",
        "active-bg": "rgba(255, 255, 255, 0.06)",
      },
      ringColor: {
        focus: "rgba(255, 255, 255, 0.4)",
      },
      animation: {
        'breathe': 'breathe 1.5s ease-in-out infinite',
        'rotate-gradient': 'rotate-gradient 4s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'fade-in-up': 'fadeInUp 0.4s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        'rotate-gradient': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          from: { transform: 'translateX(20px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(6, 182, 212, 0.8), 0 0 40px rgba(6, 182, 212, 0.4)',
        'glow-emerald': '0 0 20px rgba(16, 185, 129, 0.8), 0 0 40px rgba(16, 185, 129, 0.4)',
        'glow-rose': '0 0 20px rgba(244, 63, 94, 0.8), 0 0 40px rgba(244, 63, 94, 0.4)',
        'glow-amber': '0 0 20px rgba(245, 158, 11, 0.8), 0 0 40px rgba(245, 158, 11, 0.4)',
      },
      dropShadow: {
        'glow-cyan': '0 0 8px rgba(6, 182, 212, 0.8)',
        'glow-emerald': '0 0 8px rgba(16, 185, 129, 0.8)',
        'glow-rose': '0 0 8px rgba(244, 63, 94, 0.8)',
        'glow-amber': '0 0 8px rgba(245, 158, 11, 0.8)',
      },
    },
  },
  plugins: [],
};

export default config;