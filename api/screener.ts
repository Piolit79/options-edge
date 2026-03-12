import type { VercelRequest, VercelResponse } from '@vercel/node';

const POLYGON_KEY = process.env.POLYGON_API_KEY!;
const BASE = 'https://api.polygon.io';

async function getTickerData(ticker: string) {
  const today = new Date().toISOString().split('T')[0];
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];

  const histRes = await fetch(
    `${BASE}/v2/aggs/ticker/${ticker}/range/1/day/${yearAgo}/${today}?limit=300&apiKey=${POLYGON_KEY}`
  );
  const hist = await histRes.json();
  const bars = hist.results ?? [];
  if (bars.length < 50) return null;

  const closes = bars.map((b: any) => b.c as number);
  const latest = bars[bars.length - 1];
  const prev = bars[bars.length - 2];

  const ma50 = closes.slice(-50).reduce((a: number, b: number) => a + b, 0) / 50;
  const ma200 = closes.length >= 200 ? closes.slice(-200).reduce((a: number, b: number) => a + b, 0) / 200 : null;
  const rsi = calcRSI(closes.slice(-15));
  const change_pct = ((latest.c - prev.c) / prev.c) * 100;

  // IV rank: use 52-week high/low of close as proxy (real IV needs options data)
  const high52 = Math.max(...closes.slice(-252));
  const low52 = Math.min(...closes.slice(-252));
  const iv_rank = high52 === low52 ? 50 : Math.round(((latest.c - low52) / (high52 - low52)) * 100);

  // Signal detection
  const above_50ma = latest.c > ma50;
  const above_200ma = ma200 ? latest.c > ma200 : true;
  const dip_from_high = ((Math.max(...closes.slice(-10)) - latest.c) / Math.max(...closes.slice(-10))) * 100;

  let signal = 'none';
  let score = 0;

  if (above_50ma && above_200ma && rsi < 40 && dip_from_high > 3) {
    signal = 'momentum_dip'; score = 3;
  } else if (above_50ma && above_200ma && rsi < 35) {
    signal = 'oversold_uptrend'; score = 2;
  } else if (above_50ma && latest.c > Math.max(...closes.slice(-20, -1)) && latest.v > bars.slice(-20).reduce((a: any, b: any) => a + b.v, 0) / 20 * 1.5) {
    signal = 'breakout'; score = 2;
  }

  return {
    ticker,
    price: latest.c,
    change_pct,
    above_50ma,
    above_200ma,
    rsi,
    iv_rank,
    signal,
    score,
  };
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
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tickersParam = req.query.tickers as string;
  if (!tickersParam) return res.status(400).json({ error: 'tickers required' });

  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  try {
    // Process in parallel but rate-limit to 5 at a time (Polygon free tier)
    const results = [];
    for (let i = 0; i < tickers.length; i += 5) {
      const batch = tickers.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map(t => getTickerData(t).catch(() => null)));
      results.push(...batchResults.filter(Boolean));
      if (i + 5 < tickers.length) await new Promise(r => setTimeout(r, 12000)); // free tier: 5 req/min
    }
    res.json({ results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
