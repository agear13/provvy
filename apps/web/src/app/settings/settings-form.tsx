"use client";

import { useState, FormEvent } from "react";

type SettingsFormProps = {
  orgId: string;
  clerkUserId: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function SettingsForm({ orgId, clerkUserId }: SettingsFormProps) {
  const [displayName, setDisplayName] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
    } else {
      setLogoPreview(null);
    }
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      if (!orgId) {
        throw new Error("No organization selected");
      }

      let logoKey: string | null = null;

      // 1) If a logo file is selected, get a presigned URL from Next API and upload to S3
      if (logoFile) {
        const presignRes = await fetch("/api/uploads/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            contentType: logoFile.type || "image/png",
          }),
        });

        if (!presignRes.ok) {
          throw new Error("Failed to get upload URL from backend");
        }

        const { uploadUrl, key } = await presignRes.json();

        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": logoFile.type || "image/png",
          },
          body: logoFile,
        });

        if (!uploadRes.ok) {
          throw new Error("Upload to S3 failed");
        }

        logoKey = key;
      }

      // 2) Call Nest API to save merchant settings in Neon
      const apiRes = await fetch(
        `${API_BASE_URL}/orgs/${orgId}/settings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName,
            logoKey,
            defaultCurrency: currency,
            functionalCurrency: currency,
            updatedByUserId: clerkUserId,
          }),
        }
      );

      if (!apiRes.ok) {
        const text = await apiRes.text();
        throw new Error(`Settings API failed: ${apiRes.status} ${text}`);
      }

      setMessage("Settings saved successfully!");
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong while saving settings.";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <label className="block text-sm font-medium mb-1">
          Business display name
        </label>
        <input
          type="text"
          className="w-full rounded border px-3 py-2 text-sm"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Provvypay Cafe"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Default / functional currency
        </label>
        <select
          className="w-full rounded border px-3 py-2 text-sm"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          <option value="AUD">AUD — Australian Dollar</option>
          <option value="USD">USD — US Dollar</option>
          <option value="EUR">EUR — Euro</option>
          {/* add more later */}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Logo (optional)
        </label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          onChange={handleFileChange}
        />
        {logoPreview && (
          <img
            src={logoPreview}
            alt="Logo preview"
            className="mt-2 h-16 w-16 rounded object-cover border"
          />
        )}
      </div>

      <button
        type="submit"
        disabled={isSaving}
        className="rounded bg-black text-white px-4 py-2 text-sm disabled:opacity-60"
      >
        {isSaving ? "Saving..." : "Save settings"}
      </button>

      {message && <p className="text-sm text-green-600 mt-2">{message}</p>}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </form>
  );
}
