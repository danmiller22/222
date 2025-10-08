'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

type SubmitState = { status: 'idle'|'compressing'|'sending'|'done'|'error'; message?: string };
type Lang = 'ru' | 'en';

const STR = {
  ru: {
    brand: 'US Team Fleet',
    title: 'Drop / Hook',
    policy:
      'Каждый водитель обязан отправлять фото, когда берет (Hook) или оставляет (Drop) трейлер — во избежание штрафов! За невыполнение - штраф $150!',
    type: 'Тип',
    hook: 'Hook',
    drop: 'Drop',
    truck: 'Truck #',
    first: 'Имя',
    last: 'Фамилия',
    pick: 'Берёт трейлер (Напишите номер трейлера. Если нет — напишите <b>нет</b>)',
    droptr: 'Оставляет трейлер (Напишите номер трейлера. Если нет — напишите <b>нет</b>)',
    notes: 'Примечания',
    choose10: 'Выберите минимум 10 фото из галереи. Обязательные ракурсы:',
    chosen: (n:number)=>`Выбрано: ${n} (минимум 10)`,
    send: 'Отправить',
    sending: 'Отправка…',
    done: 'Готово ✔ Письмо отправлено.',
    needField: (k:string)=>`Заполни поле: ${k}`,
    must10: (n:number)=>`Мало фото: ${n}. Нужно минимум 10.`,
    tooBig: 'Суммарный размер фото >24MB. Снимайте меньшим размером.',
    err: 'Ошибка отправки',
    angles: [
      'Номер трейлера',
      'Все колёса',
      'Внутрь трейлера',
      'Углы',
      'Потолки',
      'Двери',
      'Левая сторона снаружи',
      'Правая сторона снаружи',
      'Передняя часть снаружи',
      'Розетки',
    ],
    none: 'нет',
    locBtn: 'Локация',
    locGetting: 'Получаем…',
    locOK: 'Локация добавлена',
    locErr: 'Локация недоступна',
  },
  en: {
    brand: 'US Team Fleet',
    title: 'Drop / Hook',
    policy:
      'Every driver must submit photos when hooking (Hook) or dropping (Drop) a trailer — in order to avoid charges! For missing report - charge $150!',
    type: 'Type',
    hook: 'Hook',
    drop: 'Drop',
    truck: 'Truck #',
    first: 'First name',
    last: 'Last name',
    pick: 'Trailer picked (if none — write <b>none</b>)',
    droptr: 'Trailer dropped (if none — write <b>none</b>)',
    notes: 'Notes',
    choose10: 'Select at least 10 photos from gallery. Mandatory angles:',
    chosen: (n:number)=>`Selected: ${n} (min 10)`,
    send: 'Send',
    sending: 'Sending…',
    done: 'Done ✔ Email sent.',
    needField: (k:string)=>`Fill the field: ${k}`,
    must10: (n:number)=>`Too few photos: ${n}. Minimum is 10.`,
    tooBig: 'Total photo size >24MB. Use smaller images.',
    err: 'Submit error',
    angles: [
      'Trailer number',
      'All tires',
      'Inside the trailer',
      'Corners',
      'Roof',
      'Doors',
      'Left side (outside)',
      'Right side (outside)',
      'Front side (outside)',
      'Sockets',
    ],
    none: 'none',
    locBtn: 'Location',
    locGetting: 'Getting…',
    locOK: 'Location attached',
    locErr: 'Location unavailable',
  }
} as const;

/** Усиленный компрессор (~300KB/фото), JPEG */
async function compressImageAdaptive(
  file: File,
  {
    startMaxDim = 1024,
    minMaxDim = 640,
    stepDim = 160,
    startQ = 0.50,
    minQ = 0.30,
    stepQ = 0.05,
    targetBytes = 300 * 1024,
  }: Partial<{
    startMaxDim: number; minMaxDim: number; stepDim: number;
    startQ: number; minQ: number; stepQ: number; targetBytes: number;
  }> = {}
): Promise<File> {
  const img = document.createElement('img');
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('image load failed'));
      img.src = url;
    });

    let attemptMaxDim = startMaxDim;
    let attemptQ = startQ;

    const render = (maxDim: number, q: number): Promise<Blob> => {
      let { width, height } = img;
      if (Math.max(width, height) > maxDim) {
        if (width >= height) { const k = maxDim / width; width = maxDim; height = Math.round(height * k); }
        else { const k = maxDim / height; height = maxDim; width = Math.round(width * k); }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      return new Promise<Blob>((resolve) => {
        canvas.toBlob(b => resolve(b as Blob), 'image/jpeg', q);
      });
    };

    for (let safe = 0; safe < 50; safe++) {
      const blob = await render(attemptMaxDim, attemptQ);
      if (blob.size <= targetBytes || (attemptMaxDim <= minMaxDim && attemptQ <= minQ)) {
        return new File([blob], (file.name?.replace(/\.[^.]+$/,'') || 'photo') + '.jpg', { type: 'image/jpeg' });
      }
      if (attemptQ - stepQ >= minQ) {
        attemptQ = Number((attemptQ - stepQ).toFixed(2));
      } else if (attemptMaxDim - stepDim >= minMaxDim) {
        attemptQ = startQ;
        attemptMaxDim -= stepDim;
      } else {
        return new File([blob], (file.name?.replace(/\.[^.]+$/,'') || 'photo') + '.jpg', { type: 'image/jpeg' });
      }
    }
    const fallbackBlob = await render(minMaxDim, minQ);
    return new File([fallbackBlob], (file.name?.replace(/\.[^.]+$/,'') || 'photo') + '.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Page() {
  const [lang, setLang] = useState<Lang>('ru');
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  const [files, setFiles] = useState<File[]>([]);
  const [geo, setGeo] = useState<{lat?:number; lon?:number; acc?:number; status:'idle'|'getting'|'ok'|'err'}>({status:'idle'});

  useEffect(()=>{ const s = localStorage.getItem('lang') as Lang|null; if (s) setLang(s); },[]);
  useEffect(()=>{ localStorage.setItem('lang', lang); },[lang]);

  async function getLocation() {
    if (!navigator.geolocation) { setGeo(g=>({...g,status:'err'})); return; }
    setGeo(g=>({...g,status:'getting'}));
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        setGeo({ lat: latitude, lon: longitude, acc: accuracy ?? undefined, status: 'ok' });
      },
      _err => setGeo(g=>({...g,status:'err'})),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = STR[lang];
    const form = e.currentTarget;
    const fd = new FormData(form);

    const required = ['event_type','truck_number','driver_first','driver_last'];
    for (const k of required) {
      if (!fd.get(k)) { setState({status:'error', message:t.needField(k)}); return; }
    }

    if (files.length < 8) { setState({status:'error', message:t.must10(files.length)}); return; }
    if (files.length > 13) {
      setState({status:'error', message: lang==='ru'
        ? `Слишком много фото: ${files.length}. Максимум 13.`
        : `Too many photos: ${files.length}. Max is 13.`});
      return;
    }

    try {
      setState({status:'compressing', message: lang==='ru' ? 'Сжатие фото…' : 'Compressing photos…'});
      const compressed: File[] = [];
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        compressed.push(
          await compressImageAdaptive(f, {
            startMaxDim: 1024, minMaxDim: 640, stepDim: 160,
            startQ: 0.50, minQ: 0.30, stepQ: 0.05,
            targetBytes: 300 * 1024,
          })
        );
      }

      const payload = new FormData();
      payload.set('lang', lang);
      payload.set('event_type', String(fd.get('event_type')));
      payload.set('truck_number', String(fd.get('truck_number')));
      payload.set('driver_first', String(fd.get('driver_first')));
      payload.set('driver_last', String(fd.get('driver_last')));
      payload.set('trailer_pick', String(fd.get('trailer_pick') || STR[lang].none));
      payload.set('trailer_drop', String(fd.get('trailer_drop') || STR[lang].none));
      payload.set('notes', String(fd.get('notes') || ''));

      // гео опционально
      if (geo.lat && geo.lon) {
        payload.set('geo_lat', String(geo.lat));
        payload.set('geo_lon', String(geo.lon));
        if (geo.acc) payload.set('geo_acc', String(Math.round(geo.acc)));
      }

      compressed.forEach((f, i) => payload.append('photos', f, f.name || `photo_${i+1}.jpg`));

      setState({status:'sending', message:t.sending});
      const resp = await fetch('/api/submit', { method: 'POST', body: payload });
      if (!resp.ok) throw new Error(await resp.text());

      setState({status:'done', message:t.done});
      form.reset(); setFiles([]);
    } catch (err:any) {
      setState({status:'error', message: err?.message || STR[lang].err});
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? Array.from(e.target.files) : [];
    setFiles(list);
    if (list.length < 8) setState({status:'error', message:STR[lang].must10(list.length)});
    else if (list.length > 13) setState({status:'error', message: lang==='ru'
      ? `Слишком много фото: ${list.length}. Максимум 13.`
      : `Too many photos: ${list.length}. Max is 13.`});
    else setState({status:'idle', message: undefined});
  }

  const t = STR[lang];

  return (
    <div className="container">
      <div className="card">
        <div className="logo" style={{justifyContent:'space-between', alignItems:'center'}}>
          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <Image src="/logo.png" alt="US Team Fleet" width={40} height={40} priority />
            <div className="brand">{t.brand}</div>
          </div>
          <div className="lang-toggle" role="group" aria-label="Language">
            <button type="button" className={`seg ${lang==='ru' ? 'active' : ''}`} onClick={() => setLang('ru')} aria-pressed={lang==='ru'}>RU</button>
            <button type="button" className={`seg ${lang==='en' ? 'active' : ''}`} onClick={() => setLang('en')} aria-pressed={lang==='en'}>EN</button>
          </div>
        </div>

        <h1 className="title">{t.title}</h1>
        <p className="lead">{t.policy}</p>

        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="field">
              <label>{t.type}</label>
              <select name="event_type" required defaultValue="Hook">
                <option value="Hook">{t.hook}</option>
                <option value="Drop">{t.drop}</option>
              </select>
            </div>

            <div className="field">
              <label>{t.truck}</label>
              <input type="text" name="truck_number" inputMode="numeric" />
            </div>

            <div className="field">
              <label>{t.first}</label>
              <input type="text" name="driver_first" />
            </div>

            <div className="field">
              <label>{t.last}</label>
              <input type="text" name="driver_last" />
            </div>

            <div className="field">
              <label dangerouslySetInnerHTML={{__html:t.pick}} />
              <input type="text" name="trailer_pick" />
            </div>

            <div className="field">
              <label dangerouslySetInnerHTML={{__html:t.droptr}} />
              <input type="text" name="trailer_drop" />
            </div>

            <div className="field field--full">
              <label>{t.notes}</label>
              <textarea name="notes"></textarea>
            </div>

            {/* Локация — компактная кнопка */}
            <div className="field field--full">
              <label>{t.locBtn}</label>
              <div style={{display:'flex', gap:8, alignItems:'center'}}>
                <button type="button" className="seg" onClick={getLocation} disabled={geo.status==='getting'}>
                  {geo.status==='getting' ? (lang==='ru'?t.locGetting:t.locGetting) : t.locBtn}
                </button>
                {geo.status==='ok' && (
                  <span className="hint">
                    📍 {geo.lat?.toFixed(5)}, {geo.lon?.toFixed(5)} {geo.acc ? `(~${Math.round(geo.acc)}m)` : ''}
                    &nbsp;— {lang==='ru'? t.locOK : t.locOK}
                  </span>
                )}
                {geo.status==='err' && <span className="error">{t.locErr}</span>}
              </div>
            </div>
          </div>

          <div className="photos">
            <div className="photos-note">{t.choose10}</div>
            <ul className="angles">
              {t.angles.map((txt, i)=>(<li key={i}>{i+1}. {txt}</li>))}
            </ul>

            <div className="picker">
              <input type="file" accept="image/*" multiple onChange={onPick} aria-label="Select photos (8–13)" />
              <div className="hint">{t.chosen(files.length)}</div>
            </div>
          </div>

          <button
            className="btn-primary btn-full"
            type="submit"
            disabled={state.status==='sending' || state.status==='compressing'}
            style={state.status==='done' ? { background:'#18b663', cursor:'default' } : undefined}
          >
            {state.status==='sending'
              ? t.sending
              : state.status==='done'
                ? (lang==='ru' ? 'Отправлено' : 'Sent')
                : t.send}
          </button>
        </form>

        {state.status==='done' && <p className="success">{t.done}</p>}
        {state.status==='error' && <p className="error">{state.message}</p>}

        <div className="footer">
          <em>“It's our duty to lead people to the light”</em><br/>— D. Miller
        </div>
      </div>
    </div>
  );
}
