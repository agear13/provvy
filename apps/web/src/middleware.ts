import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware({
  publicRoutes: ["/", "/sign-in(.*)", "/sign-up(.*)", "/health", "/favicon.ico"],
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
