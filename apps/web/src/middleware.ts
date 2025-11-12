// apps/web/src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Only protect these routes:
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/settings(.*)",
  "/api/(.*)", // protect your app's API routes if you want
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    (await auth()).protect(); // requires signed-in user, otherwise redirects to sign-in
  }
});

// Next.js matcher—let middleware run for app routes but skip _next/static, files, etc.
export const config = {
  matcher: [
    "/((?!.+\\.[\\w]+$|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
