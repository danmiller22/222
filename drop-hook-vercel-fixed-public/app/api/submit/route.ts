// app/api/submit/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003162402009';

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
const TG_API = () => `https://api.telegram.org/bot${envOrThrow('TELEGRAM_BOT_TOKEN')}`;

// ----- Anti-429 / retry helpers -----
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * 400);

async function fetchTG(path: string, init: RequestInit, tries = 6): Promise<Response> {
  let delay = 1200; // начальная пауза между ретраями
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(`${TG_API()}${path}`, init);
    if (res.ok) return res;

    // 429 — уважаем retry_after; добавляем jitter
    if (res.status === 429) {
      let wait = 3000;
      try {
        const b = await res.clone().json();
        if (b?.parameters?.retry_after) wait = (Number(b.parameters.retry_after) + 1) * 1000;
      } catch {}
      await sleep(jitter(wait));
      continue;
    }

    // 5xx — экспоненциальный бэкоф
    if (res.status >= 500 && res.status < 600) {
      await sleep(jitter(delay));
      delay *= 2;
      continue;
    }

    // остальное — фейлим с текстом ошибки
    throw new Error(`Telegram ${path} failed: ${res.status} ${await res.text()}`);
  }
  throw new Error(`Telegram ${path} failed after ${tries} retries`);
}

// ----- Telegram senders -----
async function sendMessage(text: string) {
  await fetchTG('/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  // микропаузa, чтобы не схватить 429 на следующем запросе
  await sleep(900);
}

type InputMediaPhoto = { type: 'photo'; media: string };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sendMediaGroupFiles(files: File[]) {
  const groups = chunk(files, 10); // лимит альбома в Telegram — 10

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const fd = new FormData();
    fd.set('chat_id', TELEGRAM_CHAT_ID);

    const media: InputMediaPhoto[] = group.map((_, idx) => {
      const attachName = `file${idx}`;
      return { type: 'photo', media: `attach://${attachName}` };
    });
    fd.set('media', JSON.stringify(media));

    for (let idx = 0; idx < group.length; idx++) {
      const f = group[idx];
      const buf = Buffer.from(await f.arrayBuffer());
      const filename = f.name?.trim() ? f.name : `photo_${gi + 1}_${idx + 1}.jpg`;
      fd.append(`file${idx}`, new Blob([buf], { type: f.type || 'image/jpeg' }), filename);
    }

    // пробуем отправить медиагруппу; если 429/5xx — fetchTG сам ретраит
    await fetchTG('/sendMediaGroup', { method: 'POST', body: fd });

    // мягкая пауза между альбомами, чтобы исключить 429
    if (gi < groups.length - 1) await sleep(1500);
  }
}

// Фолбэк: если медиагруппа упорно не проходит, отправляем по одному фото с паузами
async function sendPhotosIndividually(files: File[]) {
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const fd = new FormData();
    fd.set('chat_id', TELEGRAM_CHAT_ID);

    const buf = Buffer.from(await f.arrayBuffer());
    const filename = f.name?.trim() ? f.name : `photo_single_${i + 1}.jpg`;
    fd.append('photo', new Blob([buf], { type: f.type || 'image/jpeg' }), filename);

    await fetchTG('/sendPhoto', { method: 'POST', body: fd });
    await sleep(1200); // чтоб не уткнуться в rate-limit
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const lang = (String(form.get('lang') || 'en') === 'ru') ? 'ru' : 'en';
    const event_type   = String(form.get('event_type') || '');
    const truck_number = String(form.get('truck_number') || '');
    const driver_first = String(form.get('driver_first') || '');
    const driver_last  = String(form.get('driver_last')  || '');
    const trailer_pick = String(form.get('trailer_pick') || (lang==='ru'?'нет':'none'));
    const trailer_drop = String(form.get('trailer_drop') || (lang==='ru'?'нет':'none'));
    const notes        = String(form.get('notes') || '');

    if (!event_type || !truck_number || !driver_first || !driver_last) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Принимаем 8..13 фото, лишнее отрезаем
    let files = form.getAll('photos') as unknown as File[];
    if (files.length < 8) {
      return NextResponse.json({ error: `Too few photos: ${files.length}. Minimum is 8.` }, { status: 400 });
    }
    if (files.length > 13) files = files.slice(0, 13);

    // Chicago time
    const dt = new Intl.DateTimeFormat(lang==='ru'?'ru-RU':'en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date());
    const when = `${dt} America/Chicago`;
    const fullName = `${driver_first} ${driver_last}`.trim();

    // ЕДИНСТВЕННАЯ текстовая карточка (шаблон)
    const header = (lang === 'ru' ? [
      `🚚 <b>US Team Fleet — ${event_type}</b>`,
      `Когда: <code>${when}</code>`,
      `Truck #: <b>${truck_number}</b>`,
      `Водитель: <b>${fullName}</b>`,
      `Взял (Hook): <b>${trailer_pick}</b>`,
      `Оставил (Drop): <b>${trailer_drop}</b>`,
      `Заметки: ${notes || '-'}`,
      `Фото: ${files.length} шт.`,
    ] : [
      `🚚 <b>US Team Fleet — ${event_type}</b>`,
      `When: <code>${when}</code>`,
      `Truck #: <b>${truck_number}</b>`,
      `Driver: <b>${fullName}</b>`,
      `Trailer picked (Hook): <b>${trailer_pick}</b>`,
      `Trailer dropped (Drop): <b>${trailer_drop}</b>`,
      `Notes: ${notes || '-'}`,
      `Photos: ${files.length}`,
    ]).join('\n');

    // 1) отправляем РОВНО одну текстовую карточку
    await sendMessage(header);

    // 2) пробуем отправить фото альбомами
    try {
      await sendMediaGroupFiles(files);
    } catch (e) {
      // 3) жёсткий фолбэк, если где-то упёрлись в лимиты: поштучно, с паузами
      await sendPhotosIndividually(files);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('submit->telegram failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Submit failed' }, { status: 500 });
  }
}
