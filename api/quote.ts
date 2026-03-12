import type { VercelRequest, VercelResponse } from '@vercel/node';

const POLYGON_KEY = process.env.POLYGON_API_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { ticker } = req.query;
  if (!ticker || typeof ticker !== 'string') return res.status(400).json({ error: 'ticker required' });

  const t = ticker.toUpperCase();
  try {
    const [quoteRes, detailsRes] = await Promise.all([
      fetch(`https://api.polygon.io/v2/aggs/ticker/${t}/prev?apiKey=${POLYGON_KEY}`),
      fetch(`https://api.polygon.io/v3/reference/tickers/${t}?apiKey=${POLYGON_KEY}`),
    ]);

    const [quote, details] = await Promise.all([quoteRes.json(), detailsRes.json()]);
    const bar = quote.results?.[0];
    if (!bar) return res.status(404).json({ error: `No data for ${t}` });

    // Get 200 days of history for MA calculations
    const histRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${t}/range/1/day/2024-01-01/${new Date().toISOString().split('T')[0]}?limit=300&apiKey=${POLYGON_KEY}`
    );
    const hist = await histRes.json();
    const closes = (hist.results ?? []).map((r: any) => r.c as number);

    const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((a: number, b: number) => a + b, 0) / 50 : null;
    const ma200 = closes.length >= 200 ? closes.slice(-200).reduce((a: number, b: number) => a + b, 0) / 200 : null;

    // RSI (14)
    const rsi = calcRSI(closes.slice(-15), 14);

    res.json({
      ticker: t,
      price: bar.c,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      volume: bar.v,
      change: bar.c - bar.o,
      change_pct: ((bar.c - bar.o) / bar.o) * 100,
      ma50,
      ma200,
      above_50ma: ma50 ? bar.c > ma50 : null,
      above_200ma: ma200 ? bar.c > ma200 : null,
      rsi,
      name: details.results?.name ?? t,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
