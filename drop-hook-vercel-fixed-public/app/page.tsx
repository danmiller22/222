'use client';
import Image from 'next/image';
import { useEffect, useState } from 'react';

type SubmitState = { status:'idle'|'sending'|'done'|'error'; message?: string };
type Lang = 'ru'|'en';

const STR = {
  ru:{brand:'US Team Fleet',title:'Drop / Hook',
    policy:'Каждый водитель обязан отправлять фото, когда берет (Hook) или оставляет (Drop) трейлер — во избежание штрафов!',
    type:'Тип',hook:'Hook',drop:'Drop',truck:'Truck #',first:'Имя',last:'Фамилия',
    pick:'Берёт трейлер (Напишите номер трейлера. Если нет — напишите <b>нет</b>)',
    droptr:'Trailer dropped (Напишите номер трейлера. Если нет — напишите <b>нет</b>)',
    notes:'Примечания',
    choose10:'Выберите минимум 8 фото из галереи. Обязательные ракурсы:',
    chosen:(n:number)=>`Выбрано: ${n} (минимум 8, максимум 13)`,
    send:'Отправить',sending:'Отправка…',done:'Отправлено',
    needField:(k:string)=>`Заполни поле: ${k}`,must8:(n:number)=>`Мало фото: ${n}. Нужно минимум 8.`,
    max13:(n:number)=>`Слишком много фото: ${n}. Можно максимум 13.`,
    err:'Ошибка отправки',
    angles:['Номер трейлера','Все колёса','Внутрь трейлера','Углы','Потолки','Двери','Левая сторона снаружи','Правая сторона снаружи','Передняя часть снаружи','Розетки'],
    none:'нет',
    needGeoBtn:'Дать доступ к локации',
    geoOkBtn:'Локация получена',
    needGeoBanner:'Разрешите доступ к локации, чтобы отправить форму',
  },
  en:{brand:'US Team Fleet',title:'Drop / Hook',
    policy:'Every driver must submit photos when hooking (Hook) or dropping (Drop) a trailer — to avoid charges!',
    type:'Type',hook:'Hook',drop:'Drop',truck:'Truck #',first:'First name',last:'Last name',
    pick:'Trailer picked (if none — write <b>none</b>)',
    droptr:'Trailer dropped (if none — write <b>none</b>)',
    notes:'Notes',
    choose10:'Select at least 8 photos from gallery. Mandatory angles:',
    chosen:(n:number)=>`Selected: ${n} (min 8, max 13)`,
    send:'Send',sending:'Sending…',done:'Sent',
    needField:(k:string)=>`Fill the field: ${k}`,must8:(n:number)=>`Too few photos: ${n}. Minimum is 8.`,
    max13:(n:number)=>`Too many photos: ${n}. Maximum is 13.`,
    err:'Submit error',
    angles:['Trailer number','All tires','Inside the trailer','Corners','Roof','Doors','Left side (outside)','Right side (outside)','Front side (outside)','Sockets'],
    none:'none',
    needGeoBtn:'Allow location',
    geoOkBtn:'Location set',
    needGeoBanner:'Please allow location access before sending',
  }
} as const;

/** Агрессивная компрессия ~220KB/фото */
async function compressImageAdaptive(
  file: File,
  opts = { startMaxDim: 960, minMaxDim: 600, stepDim: 120, startQ: 0.5, minQ: 0.28, stepQ: 0.05, targetBytes: 220*1024 }
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      let { startMaxDim, minMaxDim, stepDim, startQ, minQ, stepQ, targetBytes } = opts;
      let maxDim = startMaxDim, q = startQ;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha:false }); if(!ctx) return reject('no canvas');

      while (true) {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width*scale));
        canvas.height= Math.max(1, Math.round(img.height*scale));
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0,canvas.width,canvas.height);

        const blob: Blob = await new Promise(res => canvas.toBlob(b=>res(b as Blob),'image/jpeg', q));
        if (blob.size <= targetBytes || (q <= minQ && maxDim <= minMaxDim)) {
          resolve(new File([blob], (file.name||'img')+'.jpg', { type:'image/jpeg' })); return;
        }
        if (q > minQ) { q = Math.max(minQ, q - stepQ); continue; }
        if (maxDim > minMaxDim) { maxDim = Math.max(minMaxDim, maxDim - stepDim); continue; }
        resolve(new File([blob], (file.name||'img')+'.jpg', { type:'image/jpeg' })); return;
      }
    };
    img.onerror = () => reject('image load error');
    img.src = URL.createObjectURL(file);
  });
}

export default function Page(){
  const [lang,setLang]=useState<Lang>('ru');
  const [state,setState]=useState<SubmitState>({status:'idle'});
  const [files,setFiles]=useState<File[]>([]);
  const [geo,setGeo]=useState<{lat:number,lon:number}|null>(null);
  const [showGeoBanner,setShowGeoBanner]=useState(false);   // баннер «разрешите локацию»
  const [shakeGeo,setShakeGeo]=useState(false);             // лёгкая анимация «потрясти» кнопку

  useEffect(()=>{ const s=localStorage.getItem('lang') as Lang|null; if(s) setLang(s); },[]);
  useEffect(()=>{ localStorage.setItem('lang',lang); },[lang]);

  function askGeo(){
    if(!navigator.geolocation){ pulseGeoWarn(); return; }
    navigator.geolocation.getCurrentPosition(
      p=>{ setGeo({lat:p.coords.latitude, lon:p.coords.longitude}); setShowGeoBanner(false); },
      ()=>{ pulseGeoWarn(); },
      { enableHighAccuracy:true, maximumAge:15000, timeout:15000 }
    );
  }

  function pulseGeoWarn(){
    setGeo(null);
    setShowGeoBanner(true);
    setShakeGeo(true);
    setTimeout(()=>setShakeGeo(false), 500);
  }

  function onPick(e:React.ChangeEvent<HTMLInputElement>){
    const list = e.target.files ? Array.from(e.target.files) : [];
    if(list.length<8) setState({status:'error',message:STR[lang].must8(list.length)});
    else if(list.length>13) setState({status:'error',message:STR[lang].max13(list.length)});
    else setState({status:'idle'});
    setFiles(list.slice(0,13));
  }

  async function onSubmit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const t = STR[lang];
    const fd = new FormData(e.currentTarget);

    for(const k of ['event_type','truck_number','driver_first','driver_last']){
      if(!fd.get(k)){ setState({status:'error',message:t.needField(k)}); return; }
    }
    if(!geo){ pulseGeoWarn(); return; }                 // ← без гео — стоп и показываем баннер
    if(files.length<8){ setState({status:'error',message:t.must8(files.length)}); return; }
    if(files.length>13){ setState({status:'error',message:t.max13(files.length)}); return; }

    try{
      setState({status:'sending',message:t.sending});

      // сжать фото
      const compressed: File[] = [];
      for(const f of files){
        const c = f.type.startsWith('image/') ? await compressImageAdaptive(f) : f;
        compressed.push(c);
      }

      // 1) INIT → replyTo
      const init = new FormData();
      init.set('phase','init');
      init.set('lang',lang);
      ['event_type','truck_number','driver_first','driver_last','notes'].forEach(k=>init.set(k, String(fd.get(k)||'')));
      init.set('trailer_pick', String(fd.get('trailer_pick') || STR[lang].none));
      init.set('trailer_drop', String(fd.get('trailer_drop') || STR[lang].none));
      init.set('geo_lat', String(geo.lat)); init.set('geo_lon', String(geo.lon));

      const r1 = await fetch('/api/submit', { method:'POST', body:init });
      if(!r1.ok) throw new Error(await r1.text());
      const { replyTo } = await r1.json();

      // 2) PHOTOS — кусками ≤10
      const chunk = <T,>(arr:T[], n:number)=>{ const out:T[][]=[]; for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; };
      for(const group of chunk(compressed, 10)){
        const pf = new FormData();
        pf.set('phase','photos'); pf.set('replyTo', String(replyTo));
        group.forEach((f)=>pf.append('photos', f, f.name));
        const rp = await fetch('/api/submit', { method:'POST', body: pf });
        if(!rp.ok) throw new Error(await rp.text());
      }

      setState({status:'done',message:t.done});
    }catch(err:any){
      setState({status:'error',message: err?.message || STR[lang].err});
    }
  }

  const t = STR[lang];
  const canSend = !!geo && state.status!=='sending';

  return (
    <div className="container">
      {/* Apple-like баннер */}
      <div className={`banner ${showGeoBanner?'show':''}`} role="status" aria-live="polite">
        <span>{t.needGeoBanner}</span>
      </div>

      <div className="card">
        <div className="logo" style={{justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <Image src="/logo.png" alt="US Team Fleet" width={40} height={40} priority />
            <div className="brand">{t.brand}</div>
          </div>
          <div className="lang-toggle" role="group" aria-label="Language">
            <button type="button" className={`seg ${lang==='ru'?'active':''}`} onClick={()=>setLang('ru')} aria-pressed={lang==='ru'}>RU</button>
            <button type="button" className={`seg ${lang==='en'?'active':''}`} onClick={()=>setLang('en')} aria-pressed={lang==='en'}>EN</button>
          </div>
        </div>

        <h1 className="title">{t.title}</h1>
        <p className="lead">{t.policy}</p>

        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="field">
              <label>{t.type}</label>
              <select name="event_type" required defaultValue="Hook">
                <option value="Hook">{t.hook}</option><option value="Drop">{t.drop}</option>
              </select>
            </div>
            <div className="field"><label>{t.truck}</label><input type="text" name="truck_number" inputMode="numeric" /></div>
            <div className="field"><label>{t.first}</label><input type="text" name="driver_first" /></div>
            <div className="field"><label>{t.last}</label><input type="text" name="driver_last" /></div>
            <div className="field"><label dangerouslySetInnerHTML={{__html:t.pick}}/><input type="text" name="trailer_pick" /></div>
            <div className="field"><label dangerouslySetInnerHTML={{__html:t.droptr}}/><input type="text" name="trailer_drop" /></div>
            <div className="field field--full"><label>{t.notes}</label><textarea name="notes" /></div>
          </div>

          {/* Локация */}
          <div className="geo">
            <button
              type="button"
              className={`btn-geo ${geo?'ok':''} ${shakeGeo?'shake':''}`}
              onClick={askGeo}
              aria-pressed={!!geo}
            >
              {geo ? t.geoOkBtn : t.needGeoBtn}
            </button>
          </div>

          {/* Фото */}
          <div className="photos">
            <div className="photos-note">{t.choose10}</div>
            <ul className="angles">{t.angles.map((txt,i)=>(<li key={i}>{i+1}. {txt}</li>))}</ul>
            <div className="picker">
              <input type="file" accept="image/*" multiple onChange={onPick} aria-label="Select photos (min 8, max 13)" />
              <div className="hint">{t.chosen(files.length)}</div>
            </div>
          </div>

          <button
            className={`btn-primary btn-full ${state.status==='done'?'btn-done':''}`}
            type="submit"
            disabled={!canSend}
            aria-disabled={!canSend}
            title={!geo ? (lang==='ru'?'Разрешите локацию':'Allow location') : undefined}
          >
            {state.status==='done' ? t.done : state.status==='sending' ? t.sending : t.send}
          </button>
        </form>

        {state.status==='error' && <p className="error">{state.message}</p>}

        <div className="footer"><em>“It's our duty to lead people to the light”</em><br/>— D. Miller</div>
      </div>

      <style jsx>{`
        .banner{
          position: sticky; top: 0; z-index: 50;
          display: flex; justify-content: center;
          transform: translateY(-120%); opacity: 0;
          transition: transform .35s ease, opacity .35s ease;
          pointer-events: none;
        }
        .banner.show{
          transform: translateY(0); opacity: 1;
        }
        .banner > span{
          margin: 8px; padding: 10px 14px;
          border-radius: 14px;
          backdrop-filter: blur(10px);
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.18);
          color: #fff; font-size: 14px;
        }
        .btn-geo{
          border-radius: 12px; padding: 12px 16px;
          background:#111; color:#fff; border:1px solid #333;
          transition: transform .15s ease, background .15s ease, border-color .15s ease;
        }
        .btn-geo.ok{
          background:#0ea5e9; border-color:#38bdf8;   /* голубой как у Apple разрешений */
        }
        .btn-done{ background:#22c55e !important; }
        .shake{ animation: shake .35s ease; }
        @keyframes shake{
          0%{ transform: translateX(0); }
          25%{ transform: translateX(-6px); }
          50%{ transform: translateX(6px); }
          75%{ transform: translateX(-4px); }
          100%{ transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
