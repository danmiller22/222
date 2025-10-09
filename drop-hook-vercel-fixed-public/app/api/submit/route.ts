// app/api/submit/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ========= ENV =========
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
// ID форум-топика (thread) в супер-группе
const TG_TOPIC_ID = Number(process.env.TELEGRAM_TOPIC_ID || process.env.TELEGRAM_TOPIC_ANCHOR || 0);

// ========= LIMITS / CFG =========
const MIN_PHOTOS = 8;
const MAX_PHOTOS = 20;
const TARGET_MAX_BYTES = 800_000; // ~0.8 MB после recompress
const TARGET_MAX_WIDTH = 1400;
const TG_ALBUM_LIMIT = 10;
const MAX_CHUNK_TOTAL = 7_500_000;
const GROUP_PAUSE_MS_MIN = 1000;
const GROUP_PAUSE_MS_MAX = 1600;
const MAX_TG_RETRIES = 8;
const TZ = "America/Chicago";

// ========= UTILS =========
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function rand(min: number, max: number) { return Math.floor(min + Math.random() * (max - min + 1)); }
function esc(s: string) { return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }
function fmtLocal(dt: Date) {
  const d = new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(dt);
  return `${d} ${TZ}`;
}
// корректный BlobPart из Buffer
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ========= optional sharp =========
let sharpAvailable = false;
let sharp: any = null;
try {
  // eslint-disable-next-line no-eval
  const req: any = (globalThis as any).require || eval("require");
  sharp = req?.("sharp");
  sharpAvailable = !!sharp;
} catch { sharpAvailable = false; }

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

// ========= Telegram =========
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

function withTopic(base: URLSearchParams | FormData) {
  if (TG_TOPIC_ID) {
    // @ts-ignore
    base.set?.("message_thread_id", String(TG_TOPIC_ID));
  }
  return base;
}

async function sendTextToTopic(text: string) {
  const body = withTopic(new URLSearchParams());
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

async function sendMediaGroupAdaptive(photos: InputPhoto[]) {
  let groupLimit = TG_ALBUM_LIMIT;
  let sizeLimit = MAX_CHUNK_TOTAL;
  let index = 0;

  while (index < photos.length) {
    const rest = photos.slice(index);
    const groups = chunkPhotosFixed(rest, groupLimit, sizeLimit);
    if (!groups.length) throw new Error("internal chunking error");

    const group = groups[0];
    const fd = withTopic(new FormData());
    const media = group.map((p, i) => {
      const attachName = `photo_${i}`;
      const blob = new Blob([toArrayBuffer(p.data)], { type: p.type || "image/jpeg" });
      fd.append(attachName, blob, p.name || `p${i}.jpg`);
      return {
        type: "photo",
        media: `attach://${attachName}`,
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
        continue; // повтор
      }
      throw e;
    }
  }
}

// ========= TYPES =========
type InitPayload = {
  phase: "init";
  sessionId: string;
  event_type: "Hook" | "Drop";
  truck_number: string;
  driver_first: string;
  driver_last: string;
  trailer_pick?: string;
  trailer_drop?: string;
  notes?: string;
  coords: { lat: number; lng: number };
};
type PhotosMultipart = "photos";
type PhotosJson = {
  phase: "photos";
  sessionId: string;
  photosBase64: string[];
};

// ========= HANDLER =========
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // ---------- MULTIPART (фото + мета) ----------
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();

      const phase = String(form.get("phase") || "photos") as PhotosMultipart;
      if (phase !== "photos") {
        return NextResponse.json({ ok: false, error: "Multipart поддерживает только phase=photos" }, { status: 400 });
      }
      const sessionId = String(form.get("sessionId") || "");
      if (!sessionId) return NextResponse.json({ ok: false, error: "sessionId required" }, { status: 400 });

      // Мета может прийти вместе с фото (наш фронт так и делает)
      const meta = {
        event_type: (form.get("event_type") as string) || "",
        truck_number: (form.get("truck_number") as string) || "",
        driver_first: (form.get("driver_first") as string) || "",
        driver_last: (form.get("driver_last") as string) || "",
        trailer_pick: (form.get("trailer_pick") as string) || "",
        trailer_drop: (form.get("trailer_drop") as string) || "",
        notes: (form.get("notes") as string) || "",
      };

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

      // 1) Отправляем альбом(ы) в нужный топик
      await sendMediaGroupAdaptive(photos);

      // 2) После фото шлём СУММАРНОЕ сообщение строго по шаблону
      const when = fmtLocal(new Date());
      const hook = meta.trailer_pick?.trim() ? meta.trailer_pick.trim() : "No";
      const drop = meta.trailer_drop?.trim() ? meta.trailer_drop.trim() : "No";
      const notes = meta.notes?.trim() ? meta.notes.trim() : "-";

      let locLine = "-";
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        const dispLat = coords.lat.toFixed(5);
        const dispLng = coords.lng.toFixed(5);
        // линк с полной точностью
        const link = `https://maps.google.com/?q=${coords.lat},${coords.lng}`;
        locLine = `${dispLat}, ${dispLng} — ${link}`;
      }

      const message =
        `🚚 US Team Fleet — ${meta.event_type || "Hook"}\n` +
        `Когда: ${when}\n` +
        `Truck #: ${esc(meta.truck_number || "-")}\n` +
        `Водитель: ${esc(meta.driver_first || "-")}  ${esc(meta.driver_last || "-")}\n` +
        `Взял (Hook): ${esc(hook)}\n` +
        `Оставил (Drop): ${esc(drop)}\n` +
        `Локация: ${esc(locLine)}\n` +
        `Заметки: ${esc(notes)}\n` +
        `Фото: ${photos.length} шт.`;

      await sendTextToTopic(message);

      return NextResponse.json({ ok: true });
    }

    // ---------- JSON (init/photos base64) ----------
    const raw = await req.text().catch(() => "");
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    if (typeof body !== "object" || body === null) body = {};

    const phase: "init" | "photos" | undefined = body.phase;
    if (!phase) return NextResponse.json({ ok: false, error: "phase required" }, { status: 400 });

    // Вариант init (если используешь): просто отправим заголовок без счётчика фото
    if (phase === "init") {
      const p = body as InitPayload;
      if (!p.sessionId || !p.event_type || !p.truck_number || !p.driver_first || !p.driver_last || !p.coords) {
        return NextResponse.json({ ok: false, error: "sessionId, event_type, truck_number, driver_first, driver_last, coords обязательны" }, { status: 400 });
      }
      const when = fmtLocal(new Date());
      const hook = p.trailer_pick?.trim() ? p.trailer_pick.trim() : "No";
      const drop = p.trailer_drop?.trim() ? p.trailer_drop.trim() : "No";
      const notes = p.notes?.trim() ? p.notes.trim() : "-";
      const dispLat = p.coords.lat.toFixed(5);
      const dispLng = p.coords.lng.toFixed(5);
      const link = `https://maps.google.com/?q=${p.coords.lat},${p.coords.lng}`;

      const msg =
        `🚚 US Team Fleet — ${p.event_type}\n` +
        `Когда: ${when}\n` +
        `Truck #: ${esc(p.truck_number)}\n` +
        `Водитель: ${esc(p.driver_first)}  ${esc(p.driver_last)}\n` +
        `Взял (Hook): ${esc(hook)}\n` +
        `Оставил (Drop): ${esc(drop)}\n` +
        `Локация: ${dispLat}, ${dispLng} — ${link}\n` +
        `Заметки: ${esc(notes)}`;

      await sendTextToTopic(msg);
      return NextResponse.json({ ok: true });
    }

    // JSON-фото (base64) — поддержка на всякий случай
    if (phase === "photos") {
      const p = body as PhotosJson;
      if (!p.sessionId || !Array.isArray(p.photosBase64)) {
        return NextResponse.json({ ok: false, error: "sessionId и photosBase64 обязательны" }, { status: 400 });
      }
      if (p.photosBase64.length < MIN_PHOTOS || p.photosBase64.length > MAX_PHOTOS) {
        return NextResponse.json({ ok: false, error: `Нужно ${MIN_PHOTOS}–${MAX_PHOTOS} фото (base64)` }, { status: 400 });
      }
      const photos: InputPhoto[] = [];
      for (let i = 0; i < p.photosBase64.length; i++) {
        const b64 = p.photosBase64[i];
        const m = b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        const mime = m?.[1] || "image/jpeg";
        const dataStr = m?.[2] || b64;
        const rawBuf = Buffer.from(dataStr, "base64");
        const { data, type } = await recompressIfNeeded(rawBuf, mime);
        photos.push({ name: `p${i}.jpg`, type, data });
      }
      await sendMediaGroupAdaptive(photos);
      await sendTextToTopic(`Фото: ${photos.length} шт.`);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Неизвестная phase" }, { status: 400 });
  } catch (err: any) {
    console.error("[submit] error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "internal" }, { status: 500 });
  }
}
