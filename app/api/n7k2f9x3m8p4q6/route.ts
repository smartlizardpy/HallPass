import { createHash } from 'crypto';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const token = process.env.EBAY_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_ENDPOINT_URL;
  if (!token || !endpoint) {
    return Response.json(
      { error: 'EBAY_VERIFICATION_TOKEN and EBAY_ENDPOINT_URL must be set' },
      { status: 500 },
    );
  }

  const challengeCode = new URL(request.url).searchParams.get('challenge_code');
  if (!challengeCode) {
    return Response.json({ error: 'challenge_code is required' }, { status: 400 });
  }

  const challengeResponse = createHash('sha256')
    .update(challengeCode)
    .update(token)
    .update(endpoint)
    .digest('hex');

  return Response.json({ challengeResponse });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[ebay-account-deletion]', JSON.stringify(body));
  } catch {
    console.log('[ebay-account-deletion] non-json body');
  }
  return Response.json({});
}
