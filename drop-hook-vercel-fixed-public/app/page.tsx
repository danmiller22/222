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
  }
} as const;

/** Клиентское сжатие: long edge 1600px, JPEG ~0.75 */
async function compressImage(file: File, maxDim = 1600, quality = 0.75): Promise<File> {
  const img = document.createElement('img');
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('image load failed'));
      img.src = url;
    });
    let { width, height } = img;
    if (Math.max(width, height) > maxDim) {
      if (width >= height) {
        const k = maxDim / width;
        width = maxDim;
        height = Math.round(height * k);
      } else {
        const k = maxDim / height;
        height = maxDim;
        width = Math.round(width * k);
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas ctx');
    ctx.drawImage(img, 0, 0, width, height);
    const blob: Blob = await new Promise((res) => canvas.toBlob(b => res(b as Blob), 'image/jpeg', quality));
    return new File([blob], (file.name?.replace(/\.[^.]+$/,'') || 'photo') + '.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Page() {
  const [lang, setLang] = useState<Lang>('ru');
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  const [files, setFiles] = useState<File[]>([]);

  useEffect(()=>{ const s = localStorage.getItem('lang') as Lang|null; if (s) setLang(s); },[]);
  useEffect(()=>{ localStorage.setItem('lang', lang); },[lang]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = STR[lang];
    const form = e.currentTarget;
    const fd = new FormData(form);

    const required = ['event_type','truck_number','driver_first','driver_last'];
    for (const k of required) {
      if (!fd.get(k)) { setState({status:'error', message:t.needField(k)}); return; }
    }

    // минимум 8 фото, верхнего предела нет
    if (files.length < 8) {
      setState({status:'error', message:t.must10(files.length)}); // текст не меняем
      return;
    }

    try {
      setState({status:'sending', message:t.sending});
      const payload = new FormData();
      payload.set('lang', lang);
      payload.set('event_type', String(fd.get('event_type')));
      payload.set('truck_number', String(fd.get('truck_number')));
      payload.set('driver_first', String(fd.get('driver_first')));
      payload.set('driver_last', String(fd.get('driver_last')));
      payload.set('trailer_pick', String(fd.get('trailer_pick') || STR[lang].none));
      payload.set('trailer_drop', String(fd.get('trailer_drop') || STR[lang].none));
      payload.set('notes', String(fd.get('notes') || ''));

      files.forEach((f, i) => payload.append('photos', f, f.name || `photo_${i+1}.jpg`));

      const resp = await fetch('/api/submit', { method: 'POST', body: payload });
      if (!resp.ok) throw new Error(await resp.text());

      setState({status:'done', message:t.done});
      form.reset(); setFiles([]);
    } catch (err:any) {
      setState({status:'error', message: err?.message || STR[lang].err});
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? Array.from(e.target.files) : [];
    if (list.length === 0) { setFiles([]); setState({status:'idle'}); return; }

    // сжимаем все выбранные фото перед отправкой
    setState({status:'compressing', message: lang==='ru' ? 'Сжатие фото…' : 'Compressing photos…'});
    try {
      const compressed: File[] = [];
      for (const f of list) {
        // только изображения — на всякий
        if (!f.type.startsWith('image/')) continue;
        const cf = await compressImage(f, 1600, 0.75);
        compressed.push(cf);
      }
      setFiles(compressed);
      // валидация на минимум 8
      if (compressed.length < 8) setState({status:'error', message: STR[lang].must10(compressed.length)});
      else setState({status:'idle', message: undefined});
    } catch {
      setFiles([]);
      setState({status:'error', message: lang==='ru' ? 'Ошибка сжатия фото' : 'Image compression error'});
    }
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

          {/* Apple-like segmented control */}
          <div className="lang-toggle" role="group" aria-label="Language">
            <button
              type="button"
              className={`seg ${lang==='ru' ? 'active' : ''}`}
              onClick={() => setLang('ru')}
              aria-pressed={lang==='ru'}
            >
              RU
            </button>
            <button
              type="button"
              className={`seg ${lang==='en' ? 'active' : ''}`}
              onClick={() => setLang('en')}
              aria-pressed={lang==='en'}
            >
              EN
            </button>
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
          </div>

          <div className="photos">
            <div className="photos-note">{t.choose10}</div>
            <ul className="angles">
              {t.angles.map((txt, i)=>(<li key={i}>{i+1}. {txt}</li>))}
            </ul>

            <div className="picker">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={onPick}
                aria-label="Select photos"
              />
              <div className="hint">
                {t.chosen(files.length)}
                {state.status==='compressing' ? (lang==='ru' ? ' • сжимаем…' : ' • compressing…') : null}
              </div>
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
