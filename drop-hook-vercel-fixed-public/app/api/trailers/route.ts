import { NextResponse } from "next/server";
import { listTrailerOptions } from "../../lib/trailer-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").slice(0, 40);
  if (query.trim().length < 2) {
    return NextResponse.json({ ok: true, trailers: [] });
  }
  const trailers = await listTrailerOptions(query, 2);
  return NextResponse.json({ ok: true, trailers });
}
