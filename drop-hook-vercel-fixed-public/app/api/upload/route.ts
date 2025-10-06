import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname /*, clientPayload*/) => {
        return {
          allowedContentTypes: [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/heic',
            'image/heif',
          ],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({}), // вернётся в onUploadCompleted (если нужно)
        };
      },
      onUploadCompleted: async ({ blob /*, tokenPayload*/ }) => {
        console.log('blob upload completed:', blob.url);
      },
    });

    return NextResponse.json(json);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
