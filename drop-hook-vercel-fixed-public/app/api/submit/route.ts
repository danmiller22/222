import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003162402009';
const TOPIC_ANCHOR = process.env.TELEGRAM_TOPIC_ANCHOR ? Number(process.env.TELEGRAM_TOPIC_ANCHOR) : undefined;
const TG = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Yard
const YARD_CENTER = { lat: 41.380615, lon: -88.191687 };
const YARD_RADIUS_M = 120;
const toRad = (x:number)=>x*Math.PI/180;
function meters(a:{lat:number;lon:number}, b:{lat:number;lon:number}){
  const R=6371000, dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon);
  const la1=toRad(a.lat), la2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}

const sleep = (ms:number)=> new Promise(r=>setTimeout(r,ms));
const jitter = (ms:number)=> ms + Math.floor(Math.random()*400);

// Telegram helpers with retry/backoff
async function fetchTG(path:string, init:RequestInit, tries=6):Promise<any>{
  let delay=1200;
  for(let i=1;i<=tries;i++){
    const r = await fetch(`${TG()}${path}`, init);
    try{
      const j = await r.json();
      if(j.ok) return j;
      if(r.status===429){
        let wait=3000; if(j?.parameters?.retry_after) wait=(j.parameters.retry_after+1)*1000;
        await sleep(jitter(wait)); continue;
      }
      if(r.status>=500){ await sleep(jitter(delay)); delay*=2; continue; }
      throw new Error(JSON.stringify(j));
    }catch(parseErr){
      if(r.ok) return {};
      if(r.status>=500){ await sleep(jitter(delay)); delay*=2; continue; }
      throw new Error(`TG ${path} failed: ${r.status}`);
    }
  }
  throw new Error(`TG ${path} failed after retries`);
}

function textCard(params:{
  lang:'ru'|'en', event_type:string, when:string, truck:string,
  first:string,last:string,pick:string,drop:string,locLine:string,
  annual_mode:string, reg_mode:string, notes:string
}){
  const {lang,event_type,when,truck,first,last,pick,drop,locLine,annual_mode,reg_mode,notes} = params;
  const annualLine = (lang==='ru') ? `Annual Inspection: <b>${annual_mode==='yes'?'есть':'нет'}</b>` : `Annual Inspection: <b>${annual_mode==='yes'?'available':'none'}</b>`;
  const regLine    = (lang==='ru') ? `Registration: <b>${reg_mode==='yes'?'есть':'нет'}</b>`     : `Registration: <b>${reg_mode==='yes'?'available':'none'}</b>`;
  const lines = (lang==='ru' ? [
    `🚚 <b>US Team Fleet — ${event_type}</b>`,
    `Когда: <code>${when}</code>`,
    `Truck #: <b>${truck}</b>`,
    `Водитель: <b>${first} ${last}</b>`,
    `Взял (Hook): <b>${pick}</b>`,
    `Оставил (Drop): <b>${drop}</b>`,
    locLine, annualLine, regLine,
    `Заметки: ${notes||'-'}`
  ] : [
    `🚚 <b>US Team Fleet — ${event_type}</b>`,
    `When: <code>${when}</code>`,
    `Truck #: <b>${truck}</b>`,
    `Driver: <b>${first} ${last}</b>`,
    `Trailer picked (Hook): <b>${pick}</b>`,
    `Trailer dropped (Drop): <b>${drop}</b>`,
    locLine, annualLine, regLine,
    `Notes: ${notes||'-'}`
  ]);
  return lines.join('\n');
}

export async function POST(req: Request){
  const form = await req.formData();
  const phase = String(form.get('phase')||'init');

  if (phase === 'init'){
    const lang = (String(form.get('lang')||'en')==='ru')?'ru':'en';
    const event_type = String(form.get('event_type')||'');
    const truck = String(form.get('truck_number')||'');
    const first = String(form.get('driver_first')||'');
    const last  = String(form.get('driver_last')||'');
    const pick  = String(form.get('trailer_pick')|| (lang==='ru'?'нет':'none'));
    const drop  = String(form.get('trailer_drop')|| (lang==='ru'?'нет':'none'));
    const notes = String(form.get('notes')||'');

    const lat = Number(form.get('geo_lat')); const lon = Number(form.get('geo_lon'));
    let locLine = lang==='ru' ? 'Локация: -' : 'Location: -';
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      const here = {lat,lon};
      if (meters(here, YARD_CENTER) <= YARD_RADIUS_M){
        locLine = (lang==='ru') ? 'Локация: US TEAM Yard ( Channahon IL )' : 'Location: US TEAM Yard ( Channahon IL )';
      } else {
        const url = `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
        locLine = (lang==='ru') ? `Локация: ${lat.toFixed(5)}, ${lon.toFixed(5)} — ${url}` : `Location: ${lat.toFixed(5)}, ${lon.toFixed(5)} — ${url}`;
      }
    }

    const dt = new Intl.DateTimeFormat(lang==='ru'?'ru-RU':'en-US',{
      timeZone:'America/Chicago', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
    }).format(new Date());
    const when = `${dt} America/Chicago`;

    const annual_mode = String(form.get('annual_mode')||'none');
    const reg_mode    = String(form.get('reg_mode')||'none');

    const text = textCard({ lang, event_type, when, truck, first, last, pick, drop, locLine, annual_mode, reg_mode, notes });

    const body:any = { chat_id: CHAT_ID, text, parse_mode:'HTML', disable_web_page_preview:true };
    if (TOPIC_ANCHOR) body.message_thread_id = TOPIC_ANCHOR;
    const j = await fetchTG('/sendMessage', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    return NextResponse.json({ ok:true, replyTo: j.result.message_id });
  }

  if (phase === 'photos'){
    const replyTo = Number(form.get('replyTo')); if(!replyTo) return NextResponse.json({error:'replyTo required'},{status:400});
    const files = form.getAll('photos') as unknown as File[]; if(!files.length) return NextResponse.json({ok:true});

    // попытка mediaGroup (батчами ≤10), если упадёт — по одному
    const groups: File[][] = []; for(let i=0;i<files.length;i+=10) groups.push(files.slice(i,i+10));
    try{
      for (let gi=0; gi<groups.length; gi++){
        const g = groups[gi];
        const fd = new FormData();
        fd.set('chat_id', CHAT_ID);
        fd.set('reply_to_message_id', String(replyTo));
        fd.set('allow_sending_without_reply','true');
        if (TOPIC_ANCHOR) fd.set('message_thread_id', String(TOPIC_ANCHOR));
        const media = g.map((_,i)=>({type:'photo',media:`attach://file${i}`}));
        fd.set('media', JSON.stringify(media));
        for(let i=0;i<g.length;i++){
          const f=g[i]; const buf=Buffer.from(await f.arrayBuffer());
          fd.append(`file${i}`, new Blob([buf], {type:f.type||'image/jpeg'}), f.name||`p_${gi+1}_${i+1}.jpg`);
        }
        await fetchTG('/sendMediaGroup',{ method:'POST', body:fd });
        if(gi<groups.length-1) await sleep(1500);
      }
      return NextResponse.json({ok:true});
    }catch{
      // fallback по одному
      for(let i=0;i<files.length;i++){
        const f=files[i]; const fd=new FormData();
        fd.set('chat_id',CHAT_ID); fd.set('reply_to_message_id', String(replyTo)); fd.set('allow_sending_without_reply','true');
        if (TOPIC_ANCHOR) fd.set('message_thread_id', String(TOPIC_ANCHOR));
        const buf=Buffer.from(await f.arrayBuffer());
        fd.append('photo', new Blob([buf], {type:f.type||'image/jpeg'}), f.name||`p_${i+1}.jpg`);
        await fetchTG('/sendPhoto',{ method:'POST', body:fd });
        await sleep(1200);
      }
      return NextResponse.json({ok:true});
    }
  }

  if (phase === 'docs'){
    const replyTo = Number(form.get('replyTo')); if(!replyTo) return NextResponse.json({error:'replyTo required'},{status:400});
    const annual_mode = String(form.get('annual_mode')||'none');
    const reg_mode    = String(form.get('reg_mode')||'none');
    const annual_doc  = (form.get('annual_doc') as unknown as File) || null;
    const reg_doc     = (form.get('reg_doc') as unknown as File) || null;

    async function sendDoc(file:File, caption:string){
      const fd = new FormData();
      fd.set('chat_id', CHAT_ID);
      fd.set('reply_to_message_id', String(replyTo));
      fd.set('allow_sending_without_reply','true');
      if (TOPIC_ANCHOR) fd.set('message_thread_id', String(TOPIC_ANCHOR));
      const buf=Buffer.from(await file.arrayBuffer());
      fd.append('document', new Blob([buf], {type:file.type||'application/octet-stream'}), file.name||'doc');
      if(caption) fd.set('caption', caption);
      await fetchTG('/sendDocument',{ method:'POST', body:fd });
      await sleep(700);
    }

    if(annual_mode==='yes' && annual_doc) await sendDoc(annual_doc,'Annual Inspection');
    if(reg_mode==='yes' && reg_doc) await sendDoc(reg_doc,'Registration');
    return NextResponse.json({ok:true});
  }

  return NextResponse.json({ error:'unknown phase' }, { status:400 });
}
