import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Dashboard() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();

  let orgName: string | null = null;
  if (orgId) {
    try {
      const cc = await clerkClient(); // 👈 v6: call it to get the client instance
      const org = await cc.organizations.getOrganization({ organizationId: orgId });
      orgName = org.name ?? null;
    } catch {
      orgName = null;
    }
  }

  return (
    <main className="p-6">
      <header className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-4">
          <OrganizationSwitcher />
          <div className="text-sm text-neutral-600">
            {orgName ? `Org: ${orgName}` : "No org selected"}
          </div>
        </div>
        <UserButton />
      </header>

      <section className="mt-6">
        <h2 className="text-xl font-semibold">
          Welcome, {user?.firstName ?? "there"}!
        </h2>
        <p className="text-neutral-600 mt-2">
          This is your dashboard. Next up: Settings & Payment Links.
        </p>
      </section>


      <div className="mt-4">
        <Link href="/settings" className="underline">
          Go to Settings
        </Link>
      </div>
    </main>
  );
}
