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
    droptr: 'Trailer dropped (Напишите номер трейлера. Если нет — напишите <b>нет</b>)',
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
    locHint: 'Дайте разрешение на локацию',
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
    locHint: 'Allow location access',
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

  // ====== ЛОКАЦИЯ (фикс) ======
  async function getLocation() {
    setGeo(g => ({ ...g, status: 'getting' }));

    // Нет API
    if (!('geolocation' in navigator)) {
      setGeo(g => ({ ...g, status: 'err' }));
      setState({ status: 'error', message: STR[lang].locErr });
      return;
    }

    // Если явный deny — сразу подсказка
    try {
      const perm = (navigator.permissions as any)?.query
        ? await (navigator.permissions as any).query({ name: 'geolocation' as PermissionName })
        : null;
      if (perm && perm.state === 'denied') {
        setGeo(g => ({ ...g, status: 'err' }));
        setState({ status: 'error', message: STR[lang].locHint });
        return;
      }
    } catch { /* ignore */ }

    const once = (opts: PositionOptions) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, opts);
      });

    const watchOnce = (opts: PositionOptions, timeoutMs = 12000) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        let done = false;
        const id = navigator.geolocation.watchPosition(
          pos => {
            if (done) return;
            done = true;
            navigator.geolocation.clearWatch(id);
            resolve(pos);
          },
          err => {
            if (done) return;
            done = true;
            navigator.geolocation.clearWatch(id);
            reject(err);
          },
          opts
        );
        setTimeout(() => {
          if (done) return;
          done = true;
          navigator.geolocation.clearWatch(id);
          reject(new Error('watchPosition timeout'));
        }, timeoutMs);
      });

    try {
      // Быстро берём первый успешный фикс
      const pos = await Promise.race([
        once({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }),
        watchOnce({ enableHighAccuracy: true, maximumAge: 0 }, 12000),
      ]);
      const { latitude, longitude, accuracy } = pos.coords;
      setGeo({ lat: latitude, lon: longitude, acc: accuracy ?? undefined, status: 'ok' });
      setState(s => (s.status === 'error' ? { status: 'idle' } : s));
    } catch {
      // Вторая попытка — мягче
      try {
        const pos2 = await once({ enableHighAccuracy: false, timeout: 15000, maximumAge: 0 });
        const { latitude, longitude, accuracy } = pos2.coords;
        setGeo({ lat: latitude, lon: longitude, acc: accuracy ?? undefined, status: 'ok' });
        setState(s => (s.status === 'error' ? { status: 'idle' } : s));
      } catch {
        setGeo(g => ({ ...g, status: 'err' }));
        setState({ status: 'error', message: STR[lang].locHint });
      }
    }
  }

  // ====== SUBMIT ======
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = STR[lang];
    const form = e.currentTarget;
    const fd = new FormData(form);

    // Обязательные поля
    const required = ['event_type','truck_number','driver_first','driver_last'];
    for (const k of required) {
      if (!fd.get(k)) { setState({status:'error', message:t.needField(k)}); return; }
    }

    // Фото: минимум 8, максимум 20
    if (files.length < 8) {
      setState({status:'error', message: lang==='ru'
        ? `Мало фото: ${files.length}. Нужно минимум 8.`
        : `Too few photos: ${files.length}. Minimum is 8.`});
      return;
    }
    if (files.length > 20) {
      setState({status:'error', message: lang==='ru'
        ? `Слишком много фото: ${files.length}. Максимум 20.`
        : `Too many photos: ${files.length}. Max is 20.`});
      return;
    }

    // Локация обязательна
    if (geo.status !== 'ok' || typeof geo.lat !== 'number' || typeof geo.lon !== 'number') {
      setState({status:'error', message: STR[lang].locHint});
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

      // локация обязательна
      payload.set('geo_lat', String(geo.lat));
      payload.set('geo_lon', String(geo.lon));
      if (geo.acc) payload.set('geo_acc', String(Math.round(geo.acc)));

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
    // Сообщения — без изменения интерфейса
    if (list.length < 8) {
      setState({status:'error', message: STR[lang] === STR.ru
        ? `Мало фото: ${list.length}. Нужно минимум 8.`
        : `Too few photos: ${list.length}. Minimum is 8.`});
    } else if (list.length > 20) {
      setState({status:'error', message: STR[lang] === STR.ru
        ? `Слишком много фото: ${list.length}. Максимум 20.`
        : `Too many photos: ${list.length}. Max is 20.`});
    } else {
      setState({status:'idle', message: undefined});
    }
  }

  const t = STR[lang];
  // Кнопку не блокируем из-за гео, чтобы при попытке сабмита вывести ошибку
  const submitBlocked = state.status==='sending' || state.status==='compressing';

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

            {/* Локация — обязательна (кнопка и подсказки — как были) */}
            <div className="field field--full">
              <label>{t.locBtn}</label>
              <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
                <button
                  type="button"
                  className={`loc-btn ${geo.status==='ok' ? 'ok' : ''}`}
                  onClick={getLocation}
                  disabled={geo.status==='getting'}
                >
                  {geo.status==='getting' ? (lang==='ru'?t.locGetting:t.locGetting) : t.locBtn}
                </button>
                {geo.status==='ok' && (
                  <span className="hint">
                    📍 {geo.lat?.toFixed(5)}, {geo.lon?.toFixed(5)} {geo.acc ? `(~${Math.round(geo.acc)}m)` : ''} — {lang==='ru'? t.locOK : t.locOK}
                  </span>
                )}
                {geo.status!=='ok' && (
                  <span className="soft-hint">{t.locHint}</span>
                )}
              </div>
            </div>
          </div>

          <div className="photos">
            <div className="photos-note">{t.choose10}</div>
            <ul className="angles">
              {t.angles.map((txt, i)=>(<li key={i}>{i+1}. {txt}</li>))}
            </ul>

            <div className="picker">
              <input type="file" accept="image/*" multiple onChange={onPick} aria-label="Select photos (8–20)" />
              <div className="hint">{t.chosen(files.length)}</div>
            </div>
          </div>

          <button
            className="btn-primary btn-full"
            type="submit"
            disabled={submitBlocked}
            style={state.status==='done' ? { background:'#18b663', cursor:'default' } : undefined}
            aria-disabled={submitBlocked}
          >
            {state.status==='sending'
              ? STR[lang].sending
              : state.status==='done'
                ? (lang==='ru' ? 'Отправлено' : 'Sent')
                : STR[lang].send}
          </button>
        </form>

        {state.status==='done' && <p className="success">{STR[lang].done}</p>}
        {state.status==='error' && <p className="error">{state.message}</p>}

        <div className="footer">
          <em>“It's our duty to lead people to the light”</em><br/>— D. Miller
        </div>
      </div>

      {/* Кнопка локации и подсказки — внешний вид не менял */}
      <style jsx global>{`
        .loc-btn{
          -webkit-tap-highlight-color: transparent;
          appearance: none;
          border: 0;
          outline: none;
          padding: 10px 16px;
          border-radius: 9999px;
          background: linear-gradient(180deg, #ffffff, #f4f4f6);
          box-shadow:
            0 1px 0 rgba(0,0,0,0.06),
            inset 0 0 0 0.5px rgba(0,0,0,0.08);
          color: #111;
          font-weight: 600;
          font-size: 14px;
          letter-spacing: .2px;
          transition: transform .06s ease, box-shadow .2s ease, background .2s ease;
        }
        .loc-btn:hover{ box-shadow:
            0 2px 6px rgba(0,0,0,0.08),
            inset 0 0 0 0.5px rgba(0,0,0,0.10); }
        .loc-btn:active{ transform: translateY(1px); }
        .loc-btn.ok{
          background: linear-gradient(180deg, #e9f9ef, #d9f3e5);
          box-shadow:
            0 1px 0 rgba(0,0,0,0.05),
            inset 0 0 0 0.5px rgba(24,182,99,0.55);
          color: #127a45;
        }
        .soft-hint{
          color: #6b7280;
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}
