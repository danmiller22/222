'use client';

import Image from 'next/image';
import { useState } from 'react';

type SubmitState = { status: 'idle'|'sending'|'done'|'error'; message?: string };

const ANGLES = [
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
];

export default function Page() {
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  const [files, setFiles] = useState<File[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    // обязательные поля
    const required = ['event_type','truck_number','driver_first','driver_last'];
    for (const k of required) {
      if (!fd.get(k)) { setState({status:'error', message:`Заполни поле: ${k}`}); return; }
    }

    // ровно 10 фото
    if (files.length !== 10) {
      setState({status:'error', message:`Выбери ровно 10 фото. Сейчас: ${files.length}`});
      return;
    }

    // лимит размера (≈ 24 МБ)
    const totalBytes = files.reduce((s,f)=>s+f.size, 0);
    if (totalBytes > 24 * 1024 * 1024) {
      setState({status:'error', message:'Суммарный размер фото >24MB. Сделай снимки меньшего размера.'});
      return;
    }

    try {
      setState({status:'sending', message:'Отправка…'});
      const payload = new FormData();
      payload.set('event_type', String(fd.get('event_type')));
      payload.set('truck_number', String(fd.get('truck_number')));
      payload.set('driver_first', String(fd.get('driver_first')));
      payload.set('driver_last', String(fd.get('driver_last')));
      payload.set('trailer_pick', String(fd.get('trailer_pick') || 'нет'));
      payload.set('trailer_drop', String(fd.get('trailer_drop') || 'нет'));
      payload.set('notes', String(fd.get('notes') || ''));

      files.forEach((f, i) => payload.append('photos', f, f.name || `photo_${i+1}.jpg`));

      const resp = await fetch('/api/submit', { method: 'POST', body: payload });
      if (!resp.ok) throw new Error(await resp.text());

      setState({status:'done', message:'Готово — письмо отправлено.'});
      form.reset(); setFiles([]);
    } catch (err:any) {
      setState({status:'error', message: err?.message || 'Ошибка отправки'});
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? Array.from(e.target.files) : [];
    setFiles(list);
    if (list.length !== 10) {
      setState({status:'error', message:`Нужно ровно 10 фото. Сейчас: ${list.length}`});
    } else {
      setState({status:'idle'});
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="logo">
          <Image src="/logo.png" alt="US Team Fleet" width={40} height={40} priority />
          <div className="brand">US Team Fleet</div>
        </div>

        <h1 className="title">Drop / Hook</h1>
        <p className="lead">
          Каждый водитель обязан отправлять фото при <b>взятии</b> или <b>оставлении</b> трейлера —
          иначе будут штрафы. Нужно загрузить <b>ровно 10 фото</b> по списку ниже.
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
              <input type="text" name="truck_number" inputMode="numeric" placeholder="Напр. 263" required />
            </div>

            <div className="field">
              <label>Имя</label>
              <input type="text" name="driver_first" placeholder="Имя" required />
            </div>

            <div className="field">
              <label>Фамилия</label>
              <input type="text" name="driver_last" placeholder="Фамилия" required />
            </div>

            <div className="field">
              <label>Берёт трейлер (если нет — напишите <b>нет</b>)</label>
              <input type="text" name="trailer_pick" placeholder="напр. H12467 или нет" />
            </div>

            <div className="field">
              <label>Оставляет трейлер (если нет — напишите <b>нет</b>)</label>
              <input type="text" name="trailer_drop" placeholder="напр. H12468 или нет" />
            </div>

            <div className="field field--full">
              <label>Примечания</label>
              <textarea name="notes" placeholder="Повреждения, особенности и т.д."></textarea>
            </div>
          </div>

          <div className="photos">
            <div className="photos-note">
              Выберите сразу <b>10 фото</b> из галереи. Рекомендуемые ракурсы:
            </div>
            <ul className="angles">
              {ANGLES.map((t,i)=>(<li key={i}>{i+1}. {t}</li>))}
            </ul>

            <div className="picker">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={onPick}
                aria-label="Выберите ровно 10 фото"
              />
              <div className="hint">Выбрано: {files.length} из 10</div>
            </div>
          </div>

          <button className="btn-primary btn-full" type="submit" disabled={state.status==='sending'}>
            {state.status==='sending' ? 'Отправка…' : 'Отправить'}
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
