// app/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const MIN_PHOTOS = 8;
const MAX_PHOTOS = 20; // ← требование: до 20
const CLIENT_TARGET_MAX_BYTES = 900_000; // агрессивная компрессия ~0.9MB
const CLIENT_TARGET_MAX_WIDTH = 1600;
const CLIENT_ALBUM_LIMIT = 10;
const CLIENT_GROUP_PAUSE_MS_MIN = 700;
const CLIENT_GROUP_PAUSE_MS_MAX = 1200;

type Direction = "drop" | "hook";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function rand(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function makeSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Сильный клиентский компрессор без сторонних пакетов
async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, CLIENT_TARGET_MAX_WIDTH / bitmap.width);
  const w = Math.max(1, Math.floor(bitmap.width * scale));
  const h = Math.max(1, Math.floor(bitmap.height * scale));

  const hasOffscreen = typeof OffscreenCanvas !== "undefined";
  const canvas: HTMLCanvasElement | OffscreenCanvas = hasOffscreen
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });

  const ctx: any = (canvas as any).getContext("2d", { alpha: false });
  if (!ctx) return file;

  (canvas as any).width = w;
  (canvas as any).height = h;
  ctx.drawImage(bitmap, 0, 0, w, h);

  let quality = 0.78;
  let blob: Blob | null = await (canvas as any).convertToBlob
    ? (canvas as any).convertToBlob({ type: "image/jpeg", quality, // прогрессивность браузер решит сам
      })
    : new Promise<Blob | null>((resolve) =>
        (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), "image/jpeg", quality)
      );

  for (let i = 0; i < 6 && blob && blob.size > CLIENT_TARGET_MAX_BYTES; i++) {
    quality = Math.max(0.45, quality * 0.82);
    blob = await ((canvas as any).convertToBlob
      ? (canvas as any).convertToBlob({ type: "image/jpeg", quality })
      : new Promise<Blob | null>((resolve) =>
          (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), "image/jpeg", quality)
        ));
  }

  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/i, ".jpg"), { type: "image/jpeg" });
}

export default function Page() {
  const [truck, setTruck] = useState("");
  const [driver, setDriver] = useState("");
  const [direction, setDirection] = useState<Direction>("drop");
  const [notes, setNotes] = useState("");

  const [photos, setPhotos] = useState<File[]>([]);
  const [geoAllowed, setGeoAllowed] = useState<"granted" | "denied" | "prompt" | "unknown">("unknown");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ step: "idle" | "init" | "compress" | "upload"; current: number; total: number }>({ step: "idle", current: 0, total: 0 });
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [submitTried, setSubmitTried] = useState(false);
  const [filesTrimmedMsg, setFilesTrimmedMsg] = useState<string>("");

  const statusRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string>(makeSessionId());

  // Узнаём статус разрешения на гео
  useEffect(() => {
    let cancelled = false;
    async function check() {
      if ("permissions" in navigator && (navigator.permissions as any).query) {
        try {
          const st = await (navigator.permissions as any).query({ name: "geolocation" as PermissionName });
          if (!cancelled) setGeoAllowed(st.state as any);
          st.onchange = () => setGeoAllowed((st.state as any) || "unknown");
        } catch {
          setGeoAllowed("unknown");
        }
      } else {
        setGeoAllowed("unknown");
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  const requiredFilled = useMemo(() => {
    return !!(truck.trim() && driver.trim() && direction && coords && photos.length >= MIN_PHOTOS && photos.length <= MAX_PHOTOS);
  }, [truck, driver, direction, coords, photos.length]);

  async function requestLocation() {
    setStatusMsg("Запрашиваем геолокацию…");
    return new Promise<void>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGeoAllowed("granted");
          setStatusMsg("Геолокация получена.");
          resolve();
        },
        (err) => {
          console.error(err);
          setGeoAllowed("denied");
          setStatusMsg("Геолокация отклонена. Разрешите доступ в браузере.");
          resolve();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  function onFilesPicked(list: FileList | null) {
    setFilesTrimmedMsg("");
    const arr = list ? Array.from(list) : [];
    const imgs = arr.filter((f) => /^image\//.test(f.type));
    let chosen = imgs;
    let msg = "";
    if (imgs.length > MAX_PHOTOS) {
      chosen = imgs.slice(0, MAX_PHOTOS);
      msg = `Выбрано больше ${MAX_PHOTOS}. Лишние (${imgs.length - MAX_PHOTOS}) автоматически отброшены.`;
    }
    setPhotos(chosen);
    if (msg) setFilesTrimmedMsg(msg);
  }

  // Сбор сообщения об ошибках при сабмите
  function buildValidationMessage(): string {
    const issues: string[] = [];
    if (!coords) issues.push("разрешите доступ к геолокации");
    if (!truck.trim()) issues.push("заполните Truck");
    if (!driver.trim()) issues.push("заполните Driver");
    if (photos.length < MIN_PHOTOS) issues.push(`добавьте ещё фото (минимум ${MIN_PHOTOS})`);
    if (photos.length > MAX_PHOTOS) issues.push(`уменьшите фото до ${MAX_PHOTOS}`);
    return issues.length ? "Нельзя отправить: " + issues.join("; ") : "";
  }

  async function handleSubmit() {
    setSubmitTried(true);

    // Явная ошибка, если что-то не заполнено/нет гео/не тот объём фото
    const validationMsg = buildValidationMessage();
    if (validationMsg) {
      setStatusMsg(validationMsg);
      statusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!coords) return;

    setBusy(true);
    setStatusMsg("");
    try {
      // INIT
      setProgress({ step: "init", current: 0, total: 1 });
      const initRes = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase: "init",
          sessionId: sessionIdRef.current,
          truck: truck.trim(),
          driver: driver.trim(),
          direction,
          coords,
          notes: notes?.trim() || undefined,
        }),
      }).then((r) => r.json());

      if (!initRes?.ok) throw new Error(initRes?.error || "INIT failed");

      // Компрессия
      setProgress({ step: "compress", current: 0, total: photos.length });
      const processed: File[] = [];
      for (let i = 0; i < photos.length; i++) {
        const f = photos[i];
        const cf = await compressImage(f).catch(() => f);
        processed.push(cf);
        setProgress((p) => ({ ...p, current: i + 1 }));
        await sleep(10);
      }

      // Отправка партиями по 10 с паузами
      const chunks: File[][] = [];
      for (let i = 0; i < processed.length; i += CLIENT_ALBUM_LIMIT) {
        chunks.push(processed.slice(i, i + CLIENT_ALBUM_LIMIT));
      }

      let uploaded = 0;
      setProgress({ step: "upload", current: 0, total: processed.length });

      for (let i = 0; i < chunks.length; i++) {
        const group = chunks[i];
        const fd = new FormData();
        fd.set("phase", "photos");
        fd.set("sessionId", sessionIdRef.current);
        fd.set("lat", String(coords.lat));
        fd.set("lng", String(coords.lng));
        group.forEach((file, j) => fd.append("photos", file, file.name || `p${i}_${j}.jpg`));

        const resp = await fetch("/api/submit", { method: "POST", body: fd });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json?.ok) throw new Error(json?.error || `upload group ${i + 1} failed`);

        uploaded += group.length;
        setProgress({ step: "upload", current: uploaded, total: processed.length });

        if (i < chunks.length - 1) await sleep(rand(CLIENT_GROUP_PAUSE_MS_MIN, CLIENT_GROUP_PAUSE_MS_MAX));
      }

      setStatusMsg("Готово: отправлено!");
      sessionIdRef.current = makeSessionId();
      // по желанию можно сбрасывать форму, но оставим как есть
    } catch (e: any) {
      console.error(e);
      setStatusMsg(`Ошибка: ${e?.message || e}`);
      statusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      setBusy(false);
      setProgress({ step: "idle", current: 0, total: 0 });
    }
  }

  // Подсветка ошибок под полями (после попытки отправки)
  const truckError = submitTried && !truck.trim() ? "Укажите Truck" : "";
  const driverError = submitTried && !driver.trim() ? "Укажите Driver" : "";
  const geoError = submitTried && !coords ? "Разрешите доступ к геолокации" : "";
  const photosError =
    submitTried && (photos.length < MIN_PHOTOS || photos.length > MAX_PHOTOS)
      ? `Выберите от ${MIN_PHOTOS} до ${MAX_PHOTOS} фото`
      : "";

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Drop/Hook Report</h1>

      {/* Гео-блок */}
      <div className="p-4 rounded-xl border">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Геолокация</div>
            <div className="text-sm opacity-80">
              {coords
                ? `Получена: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                : "Требуется разрешение на геолокацию перед отправкой."}
            </div>
            {geoError && <div className="text-red-600 text-sm mt-1">{geoError}</div>}
          </div>
          <button
            className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50"
            onClick={requestLocation}
            disabled={busy}
            aria-live="polite"
          >
            Разрешить гео
          </button>
        </div>
      </div>

      {/* Форма */}
      <div className="p-4 rounded-xl border space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm">Truck *</span>
            <input
              className={`mt-1 w-full rounded-lg border px-3 py-2 ${truckError ? "border-red-600" : ""}`}
              value={truck}
              onChange={(e) => setTruck(e.target.value)}
              aria-required="true"
              aria-invalid={!!truckError}
              aria-describedby={truckError ? "truck-err" : undefined}
            />
            {truckError && <div id="truck-err" className="text-red-600 text-sm mt-1">{truckError}</div>}
          </label>
          <label className="block">
            <span className="text-sm">Driver *</span>
            <input
              className={`mt-1 w-full rounded-lg border px-3 py-2 ${driverError ? "border-red-600" : ""}`}
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              aria-required="true"
              aria-invalid={!!driverError}
              aria-describedby={driverError ? "driver-err" : undefined}
            />
            {driverError && <div id="driver-err" className="text-red-600 text-sm mt-1">{driverError}</div>}
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm">Тип *</span>
            <select
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
              aria-required="true"
            >
              <option value="drop">Drop</option>
              <option value="hook">Hook</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm">Примечания (опционально)</span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm">
            Фото * (от {MIN_PHOTOS} до {MAX_PHOTOS})
          </span>
          <input
            className="mt-1 w-full"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => onFilesPicked(e.target.files)}
            aria-required="true"
            aria-invalid={!!photosError}
            aria-describedby={photosError ? "photos-err" : undefined}
          />
          <div className="text-sm mt-1">
            Выбрано: {photos.length}{" "}
            {photos.length < MIN_PHOTOS || photos.length > MAX_PHOTOS ? "❗" : "✅"}
          </div>
          {filesTrimmedMsg && <div className="text-xs opacity-70 mt-1">{filesTrimmedMsg}</div>}
          {photosError && <div id="photos-err" className="text-red-600 text-sm mt-1">{photosError}</div>}
        </label>

        {/* Кнопка сабмита: всегда доступна (чтобы выдать ошибки), но блокируем при отправке */}
        <div className="pt-2 flex items-center gap-3">
          <button
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
            disabled={busy}
            onClick={handleSubmit}
            aria-disabled={busy}
          >
            Отправить
          </button>
          <span className="text-sm opacity-80">
            Требуется гео + заполненные Truck/Driver + {MIN_PHOTOS}–{MAX_PHOTOS} фото.
          </span>
        </div>

        {/* Прогресс */}
        {progress.step !== "idle" && (
          <div className="mt-3 space-y-1" aria-live="polite">
            <div className="text-sm font-medium">
              {progress.step === "init" && "Инициализация…"}
              {progress.step === "compress" && `Сжатие фото: ${progress.current}/${progress.total}`}
              {progress.step === "upload" && `Отправка: ${progress.current}/${progress.total}`}
            </div>
            <div className="w-full h-2 rounded bg-gray-200 overflow-hidden">
              <div
                className="h-2 bg-black transition-all"
                style={{
                  width:
                    progress.total > 0
                      ? `${Math.round((progress.current / progress.total) * 100)}%`
                      : "10%",
                }}
              />
            </div>
          </div>
        )}

        {/* Статус/ошибки (глобально) */}
        <div ref={statusRef} className={`text-sm mt-2 ${statusMsg ? "" : "opacity-0"}`} role="status" aria-live="assertive">
          {statusMsg || " "}
        </div>
      </div>

      <div className="text-xs opacity-60">
        Кнопка «Отправить» выводит ошибки, если что-то не заполнено. Гео обязателен. Фото отправляются партиями по 10 с паузами и жестко ужимаются.
      </div>
    </main>
  );
}
