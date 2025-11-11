import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function Home() {
  // If the user is logged in, send them straight to the dashboard
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  // Otherwise show a simple landing with Sign in / Sign up
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <div className="w-full max-w-xl p-10 bg-white dark:bg-black rounded-2xl border border-zinc-200/60 dark:border-white/10">
        <h1 className="text-3xl font-semibold text-black dark:text-zinc-50">
          Provvypay — Payment Links
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Sign in to access your dashboard.
        </p>

        <div className="mt-6 flex gap-4">
          <Link className="underline" href="/sign-in">Sign in</Link>
          <Link className="underline" href="/sign-up">Create account</Link>
        </div>
      </div>
    </main>
  );
}
