import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // не кэшируем

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;

    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname /*, clientPayload*/) => {
        // Можно добавить ACL/проверки. Пока разрешаем изображения.
        return {
          allowedContentTypes: [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/heic',
            'image/heif',
          ],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ p: pathname }), // вернётся в onUploadCompleted
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('✅ Blob uploaded:', blob.url, tokenPayload);
      },
    });

    return NextResponse.json(json);
  } catch (err: any) {
    console.error('❌ /api/upload error:', err?.message || err);
    // Очень важно вернуть читаемое сообщение — клиент покажет его
    return NextResponse.json(
      { error: 'upload-token-failed', detail: err?.message || 'unknown' },
      { status: 400 },
    );
  }
}

// На всякий случай — запретим GET
export async function GET() {
  return NextResponse.json({ error: 'method-not-allowed' }, { status: 405 });
}
