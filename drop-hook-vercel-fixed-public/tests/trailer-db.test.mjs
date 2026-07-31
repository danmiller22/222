import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import {
  beginSubmission,
  listTrailerOptions,
  markSubmissionDelivered,
  normalizeSkyBitzCatalog,
  normalizeSpireonCatalog,
  setDatabaseForTests,
  syncConfiguredTrailerCatalogs,
} from "../app/lib/trailer-db.ts";

test("normalizes the live SkyBitz and Spireon response shapes", () => {
  assert.deepEqual(
    normalizeSkyBitzCatalog({
      skybitz: {
        error: 0,
        gls: [
          {
            mtsn: "device-x-1",
            asset: { assetid: "XTRA-100", assettype: "Dry Van" },
          },
        ],
      },
    }).map(({ trailerNumber, providerKey }) => ({ trailerNumber, providerKey })),
    [{ trailerNumber: "XTRA-100", providerKey: "device-x-1" }],
  );

  assert.deepEqual(
    normalizeSpireonCatalog({
      total: 1,
      content: [{ id: 42, name: "PREM-200", active: true }],
    }).map(({ trailerNumber, providerKey }) => ({ trailerNumber, providerKey })),
    [{ trailerNumber: "PREM-200", providerKey: "42" }],
  );
});

test("imports both catalogs, records a report, and prevents duplicate delivery", async () => {
  const memory = newDb();
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  setDatabaseForTests(pool);

  process.env.XTRALEASE_TRAILERS_DATA = JSON.stringify([
    { trailer_number: "XTRA-100", key: "x-key-100", status: "available" },
    { trailerNumber: "XTRA-101", providerKey: "x-key-101" },
  ]);
  process.env.PREMIER_TRAILERS_DATA = JSON.stringify({
    trailers: [
      { unit_number: "PREM-200", id: "p-key-200", status: "leased" },
      { number: "PREM-201", key: "p-key-201" },
    ],
  });

  await syncConfiguredTrailerCatalogs();
  process.env.XTRALEASE_TRAILERS_DATA = JSON.stringify([
    { trailer_number: "XTRA-SHOULD-BE-RATE-LIMITED" },
  ]);
  await syncConfiguredTrailerCatalogs();

  const catalogs = await pool.query(
    "select provider, count(*)::int as count from trailers group by provider order by provider",
  );
  assert.deepEqual(catalogs.rows, [
    { provider: "premier", count: 2 },
    { provider: "xtralease", count: 2 },
  ]);
  assert.deepEqual(await listTrailerOptions("PREM", 10), [
    { trailerNumber: "PREM-200", provider: "premier" },
    { trailerNumber: "PREM-201", provider: "premier" },
  ]);

  const submission = {
    sessionId: "test-session-1",
    eventType: "Hook",
    truckNumber: "77",
    driverFirst: "Test",
    driverLast: "Driver",
    trailerPick: "XTRA-100",
    trailerDrop: "PREM-200",
    notes: "database integration test",
    lat: 41.8781,
    lng: -87.6298,
    photoCount: 10,
  };

  assert.deepEqual(await beginSubmission(submission), { alreadyDelivered: false });
  await markSubmissionDelivered(submission.sessionId);
  assert.deepEqual(await beginSubmission(submission), { alreadyDelivered: true });

  const saved = await pool.query(
    "select status, photo_count from trailer_submissions where session_id = $1",
    [submission.sessionId],
  );
  assert.deepEqual(saved.rows, [{ status: "delivered", photo_count: 10 }]);

  await pool.end();
});
