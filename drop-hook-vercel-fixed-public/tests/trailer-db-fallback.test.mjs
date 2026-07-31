import assert from "node:assert/strict";
import test from "node:test";

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.NEON_DATABASE_URL;

const {
  beginSubmission,
  markSubmissionDelivered,
  markSubmissionFailed,
} = await import("../app/lib/trailer-db.ts");

function record(sessionId) {
  return {
    sessionId,
    eventType: "Hook",
    truckNumber: "544",
    driverFirst: "Test",
    driverLast: "Driver",
    trailerPick: "H03036",
    trailerDrop: "none",
    notes: "",
    lat: 41.8781,
    lng: -87.6298,
    photoCount: 10,
  };
}

test("submission tracking falls back safely when DATABASE_URL is absent", async () => {
  const first = await beginSubmission(record("fallback-delivered"));
  assert.equal(first.alreadyDelivered, false);
  await markSubmissionDelivered("fallback-delivered");
  const duplicate = await beginSubmission(record("fallback-delivered"));
  assert.equal(duplicate.alreadyDelivered, true);
});

test("a failed fallback submission can be retried", async () => {
  await beginSubmission(record("fallback-retry"));
  await markSubmissionFailed("fallback-retry", new Error("test"));
  const retry = await beginSubmission(record("fallback-retry"));
  assert.equal(retry.alreadyDelivered, false);
});
