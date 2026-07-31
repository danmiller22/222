'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import {
  compressionTargetBytes,
  PHOTO_COMPRESSION_SETTINGS,
} from './lib/photo-compression';

type SubmitState = {
  status: 'idle'|'compressing'|'sending'|'done'|'error';
  message?: string;
  progress?: number;
};
type Lang = 'ru' | 'en';
type TrailerOption = {
  trailerNumber: string;
  provider: 'xtralease' | 'premier';
};

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
    choose10: 'Добавьте минимум 10 фото. Обязательные:',
    addPhotos: 'Добавить фото',
    clearPhotos: 'Очистить',
    chosen: (n:number)=>`Выбрано: ${n} (минимум 10)`,
    send: 'Отправить',
    sending: 'Отправляется…',
    processing: 'Отправляется…',
    done: 'Готово ✓',
    close: 'Закрыть',
    needField: (k:string)=>`Заполни поле: ${k}`,
    must10: (n:number)=>`Мало фото: ${n}. Нужно минимум 10.`,
    tooBig: 'Суммарный размер фото >24MB. Снимайте меньшим размером.',
    err: 'Ошибка отправки',
    angles: [
      'Номер трейлера','Все колёса','Внутрь трейлера','Углы','Потолки',
      'Двери','Левая сторона снаружи','Правая сторона снаружи','Регистрация','Annual Inspection',
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
    choose10: 'Add at least 10 photos. Mandatory:',
    addPhotos: 'Add photos',
    clearPhotos: 'Clear',
    chosen: (n:number)=>`Selected: ${n} (min 10)`,
    send: 'Send',
    sending: 'Sending…',
    processing: 'Sending…',
    done: 'Done ✓',
    close: 'Close',
    needField: (k:string)=>`Fill the field: ${k}`,
    must10: (n:number)=>`Too few photos: ${n}. Minimum is 10.`,
    tooBig: 'Total photo size >24MB. Use smaller images.',
    err: 'Submit error',
    angles: [
      'Trailer number','All tires','Inside the trailer','Corners','Roof',
      'Doors','Left side (outside)','Right side (outside)','Annual Inspection','Registration',
    ],
    none: 'none',
    locBtn: 'Location',
    locGetting: 'Getting…',
    locOK: 'Location attached',
    locErr: 'Location unavailable',
    locHint: 'Allow location access',
  }
} as const;

/** Дружелюбные лейблы для ошибок (только тексты, UI не трогаем) */
const FIELD_LABEL: Record<Lang, Record<string, string>> = {
  ru: {
    event_type: 'Тип',
    truck_number: 'Truck #',
    driver_first: 'Имя',
    driver_last: 'Фамилия',
  },
  en: {
    event_type: 'Type',
    truck_number: 'Truck #',
    driver_first: 'First name',
    driver_last: 'Last name',
  }
};

/** Detail-preserving JPEG compression within the Vercel request budget. */
async function compressImageAdaptive(
  file: File,
  {
    startMaxDim = PHOTO_COMPRESSION_SETTINGS.startMaxDim,
    minMaxDim = PHOTO_COMPRESSION_SETTINGS.minMaxDim,
    stepDim = PHOTO_COMPRESSION_SETTINGS.stepDim,
    startQ = PHOTO_COMPRESSION_SETTINGS.startQ,
    minQ = PHOTO_COMPRESSION_SETTINGS.minQ,
    stepQ = PHOTO_COMPRESSION_SETTINGS.stepQ,
    targetBytes = 380 * 1024,
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

/** Генератор sessionId для мультипарт-отправки (требуется сервером) */
function makeSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function compressPhotoForUpload(file: File, targetBytes: number): Promise<File> {
  const options = {
    ...PHOTO_COMPRESSION_SETTINGS,
    targetBytes,
  };

  try {
    return await compressImageAdaptive(file, options);
  } catch (nativeDecodeError) {
    // Chrome and some Android webviews cannot decode HEIC/HEIF returned by a
    // phone gallery. Detect the file by its contents and convert it locally.
    const { heicTo, isHeic } = await import('heic-to/csp');
    if (!(await isHeic(file))) throw nativeDecodeError;
    const jpeg = await heicTo({
      blob: file,
      type: 'image/jpeg',
      quality: 0.86,
    });
    const converted = new File(
      [jpeg],
      `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`,
      { type: 'image/jpeg', lastModified: file.lastModified || Date.now() },
    );
    return compressImageAdaptive(converted, options);
  }
}

const PHOTO_DRAFT_DB = 'us-team-trailer-report';
const PHOTO_DRAFT_STORE = 'photos';

function openPhotoDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DRAFT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_DRAFT_STORE)) {
        request.result.createObjectStore(PHOTO_DRAFT_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPhotoDraft(): Promise<File[]> {
  if (!('indexedDB' in window)) return [];
  const database = await openPhotoDraftDb();
  try {
    const records = await new Promise<any[]>((resolve, reject) => {
      const request = database
        .transaction(PHOTO_DRAFT_STORE, 'readonly')
        .objectStore(PHOTO_DRAFT_STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    return records
      .sort((a, b) => a.order - b.order)
      .map((record) => new File([record.blob], record.name, {
        type: record.type,
        lastModified: record.lastModified,
      }));
  } finally {
    database.close();
  }
}

async function writePhotoDraft(files: File[]) {
  if (!('indexedDB' in window)) return;
  const database = await openPhotoDraftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PHOTO_DRAFT_STORE, 'readwrite');
      const store = transaction.objectStore(PHOTO_DRAFT_STORE);
      store.clear();
      files.forEach((file, order) => store.put({
        id: `${order}-${file.name}-${file.size}-${file.lastModified}`,
        order,
        name: file.name || `camera-${order + 1}.jpg`,
        type: file.type || 'image/jpeg',
        lastModified: file.lastModified || Date.now(),
        blob: file.slice(0, file.size, file.type || 'image/jpeg'),
      }));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function uploadWithProgress(
  payload: FormData,
  onProgress: (progress: number, processing?: boolean) => void,
) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/submit');
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(45 + Math.round((event.loaded / event.total) * 40));
    };
    xhr.upload.onload = () => onProgress(90, true);
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else {
        let message = '';
        try { message = JSON.parse(xhr.responseText)?.error || ''; } catch {}
        reject(new Error(message || (xhr.status >= 500 ? 'Server error' : 'Submit failed')));
      }
    };
    xhr.send(payload);
  });
}

function TrailerAutocomplete({
  name,
  labelHtml,
  lang,
}: {
  name: 'trailer_pick' | 'trailer_drop';
  labelHtml: string;
  lang: Lang;
}) {
  const [value, setValue] = useState('');
  const [options, setOptions] = useState<TrailerOption[]>([]);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = value.trim();
    if (!focused || query.length < 2) {
      setOptions([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/trailers?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const payload = await response.json();
        setOptions(
          Array.isArray(payload?.trailers) ? payload.trailers.slice(0, 2) : [],
        );
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setOptions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [focused, value]);

  const showMenu = focused && !loading && options.length > 0;

  return (
    <div className="field trailer-field">
      <label dangerouslySetInnerHTML={{__html: labelHtml}} />
      <div className={`trailer-combobox ${focused ? 'is-open' : ''}`}>
        <input
          type="text"
          name={name}
          value={value}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showMenu}
          aria-controls={`${name}-options`}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onChange={(event) => setValue(event.target.value.toUpperCase())}
        />
        <span className="trailer-combobox__icon" aria-hidden="true">⌕</span>
        {showMenu && (
          <div
            className="trailer-options"
            id={`${name}-options`}
            role="listbox"
          >
            {options.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={value === option.trailerNumber}
                key={`${option.provider}-${option.trailerNumber}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setValue(option.trailerNumber);
                  setFocused(false);
                }}
              >
                <span>{option.trailerNumber}</span>
                <small className={`provider-badge is-${option.provider}`}>
                  {option.provider === 'premier' ? 'Premier' : 'Xtralease'}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  const [lang, setLang] = useState<Lang>('ru');
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  const [files, setFiles] = useState<File[]>([]);
  const [formVersion, setFormVersion] = useState(0);
  const [geo, setGeo] = useState<{lat?:number; lon?:number; acc?:number; status:'idle'|'getting'|'ok'|'err'}>({status:'idle'});
  const sessionIdRef = useRef<string>(makeSessionId()); // ← добавили
  const photoDraftReadyRef = useRef(false);
  const displayedProgressRef = useRef(0);
  const [displayedProgress, setDisplayedProgress] = useState(0);

  useEffect(()=>{ const s = localStorage.getItem('lang') as Lang|null; if (s) setLang(s); },[]);
  useEffect(()=>{ localStorage.setItem('lang', lang); },[lang]);
  useEffect(() => {
    let active = true;
    readPhotoDraft()
      .then((restored) => {
        if (!active) return;
        photoDraftReadyRef.current = true;
        if (restored.length) setFiles(restored.slice(0, 20));
      })
      .catch(() => {
        photoDraftReadyRef.current = true;
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!photoDraftReadyRef.current) return;
    if (state.status === 'compressing' || state.status === 'sending') return;
    const timer = window.setTimeout(() => {
      writePhotoDraft(files).catch(() => undefined);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [files, state.status]);
  useEffect(() => {
    const active = state.status === 'compressing' || state.status === 'sending' || state.status === 'done';
    if (!active) {
      displayedProgressRef.current = 0;
      setDisplayedProgress(0);
      return;
    }
    const target = Math.max(0, Math.min(100, state.progress ?? 0));
    const start = displayedProgressRef.current;
    const distance = target - start;
    if (distance === 0) return;
    const duration = Math.min(650, Math.max(220, Math.abs(distance) * 14));
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const eased = elapsed * elapsed * (3 - 2 * elapsed);
      const desiredValue = Math.round(start + distance * eased);
      const previousValue = displayedProgressRef.current;
      const value = desiredValue > previousValue
        ? Math.min(desiredValue, previousValue + 3)
        : Math.max(desiredValue, previousValue - 3);
      displayedProgressRef.current = value;
      setDisplayedProgress(value);
      if (elapsed < 1 || value !== target) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [state.progress, state.status]);

  // ====== ЛОКАЦИЯ (устойчивый запрос) ======
  async function getLocation() {
    setGeo(g => ({ ...g, status: 'getting' }));
    if (!('geolocation' in navigator)) {
      setGeo(g => ({ ...g, status: 'err' }));
      setState({ status: 'error', message: STR[lang].locErr });
      return;
    }
    try {
      const perm = (navigator.permissions as any)?.query
        ? await (navigator.permissions as any).query({ name: 'geolocation' as PermissionName })
        : null;
      if (perm && perm.state === 'denied') {
        setGeo(g => ({ ...g, status: 'err' }));
        setState({ status: 'error', message: STR[lang].locHint });
        return;
      }
    } catch {}

    const once = (opts: PositionOptions) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, opts);
      });
    const watchOnce = (opts: PositionOptions, timeoutMs = 12000) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        let done = false;
        const id = navigator.geolocation.watchPosition(
          pos => { if (done) return; done = true; navigator.geolocation.clearWatch(id); resolve(pos); },
          err => { if (done) return; done = true; navigator.geolocation.clearWatch(id); reject(err); },
          opts
        );
        setTimeout(() => { if (done) return; done = true; navigator.geolocation.clearWatch(id); reject(new Error('watchPosition timeout')); }, timeoutMs);
      });

    try {
      const pos = await Promise.race([
        once({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }),
        watchOnce({ enableHighAccuracy: true, maximumAge: 0 }, 12000),
      ]);
      const { latitude, longitude, accuracy } = pos.coords;
      setGeo({ lat: latitude, lon: longitude, acc: accuracy ?? undefined, status: 'ok' });
      setState(s => (s.status === 'error' ? { status: 'idle' } : s));
    } catch {
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

    // Обязательные поля (чёткие лейблы)
    const required = ['event_type','truck_number','driver_first','driver_last'];
    for (const k of required) {
      if (!fd.get(k)) {
        const label = FIELD_LABEL[lang][k] || k;
        setState({status:'error', message: t.needField(label)});
        return;
      }
    }

    // Фото: минимум 10, максимум 20
    if (files.length < 10) {
      setState({status:'error', message: lang==='ru'
        ? `Мало фото: ${files.length}. Нужно минимум 10.`
        : `Too few photos: ${files.length}. Minimum is 10.`});
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
      setState({
        status:'compressing',
        progress: 5,
        message: t.sending,
      });
      const compressed = new Array<File>(files.length);
      const targetBytesPerPhoto = compressionTargetBytes(files.length);
      const availableCores = navigator.hardwareConcurrency || 4;
      const workerCount = Math.min(files.length, Math.max(2, Math.min(6, Math.floor(availableCores / 2))));
      let nextIndex = 0;
      let complete = 0;
      let compressionError: Error | undefined;
      const compressWorker = async () => {
        while (!compressionError) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= files.length) return;
          try {
            compressed[index] = await compressPhotoForUpload(files[index], targetBytesPerPhoto);
          } catch {
            compressionError = new Error(lang === 'ru'
              ? `Не удалось обработать фото ${index + 1}. Выберите его ещё раз.`
              : `Photo ${index + 1} could not be processed. Please select it again.`);
            return;
          }
          complete += 1;
          setState({
            status:'compressing',
            progress: 5 + Math.round((complete / files.length) * 35),
            message: t.sending,
          });
        }
      };
      await Promise.all(Array.from({length: workerCount}, () => compressWorker()));
      if (compressionError) throw compressionError;

      const payload = new FormData();
      // обязательные данные
      payload.set('phase', 'photos'); // сервер ожидает
      payload.set('sessionId', sessionIdRef.current); // ← фикс «sessionId required»
      payload.set('event_type', String(fd.get('event_type')));
      payload.set('truck_number', String(fd.get('truck_number')));
      payload.set('driver_first', String(fd.get('driver_first')));
      payload.set('driver_last', String(fd.get('driver_last')));
      payload.set('trailer_pick', String(fd.get('trailer_pick') || STR[lang].none));
      payload.set('trailer_drop', String(fd.get('trailer_drop') || STR[lang].none));
      payload.set('notes', String(fd.get('notes') || ''));
      // локация
      payload.set('lat', String(geo.lat));
      payload.set('lng', String(geo.lon));
      if (geo.acc) payload.set('geo_acc', String(Math.round(geo.acc)));
      // фото
      compressed.forEach((f, i) => payload.append('photos', f, f.name || `photo_${i+1}.jpg`));

      setState({status:'sending', progress:45, message:t.sending});
      const text = await uploadWithProgress(payload, (progress) => {
        setState({
          status:'sending',
          progress,
          message: t.sending,
        });
      });
      try {
        const j = JSON.parse(text);
        if (!j?.ok) throw new Error(j?.error || 'submit failed');
      } catch { /* если сервер вернул текст OK без JSON */ }

      setState({status:'done', progress:100, message:t.done});
      form.reset(); setFiles([]);
      setFormVersion((version) => version + 1);
      sessionIdRef.current = makeSessionId(); // новая сессия на следующий раз
    } catch (err:any) {
      setState({status:'error', message: err?.message || STR[lang].err});
    }
  }

  function addPhotos(incoming: File[]) {
    if (incoming.length === 0) return;
    setFiles((current) => {
      // Mobile cameras may return files without a MIME type and reuse the same
      // filename/metadata. Keep every item the user selected; validation happens
      // while the browser decodes and compresses each image before submission.
      const next = [...current, ...incoming];
      const limited = next.slice(0, 20);
      if (next.length > 20) {
        setState({status:'error', message: lang === 'ru'
          ? 'Максимум 20 фотографий.'
          : 'Maximum is 20 photos.'});
      } else if (limited.length < 10) {
        setState({status:'error', message: lang === 'ru'
          ? `Добавлено: ${limited.length}. Нужно минимум 10.`
          : `Added: ${limited.length}. Minimum is 10.`});
      } else {
        setState({status:'idle', message: undefined});
      }
      return limited;
    });
  }

  function onPhotoInput(e: React.ChangeEvent<HTMLInputElement>) {
    addPhotos(e.currentTarget.files ? Array.from(e.currentTarget.files) : []);
    e.currentTarget.value = '';
  }

  function clearSelectedPhotos() {
    setFiles([]);
    setState({status:'idle'});
  }

  const t = STR[lang];
  const submitBlocked = state.status==='sending' || state.status==='compressing';
  const progressCircumference = 2 * Math.PI * 48;

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

        <form onSubmit={onSubmit} autoComplete="off">
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
              <input
                type="text"
                name="truck_number"
                inputMode="numeric"
                autoComplete="off"
                data-form-type="other"
                data-lpignore="true"
              />
            </div>

            <div className="field">
              <label>{t.first}</label>
              <input type="text" name="driver_first" />
            </div>

            <div className="field">
              <label>{t.last}</label>
              <input type="text" name="driver_last" />
            </div>

            <TrailerAutocomplete
              key={`pick-${formVersion}`}
              name="trailer_pick"
              labelHtml={t.pick}
              lang={lang}
            />

            <TrailerAutocomplete
              key={`drop-${formVersion}`}
              name="trailer_drop"
              labelHtml={t.droptr}
              lang={lang}
            />

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
                  {geo.status==='getting'
                    ? t.locGetting
                    : geo.status==='ok'
                      ? t.locOK
                      : t.locBtn}
                </button>
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
              <label className="photo-add-button">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M8.4 5.5 9.7 3.8h4.6l1.3 1.7H19A2.5 2.5 0 0 1 21.5 8v9A2.5 2.5 0 0 1 19 19.5H5A2.5 2.5 0 0 1 2.5 17V8A2.5 2.5 0 0 1 5 5.5h3.4Z" />
                  <circle cx="12" cy="12.5" r="3.4" />
                  <path d="M19 3v4M17 5h4" />
                </svg>
                <span>{t.addPhotos}</span>
                <input
                  className="photo-input"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onPhotoInput}
                  aria-label={`${t.addPhotos} (10–20)`}
                />
              </label>
              <div className="photo-selection-row">
                <span className="photo-count">{t.chosen(files.length)}</span>
                {files.length > 0 && (
                  <button className="photo-clear" type="button" onClick={clearSelectedPhotos}>
                    {t.clearPhotos}
                  </button>
                )}
              </div>
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

        {state.status==='error' && <p className="error">{state.message}</p>}

        <div className="footer">
          <em>“It's our duty to lead people to the light”</em><br/>— D. Miller
        </div>
      </div>

      {(state.status==='compressing' || state.status==='sending' || state.status==='done') && (
        <div className="progress-modal" role="dialog" aria-modal="true" aria-labelledby="progress-modal-title">
          <div className={`progress-modal__card ${state.status==='done' ? 'is-done' : ''}`}>
            <div
              className="progress-ring"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={displayedProgress}
            >
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <defs>
                  <linearGradient id="submit-progress-gradient" x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0%" stopColor="#ff9f0a" />
                    <stop offset="52%" stopColor="#ff453a" />
                    <stop offset="100%" stopColor="#ff375f" />
                  </linearGradient>
                </defs>
                <circle className="progress-ring__base" cx="60" cy="60" r="48" />
                <circle
                  className="progress-ring__value"
                  cx="60"
                  cy="60"
                  r="48"
                  strokeDasharray={progressCircumference}
                  strokeDashoffset={progressCircumference * (1 - displayedProgress / 100)}
                />
              </svg>
              <strong>{displayedProgress}%</strong>
            </div>
            <p id="progress-modal-title" aria-live="polite">
              {state.status==='done' && displayedProgress < 100 ? t.sending : state.message}
            </p>
            {state.status==='done' && displayedProgress === 100 && (
              <button type="button" className="progress-modal__close" onClick={() => setState({status:'idle'})}>
                {t.close}
              </button>
            )}
          </div>
        </div>
      )}

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
