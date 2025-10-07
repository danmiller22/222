'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

type SubmitState = { status: 'idle'|'sending'|'done'|'error'; message?: string };
type Lang = 'ru' | 'en';

const STR = {
  ru: {
    brand: 'US Team Fleet',
    title: 'Drop / Hook',
    policy: 'Каждый водитель обязан отправлять фото, когда берет и/или оставляет трейлер — иначе будут штрафы. Нужно загрузить ровно 10 фото по списку ниже.',
    type: 'Тип',
    hook: 'Hook',
    drop: 'Drop',
    truck: 'Truck #',
    first: 'Имя водителя',
    last: 'Фамилия водителя',
    pick: 'Берёт трейлер (если нет — напишите нет)',
    droptr: 'Оставляет трейлер (если нет — напишите нет)',
    notes: 'Примечания',
    choose10: 'Выберите сразу 10 фото из галереи. Обязательные ракурсы:',
    chosen: (n:number)=>`Выбрано: ${n} из 10`,
    send: 'Отправить',
    sending: 'Отправка…',
    done: 'Готово ✔ Письмо отправлено.',
    needField: (k:string)=>`Заполни поле: ${k}`,
    must10: (n:number)=>`Выбери ровно 10 фото. Сейчас: ${n}`,
    tooBig: 'Суммарный размер фото >24MB. Сделай снимки меньшего размера.',
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
    policy: 'Every driver must submit photos when hooking or dropping a trailer — charges will apply otherwise. Upload 10 photos as listed below.',
    type: 'Type',
    hook: 'Hook',
    drop: 'Drop',
    truck: 'Truck #',
    first: 'First name',
    last: 'Last name',
    pick: 'Trailer picked (if none — write none)',
    droptr: 'Trailer dropped (if none — write none)',
    notes: 'Notes',
    choose10: 'Select exactly 10 photos from gallery. Recommended angles:',
    chosen: (n:number)=>`Selected: ${n} / 10`,
    send: 'Send',
    sending: 'Sending…',
    done: 'Done ✔ Email sent.',
    needField: (k:string)=>`Fill the field: ${k}`,
    must10: (n:number)=>`Select exactly 10 photos. Now: ${n}`,
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
      'Plugs/Sockets',
    ],
    none: 'none',
  }
} as const;

export default function Page() {
  const [lang, setLang] = useState<Lang>('ru');
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  const [files, setFiles] = useState<File[]>([]);

  // запоминаем язык локально
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
    if (files.length !== 10) { setState({status:'error', message:t.must10(files.length)}); return; }

    const totalBytes = files.reduce((s,f)=>s+f.size, 0);
    if (totalBytes > 24 * 1024 * 1024) { setState({status:'error', message:t.tooBig}); return; }

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

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? Array.from(e.target.files) : [];
    setFiles(list);
    if (list.length !== 10) setState({status:'error', message:STR[lang].must10(list.length)});
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
          <div style={{display:'flex', gap:6}}>
            <button type="button" className="btn-secondary" onClick={()=>setLang('ru')} aria-pressed={lang==='ru'}>RU</button>
            <button type="button" className="btn-secondary" onClick={()=>setLang('en')} aria-pressed={lang==='en'}>EN</button>
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
              <input type="text" name="truck_number" inputMode="numeric" placeholder="263" required />
            </div>

            <div className="field">
              <label>{t.first}</label>
              <input type="text" name="driver_first" placeholder="" required />
            </div>

            <div className="field">
              <label>{t.last}</label>
              <input type="text" name="driver_last" placeholder="" required />
            </div>

            <div className="field">
              <label dangerouslySetInnerHTML={{__html:t.pick}} />
              <input type="text" name="trailer_pick" placeholder={STR[lang].none} />
            </div>

            <div className="field">
              <label dangerouslySetInnerHTML={{__html:t.droptr}} />
              <input type="text" name="trailer_drop" placeholder={STR[lang].none} />
            </div>

            <div className="field field--full">
              <label>{t.notes}</label>
              <textarea name="notes" placeholder=""></textarea>
            </div>
          </div>

          <div className="photos">
            <div className="photos-note">{t.choose10}</div>
            <ul className="angles">
              {t.angles.map((txt, i)=>(<li key={i}>{i+1}. {txt}</li>))}
            </ul>

            <div className="picker">
              <input type="file" accept="image/*" multiple onChange={onPick} aria-label="Select 10 photos" />
              <div className="hint">{t.chosen(files.length)}</div>
            </div>
          </div>

          <button className="btn-primary btn-full" type="submit" disabled={state.status==='sending'}>
            {state.status==='sending' ? t.sending : t.send}
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
