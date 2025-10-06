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

    const event_type   = String(form.get('event_type') || '');
    const truck_number = String(form.get('truck_number') || '');
    const driver_first = String(form.get('driver_first') || '');
    const driver_last  = String(form.get('driver_last')  || '');
    const trailer_pick = String(form.get('trailer_pick') || 'нет');
    const trailer_drop = String(form.get('trailer_drop') || 'нет');
    const notes        = String(form.get('notes') || '');

    if (!event_type || !truck_number || !driver_first || !driver_last) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // все файлы под ключом "photos"
    const files = form.getAll('photos') as unknown as File[];
    if (files.length !== 10) {
      return NextResponse.json({ error: `Ожидалось 10 фото, получено: ${files.length}` }, { status: 400 });
    }

    const attachments = await Promise.all(files.map(async (f, i) => ({
      filename: f?.name || `photo_${i+1}.jpg`,
      content: Buffer.from(await f.arrayBuffer()),
      contentType: f?.type || undefined,
    })));

    const when = new Date().toISOString().replace('T',' ').replace('Z',' UTC');
    const fullName = `${driver_first} ${driver_last}`.trim();
    const subject = `US Team Fleet — ${event_type} — Truck ${truck_number} — ${fullName}`;

    const bodyText = [
      `Event: ${event_type}`,
      `When: ${when}`,
      `Truck #: ${truck_number}`,
      `Driver: ${fullName}`,
      `Trailer picked: ${trailer_pick}`,
      `Trailer left: ${trailer_drop}`,
      `Notes: ${notes}`,
      `Photos: (10 attachments)`,
    ].join('\n');

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
