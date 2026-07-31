export const MAX_COMPRESSED_BATCH_BYTES = 3_800_000;
export const MAX_COMPRESSED_PHOTO_BYTES = 420 * 1024;

export const PHOTO_COMPRESSION_SETTINGS = {
  startMaxDim: 1600,
  minMaxDim: 960,
  stepDim: 160,
  startQ: 0.80,
  minQ: 0.58,
  stepQ: 0.04,
} as const;

export function compressionTargetBytes(photoCount: number) {
  return Math.min(
    MAX_COMPRESSED_PHOTO_BYTES,
    Math.floor(MAX_COMPRESSED_BATCH_BYTES / Math.max(1, photoCount)),
  );
}
