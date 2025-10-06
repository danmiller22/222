import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export const runtime = 'nodejs';

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event_type, truck_number, driver_first, driver_last, trailer_pick, trailer_drop, notes, photo_urls } = body || {};
    if (!event_type || !truck_number || !driver_first || !driver_last) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!Array.isArray(photo_urls) || photo_urls.length !== 10) {
      return NextResponse.json({ error: '10 photo URLs required' }, { status: 400 });
    }

    const when = new Date().toISOString().replace('T',' ').replace('Z',' UTC');
    const fullName = `${driver_first} ${driver_last}`.trim();

    const lines = [
      `Event: ${event_type}`,
      `When: ${when}`,
      `Truck #: ${truck_number}`,
      `Driver: ${fullName}`,
      `Trailer picked: ${trailer_pick||''}`,
      `Trailer left: ${trailer_drop||''}`,
      `Notes: ${notes||''}`,
      `Photos:`,
      ...photo_urls.map((u:string, idx:number)=> `  ${idx+1}. ${u}`),
    ];
    const bodyText = lines.join('\n');

    const host = envOrThrow('SMTP_HOST');
    const port = Number(envOrThrow('SMTP_PORT'));
    const user = envOrThrow('SMTP_USER');
    const pass = envOrThrow('SMTP_PASS');
    const to   = envOrThrow('EMAIL_TO');
    const useSSL = String(process.env.USE_SSL||'false').toLowerCase()==='true';

    const transporter = nodemailer.createTransport({
      host, port,
      secure: useSSL,
      auth: { user, pass }
    });

    const subject = `${event_type} — Truck ${truck_number} — ${fullName}`;
    await transporter.sendMail({ from: user, to, subject, text: bodyText });

    return NextResponse.json({ ok: true });
  } catch (err:any) {
    console.error('Submit failed', err);
    return NextResponse.json({ error: err?.message || 'Submit failed' }, { status: 500 });
  }
}
