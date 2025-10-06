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
4) Deploy.
