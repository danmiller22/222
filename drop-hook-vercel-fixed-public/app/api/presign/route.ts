// app/api/presign/route.ts
import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REGION = process.env.S3_REGION!;
const BUCKET = process.env.S3_BUCKET!;
const PUBLIC_BASE = (process.env.S3_PUBLIC_BASE || '').replace(/\/+$/, '');

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(req: Request) {
  try {
    const { filename, contentType } = await req.json();
    if (!filename || !contentType) {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }

    // filename приходит уже с папкой (например: drops/1699999999999_1.jpg)
    const key = filename.replace(/^\/+/, '');

    const put = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ACL: 'public-read', // либо убери и раздавай через приватный CDN/CloudFront
    });

    const url = await getSignedUrl(s3, put, { expiresIn: 900 }); // 15 минут
    const publicUrl = `${PUBLIC_BASE}/${key}`;

    return NextResponse.json({ url, key, publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'presign failed' }, { status: 500 });
  }
}
