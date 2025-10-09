// app/api/submit/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ====== ENV ======
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const YARD_CENTER = {
  lat: Number(process.env.YARD_LAT || 41.4299),
  lng: Number(process.env.YARD_LNG || -88.2284),
};
const YARD_RADIUS_M = Number(process.env.YARD_RADIUS_M || 500);
const OVERRIDE_PIN = process.env.DISPATCH_OVERRIDE_PIN || "";

// ====== LIMITS ======
const MIN_PHOTOS = 8;
const MAX_PHOTOS = 20;
const TARGET_MAX_BYTES = 800_000; // ~0.8MB
const TARGET_MAX_WIDTH = 1400;
const TG_ALBUM_LIMIT = 10;
const MAX_CHUNK_TOTAL = 7_500_000;
const GROUP_PAUSE_MS_MIN = 1000;
const GROUP_PAUSE_MS_MAX = 1600;
const MAX_TG_RETRIES = 8;

// ====== utils ======
function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function inYard(coords?: { lat: number; lng: number }) {
  if (!coords) return false;
  return meters(coords, YARD_CENTER) <= YARD_RADIUS_M;
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function rand(min: number, max: number) { return Math.floor(min + Math.random() * (max - min + 1)); }
function escapeHtml(s: string) { return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }

// ВАЖНО: типобезопасное получение ArrayBuffer из Buffer (учитывая byteOffset/length)
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  // TS ожидает именно ArrayBuffer (не ArrayBufferLike) → slice гарантирует тип
  return ab as ArrayBuffer;
}

// ====== optional sharp (НЕ ломает билд, если не установлен) ======
let sharpAvailable = false;
let sharp: any = null;
try {
  // eslint-disable-next-line no-eval
  const req: any = (globalThis as any).require || eval("require");
  sharp = req?.("sharp");
  sharpAvailable = !!sharp;
} catch {
  sharpAvailable = false;
}

// Суперагрессивная компрессия JPEG (progressive+mozjpeg), до 8 итераций
async function recompressIfNeeded(buf: Buffer, mime: string): Promise<{ data: Buffer; type: string }> {
  if (!sharpAvailable) return { data: buf, type: mime || "image/jpeg" };
  try {
    let quality = 68;
    let out = await sharp(buf).rotate().resize({ width: TARGET_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality, progressive: true, mozjpeg: true }).toBuffer();
    for (let i = 0; i < 8 && out.length > TARGET_MAX_BYTES; i++) {
      quality = Math.max(35, Math.floor(quality * 0.82));
      out = await sharp(buf).rotate().resize({ width: TARGET_MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality, progressive: true, mozjpeg: true }).toBuffer();
    }
    return { data: out, type: "image/jpeg" };
  } catch {
    return { data: buf, type: mime || "image/jpeg" };
  }
}

async function tgFetch(method: string, body: FormData | URLSearchParams, attempt = 0): Promise<any> {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/${method}`;
  const res = await fetch(url, { method: "POST", body });

  if (res.ok) return res.json();

  let j: any = null;
  try { j = await res.json(); } catch {}

  if (res.status === 429 && j?.parameters?.retry_after) {
    const waitSec = Math.max(1, Number(j.parameters.retry_after));
    await sleep(waitSec * 1000 + rand(200, 700));
    if (attempt < MAX_TG_RETRIES) return tgFetch(method, body, attempt + 1);
  }

  if (attempt < MAX_TG_RETRIES && (res.status === 400 || res.status === 500 || res.status === 502 || res.status === 503)) {
    await sleep(rand(600, 1400) + attempt * 150);
    return tgFetch(method, body, attempt + 1);
  }

  const text = j ? JSON.stringify(j) : await res.text().catch(() => "");
  throw new Error(`TG ${method} ${res.status}: ${text || "error"}`);
}

async function sendText(text: string) {
  const body = new URLSearchParams();
  body.set("chat_id", TG_CHAT_ID);
  body.set("text", text);
  body.set("parse_mode", "HTML");
  return tgFetch("sendMessage", body);
}

type InputPhoto = { name: string; type: string; data: Buffer };

function chunkPhotosFixed(photos: InputPhoto[], maxCount: number, maxBytes: number): InputPhoto[][] {
  const chunks: InputPhoto[][] = [];
  let group: InputPhoto[] = [];
  let total = 0;
  for (const p of photos) {
    const size = p.data.length;
    if (group.length >= maxCount || total + size > maxBytes) {
      if (group.length) chunks.push(group);
      group = [];
      total = 0;
    }
    group.push(p);
    total += size;
  }
  if (group.length) chunks.push(group);
  return chunks;
}

async function sendMediaGroupAdaptive(photos: InputPhoto[], caption?: string) {
  let groupLimit = TG_ALBUM_LIMIT;
  let sizeLimit = MAX_CHUNK_TOTAL;
  let index = 0;

  while (index < photos.length) {
    const rest = photos.slice(index);
    const groups = chunkPhotosFixed(rest, groupLimit, sizeLimit);
    if (!groups.length) throw new Error("internal chunking error");

    const group = groups[0];
    const fd = new FormData();
    const media = group.map((p, i) => {
      const attachName = `photo_${i}`;
      // Кладём именно ArrayBuffer — это валидный BlobPart для TS и рантайма
      const blob = new Blob([toArrayBuffer(p.data)], { type: p.type || "image/jpeg" });
      fd.append(attachName, blob, p.name || `p${i}.jpg`);
      return {
        type: "photo",
        media: `attach://${attachName}`,
        caption: i === 0 && caption ? caption : undefined,
        parse_mode: "HTML" as const,
      };
    });
    fd.set("chat_id", TG_CHAT_ID);
    fd.set("media", JSON.stringify(media));

    try {
      await tgFetch("sendMediaGroup", fd);
      index += group.length;
      if (index < photos.length) await sleep(rand(GROUP_PAUSE_MS_MIN, GROUP_PAUSE_MS_MAX));
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (/429|Too Many Requests|retry_after|Too Many|flood/i.test(msg) || /Bad Request/i.test(msg)) {
        if (groupLimit > 5) groupLimit = Math.max(5, groupLimit - 2);
        else if (sizeLimit > 5_000_000) sizeLimit = Math.max(5_000_000, sizeLimit - 1_000_000);
        else await sleep(rand(1500, 2500));
        continue; // повтор без увеличения index
      }
      throw e;
    }
  }
}

// ====== Типы входа ======
type InitPayload = {
  phase: "init";
  sessionId: string;
  truck: string;
  driver: string;
  direction: "drop" | "hook";
  coords?: { lat: number; lng: number };
  notes?: string;
};
type PhotosPayload = {
  phase: "photos";
  sessionId: string;
  coords?: { lat: number; lng: number };
};

// ====== Handler ======
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let phase: "init" | "photos";

    if (contentType.includes("multipart/form-data")) {
      // ---- photos (multipart) ----
      const form = await req.formData();
      phase = String(form.get("phase") || "photos") as "photos";
      if (phase !== "photos") {
        return NextResponse.json({ ok: false, error: "Multipart поддерживает только phase=photos" }, { status: 400 });
      }
      const sessionId = String(form.get("sessionId") || "");
      if (!sessionId) return NextResponse.json({ ok: false, error: "sessionId required" }, { status: 400 });

      const lat = form.get("lat");
      const lng = form.get("lng");
      const coords = lat && lng ? { lat: Number(lat), lng: Number(lng) } : undefined;

      const files = form.getAll("photos");
      const photos: InputPhoto[] = [];
      for (const f of files) {
        if (f instanceof File) {
          const raw = Buffer.from(await f.arrayBuffer());
          if (!/^image\//.test(f.type || "image/jpeg")) continue;
          if (raw.length === 0) continue;

          const { data, type } = await recompressIfNeeded(raw, f.type || "image/jpeg");
          photos.push({ name: f.name || "photo.jpg", type, data });
        }
      }

      if (photos.length < MIN_PHOTOS || photos.length > MAX_PHOTOS) {
        return NextResponse.json({ ok: false, error: `Нужно ${MIN_PHOTOS}–${MAX_PHOTOS} фото` }, { status: 400 });
      }

      const yardOk = inYard(coords);
      const metaBadge = yardOk ? "✅ Внутри ярда" : "⛔️ ВНЕ ярда";

      await sendMediaGroupAdaptive(photos, `<b>ФОТО (${photos.length})</b>\nСессия: <code>${sessionId}</code>\n${metaBadge}`);

      return NextResponse.json({ ok: true, yardOk });
    } else {
      // ---- JSON ----
      const body = (await req.json().catch(() => ({}))) as Partial<
        InitPayload &
          PhotosPayload & {
            photosBase64?: string[];
            overridePin?: string;
          }
      >;

      if (!body || !body.phase) {
        return NextResponse.json({ ok: false, error: "phase required" }, { status: 400 });
      }
      phase = body.phase;

      if (phase === "init") {
        const p = body as InitPayload & { overridePin?: string };
        if (!p.sessionId || !p.truck || !p.driver || !p.direction) {
          return NextResponse.json({ ok: false, error: "sessionId, truck, driver, direction обязательны" }, { status: 400 });
        }
        if (!p.coords) {
          return NextResponse.json({ ok: false, error: "Требуется геолокация" }, { status: 400 });
        }
        const yardOk = inYard(p.coords);
        if (!yardOk && OVERRIDE_PIN) {
          const pin = (p as any).overridePin || req.headers.get("x-override-pin") || "";
          if (pin !== OVERRIDE_PIN) {
            return NextResponse.json({ ok: false, error: "Вне ярда. Нужен override PIN." }, { status: 403 });
          }
        }

        const txt =
          `<b>INIT</b>\n` +
          `Сессия: <code>${p.sessionId}</code>\n` +
          `Truck: <code>${p.truck}</code>\n` +
          `Driver: <code>${p.driver}</code>\n` +
          `Type: <code>${p.direction.toUpperCase()}</code>\n` +
          `Coords: <code>${p.coords.lat.toFixed(6)}, ${p.coords.lng.toFixed(6)}</code>\n` +
          `${inYard(p.coords) ? "✅ Внутри ярда" : "⛔️ ВНЕ ярда"}` +
          (p.notes ? `\nNotes: ${escapeHtml(p.notes).slice(0, 500)}` : "");

        await sendText(txt);
        return NextResponse.json({ ok: true, yardOk });
      }

      if (phase === "photos") {
        const base64 = (body as any).photosBase64 as string[] | undefined;
        if (!base64 || base64.length < MIN_PHOTOS || base64.length > MAX_PHOTOS) {
          return NextResponse.json({ ok: false, error: `Нужно ${MIN_PHOTOS}–${MAX_PHOTOS} фото (base64)` }, { status: 400 });
        }
        const photos: InputPhoto[] = [];
        for (let i = 0; i < base64.length; i++) {
          const b64 = base64[i];
          const m = b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
          const mime = m?.[1] || "image/jpeg";
          const dataStr = m?.[2] || b64;
          const raw = Buffer.from(dataStr, "base64");
          const { data, type } = await recompressIfNeeded(raw, mime);
          photos.push({ name: `p${i}.jpg`, type, data });
        }
        await sendMediaGroupAdaptive(photos, `<b>ФОТО (${photos.length})</b>`);
        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ ok: false, error: "Неизвестная phase" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[submit] error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "internal" }, { status: 500 });
  }
}
