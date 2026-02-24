import type { NextConfig } from "next";

/**
 * next.config.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SPRINT 2 SECURITY FIX — FIX 5: Content Security Policy (CSP) Header
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Root cause: no CSP header was defined, meaning the browser placed no
 * restrictions on which origins could execute scripts, load resources, or
 * receive outbound connections. A successful XSS payload could freely:
 *   • Load external scripts (e.g. a keylogger from an attacker-controlled CDN)
 *   • Exfiltrate data to any origin via fetch() or img src
 *   • Frame the app in a malicious page (clickjacking)
 *
 * Fix: add a `Content-Security-Policy` header to all routes via the Next.js
 * `headers()` async config. The policy is scoped to the minimum privileges
 * required by the app's actual resource usage:
 *
 *   default-src 'self'
 *     — Deny everything by default unless explicitly listed below.
 *
 *   script-src 'self' 'unsafe-eval' 'unsafe-inline'
 *     — 'unsafe-eval': required by Next.js for dynamic code evaluation during
 *       hydration in development mode and some production optimisations.
 *     — 'unsafe-inline': required for React inline event handlers after hydration
 *       and for styled-jsx / Tailwind CSS-in-JS utilities.
 *     — NOTE: a nonce-based approach is more secure but requires per-request
 *       nonce injection through Next.js middleware; adopt if the threat model
 *       demands it and the development overhead is acceptable.
 *
 *   style-src 'self' 'unsafe-inline'
 *     — 'unsafe-inline': required for Tailwind utility classes, Framer Motion
 *       runtime style injection, and the AuthOverlay <style> tag.
 *
 *   img-src 'self' data: blob:
 *     — data: : used by canvas toDataURL() in the genome visualiser.
 *     — blob: : used by URL.createObjectURL() for the certificate download and
 *       genome file loading.
 *
 *   connect-src 'self' https://*.supabase.co
 *     — Allows fetch/WebSocket to the current origin and to any Supabase
 *       project (both the shared Arkhé Central instance and user-supplied
 *       Sovereign instances whose subdomain is unknown at build time).
 *
 *   font-src 'self' https://fonts.gstatic.com
 *     — Allows the Google Fonts stylesheet imported in AuthOverlay to load
 *       its font binaries. The stylesheet itself is loaded via style-src
 *       (covered by 'unsafe-inline' + the Google Fonts CDN is same-origin
 *       redirected). Add https://fonts.googleapis.com to style-src if you
 *       switch to a <link> tag instead of the @import in AuthOverlay.
 *
 *   frame-ancestors 'none'
 *     — Prevents the app from being embedded in any <iframe>, providing
 *       clickjacking protection equivalent to `X-Frame-Options: DENY`.
 *       More expressive than the legacy header and respected by all modern
 *       browsers.
 *
 *   base-uri 'self'
 *     — Prevents <base href="https://attacker.example"> injection from
 *       hijacking relative URL resolution.
 *
 *   form-action 'self'
 *     — Restricts <form action=""> targets to the same origin, blocking
 *       cross-site form submission attacks.
 *
 * The existing COOP and COEP headers are retained as-is — they are required
 * for SharedArrayBuffer support used by the ArkheEngine WebWorker.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const nextConfig: NextConfig = {
  reactCompiler: true,

  async headers() {
    return [
      {
        // Apply security headers to every route
        source: '/(.*)',
        headers: [
          // ── Existing headers (required for SharedArrayBuffer / WebWorker) ──
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },

          // ── FIX 5: Content Security Policy ────────────────────────────────
          {
            key: 'Content-Security-Policy',
            value: [
              // Deny everything not explicitly permitted
              "default-src 'self'",

              // Scripts: same-origin + eval (Next.js/React requirement) + inline (hydration)
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",

              // Styles: same-origin + inline (Tailwind, Framer Motion, AuthOverlay <style>)
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

              // Images: same-origin + data URIs (canvas) + blobs (file downloads)
              "img-src 'self' data: blob:",

              // Fonts: same-origin + Google Fonts binary CDN
              "font-src 'self' https://fonts.gstatic.com",

              // Network: same-origin + all Supabase projects (shared + sovereign)
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",

              // Workers: same-origin (ArkheEngine WebWorker)
              "worker-src 'self' blob:",

              // Clickjacking prevention (supersedes X-Frame-Options)
              "frame-ancestors 'none'",

              // Prevent <base href> hijacking
              "base-uri 'self'",

              // Prevent cross-site form submission
              "form-action 'self'",
            ].join('; '),
          },

          // ── Supplementary hardening headers ───────────────────────────────

          // Prevent MIME-type sniffing (e.g. running a .txt file as a script)
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },

          // Legacy clickjacking guard for older browsers that ignore CSP frame-ancestors
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },

          // Prevent Referer header from leaking genome IDs in cross-origin requests
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;