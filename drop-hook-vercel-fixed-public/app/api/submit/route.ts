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
const sleep = (ms:number)=>new Promise(res=>setTimeout(res,ms));

async function fetchTG(path: string, init: RequestInit, tries = 5): Promise<Response> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(`${TG_API()}${path}`, init);
    if (res.ok) return res;

    if (res.status === 429) {
      let wait = 5;
      try {
        const b = await res.clone().json();
        if (b?.parameters?.retry_after) wait = Number(b.parameters.retry_after);
      } catch {}
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (res.status >= 500 && res.status < 600) {
      await sleep(1500 * attempt);
      continue;
    }
    throw new Error(`Telegram ${path} failed: ${res.status} ${await res.text()}`);
  }
  throw new Error(`Telegram ${path} failed after ${tries} retries`);
}

type InputMediaPhoto = {
  type: 'photo';
  media: string;
  caption?: string;
  parse_mode?: 'HTML';
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ⬇️ только медиагруппы; подпись (шапка) у первого фото ПЕРВОГО альбома
async function sendTelegramMediaGroup(chatId: string, files: File[], caption?: string) {
  const groups = chunk(files, 10); // лимит Telegram

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const fd = new FormData();
    fd.set('chat_id', chatId);

    const media: InputMediaPhoto[] = group.map((_, idx) => {
      const attachName = `file${idx}`;
      const item: InputMediaPhoto = { type: 'photo', media: `attach://${attachName}` };
      if (gi === 0 && idx === 0 && caption) {
        item.caption = caption;
        item.parse_mode = 'HTML';
      }
      return item;
    });

    fd.set('media', JSON.stringify(media));

    for (let idx = 0; idx < group.length; idx++) {
      const f = group[idx];
      const buf = Buffer.from(await f.arrayBuffer());
      const filename = f.name?.trim() ? f.name : `photo_${gi + 1}_${idx + 1}.jpg`;
      fd.append(`file${idx}`, new Blob([buf], { type: f.type || 'image/jpeg' }), filename);
    }

    await fetchTG('/sendMediaGroup', { method: 'POST', body: fd });
    if (gi < groups.length - 1) await sleep(1500);
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

    // Получаем фото из формы, режем по нашему серверному лимиту: 8..15
    let files = form.getAll('photos') as unknown as File[];
    if (files.length < 8) {
      return NextResponse.json({ error: `Too few photos: ${files.length}. Minimum is 8.` }, { status: 400 });
    }
    if (files.length > 15) {
      files = files.slice(0, 15);
    }

    // Chicago time
    const dt = new Intl.DateTimeFormat(lang==='ru'?'ru-RU':'en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date());
    const when = `${dt} America/Chicago`;
    const fullName = `${driver_first} ${driver_last}`.trim();

    const isRu = lang === 'ru';
    const header = (isRu ? [
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

    // Отправляем ТОЛЬКО альбом(ы) — первая карточка содержит шапку в caption
    await sendTelegramMediaGroup(TELEGRAM_CHAT_ID, files, header);

    return NextResponse.json({ ok: true });
  } catch (err:any) {
    console.error('submit->telegram failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Submit failed' }, { status: 500 });
  }
}
