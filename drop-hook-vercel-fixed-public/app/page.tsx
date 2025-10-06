'use client';

import Image from 'next/image';
import { useState } from 'react';
import { upload } from '@vercel/blob/client';

type SubmitState = { status: 'idle'|'uploading'|'sending'|'done'|'error'; message?: string };

export default function Page() {
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  const [files, setFiles] = useState<(File|null)[]>(Array(10).fill(null));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    // обязательные поля текста
    const required = ['event_type','truck_number','driver_first','driver_last'];
    for (const k of required) {
      if (!fd.get(k)) { setState({status:'error', message:`Заполни поле: ${k}`}); return; }
    }

    // обязательные 10 фото
    const local: File[] = [];
    for (let i=0;i<10;i++) {
      const f = files[i];
      if (!f) { setState({status:'error', message:`Добавь фото #${i+1}`}); return; }
      local.push(f);
    }

    try {
      setState({status:'uploading', message:'Загрузка фото…'});
      const urls: string[] = [];
      for (let i=0;i<10;i++) {
        const f = local[i]!;
        const res = await upload(
          `drops/${Date.now()}_${i+1}_${f.name}`,
          f,
          {
            access: 'public',
            handleUploadUrl: '/api/upload',
          }
        );
        urls.push(res.url);
      }

      setState({status:'sending', message:'Отправка письма…'});
      const payload = {
        event_type: String(fd.get('event_type')),
        truck_number: String(fd.get('truck_number')),
        driver_first: String(fd.get('driver_first')),
        driver_last: String(fd.get('driver_last')),
        trailer_pick: String(fd.get('trailer_pick')||''),
        trailer_drop: String(fd.get('trailer_drop')||''),
        notes: String(fd.get('notes')||''),
        photo_urls: urls,
      };
      const resp = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setState({status:'done', message:'Готово — письмо отправлено.'});
      form.reset(); setFiles(Array(10).fill(null));
    } catch (err:any) {
      setState({status:'error', message: err?.message || 'Ошибка отправки'});
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="logo">
          <Image src="/logo.png" alt="USTEAM" width={40} height={40} priority />
          <div className="brand">USTEAM — Drop / Hook</div>
        </div>

        <h1 className="title">Drop / Hook</h1>
        <p className="lead">
          Отправьте фото трейлера со всех сторон, все колёса, изнутри и снаружи.
          <b> Все 10 обязательны.</b>
        </p>

        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="field">
              <label>Тип</label>
              <select name="event_type" required defaultValue="Hook">
                <option value="Hook">Hook</option>
                <option value="Drop">Drop</option>
              </select>
            </div>

            <div className="field">
              <label>Truck #</label>
              <input type="text" name="truck_number" inputMode="numeric" placeholder="Напр. 1234" required/>
            </div>

            <div className="field">
              <label>Имя</label>
              <input type="text" name="driver_first" placeholder="Имя" required/>
            </div>

            <div className="field">
              <label>Фамилия</label>
              <input type="text" name="driver_last" placeholder="Фамилия" required/>
            </div>

            <div className="field">
              <label>Берёт трейлер</label>
              <input type="text" name="trailer_pick" placeholder="TRL5678"/>
            </div>

            <div className="field">
              <label>Оставляет трейлер</label>
              <input type="text" name="trailer_drop" placeholder="TRL4321"/>
            </div>

            <div className="field field--full">
              <label>Примечания</label>
              <textarea name="notes" placeholder="Повреждения, особенности и т.д."></textarea>
            </div>
          </div>

          <div className="photos">
            <div className="photos-note">Загрузите 10 фото (камера откроется сразу)</div>
            <div className="photos-grid">
              {Array.from({length:10}).map((_,i)=>(
                <div className="photo-input" key={i}>
                  <span className="photo-index">{i+1}</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    required
                    onChange={(e)=>{
                      const f = e.target.files?.[0]||null;
                      const clone = [...files]; clone[i]=f; setFiles(clone);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <button className="btn-primary btn-full" type="submit" disabled={state.status==='uploading'||state.status==='sending'}>
            {state.status==='uploading'?'Загрузка…': state.status==='sending'?'Отправка…':'Отправить'}
          </button>
        </form>

        {state.status==='done' && <p className="success">Готово ✔ Письмо отправлено.</p>}
        {state.status==='error' && <p className="error">Ошибка: {state.message}</p>}

        <div className="footer">
          <em>“It's our duty to lead people to the light”</em><br/>— D. Miller
        </div>
      </div>
    </div>
  );
}
