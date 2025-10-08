// app/api/submit/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// TG группа (ваша)
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

    // 429 — уважаем retry_after
    if (res.status === 429) {
      let wait = 5;
      try {
        const b = await res.clone().json();
        if (b?.parameters?.retry_after) wait = Number(b.parameters.retry_after);
      } catch {}
      await sleep((wait + 1) * 1000);
      continue;
    }

    // 5xx — короткий бэкоф
    if (res.status >= 500 && res.status < 600) {
      await sleep(1500 * attempt);
      continue;
    }

    // иное — кидаем ошибку
    throw new Error(`Telegram ${path} failed: ${res.status} ${await res.text()}`);
  }
  throw new Error(`Telegram ${path} failed after ${tries} retries`);
}

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
}

type Media = { type: 'photo'|'document'; media: string; caption?: string; parse_mode?: 'HTML' };
const chunk = <T,>(a:T[], n:number)=>{ const r:T[][]=[]; for(let i=0;i<a.length;i+=n) r.push(a.slice(i,i+n)); return r; };

async function sendMediaGroups(urls: string[], caption: string) {
  const groups = chunk(urls, 10); // лимит Telegram в одном альбоме

  for (let gi = 0; gi < groups.length; gi++) {
    const media: Media[] = groups[gi].map((u, idx) => ({
      type: 'photo',
      media: u, // отправка по URL (из S3)
      ...(gi === 0 && idx === 0 ? { caption, parse_mode: 'HTML' as const } : {}),
    }));

    await fetchTG('/sendMediaGroup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, media }),
    });

    // мягкая пауза между альбомами
    if (gi < groups.length - 1) await sleep(1500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      lang = 'en',
      event_type, truck_number, driver_first, driver_last,
      trailer_pick, trailer_drop, notes, urls
    } = body || {};

    if (!event_type || !truck_number || !driver_first || !driver_last || !Array.isArray(urls) || urls.length < 8) {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }

    // Время — America/Chicago
    const dt = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date());
    const when = `${dt} America/Chicago`;
    const name = `${driver_first} ${driver_last}`.trim();

    const header = (lang === 'ru' ? [
      `🚚 <b>US Team Fleet — ${event_type}</b>`,
      `Когда: <code>${when}</code>`,
      `Truck #: <b>${truck_number}</b>`,
      `Водитель: <b>${name}</b>`,
      `Взял (Hook): <b>${trailer_pick || 'нет'}</b>`,
      `Оставил (Drop): <b>${trailer_drop || 'нет'}</b>`,
      `Заметки: ${notes || '-'}`,
      `Фото: ${urls.length} шт.`,
    ] : [
      `🚚 <b>US Team Fleet — ${event_type}</b>`,
      `When: <code>${when}</code>`,
      `Truck #: <b>${truck_number}</b>`,
      `Driver: <b>${name}</b>`,
      `Trailer picked (Hook): <b>${trailer_pick || 'none'}</b>`,
      `Trailer dropped (Drop): <b>${trailer_drop || 'none'}</b>`,
      `Notes: ${notes || '-'}`,
      `Photos: ${urls.length}`,
    ]).join('\n');

    // 1) текстовая шапка
    await sendMessage(header);

    // 2) пробуем медиагруппы по URL
    try {
      await sendMediaGroups(urls, header);
    } catch (e) {
      // 3) фолбэк — список ссылок (дойдёт при любом раскладе)
      const listText = header + '\n\n' + urls.map((u: string, i: number) => `${i + 1}. ${u}`).join('\n');
      await sendMessage(listText);
    }

    return NextResponse.json({ ok: true });
  } catch (e:any) {
    console.error('submit->tg failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Submit failed' }, { status: 500 });
  }
}
