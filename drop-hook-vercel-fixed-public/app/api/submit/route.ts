import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const lang = (String(form.get('lang') || 'en') === 'ru') ? 'ru' : 'en';

    const event_type   = String(form.get('event_type') || '');
    const truck_number = String(form.get('truck_number') || '');
    const driver_first = String(form.get('driver_first') || '');
    const driver_last  = String(form.get('driver_last')  || '');
    const trailer_pick = String(form.get('trailer_pick') || (lang==='ru'?'Напишите номер трейлера':'Trailer number'));
    const trailer_drop = String(form.get('trailer_drop') || (lang==='ru'?'Напишите номер трейлера':'Trailer number'));
    const notes        = String(form.get('notes') || '');

    if (!event_type || !truck_number || !driver_first || !driver_last) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // gather photos
    const files = form.getAll('photos') as unknown as File[];
    if (files.length !== 10) {
      return NextResponse.json({ error: `Expected 10 photos, got: ${files.length}` }, { status: 400 });
    }
    const attachments = await Promise.all(files.map(async (f, i) => ({
      filename: f?.name || `photo_${i+1}.jpg`,
      content: Buffer.from(await f.arrayBuffer()),
      contentType: f?.type || undefined,
    })));

    // Chicago time
    const dt = new Intl.DateTimeFormat(lang==='ru'?'ru-RU':'en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date());
    const when = `${dt} America/Chicago`;

    const fullName = `${driver_first} ${driver_last}`.trim();
    const subject = `US Team Fleet — ${event_type} — Truck ${truck_number} — ${fullName}`;

    const bodyText = (lang==='ru'
      ? [
          `Event: ${event_type}`,
          `When: ${when}`,
          `Truck #: ${truck_number}`,
          `Driver: ${fullName}`,
          `Trailer picked: ${trailer_pick}`,
          `Trailer left: ${trailer_drop}`,
          `Notes: ${notes}`,
          `Photos: (10 attachments)`,
        ].join('\n')
      : [
          `Event: ${event_type}`,
          `When: ${when}`,
          `Truck #: ${truck_number}`,
          `Driver: ${fullName}`,
          `Trailer picked: ${trailer_pick}`,
          `Trailer left: ${trailer_drop}`,
          `Notes: ${notes}`,
          `Photos: (10 attachments)`,
        ].join('\n')
    );

    const transporter = nodemailer.createTransport({
      host: envOrThrow('SMTP_HOST'),
      port: Number(envOrThrow('SMTP_PORT')),
      secure: String(process.env.USE_SSL||'false').toLowerCase()==='true',
      auth: { user: envOrThrow('SMTP_USER'), pass: envOrThrow('SMTP_PASS') },
    });

    await transporter.sendMail({
      from: envOrThrow('SMTP_USER'),
      to: envOrThrow('EMAIL_TO'),
      subject,
      text: bodyText,
      attachments,
    });

    return NextResponse.json({ ok: true });
  } catch (err:any) {
    console.error('submit failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Submit failed' }, { status: 500 });
  }
}
