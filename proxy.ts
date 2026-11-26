import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let session: { user?: unknown } | null = null;
  try {
    const res = await fetch(`${request.nextUrl.origin}/api/auth/get-session`, {
      headers: {
        cookie: request.headers.get("cookie") || "",
      },
      cache: "no-store",
    });
    if (res.ok) {
      session = await res.json();
    }
  } catch {
    session = null;
  }

  const isAuthRoute = pathname === "/sign-in" || pathname === "/sign-up";
  const isProtectedRoute =
    pathname.startsWith("/dashboard") || pathname.startsWith("/payment");

  if (session?.user && isAuthRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!session?.user && isProtectedRoute) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/payment",
    "/payment/:path*",
    "/sign-in",
    "/sign-up",
  ],
};
