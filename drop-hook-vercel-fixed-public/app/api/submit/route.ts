import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003162402009';         // твой чат
const TOPIC_ANCHOR = process.env.TELEGRAM_TOPIC_ANCHOR                    // опционально: ID топика
  ? Number(process.env.TELEGRAM_TOPIC_ANCHOR)
  : undefined;

const TG_BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

<<<<<<< HEAD
<<<<<<< HEAD
// ----- Yard геофенс (как в последней версии; при необходимости поменяй радиус) -----
const YARD_CENTER = { lat: 41.380615, lon: -88.191687 };
const YARD_RADIUS_M = 120; // при нужде скорректируй
=======
// ----------- Yard coords (Channahon yard) -----------
const YARD = { lat: 41.444219, lon: -88.194936 }; // 27665 S Frontage Rd E, Channahon, IL 60410 (округлённые)
const YARD_RADIUS_M = 70;  // радиус ярда 70 метров
const YARD_FIXED_ACC_M = 10; // погрешность показываем как ±10 м
>>>>>>> parent of 49cf56f (Update route.ts)

// Haversine (м)
function metersBetween(a:{lat:number;lon:number}, b:{lat:number;lon:number}) {
  const R = 6371000; // радиус Земли в метрах
  const toRad = (x:number)=>x*Math.PI/180;
=======
// ---- Yard (Channahon, IL) ----
const YARD_CENTER = { lat: 41.380615, lon: -88.191687 };
const YARD_RADIUS_M = 120; //  ~радиус 120 м

const toRad = (x: number) => x * Math.PI / 180;
function meters(a: {lat:number; lon:number}, b: {lat:number; lon:number}) {
  const R = 6371000;
>>>>>>> bd08f571369569eabeb98e83c775e1fc04104ef3
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- Telegram helpers ----
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * 400);

async function fetchTG(path: string, init: RequestInit, tries = 6): Promise<any> {
  let delay = 1200;
  for (let i = 1; i <= tries; i++) {
    const r = await fetch(`${TG_BASE()}${path}`, init);
    let j: any = null;
    try { j = await r.clone().json(); } catch {}
    if (j?.ok) return j;

    if (r.status === 429) {
      let wait = 3000;
      try { if (j?.parameters?.retry_after) wait = (j.parameters.retry_after + 1) * 1000; } catch {}
      await sleep(jitter(wait));
      continue;
    }
    if (r.status >= 500) {
      await sleep(jitter(delay));
      delay *= 2;
      continue;
    }
    if (j) throw new Error(JSON.stringify(j));
    throw new Error(`TG ${path} failed: ${r.status}`);
  }
  throw new Error(`TG ${path} failed after retries`);
}

function buildText(params:{
  lang:'ru'|'en', event_type:string, when:string, truck:string,
  first:string, last:string, pick:string, drop:string, locLine:string, notes:string
}) {
  const { lang, event_type, when, truck, first, last, pick, drop, locLine, notes } = params;

  const lines = (lang === 'ru'
    ? [
        `🚚 <b>US Team Fleet — ${event_type}</b>`,
        `Когда: <code>${when}</code>`,
        `Truck #: <b>${truck}</b>`,
        `Водитель: <b>${first} ${last}</b>`,
        `Взял (Hook): <b>${pick}</b>`,
        `Оставил (Drop): <b>${drop}</b>`,
        locLine,
        `Заметки: ${notes || '-'}`,
      ]
    : [
        `🚚 <b>US Team Fleet — ${event_type}</b>`,
        `When: <code>${when}</code>`,
        `Truck #: <b>${truck}</b>`,
        `Driver: <b>${first} ${last}</b>`,
        `Trailer picked (Hook): <b>${pick}</b>`,
        `Trailer dropped (Drop): <b>${drop}</b>`,
        locLine,
        `Notes: ${notes || '-'}`,
      ]);

  return lines.join('\n');
}

export async function POST(req: Request) {
  const form = await req.formData();
  const phase = String(form.get('phase') || 'init');

  if (phase === 'init') {
    const lang: 'ru'|'en' = (String(form.get('lang') || 'en') === 'ru') ? 'ru' : 'en';

    const event_type = String(form.get('event_type') || '');
    const truck = String(form.get('truck_number') || '');
    const first = String(form.get('driver_first') || '');
    const last  = String(form.get('driver_last') || '');
    const pick  = String(form.get('trailer_pick') || (lang==='ru' ? 'нет' : 'none'));
    const drop  = String(form.get('trailer_drop') || (lang==='ru' ? 'нет' : 'none'));
    const notes = String(form.get('notes') || '');

    const lat = Number(form.get('geo_lat'));
    const lon = Number(form.get('geo_lon'));

<<<<<<< HEAD
<<<<<<< HEAD
    // Гео
=======
    // Geo (required на фронте, но здесь формируем текст)
>>>>>>> parent of 49cf56f (Update route.ts)
    const geo_lat = form.get('geo_lat') ? Number(form.get('geo_lat')) : undefined;
    const geo_lon = form.get('geo_lon') ? Number(form.get('geo_lon')) : undefined;
    // geo_acc нам теперь не нужен для вывода вне ярда

    // Фото 8..13
    let files = form.getAll('photos') as unknown as File[];
    if (files.length < 8) return NextResponse.json({ error: `Too few photos: ${files.length}. Minimum is 8.` }, { status: 400 });
    if (files.length > 13) files = files.slice(0, 13);

    // Chicago time
    const dt = new Intl.DateTimeFormat(lang==='ru'?'ru-RU':'en-US', {
      timeZone: 'America/Chicago',
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
      hour12:false,
    }).format(new Date());
    const when = `${dt} America/Chicago`;
    const fullName = `${driver_first} ${driver_last}`.trim();

<<<<<<< HEAD
    // Локация
=======
    // Линия локации:
    // - если в пределах 70м от ярда -> "Yard (Channahon) (±15м)" / "(±15m)"
    // - иначе только точные координаты + ссылка на Google Maps (без погрешности)
>>>>>>> parent of 49cf56f (Update route.ts)
    let locLine = lang==='ru' ? 'Локация: -' : 'Location: -';
    if (Number.isFinite(geo_lat) && Number.isFinite(geo_lon)) {
      const here = { lat: geo_lat as number, lon: geo_lon as number };
      const distM = metersBetween(here, YARD);
      if (distM <= YARD_RADIUS_M) {
        const accTxt = lang==='ru' ? ` (±${YARD_FIXED_ACC_M}м)` : ` (±${YARD_FIXED_ACC_M}m)`;
        locLine = lang==='ru'
          ? `Локация: Yard (Channahon)${accTxt}`
          : `Location: Yard (Channahon)${accTxt}`;
=======
    let locLine = lang === 'ru' ? 'Локация: -' : 'Location: -';
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const here = { lat, lon };
      if (meters(here, YARD_CENTER) <= YARD_RADIUS_M) {
        locLine = (lang==='ru')
          ? 'Локация: US TEAM Yard ( Channahon IL )'
          : 'Location: US TEAM Yard ( Channahon IL )';
>>>>>>> bd08f571369569eabeb98e83c775e1fc04104ef3
      } else {
        const url = `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
        locLine = (lang==='ru')
          ? `Локация: ${lat.toFixed(5)}, ${lon.toFixed(5)} — ${url}`
          : `Location: ${lat.toFixed(5)}, ${lon.toFixed(5)} — ${url}`;
      }
    }

    const dt = new Intl.DateTimeFormat(lang==='ru' ? 'ru-RU' : 'en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date());
    const when = `${dt} America/Chicago`;

    const text = buildText({ lang, event_type, when, truck, first, last, pick, drop, locLine, notes });

    const body: any = {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (TOPIC_ANCHOR) body.message_thread_id = TOPIC_ANCHOR;

    const j = await fetchTG('/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    return NextResponse.json({ ok: true, replyTo: j.result.message_id });
  }

  if (phase === 'photos') {
    const replyTo = Number(form.get('replyTo'));
    if (!replyTo) return NextResponse.json({ error: 'replyTo required' }, { status: 400 });

    const files = form.getAll('photos') as unknown as File[];
    if (!files.length) return NextResponse.json({ ok: true });

    // пробуем группами по 10, при 429 — поштучно
    const groups: File[][] = [];
    for (let i = 0; i < files.length; i += 10) groups.push(files.slice(i, i + 10));

    try {
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const fd = new FormData();
        fd.set('chat_id', String(CHAT_ID));
        fd.set('reply_to_message_id', String(replyTo));
        fd.set('allow_sending_without_reply', 'true');
        if (TOPIC_ANCHOR) fd.set('message_thread_id', String(TOPIC_ANCHOR));

        const media = g.map((_, i) => ({ type: 'photo', media: `attach://file${i}` }));
        fd.set('media', JSON.stringify(media));

        for (let i = 0; i < g.length; i++) {
          const f = g[i];
          const buf = Buffer.from(await f.arrayBuffer());
          fd.append(`file${i}`, new Blob([buf], { type: f.type || 'image/jpeg' }), f.name || `p_${gi+1}_${i+1}.jpg`);
        }

        await fetchTG('/sendMediaGroup', { method: 'POST', body: fd });
        if (gi < groups.length - 1) await sleep(1500);
      }
      return NextResponse.json({ ok: true });
    } catch {
      // fallback: по одному
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const fd = new FormData();
        fd.set('chat_id', String(CHAT_ID));
        fd.set('reply_to_message_id', String(replyTo));
        fd.set('allow_sending_without_reply', 'true');
        if (TOPIC_ANCHOR) fd.set('message_thread_id', String(TOPIC_ANCHOR));
        const buf = Buffer.from(await f.arrayBuffer());
        fd.append('photo', new Blob([buf], { type: f.type || 'image/jpeg' }), f.name || `p_${i+1}.jpg`);
        await fetchTG('/sendPhoto', { method: 'POST', body: fd });
        await sleep(1200);
      }
      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ error: 'unknown phase' }, { status: 400 });
}
