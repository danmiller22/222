import { NextResponse } from "next/server";
import { syncConfiguredTrailerCatalogs } from "../../../lib/trailer-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const expected = (process.env.TRAILER_SYNC_SECRET || "").trim();
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    await syncConfiguredTrailerCatalogs();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[trailer-sync] error:", error);
    return NextResponse.json({ ok: false, error: "Trailer sync failed" }, { status: 500 });
  }
}
