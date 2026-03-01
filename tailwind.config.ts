import type { Config } from "tailwindcss";

/**
 * tailwind.config.ts
 * ──────────────────────────────────────────────────────────────
 * SOVEREIGN DESIGN SYSTEM — Arkhé Genesis v10.0
 *
 * Note: This project uses Tailwind CSS v4. The `@theme` block in
 * globals.css is the primary source of truth for design tokens.
 * This config provides the content scan paths and extends the v4
 * theme for any utility-generation that still routes through the
 * config (e.g. boxShadow, animation).
 *
 * Color palette: "Abyssal" — deep navy-black (#020617, #0F172A)
 * with a single cold arctic-teal accent (#38BDF8).
 * ──────────────────────────────────────────────────────────────
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // ── Typography ─────────────────────────────────────────
      fontFamily: {
        sans:  ["var(--font-inter)", "system-ui", "-apple-system", "sans-serif"],
        mono:  ["var(--font-jetbrains-mono)", "JetBrains Mono", "Geist Mono", "SF Mono", "monospace"],
        geist: ["var(--font-inter)", "system-ui", "sans-serif"], // alias
      },

      // ── Abyssal Color Palette ───────────────────────────────
      colors: {
        // Core background ramp — navy-blacks with blue undertone
        abyss: {
          DEFAULT: "#020617",   // deepest possible — slate-950
          void:    "#0F172A",   // primary background — slate-900
          panel:   "#0D1B2E",   // panel surfaces
          surface: "#1E293B",   // elevated surfaces — slate-800
          raised:  "#334155",   // raised elements — slate-700
          border:  "#475569",   // strong border — slate-600
        },

        // Single sovereign accent — cold arctic teal
        accent: {
          DEFAULT: "#38BDF8",   // sky-400 — primary accent
          dim:     "#0EA5E9",   // sky-500 — pressed/hover state
          ghost:   "rgba(56, 189, 248, 0.08)",
          glow:    "rgba(56, 189, 248, 0.25)",
        },

        // Text hierarchy — careful luminance steps
        ink: {
          sovereign: "#F8FAFC",   // slate-50  — headings
          primary:   "#E2E8F0",   // slate-200 — body
          secondary: "#94A3B8",   // slate-400 — meta
          muted:     "#64748B",   // slate-500 — placeholder
          ghost:     "#334155",   // slate-700 — disabled
        },

        // DNA Base Colors — vivid, pop on dark ground
        base: {
          a: "#4ADE80",   // adenine  — green-400
          t: "#FB7185",   // thymine  — rose-400
          c: "#38BDF8",   // cytosine — sky-400
          g: "#FACC15",   // guanine  — yellow-400
        },

        // Semantic system
        success:  "#10B981",
        warning:  "#F59E0B",
        error:    "#EF4444",
        info:     "#38BDF8",
      },

      // ── Border Tokens ───────────────────────────────────────
      borderColor: {
        razor:  "rgba(255, 255, 255, 0.04)",
        subtle: "rgba(255, 255, 255, 0.07)",
        medium: "rgba(255, 255, 255, 0.12)",
        strong: "rgba(255, 255, 255, 0.20)",
        accent: "rgba(56, 189, 248, 0.35)",
      },

      // ── Background Tokens ───────────────────────────────────
      backgroundColor: {
        "hover-bg":    "rgba(255, 255, 255, 0.03)",
        "active-bg":   "rgba(255, 255, 255, 0.06)",
        "glass":       "rgba(15, 23, 42, 0.70)",
        "glass-panel": "rgba(9, 15, 28, 0.90)",
        "accent-ghost":"rgba(56, 189, 248, 0.08)",
      },

      // ── Ring (focus) ─────────────────────────────────────────
      ringColor: {
        DEFAULT: "rgba(56, 189, 248, 0.50)",
        focus:   "rgba(56, 189, 248, 0.50)",
      },

      // ── Box Shadows ──────────────────────────────────────────
      boxShadow: {
        // Sovereign glow set — restrained, not neon-loud
        "glow-accent":  "0 0 16px rgba(56, 189, 248, 0.25), 0 0 32px rgba(56, 189, 248, 0.12)",
        "glow-emerald": "0 0 16px rgba(74, 222, 128, 0.25), 0 0 32px rgba(74, 222, 128, 0.12)",
        "glow-rose":    "0 0 16px rgba(251, 113, 133, 0.25), 0 0 32px rgba(251, 113, 133, 0.12)",
        "glow-amber":   "0 0 16px rgba(250, 204, 21, 0.25), 0 0 32px rgba(250, 204, 21, 0.12)",
        // Panel elevation
        "panel":  "0 1px 0 rgba(255,255,255,0.04), 0 4px 12px rgba(2,6,23,0.50)",
        "float":  "0 8px 32px rgba(2,6,23,0.60), 0 1px 0 rgba(255,255,255,0.06)",
        "modal":  "0 24px 64px rgba(2,6,23,0.80), 0 1px 0 rgba(255,255,255,0.08)",
        // Accent border breathe
        "accent-border": "0 0 0 1px rgba(56, 189, 248, 0.30), 0 0 12px rgba(56, 189, 248, 0.10)",
      },

      // ── Drop Shadows ─────────────────────────────────────────
      dropShadow: {
        "glow-accent":  "0 0 6px rgba(56, 189, 248, 0.70)",
        "glow-emerald": "0 0 6px rgba(74, 222, 128, 0.70)",
        "glow-rose":    "0 0 6px rgba(251, 113, 133, 0.70)",
        "glow-amber":   "0 0 6px rgba(250, 204, 21, 0.70)",
      },

      // ── Border Radius ────────────────────────────────────────
      borderRadius: {
        DEFAULT: "6px",
        sm:  "3px",
        md:  "6px",
        lg:  "10px",
        xl:  "14px",
        "2xl": "18px",
      },

      // ── Animations ───────────────────────────────────────────
      animation: {
        "fade-in":       "fade-in 0.30s cubic-bezier(0.4, 0, 0.2, 1)",
        "fade-in-right": "fade-in-right 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        "breathe":       "breathe 2.0s ease-in-out infinite",
        "pulse-sovereign":"pulse-sovereign 2.0s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "shimmer":       "shimmer 1.8s ease-in-out infinite",
        "spin":          "spin 1.0s linear infinite",
        "terminal-cursor":"terminal-cursor 1.1s step-end infinite",
        "accent-breathe-border": "accent-breathe-border 3s ease-in-out infinite",
      },

      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)"  },
          to:   { opacity: "1", transform: "translateY(0)"    },
        },
        "fade-in-right": {
          from: { opacity: "0", transform: "translateX(-8px)" },
          to:   { opacity: "1", transform: "translateX(0)"    },
        },
        breathe: {
          "0%, 100%": { opacity: "0.5" },
          "50%":      { opacity: "1"   },
        },
        "pulse-sovereign": {
          "0%, 100%": { opacity: "1"   },
          "50%":      { opacity: "0.4" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition:  "1000px 0" },
        },
        spin: {
          from: { transform: "rotate(0deg)"   },
          to:   { transform: "rotate(360deg)" },
        },
        "terminal-cursor": {
          "0%, 100%": { opacity: "1" },
          "49%":      { opacity: "1" },
          "50%":      { opacity: "0" },
        },
        "accent-breathe-border": {
          "0%, 100%": {
            boxShadow: "0 0 0 1px rgba(56, 189, 248, 0.20), 0 0 12px rgba(56, 189, 248, 0.08)",
          },
          "50%": {
            boxShadow: "0 0 0 1px rgba(56, 189, 248, 0.50), 0 0 24px rgba(56, 189, 248, 0.15)",
          },
        },
      },

      // ── Transitions ──────────────────────────────────────────
      transitionDuration: {
        snap:  "80",
        base:  "150",
        ease:  "250",
        slow:  "350",
      },
      transitionTimingFunction: {
        sovereign: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};

export default config;