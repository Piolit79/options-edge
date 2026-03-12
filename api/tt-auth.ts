// Tastytrade session token — cached in module scope
// (Vercel may reuse warm lambdas, so this helps reduce auth calls)
let cachedToken: string | null = null;
let tokenExpiry = 0;

const TT_BASE = 'https://api.tastyworks.com';

export async function getTTToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${TT_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: process.env.TT_USERNAME,
      password: process.env.TT_PASSWORD,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? 'Tastytrade auth failed');

  cachedToken = data.data['session-token'];
  tokenExpiry = Date.now() + 20 * 60 * 1000; // tokens last ~24h, refresh every 20min
  return cachedToken!;
}

export { TT_BASE };
