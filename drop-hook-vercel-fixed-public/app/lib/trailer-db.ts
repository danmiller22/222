import { Pool } from "pg";
import { CompactEncrypt, importJWK, type JWK } from "jose";
import catalogSeed from "../data/trailer-seed.json" with { type: "json" };

export type TrailerOption = {
  trailerNumber: string;
  provider: "xtralease" | "premier";
};

const trailerSeed: TrailerOption[] = [
  ...catalogSeed.xtralease.map((trailerNumber) => ({
    trailerNumber,
    provider: "xtralease" as const,
  })),
  ...catalogSeed.premier.map((trailerNumber) => ({
    trailerNumber,
    provider: "premier" as const,
  })),
];

type Provider = "xtralease" | "premier";

type CatalogTrailer = {
  trailerNumber: string;
  providerKey: string | null;
  raw: Record<string, unknown>;
};

export type SubmissionRecord = {
  sessionId: string;
  eventType: string;
  truckNumber: string;
  driverFirst: string;
  driverLast: string;
  trailerPick: string;
  trailerDrop: string;
  notes: string;
  lat: number | null;
  lng: number | null;
  photoCount: number;
};

type DatabaseClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
  connect?: () => Promise<any>;
};

let client: Pool | DatabaseClient | undefined;
let schemaPromise: Promise<void> | undefined;
let usingTestDatabase = false;
const fallbackSubmissionStatus = new Map<string, "processing" | "delivered" | "failed">();

function databaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.NEON_DATABASE_URL ||
    ""
  ).trim();
}

function databaseConfigured() {
  return Boolean(client || databaseUrl());
}

function rememberFallbackSubmission(
  sessionId: string,
  status: "processing" | "delivered" | "failed",
) {
  fallbackSubmissionStatus.set(sessionId, status);
  if (fallbackSubmissionStatus.size > 500) {
    const oldest = fallbackSubmissionStatus.keys().next().value;
    if (oldest) fallbackSubmissionStatus.delete(oldest);
  }
}

function db(): DatabaseClient {
  if (client) return client;
  const url = databaseUrl();
  if (!url) {
    throw new Error("Trailer database is not configured (DATABASE_URL is missing)");
  }
  client = new Pool({
    connectionString: url,
    max: 3,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  return client;
}

/** Used only by the isolated database integration test. */
export function setDatabaseForTests(database: DatabaseClient) {
  client = database;
  schemaPromise = undefined;
  usingTestDatabase = true;
}

export async function ensureTrailerSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = db();
      await sql.query(`
        create table if not exists trailers (
          id bigserial primary key,
          trailer_number text not null unique,
          provider text not null,
          provider_key text,
          provider_data jsonb not null default '{}'::jsonb,
          active boolean not null default true,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          last_reported_at timestamptz
        )
      `);
      await sql.query(`
        create table if not exists trailer_submissions (
          id bigserial primary key,
          session_id text not null unique,
          event_type text not null,
          truck_number text not null,
          driver_first text not null,
          driver_last text not null,
          trailer_pick text,
          trailer_drop text,
          notes text,
          latitude double precision,
          longitude double precision,
          photo_count integer not null,
          status text not null default 'processing',
          error_message text,
          created_at timestamptz not null default now(),
          delivered_at timestamptz,
          updated_at timestamptz not null default now()
        )
      `);
      await sql.query(`
        create table if not exists trailer_catalog_syncs (
          provider text primary key,
          synced_at timestamptz not null,
          trailer_count integer not null,
          attempted_at timestamptz
        )
      `);
      await sql.query(
        "alter table trailer_catalog_syncs add column if not exists attempted_at timestamptz",
      );
      await sql.query(
        "create index if not exists trailer_submissions_created_at_idx on trailer_submissions (created_at desc)",
      );
      await sql.query(
        "create index if not exists trailers_provider_idx on trailers (provider, trailer_number)",
      );
      if (!usingTestDatabase) {
        const values = trailerSeed
          .map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2}, '{}'::jsonb)`)
          .join(", ");
        await sql.query(
          `insert into trailers (trailer_number, provider, provider_data)
           values ${values}
           on conflict (trailer_number) do nothing`,
          trailerSeed.flatMap((trailer) => [
            trailer.trailerNumber,
            trailer.provider,
          ]),
        );
      }
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const object = asObject(payload);
  for (const key of ["trailers", "data", "items", "results", "content"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return Object.entries(object).map(([key, value]) => {
    const row = asObject(value);
    return { trailer_number: key, ...row };
  });
}

function normalizeCatalog(payload: unknown): CatalogTrailer[] {
  const seen = new Set<string>();
  const normalized: CatalogTrailer[] = [];

  for (const value of rowsFromPayload(payload)) {
    const raw = typeof value === "string" || typeof value === "number"
      ? { trailer_number: String(value) }
      : asObject(value);
    const number = String(
      raw.trailer_number ??
      raw.trailerNumber ??
      raw.trailer ??
      raw.unit_number ??
      raw.unitNumber ??
      raw.unit ??
      raw.number ??
      raw.id ??
      "",
    ).trim();
    if (!number || seen.has(number.toLowerCase())) continue;
    seen.add(number.toLowerCase());
    const providerKey = raw.provider_key ?? raw.providerKey ?? raw.key ?? raw.id ?? null;
    normalized.push({
      trailerNumber: number,
      providerKey: providerKey == null ? null : String(providerKey),
      raw,
    });
  }
  return normalized;
}

function parseInlineData(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function requiredProviderEnv(name: string) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function normalizeSkyBitzCatalog(payload: unknown): CatalogTrailer[] {
  const skybitz = asObject(asObject(payload).skybitz);
  const error = skybitz.error;
  if (error != null && String(error) !== "0") {
    throw new Error(`SkyBitz catalog returned error ${String(error)}`);
  }

  const positions = Array.isArray(skybitz.gls) ? skybitz.gls : [];
  return normalizeCatalog(positions.map((position) => {
    const raw = asObject(position);
    const asset = asObject(raw.asset);
    return {
      ...raw,
      trailer_number: asset.assetid,
      provider_key: raw.mtsn ?? asset.assetid,
    };
  }));
}

export function normalizeSpireonCatalog(payload: unknown): CatalogTrailer[] {
  const response = asObject(asObject(payload).response);
  const rows = Array.isArray(response.data)
    ? response.data
    : rowsFromPayload(payload);
  return normalizeCatalog(rows.map((value) => {
    const raw = asObject(value);
    return {
      ...raw,
      trailer_number:
        raw.assetName ??
        raw.name ??
        raw.unitNumber ??
        raw.deviceName ??
        raw.id,
      provider_key:
        raw.id ??
        raw.assetId ??
        raw.deviceSerialNumber ??
        raw.serialNumber ??
        null,
    };
  }));
}

async function skyBitzCatalog(): Promise<CatalogTrailer[]> {
  const base = (
    process.env.SKYBITZ_SERVICE_URL ||
    "https://xml.skybitz.com/"
  ).trim();
  const url = new URL("QueryPositions", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("assetid", "ALL");
  url.searchParams.set("customer", requiredProviderEnv("SKYBITZ_USERNAME"));
  url.searchParams.set("password", requiredProviderEnv("SKYBITZ_PASSWORD"));
  url.searchParams.set("version", (process.env.SKYBITZ_API_VERSION || "2.76").trim());
  url.searchParams.set("getJson", "1");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`SkyBitz trailer catalog failed: ${response.status}`);
  }
  return normalizeSkyBitzCatalog(await response.json());
}

function spireonInitialJwe(html: string) {
  const match = html.match(
    /initialJwe\s*:\s*{\s*id\s*:\s*"([^"]+)"\s*,\s*jwk\s*:\s*"((?:\\.|[^"])*)"/,
  );
  if (!match) throw new Error("Spireon login encryption configuration is missing");
  return {
    id: match[1],
    jwk: JSON.parse(JSON.parse(`"${match[2]}"`)) as JWK,
  };
}

async function spireonUserToken() {
  const username = requiredProviderEnv("SPIREON_USERNAME");
  const password = requiredProviderEnv("SPIREON_PASSWORD");
  const clientId = (process.env.SPIREON_CLIENT_ID || "atiWeb").trim();
  const authBase = (
    process.env.SPIREON_AUTH_URL ||
    "https://auth-service.spireon.com"
  ).replace(/\/+$/, "");
  const loginPage = await fetch(
    `${authBase}/auth/login?clientId=${encodeURIComponent(clientId)}`,
    { cache: "no-store" },
  );
  if (!loginPage.ok) throw new Error(`Spireon login page failed: ${loginPage.status}`);

  const initial = spireonInitialJwe(await loginPage.text());
  const publicKey = await importJWK(initial.jwk, "RSA-OAEP-256");
  const plaintext = new TextEncoder().encode(JSON.stringify({ username, password }));
  const encrypted = await new CompactEncrypt(plaintext)
    .setProtectedHeader({
      alg: "RSA-OAEP-256",
      enc: "A256GCM",
      kid: initial.id,
    })
    .encrypt(publicKey);

  const login = await fetch(
    `${authBase}/rest/loginRequest?clientId=${encodeURIComponent(clientId)}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: encrypted,
      cache: "no-store",
    },
  );
  if (!login.ok) throw new Error(`Spireon login failed: ${login.status}`);

  const loginData = asObject(await login.json());
  const authResult = asObject(loginData.authResult);
  let token = String(authResult.token ?? "");
  if (!token) throw new Error("Spireon login token is missing");

  if (authResult.scope === "USER_SCOPE") {
    const platformBase = (
      process.env.SPIREON_PLATFORM_URL ||
      "https://services.spireon.com/v0/rest"
    ).replace(/\/+$/, "");
    const accountsResponse = await fetch(
      `${platformBase}/accounts?date=${Date.now()}`,
      {
        headers: {
          accept: "application/json",
          "X-Nspire-UserToken": token,
        },
        cache: "no-store",
      },
    );
    if (accountsResponse.status === 204) {
      throw new Error("Spireon user has no FleetLocate account assigned");
    }
    if (!accountsResponse.ok) {
      throw new Error(`Spireon account lookup failed: ${accountsResponse.status}`);
    }
    const accountsPayload = await accountsResponse.json();
    const accounts = Array.isArray(accountsPayload)
      ? accountsPayload.map(asObject)
      : rowsFromPayload(accountsPayload).map(asObject);
    const account = accounts.find((value) => value.loginEnabled !== false);
    if (!account?.id) throw new Error("Spireon user has no enabled FleetLocate account");

    const identityBase = (
      process.env.SPIREON_IDENTITY_URL ||
      "https://identity.spireon.com/identity"
    ).replace(/\/+$/, "");
    const appToken = (
      process.env.SPIREON_APP_TOKEN ||
      "77439e80-f93a-11e6-bc64-92361f002671"
    ).trim();
    const scopedResponse = await fetch(
      `${identityBase}/token?date=${Date.now()}`,
      {
        headers: {
          accept: "application/json",
          "X-Nspire-UserToken": token,
          "X-Nspire-AppToken": appToken,
          "X-NSpire-Account": String(account.id),
        },
        cache: "no-store",
      },
    );
    if (!scopedResponse.ok) {
      throw new Error(`Spireon account token failed: ${scopedResponse.status}`);
    }
    const scoped = asObject(await scopedResponse.json());
    token = String(scoped.token ?? scoped.userToken ?? "");
    if (!token) throw new Error("Spireon account token is missing");
  }

  return token;
}

async function spireonCatalog(): Promise<CatalogTrailer[]> {
  const token = await spireonUserToken();
  const assetsUrl = (
    process.env.SPIREON_ASSETS_URL ||
    "https://ati-avs-api.spireon.com/api/v1/assets"
  ).trim();
  const url = new URL(assetsUrl);
  url.searchParams.set("limit", "5000");
  url.searchParams.set("offset", "0");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Spireon trailer catalog failed: ${response.status}`);
  }
  return normalizeSpireonCatalog(await response.json());
}

async function providerCatalog(provider: Provider): Promise<CatalogTrailer[] | null> {
  const prefix = provider === "xtralease" ? "XTRALEASE" : "PREMIER";
  const inline =
    process.env[`${prefix}_TRAILERS_DATA`] ||
    process.env[`${prefix}_TRAILERS_JSON`] ||
    "";
  if (inline.trim()) return normalizeCatalog(parseInlineData(inline));

  if (
    provider === "xtralease" &&
    process.env.SKYBITZ_USERNAME?.trim() &&
    process.env.SKYBITZ_PASSWORD?.trim()
  ) {
    return skyBitzCatalog();
  }
  if (
    provider === "premier" &&
    process.env.SPIREON_USERNAME?.trim() &&
    process.env.SPIREON_PASSWORD?.trim()
  ) {
    return spireonCatalog();
  }

  const url = (process.env[`${prefix}_TRAILERS_URL`] || "").trim();
  if (!url) return null;

  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = (process.env[`${prefix}_API_KEY`] || "").trim();
  if (apiKey) {
    const header = (process.env[`${prefix}_API_KEY_HEADER`] || "authorization").trim();
    const scheme = process.env[`${prefix}_API_KEY_SCHEME`] ?? "Bearer ";
    headers[header] = `${scheme}${apiKey}`;
  }

  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${provider} trailer catalog failed: ${response.status}`);
  }
  return normalizeCatalog(await response.json());
}

function providerIsConfigured(provider: Provider) {
  const prefix = provider === "xtralease" ? "XTRALEASE" : "PREMIER";
  if (
    process.env[`${prefix}_TRAILERS_DATA`]?.trim() ||
    process.env[`${prefix}_TRAILERS_JSON`]?.trim() ||
    process.env[`${prefix}_TRAILERS_URL`]?.trim()
  ) {
    return true;
  }
  return provider === "xtralease"
    ? Boolean(
      process.env.SKYBITZ_USERNAME?.trim() &&
      process.env.SKYBITZ_PASSWORD?.trim()
    )
    : Boolean(
      process.env.SPIREON_USERNAME?.trim() &&
      process.env.SPIREON_PASSWORD?.trim()
    );
}

async function syncProvider(provider: Provider) {
  if (!providerIsConfigured(provider)) return;
  const sql = db();
  const recent = await sql.query(
    `select provider
     from trailer_catalog_syncs
     where provider = $1
       and attempted_at > now() - interval '12 hours'`,
    [provider],
  );
  if (recent.rows.length) return;

  await sql.query(
    `insert into trailer_catalog_syncs (
       provider, synced_at, trailer_count, attempted_at
     )
     values ($1, '1970-01-01T00:00:00Z'::timestamptz, 0, now())
     on conflict (provider) do update set
       attempted_at = excluded.attempted_at`,
    [provider],
  );

  const trailers = await providerCatalog(provider);
  if (trailers === null) return;

  const transaction = sql.connect ? await sql.connect() : sql;
  try {
    await transaction.query("begin");
    await transaction.query(
      "update trailers set active = false, updated_at = now() where provider = $1",
      [provider],
    );
    for (const trailer of trailers) {
      await transaction.query(
        `insert into trailers (
           trailer_number, provider, provider_key, provider_data, active, updated_at
         )
         values ($1, $2, $3, $4::jsonb, true, now())
         on conflict (trailer_number) do update set
           provider = excluded.provider,
           provider_key = excluded.provider_key,
           provider_data = excluded.provider_data,
           active = true,
           updated_at = now()`,
        [
          trailer.trailerNumber,
          provider,
          trailer.providerKey,
          JSON.stringify(trailer.raw),
        ],
      );
    }
    await transaction.query(
      `insert into trailer_catalog_syncs (
         provider, synced_at, trailer_count, attempted_at
       )
       values ($1, now(), $2, now())
       on conflict (provider) do update set
         synced_at = excluded.synced_at,
         trailer_count = excluded.trailer_count,
         attempted_at = excluded.attempted_at`,
      [provider, trailers.length],
    );
    await transaction.query("commit");
  } catch (error) {
    await transaction.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    transaction.release?.();
  }
}

export async function syncConfiguredTrailerCatalogs() {
  await ensureTrailerSchema();
  await Promise.all([syncProvider("xtralease"), syncProvider("premier")]);
}

export async function listTrailerOptions(
  search = "",
  requestedLimit = 12,
): Promise<TrailerOption[]> {
  const term = search.trim().toLowerCase();
  const limit = Math.max(1, Math.min(25, requestedLimit));
  if (!client && !databaseUrl()) {
    return trailerSeed
      .filter((trailer) =>
        !term || trailer.trailerNumber.toLowerCase().includes(term)
      )
      .slice(0, limit);
  }

  await ensureTrailerSchema();
  const result = await db().query(
    `select trailer_number, provider
     from trailers
     where active = true
       and ($1 = '' or trailer_number ilike $2)
     order by
       case when lower(trailer_number) = $1 then 0
            when lower(trailer_number) like $3 then 1
            else 2 end,
       trailer_number
     limit $4`,
    [term, `%${term}%`, `${term}%`, limit],
  );
  return result.rows.map((row) => ({
    trailerNumber: String(row.trailer_number),
    provider: row.provider === "premier" ? "premier" : "xtralease",
  }));
}

function isNoTrailer(value: string) {
  return /^(?:no|none|нет|-)?$/i.test(value.trim());
}

async function touchReportedTrailer(trailerNumber: string) {
  if (isNoTrailer(trailerNumber)) return;
  await db().query(
    `insert into trailers (
       trailer_number, provider, provider_data, active, last_reported_at, updated_at
     )
     values ($1, 'reported', '{}'::jsonb, true, now(), now())
     on conflict (trailer_number) do update set
       last_reported_at = now(),
       updated_at = now()`,
    [trailerNumber.trim()],
  );
}

export async function beginSubmission(record: SubmissionRecord) {
  if (!databaseConfigured()) {
    const alreadyDelivered = fallbackSubmissionStatus.get(record.sessionId) === "delivered";
    if (!alreadyDelivered) rememberFallbackSubmission(record.sessionId, "processing");
    return { alreadyDelivered };
  }
  await ensureTrailerSchema();
  const sql = db();
  const existing = await sql.query(
    "select status from trailer_submissions where session_id = $1",
    [record.sessionId],
  );
  if (existing.rows[0]?.status === "delivered") return { alreadyDelivered: true };

  await sql.query(
    `insert into trailer_submissions (
       session_id, event_type, truck_number, driver_first, driver_last,
       trailer_pick, trailer_drop, notes, latitude, longitude, photo_count,
       status, error_message, updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'processing', null, now())
     on conflict (session_id) do update set
       status = 'processing',
       error_message = null,
       updated_at = now()`,
    [
      record.sessionId,
      record.eventType,
      record.truckNumber,
      record.driverFirst,
      record.driverLast,
      record.trailerPick,
      record.trailerDrop,
      record.notes,
      record.lat,
      record.lng,
      record.photoCount,
    ],
  );
  await Promise.all([
    touchReportedTrailer(record.trailerPick),
    touchReportedTrailer(record.trailerDrop),
  ]);
  return { alreadyDelivered: false };
}

export async function markSubmissionDelivered(sessionId: string) {
  if (!databaseConfigured()) {
    rememberFallbackSubmission(sessionId, "delivered");
    return;
  }
  await db().query(
    `update trailer_submissions
     set status = 'delivered', delivered_at = now(), updated_at = now()
     where session_id = $1`,
    [sessionId],
  );
}

export async function markSubmissionFailed(sessionId: string, error: unknown) {
  if (!databaseConfigured()) {
    rememberFallbackSubmission(sessionId, "failed");
    return;
  }
  await db().query(
    `update trailer_submissions
     set status = 'failed', error_message = $2, updated_at = now()
     where session_id = $1`,
    [sessionId, String(error).slice(0, 1000)],
  );
}
