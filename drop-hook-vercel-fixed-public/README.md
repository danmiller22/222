# Drop/Hook — Next.js (TypeScript) for Vercel (Node 22)

## Deploy
1) Push to a repo with **app/** and **package.json** at the repo root.
2) Vercel → New Project → Next.js, Root Directory: `/`, Node 22.
3) ENV (Production):
   - `NEXT_PUBLIC_BLOB_READ_WRITE_TOKEN`
   - `SMTP_HOST`=`smtp.gmail.com`
   - `SMTP_PORT`=`587` or `465`
   - `SMTP_USER`, `SMTP_PASS`, `EMAIL_TO`
   - `USE_SSL`=`false` or `true`
   - `DATABASE_URL` (Postgres connection string)
   - `TRAILER_SYNC_SECRET`
   - SkyBitz / XTRA Lease: `SKYBITZ_USERNAME`, `SKYBITZ_PASSWORD`; optional
     `SKYBITZ_SERVICE_URL` (defaults to `https://xml.skybitz.com/`) and
     `SKYBITZ_API_VERSION` (defaults to `2.76`).
   - Premier / Spireon FleetLocate: `SPIREON_USERNAME`, `SPIREON_PASSWORD`;
     optional `SPIREON_CLIENT_ID` (defaults to `atiWeb`),
     `SPIREON_AUTH_URL`, `SPIREON_PLATFORM_URL`,
     `SPIREON_IDENTITY_URL`, `SPIREON_ASSETS_URL` (defaults to the
     FleetLocate Transportation AVS catalog), and `SPIREON_APP_TOKEN`.
   - For offline testing only, either catalog can instead be supplied as
     `XTRALEASE_TRAILERS_DATA` / `PREMIER_TRAILERS_DATA` (JSON or a
     comma/newline list).
4) Deploy.

The app creates the `trailers`, `trailer_submissions`, and
`trailer_catalog_syncs` tables automatically. To force a protected catalog
refresh, send `POST /api/trailers/sync` with
`Authorization: Bearer <TRAILER_SYNC_SECRET>`.
Each provider is refreshed at most once per 12 hours (maximum two catalog
requests per provider per day). All form submissions use the database between
refreshes and do not call either provider.

No paid add-on is required by this change. Use a PostgreSQL provider's free
plan for `DATABASE_URL`; the included integration test uses a free local
in-memory PostgreSQL-compatible database.
