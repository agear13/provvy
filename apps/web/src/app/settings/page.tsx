// apps/web/src/app/settings/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import SettingsForm from "./settings-form";

export default async function SettingsPage() {
  const { userId, orgId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  if (!orgId) {
    // You can get fancier later; for now just tell user to pick an org
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Merchant Settings</h1>
        <p className="mt-2 text-neutral-600">
          Please select an organization in the header before configuring settings.
        </p>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Merchant Settings</h1>
      <SettingsForm orgId={orgId} clerkUserId={userId} />
    </main>
  );
}
