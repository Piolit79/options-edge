import type { VercelRequest, VercelResponse } from '@vercel/node';

const POLYGON_KEY = process.env.POLYGON_API_KEY!;
const BASE = 'https://api.polygon.io';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { ticker, expiration } = req.query;
  if (!ticker || typeof ticker !== 'string') return res.status(400).json({ error: 'ticker required' });

  const t = ticker.toUpperCase();

  try {
    // Get current stock price
    const quoteRes = await fetch(`${BASE}/v2/aggs/ticker/${t}/prev?apiKey=${POLYGON_KEY}`);
    const quote = await quoteRes.json();
    const bar = quote.results?.[0];
    if (!bar) return res.status(404).json({ error: `No quote for ${t}` });

    const stockPrice: number = bar.c;
    const changePct: number = ((bar.c - bar.o) / bar.o) * 100;

    // Get 52-week range for IV rank proxy
    const histRes = await fetch(
      `${BASE}/v2/aggs/ticker/${t}/range/1/day/${new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0]}/${new Date().toISOString().split('T')[0]}?limit=300&apiKey=${POLYGON_KEY}`
    );
    const hist = await histRes.json();
    const closes: number[] = (hist.results ?? []).map((r: any) => r.c);
    const high52 = closes.length ? Math.max(...closes) : stockPrice;
    const low52 = closes.length ? Math.min(...closes) : stockPrice;
    const iv_rank = high52 === low52 ? 50 : Math.round(((stockPrice - low52) / (high52 - low52)) * 100);

    // Get reference contracts (calls + puts)
    const expParam = expiration && typeof expiration === 'string' ? `&expiration_date=${expiration}` : '';
    const [callsRef, putsRef] = await Promise.all([
      fetch(`${BASE}/v3/reference/options/contracts?underlying_ticker=${t}&contract_type=call&limit=100${expParam}&apiKey=${POLYGON_KEY}`).then(r => r.json()),
      fetch(`${BASE}/v3/reference/options/contracts?underlying_ticker=${t}&contract_type=put&limit=100${expParam}&apiKey=${POLYGON_KEY}`).then(r => r.json()),
    ]);

    const callContracts: any[] = callsRef.results ?? [];
    const putContracts: any[] = putsRef.results ?? [];

    // Get all unique expirations
    const allExps = [...callContracts, ...putContracts].map((c: any) => c.expiration_date).filter(Boolean);
    const expirations = [...new Set(allExps)].sort();

    // Filter to selected expiration or nearest one, pick ~20 strikes around ATM
    const selectedExp = (expiration as string) || expirations[0];
    const atmStrike = Math.round(stockPrice / 5) * 5;

    const filterContracts = (contracts: any[]) =>
      contracts
        .filter((c: any) => c.expiration_date === selectedExp)
        .sort((a: any, b: any) => a.strike_price - b.strike_price)
        .slice(0, 20);

    const selectedCalls = filterContracts(callContracts);
    const selectedPuts = filterContracts(putContracts);

    // Fetch prev day agg for each contract (batched)
    const fetchAgg = async (optionTicker: string) => {
      const r = await fetch(`${BASE}/v2/aggs/ticker/${encodeURIComponent(optionTicker)}/prev?apiKey=${POLYGON_KEY}`);
      const d = await r.json();
      return d.results?.[0] ?? null;
    };

    const [callAggs, putAggs] = await Promise.all([
      Promise.all(selectedCalls.map((c: any) => fetchAgg(c.ticker))),
      Promise.all(selectedPuts.map((c: any) => fetchAgg(c.ticker))),
    ]);

    const formatContract = (contract: any, agg: any) => ({
      strike: contract.strike_price,
      expiration: contract.expiration_date,
      ticker: contract.ticker,
      bid: agg?.o ?? 0,
      ask: agg?.c ?? 0,
      mid: agg?.vw ?? ((( agg?.o ?? 0) + (agg?.c ?? 0)) / 2),
      volume: agg?.v ?? 0,
      open_interest: 0,
      in_the_money: contract.contract_type === 'call'
        ? contract.strike_price < stockPrice
        : contract.strike_price > stockPrice,
    });

    res.json({
      ticker: t,
      price: stockPrice,
      change_pct: changePct,
      iv_rank,
      expirations,
      calls: selectedCalls.map((c, i) => formatContract(c, callAggs[i])),
      puts: selectedPuts.map((c, i) => formatContract(c, putAggs[i])),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
