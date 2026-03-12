import type { VercelRequest, VercelResponse } from '@vercel/node';

const POLYGON_KEY = process.env.POLYGON_API_KEY!;
const BASE = 'https://api.polygon.io';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { ticker, expiration } = req.query;
  if (!ticker || typeof ticker !== 'string') return res.status(400).json({ error: 'ticker required' });

  const t = ticker.toUpperCase();

  try {
    // Get current price
    const quoteRes = await fetch(`${BASE}/v2/aggs/ticker/${t}/prev?apiKey=${POLYGON_KEY}`);
    const quote = await quoteRes.json();
    const bar = quote.results?.[0];
    if (!bar) return res.status(404).json({ error: `No quote for ${t}` });

    // Get options contracts
    const expParam = expiration ? `&expiration_date=${expiration}` : '';
    const contractsRes = await fetch(
      `${BASE}/v3/reference/options/contracts?underlying_ticker=${t}&contract_type=call&limit=250${expParam}&apiKey=${POLYGON_KEY}`
    );
    const putsRes = await fetch(
      `${BASE}/v3/reference/options/contracts?underlying_ticker=${t}&contract_type=put&limit=250${expParam}&apiKey=${POLYGON_KEY}`
    );

    const [contracts, puts] = await Promise.all([contractsRes.json(), putsRes.json()]);

    // Get snapshots for greeks + IV
    const snapshotRes = await fetch(
      `${BASE}/v3/snapshot/options/${t}?limit=250${expParam}&apiKey=${POLYGON_KEY}`
    );
    const snapshot = await snapshotRes.json();

    const snapMap: Record<string, any> = {};
    (snapshot.results ?? []).forEach((s: any) => {
      snapMap[s.details?.ticker ?? s.ticker] = s;
    });

    const formatContract = (c: any) => {
      const snap = snapMap[c.ticker] ?? {};
      const greeks = snap.greeks ?? {};
      const day = snap.day ?? {};
      const iv = snap.implied_volatility ?? 0;
      return {
        strike: c.strike_price,
        expiration: c.expiration_date,
        bid: day.open ?? 0,
        ask: day.close ?? 0,
        mid: day.vwap ?? (((day.open ?? 0) + (day.close ?? 0)) / 2),
        volume: day.volume ?? 0,
        open_interest: snap.open_interest ?? 0,
        implied_volatility: iv,
        delta: greeks.delta ?? 0,
        theta: greeks.theta ?? 0,
        gamma: greeks.gamma ?? 0,
        in_the_money: c.strike_price < bar.c,
      };
    };

    // Get unique expirations from both
    const allExpirations = [
      ...(contracts.results ?? []),
      ...(puts.results ?? []),
    ].map((c: any) => c.expiration_date).filter(Boolean);
    const expirations = [...new Set(allExpirations)].sort();

    // 52-week price range for IV rank proxy
    const histRes = await fetch(
      `${BASE}/v2/aggs/ticker/${t}/range/1/day/${new Date(Date.now() - 365*864e5).toISOString().split('T')[0]}/${new Date().toISOString().split('T')[0]}?limit=300&apiKey=${POLYGON_KEY}`
    );
    const hist = await histRes.json();
    const closes = (hist.results ?? []).map((r: any) => r.c as number);
    const high52 = closes.length ? Math.max(...closes) : bar.c;
    const low52 = closes.length ? Math.min(...closes) : bar.c;
    const iv_rank = high52 === low52 ? 50 : Math.round(((bar.c - low52) / (high52 - low52)) * 100);

    res.json({
      ticker: t,
      price: bar.c,
      change_pct: ((bar.c - bar.o) / bar.o) * 100,
      iv_rank,
      expirations,
      calls: (contracts.results ?? []).map(formatContract),
      puts: (puts.results ?? []).map(formatContract),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
