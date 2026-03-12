import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStockSnapshot, getOptionsChain, getOptionSnapshots } from './lib/alpaca.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { ticker, expiration } = req.query;
  if (!ticker || typeof ticker !== 'string') return res.status(400).json({ error: 'ticker required' });

  const t = ticker.toUpperCase().trim();

  try {
    // Stock quote from Alpaca
    const snapshot = await getStockSnapshot(t);
    const stockPrice = snapshot.latestTrade?.p ?? snapshot.dailyBar?.c ?? 0;
    const prevClose = snapshot.prevDailyBar?.c ?? snapshot.dailyBar?.o ?? stockPrice;
    const changePct = prevClose > 0 ? ((stockPrice - prevClose) / prevClose) * 100 : 0;

    if (stockPrice === 0) return res.status(404).json({ error: `No quote found for ${t}` });

    // Fetch options chain — calls and puts, 0–180 DTE
    const [callContracts, putContracts] = await Promise.all([
      getOptionsChain(t, 'call', 0, 180),
      getOptionsChain(t, 'put', 0, 180),
    ]);

    // All unique expirations
    const allExps = [...callContracts, ...putContracts]
      .map(c => c.expiration_date)
      .filter(Boolean);
    const expirations = [...new Set(allExps)].sort();

    // Select expiration
    const selectedExp = (typeof expiration === 'string' ? expiration : null) ?? expirations[0];

    // Filter contracts to selected expiration, pick ~20 strikes nearest ATM
    const filterNearATM = (contracts: typeof callContracts) => {
      const filtered = contracts.filter(c => c.expiration_date === selectedExp);
      filtered.sort((a, b) => parseFloat(a.strike_price as any) - parseFloat(b.strike_price as any));
      // Find ATM index and return 10 below + 10 above
      const atmIdx = filtered.findIndex(c => parseFloat(c.strike_price as any) >= stockPrice);
      const start = Math.max(0, atmIdx - 10);
      return filtered.slice(start, start + 20);
    };

    const selectedCalls = filterNearATM(callContracts);
    const selectedPuts = filterNearATM(putContracts);

    // Batch fetch snapshots (greeks + IV + bid/ask)
    const allSymbols = [...selectedCalls, ...selectedPuts].map(c => c.symbol);
    const snapshots = await getOptionSnapshots(allSymbols);

    const formatContract = (contract: typeof callContracts[0]) => {
      const snap = snapshots[contract.symbol];
      const bid = snap?.latestQuote?.bp ?? 0;
      const ask = snap?.latestQuote?.ap ?? 0;
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
      const strike = parseFloat(contract.strike_price as any);
      return {
        strike,
        expiration: contract.expiration_date,
        ticker: contract.symbol,
        bid: Math.round(bid * 100) / 100,
        ask: Math.round(ask * 100) / 100,
        mid: Math.round(mid * 100) / 100,
        volume: 0,
        open_interest: parseFloat((contract.open_interest ?? snap?.openInterest ?? 0) as any) || 0,
        implied_volatility: snap?.impliedVolatility != null ? Math.round(snap.impliedVolatility * 1000) / 10 : null,
        delta: snap?.greeks?.delta != null ? Math.round(snap.greeks.delta * 1000) / 1000 : null,
        theta: snap?.greeks?.theta != null ? Math.round(snap.greeks.theta * 1000) / 1000 : null,
        gamma: snap?.greeks?.gamma != null ? Math.round(snap.greeks.gamma * 10000) / 10000 : null,
        in_the_money: contract.type === 'call' ? strike < stockPrice : strike > stockPrice,
      };
    };

    // IV rank proxy from Alpaca snapshot (use max IV across chain as rough rank)
    const ivValues = Object.values(snapshots)
      .map(s => s.impliedVolatility ?? 0)
      .filter(v => v > 0);
    const avgIV = ivValues.length ? ivValues.reduce((a, b) => a + b, 0) / ivValues.length : 0;
    // Simple IV rank: position of current avg IV vs historical range (proxy: 0–100 from 10%–80% IV)
    const iv_rank = Math.min(100, Math.max(0, Math.round(((avgIV - 0.10) / 0.70) * 100)));

    res.json({
      ticker: t,
      price: stockPrice,
      change_pct: Math.round(changePct * 100) / 100,
      iv_rank,
      expirations,
      calls: selectedCalls.map(formatContract),
      puts: selectedPuts.map(formatContract),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
