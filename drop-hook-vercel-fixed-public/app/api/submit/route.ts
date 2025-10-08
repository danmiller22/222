import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const TELEGRAM_CHAT_ID = '-1003162402009'; // ← ваш ID группы
const TG_API = () => {
  const token = envOrThrow('TELEGRAM_BOT_TOKEN'); // задайте в Vercel
  return `https://api.telegram.org/bot${token}`;
};

async function sendTelegramText(chatId: string, text: string) {
  const res = await fetch(`${TG_API()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
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

async function sendTelegramMediaGroup(chatId: string, files: File[], caption?: string) {
  const groups = chunk(files, 10); // лимит Telegram

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const fd = new FormData();
    fd.set('chat_id', chatId);

    const media: InputMediaPhoto[] = group.map((_, idx) => {
      const attachName = `file${idx}`;
      const item: InputMediaPhoto = {
        type: 'photo',
        media: `attach://${attachName}`,
      };
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
      const filename = f.name && f.name.trim().length ? f.name : `photo_${gi + 1}_${idx + 1}.jpg`;
      fd.append(`file${idx}`, new Blob([buf], { type: f.type || 'image/jpeg' }), filename);
    }

    const res = await fetch(`${TG_API()}/sendMediaGroup`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`Telegram sendMediaGroup failed: ${res.status} ${await res.text()}`);
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

    const files = form.getAll('photos') as unknown as File[];
    if (files.length < 8) {
      return NextResponse.json({ error: `Too few photos: ${files.length}. Minimum is 8.` }, { status: 400 });
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
    const headerLines = isRu ? [
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
    ];
    const headerText = headerLines.join('\n');

    // 1) текст
    await sendTelegramText(TELEGRAM_CHAT_ID, headerText);
    // 2) фото батчами по 10
    await sendTelegramMediaGroup(TELEGRAM_CHAT_ID, files, headerText);

    return NextResponse.json({ ok: true });
  } catch (err:any) {
    console.error('submit->telegram failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Submit failed' }, { status: 500 });
  }
}
