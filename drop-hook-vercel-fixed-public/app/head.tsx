// app/head.tsx
export default function Head() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://hook-drop-form.vercel.app';
  const title = 'Trailer Hook-Drop — Mandatory Form';
  const desc  = 'Drop / Hook mandatory form';
  const url   = `${base}/`;
  const image = `${base}/logo.png`; // лучше 1200x630, можно заменить на /og.png, если подготовишь

  return (
    <>
      <title>{title}</title>

      {/* Basic */}
      <meta name="viewport" content="width=device-width, initial-scale=1" />

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="US Team Fleet" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={desc} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:image:alt" content="US Team Fleet" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={image} />

      {/* No index if нужно — убери если хочешь индексацию */}
      {/* <meta name="robots" content="noindex,nofollow" /> */}
    </>
  );
}
