/**
 * src/middleware.ts
 * ============================================================================
 * ARKHÉ GENESIS – ROUTE PROTECTION MIDDLEWARE
 * ============================================================================
 *
 * Protects /workbench and /settings from unauthenticated access.
 * Uses @supabase/ssr to safely read the session from request cookies in the
 * Next.js edge runtime, where the browser-side supabase client is unavailable.
 *
 * Install the required package before deploying:
 *   npm install @supabase/ssr
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require an authenticated session.
const PROTECTED_ROUTES = ['/workbench', '/settings'];

// Routes that authenticated users should be bounced away from (avoids
// landing back on /login after a successful sign-in).
const AUTH_ROUTES = ['/login'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Quick short-circuit: skip middleware for static assets and API routes ──
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const isProtectedRoute = PROTECTED_ROUTES.some((route) =>
    pathname.startsWith(route)
  );
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));

  // If the route is neither protected nor an auth route, allow it through.
  if (!isProtectedRoute && !isAuthRoute) {
    return NextResponse.next();
  }

  // ── Build a response object that the SSR client can write cookies onto ─────
  // The @supabase/ssr middleware client refreshes the session token if it has
  // expired. We must pass the mutated response through so the updated cookies
  // are set on the browser.
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail open if env vars are missing (avoids infinite redirect loops during
  // local development before .env.local is configured).
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      '[middleware] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Route protection is disabled.'
    );
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Apply incoming cookie mutations to both the request and response.
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser() is the only session method that validates the JWT against the
  // Supabase Auth server rather than trusting the local cookie blindly.
  // This prevents forged cookies from bypassing the route guard.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const isAuthenticated = !error && user !== null;

  // ── Routing logic ──────────────────────────────────────────────────────────

  if (isProtectedRoute && !isAuthenticated) {
    // Unauthenticated user hitting a protected route → send to login.
    // Preserve the original destination so we can redirect back after sign-in.
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute && isAuthenticated) {
    // Already signed-in user hitting /login → bounce to workbench.
    return NextResponse.redirect(new URL('/workbench', request.url));
  }

  // Authenticated user on a protected route, or unauthenticated user on a
  // public route: allow through with the (potentially refreshed) response.
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};