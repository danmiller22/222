import assert from "node:assert/strict";
import test from "node:test";

import {
  compressionTargetBytes,
  MAX_COMPRESSED_BATCH_BYTES,
  PHOTO_COMPRESSION_SETTINGS,
} from "../app/lib/photo-compression.ts";

test("preserves more detail while keeping 10-20 photos below the request budget", () => {
  assert.equal(PHOTO_COMPRESSION_SETTINGS.startMaxDim, 1600);
  assert.equal(PHOTO_COMPRESSION_SETTINGS.startQ, 0.8);
  assert.equal(compressionTargetBytes(10), 380_000);
  assert.equal(compressionTargetBytes(20), 190_000);

  for (let count = 10; count <= 20; count += 1) {
    assert.ok(
      compressionTargetBytes(count) * count <= MAX_COMPRESSED_BATCH_BYTES,
      `${count} photos must remain inside the compressed batch budget`,
    );
  }
});
