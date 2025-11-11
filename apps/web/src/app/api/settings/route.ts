import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  // require auth
  const { userId } = await auth();
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const form = await req.formData();
    const displayName = String(form.get("displayName") ?? "");
    const orgId = form.get("orgId") ? String(form.get("orgId")) : null;
    const logo = form.get("logo") as File | null;

    // TODO: v1 — save to NestJS via internal API call
    // TODO: v1 — use presigned S3 upload (see notes below)

    // For now just “mock save”
    const fakeId = crypto.randomUUID();

    // If you want to simulate S3, echo minimal file metadata:
    const logoMeta = logo
      ? { name: logo.name, size: logo.size, type: logo.type }
      : null;

    return NextResponse.json({
      ok: true,
      id: fakeId,
      orgId,
      displayName,
      logo: logoMeta,
      note: "Mock save only. Wire to NestJS DB & S3 next.",
    });
  } catch (err: any) {
    return new NextResponse(err?.message ?? "Bad Request", { status: 400 });
  }
}
