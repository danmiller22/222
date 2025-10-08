// app/api/submit/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003162402009';
const TOPIC_ANCHOR = process.env.TELEGRAM_TOPIC_ANCHOR ? Number(process.env.TELEGRAM_TOPIC_ANCHOR) : undefined;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
const TG_API = () => `https://api.telegram.org/bot${envOrThrow('TELEGRAM_BOT_TOKEN')}`;

// ----- Yard геофенс (как в последней версии; при необходимости поменяй радиус) -----
const YARD_CENTER = { lat: 41.380615, lon: -88.191687 };
const YARD_RADIUS_M = 120; // при нужде скорректируй

// Haversine (м)
function metersBetween(a:{lat:number;lon:number}, b:{lat:number;lon:number}) {
  const R = 6371000;
  const toRad = (x:number)=>x*Math.PI/180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// anti-429
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const jitter = (ms: number) => ms + Math.floor(Math.random() * 400);
async function fetchTG(path: string, init: RequestInit, tries = 6): Promise<Response> {
  let delay = 1200;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(`${TG_API()}${path}`, init);
    if (res.ok) return res;

    if (res.status === 429) {
      let wait = 3000;
      try {
        const b = await res.clone().json();
        if (b?.parameters?.retry_after) wait = (Number(b.parameters.retry_after) + 1) * 1000;
      } catch {}
      await sleep(jitter(wait)); continue;
    }
    if (res.status >= 500 && res.status < 600) {
      await sleep(jitter(delay)); delay *= 2; continue;
    }
    throw new Error(`Telegram ${path} failed: ${res.status} ${await res.text()}`);
  }
  throw new Error(`Telegram ${path} failed after ${tries} retries`);
}

async function sendMessage(text: string, replyTo?: number) {
  const body: any = { chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (replyTo) { body.reply_to_message_id = replyTo; body.allow_sending_without_reply = true; }
  await fetchTG('/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await sleep(900);
}

type InputMediaPhoto = { type: 'photo'; media: string };
const chunk = <T,>(a:T[], n:number)=>{ const r:T[][]=[]; for(let i=0;i<a.length;i+=n) r.push(a.slice(i,i+n)); return r; };

async function sendMediaGroupFiles(files: File[], replyTo?: number) {
  const groups = chunk(files, 10);
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const fd = new FormData();
    fd.set('chat_id', CHAT_ID);
    if (replyTo) { fd.set('reply_to_message_id', String(replyTo)); fd.set('allow_sending_without_reply','true'); }

    const media: InputMediaPhoto[] = group.map((_, idx) => ({ type: 'photo', media: `attach://file${idx}` }));
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

async function sendPhotosIndividually(files: File[], replyTo?: number) {
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const fd = new FormData();
    fd.set('chat_id', CHAT_ID);
    if (replyTo) { fd.set('reply_to_message_id', String(replyTo)); fd.set('allow_sending_without_reply','true'); }
    const buf = Buffer.from(await f.arrayBuffer());
    const filename = f.name?.trim() ? f.name : `photo_single_${i + 1}.jpg`;
    fd.append('photo', new Blob([buf], { type: f.type || 'image/jpeg' }), filename);
    await fetchTG('/sendPhoto', { method: 'POST', body: fd });
    await sleep(1200);
  }
}

// отправка документа (PDF/JPG) как документ
async function sendDocument(file: File, caption?: string, replyTo?: number) {
  const fd = new FormData();
  fd.set('chat_id', CHAT_ID);
  if (replyTo) { fd.set('reply_to_message_id', String(replyTo)); fd.set('allow_sending_without_reply','true'); }
  const buf = Buffer.from(await file.arrayBuffer());
  const filename = file.name?.trim() ? file.name : 'document.pdf';
  fd.append('document', new Blob([buf], { type: file.type || 'application/octet-stream' }), filename);
  if (caption) fd.set('caption', caption);
  await fetchTG('/sendDocument', { method: 'POST', body: fd });
  await sleep(900);
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

    // Документы
    const annual_mode = (String(form.get('annual_mode') || 'none') === 'yes') ? 'yes' : 'none';
    const reg_mode    = (String(form.get('reg_mode') || 'none') === 'yes') ? 'yes' : 'none';
    const annual_doc  = (form.get('annual_doc') as unknown as File) || null;
    const reg_doc     = (form.get('reg_doc') as unknown as File) || null;

    if (!event_type || !truck_number || !driver_first || !driver_last) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    // Требуем соответствие режимов
    if (annual_mode === 'yes' && !annual_doc) {
      return NextResponse.json({ error: 'Annual inspection missing' }, { status: 400 });
    }
    if (reg_mode === 'yes' && !reg_doc) {
      return NextResponse.json({ error: 'Registration missing' }, { status: 400 });
    }

    // Гео
    const geo_lat = form.get('geo_lat') ? Number(form.get('geo_lat')) : undefined;
    const geo_lon = form.get('geo_lon') ? Number(form.get('geo_lon')) : undefined;

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

    // Локация
    let locLine = lang==='ru' ? 'Локация: -' : 'Location: -';
    if (Number.isFinite(geo_lat) && Number.isFinite(geo_lon)) {
      const here = { lat: geo_lat as number, lon: geo_lon as number };
      const distM = metersBetween(here, YARD_CENTER);
      if (distM <= YARD_RADIUS_M) {
        locLine = lang==='ru'
          ? 'Локация: US TEAM Yard ( Channahon IL )'
          : 'Location: US TEAM Yard ( Channahon IL )';
      } else {
        const mapUrl = `https://maps.google.com/?q=${here.lat.toFixed(6)},${here.lon.toFixed(6)}`;
        locLine = lang==='ru'
          ? `Локация: ${here.lat.toFixed(5)}, ${here.lon.toFixed(5)} — ${mapUrl}`
          : `Location: ${here.lat.toFixed(5)}, ${here.lon.toFixed(5)} — ${mapUrl}`;
      }
    }

    const annualLine = (lang==='ru'
      ? `Annual Inspection: <b>${annual_mode==='yes' ? 'есть' : 'нет'}</b>`
      : `Annual Inspection: <b>${annual_mode==='yes' ? 'available' : 'none'}</b>`);

    const regLine = (lang==='ru'
      ? `Registration: <b>${reg_mode==='yes' ? 'есть' : 'нет'}</b>`
      : `Registration: <b>${reg_mode==='yes' ? 'available' : 'none'}</b>`);

    const header = (lang === 'ru' ? [
      `🚚 <b>US Team Fleet — ${event_type}</b>`,
      `Когда: <code>${when}</code>`,
      `Truck #: <b>${truck_number}</b>`,
      `Водитель: <b>${fullName}</b>`,
      `Взял (Hook): <b>${trailer_pick}</b>`,
      `Оставил (Drop): <b>${trailer_drop}</b>`,
      locLine,
      annualLine,
      regLine,
      `Заметки: ${notes || '-'}`,
      `Фото: ${files.length} шт.`,
    ] : [
      `🚚 <b>US Team Fleet — ${event_type}</b>`,
      `When: <code>${when}</code>`,
      `Truck #: <b>${truck_number}</b>`,
      `Driver: <b>${fullName}</b>`,
      `Trailer picked (Hook): <b>${trailer_pick}</b>`,
      `Trailer dropped (Drop): <b>${trailer_drop}</b>`,
      locLine,
      annualLine,
      regLine,
      `Notes: ${notes || '-'}`,
      `Photos: ${files.length}`,
    ]).join('\n');

    const replyTo = TOPIC_ANCHOR;

    // 1) текстовая карточка
    await sendMessage(header, replyTo);

    // 2) альбомы фото
    try { await sendMediaGroupFiles(files, replyTo); }
    catch { await sendPhotosIndividually(files, replyTo); }

    // 3) документы (если есть) — шлём как документы отдельными сообщениями
    if (annual_mode==='yes' && annual_doc) {
      await sendDocument(annual_doc, (lang==='ru'?'Annual Inspection':'Annual Inspection'), replyTo);
    }
    if (reg_mode==='yes' && reg_doc) {
      await sendDocument(reg_doc, (lang==='ru'?'Registration':'Registration'), replyTo);
    }

    return NextResponse.json({ ok: true });
  } catch (err:any) {
    console.error('submit->telegram failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Submit failed' }, { status: 500 });
  }
}
