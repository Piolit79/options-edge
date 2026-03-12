import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { buildOCCSymbol, buildPolygonSymbol, placeLiveOrder } from './tt-place';

const supabase = createClient(
  process.env.SUPABASE_URL ?? 'https://nlusfndskgdcottasfdy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sdXNmbmRza2dkY290dGFzZmR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NTY0NDYsImV4cCI6MjA4ODMzMjQ0Nn0.sGSdCsQl0wgAHk5L-xi6ZdrLkuAEaHcdhJ8uazjTjbA'
);

const POLYGON_KEY = process.env.POLYGON_API_KEY!;
const POLYGON = 'https://api.polygon.io';

const CONVICTION_RISK: Record<number, number> = { 3: 0.03, 2: 0.02, 1: 0.01 };

async function getSettings(): Promise<Record<string, string>> {
  const { data } = await supabase.from('oe_settings').select('key, value');
  return Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
}

async function getWatchlist(): Promise<string[]> {
  const { data } = await supabase.from('oe_watchlist').select('ticker');
  const tickers = (data ?? []).map((r: any) => r.ticker as string);
  return tickers.length ? tickers : ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AMD'];
}

async function getOpenPositionTickers(): Promise<string[]> {
  const { data } = await supabase.from('oe_auto_orders').select('ticker').eq('status', 'open');
  return (data ?? []).map((r: any) => r.ticker as string);
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

async function scoreTickerSignal(ticker: string): Promise<{ signal: string; score: number; price: number } | null> {
  const today = new Date().toISOString().split('T')[0];
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];

  const histRes = await fetch(
    `${POLYGON}/v2/aggs/ticker/${ticker}/range/1/day/${yearAgo}/${today}?limit=300&apiKey=${POLYGON_KEY}`
  );
  const hist = await histRes.json();
  const bars = hist.results ?? [];
  if (bars.length < 50) return null;

  const closes: number[] = bars.map((b: any) => b.c);
  const latest = bars[bars.length - 1];

  const ma50 = closes.slice(-50).reduce((a: number, b: number) => a + b, 0) / 50;
  const ma200 = closes.length >= 200 ? closes.slice(-200).reduce((a: number, b: number) => a + b, 0) / 200 : null;
  const rsi = calcRSI(closes.slice(-15));
  const above50 = latest.c > ma50;
  const above200 = ma200 ? latest.c > ma200 : true;
  const recentHigh = Math.max(...closes.slice(-10));
  const dip = ((recentHigh - latest.c) / recentHigh) * 100;
  const avgVol = bars.slice(-20).reduce((a: any, b: any) => a + b.v, 0) / 20;

  let signal = 'none';
  let score = 0;

  if (above50 && above200 && rsi < 40 && dip > 3) {
    signal = 'momentum_dip'; score = 3;
  } else if (above50 && above200 && rsi < 35) {
    signal = 'oversold_uptrend'; score = 2;
  } else if (above50 && latest.c > Math.max(...closes.slice(-20, -1)) && latest.v > avgVol * 1.5) {
    signal = 'breakout'; score = 2;
  }

  return { signal, score, price: latest.c };
}

async function findBestOption(ticker: string, stockPrice: number): Promise<{
  strike: number; expiration: string; mid: number; optionTicker: string;
} | null> {
  // Get reference contracts — calls, 30–75 DTE
  const contractsRes = await fetch(
    `${POLYGON}/v3/reference/options/contracts?underlying_ticker=${ticker}&contract_type=call&limit=100&apiKey=${POLYGON_KEY}`
  );
  const contractsData = await contractsRes.json();
  const contracts: any[] = contractsData.results ?? [];

  const now = Date.now();
  const candidates = contracts
    .map((c: any) => {
      const dte = Math.round((new Date(c.expiration_date).getTime() - now) / 864e5);
      const distFromATM = Math.abs(c.strike_price - stockPrice);
      return { strike: c.strike_price, expiration: c.expiration_date, dte, distFromATM, optionTicker: c.ticker };
    })
    .filter((c: any) => c.dte >= 30 && c.dte <= 75);

  if (!candidates.length) {
    // Fallback: nearest expiration >= 45 days, ATM strike
    const exp = new Date();
    exp.setDate(exp.getDate() + 45);
    const strike = Math.round(stockPrice / 5) * 5;
    const optionTicker = buildPolygonSymbol(ticker, exp.toISOString().split('T')[0], 'call', strike);
    return { strike, expiration: exp.toISOString().split('T')[0], mid: stockPrice * 0.025, optionTicker };
  }

  // Sort by closest strike to ATM, then closest DTE to 52
  candidates.sort((a: any, b: any) => a.distFromATM - b.distFromATM || Math.abs(a.dte - 52) - Math.abs(b.dte - 52));
  const best = candidates[0];

  // Get prev day price for this contract
  const aggRes = await fetch(
    `${POLYGON}/v2/aggs/ticker/${encodeURIComponent(best.optionTicker)}/prev?apiKey=${POLYGON_KEY}`
  );
  const aggData = await aggRes.json();
  const agg = aggData.results?.[0];
  const mid = agg?.vw ?? agg?.c ?? (stockPrice * 0.025);

  return { strike: best.strike, expiration: best.expiration, mid, optionTicker: best.optionTicker };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const settings = await getSettings();

    if (settings.auto_enabled !== 'true') {
      return res.json({ message: 'Auto-trader is disabled. Enable it on the Auto Trader page.', orders: [] });
    }

    // Market hours check (9:30–16:00 ET = 14:30–21:00 UTC)
    const now = new Date();
    const utcTotal = now.getUTCHours() * 60 + now.getUTCMinutes();
    const day = now.getUTCDay();
    if (day === 0 || day === 6 || utcTotal < 14 * 60 + 30 || utcTotal > 21 * 60) {
      return res.json({ message: 'Market is closed.', orders: [] });
    }

    const maxPositions = parseInt(settings.max_positions ?? '5');
    const virtualBalance = parseFloat(settings.virtual_balance ?? '10000');
    const minConviction = parseInt(settings.min_conviction ?? '2');
    const isSimulation = settings.mode !== 'live';

    const [watchlist, openTickers] = await Promise.all([getWatchlist(), getOpenPositionTickers()]);
    const { count } = await supabase.from('oe_auto_orders').select('*', { count: 'exact', head: true }).eq('status', 'open') as any;
    const openCount = count ?? 0;

    if (openCount >= maxPositions) {
      return res.json({ message: `Max positions (${maxPositions}) reached.`, orders: [] });
    }

    const placed: any[] = [];

    for (const ticker of watchlist) {
      if (openCount + placed.length >= maxPositions) break;
      if (openTickers.includes(ticker)) continue;

      const signal = await scoreTickerSignal(ticker).catch(() => null);
      if (!signal || signal.score < minConviction || signal.signal === 'none') continue;

      const option = await findBestOption(ticker, signal.price).catch(() => null);
      if (!option || option.mid <= 0) continue;

      const riskPct = CONVICTION_RISK[signal.score] ?? 0.02;
      const riskDollars = virtualBalance * riskPct;
      const costPerContract = option.mid * 100;
      const contracts = Math.max(1, Math.floor(riskDollars / costPerContract));

      const occSymbol = buildOCCSymbol(ticker, option.expiration, 'call', option.strike);
      const polygonSymbol = buildPolygonSymbol(ticker, option.expiration, 'call', option.strike);

      let ttOrderId: string | undefined;
      let filledPrice = option.mid;

      if (!isSimulation) {
        try {
          const result = await placeLiveOrder(ticker, option.expiration, 'call', option.strike, contracts, option.mid);
          ttOrderId = result.orderId;
          filledPrice = result.fillPrice;
        } catch (e: any) {
          console.error(`Live order failed for ${ticker}:`, e.message);
          continue;
        }
      }

      const order = {
        id: crypto.randomUUID(),
        ticker,
        option_symbol: occSymbol,
        polygon_symbol: polygonSymbol,
        strike: option.strike,
        expiration: option.expiration,
        option_type: 'call',
        contracts,
        entry_price: filledPrice,
        signal_type: signal.signal,
        conviction: signal.score,
        risk_pct: riskPct * 100,
        status: 'open',
        simulated: isSimulation,
        filled_price: filledPrice,
        tt_order_id: ttOrderId ?? null,
        opened_at: new Date().toISOString(),
      };

      await supabase.from('oe_auto_orders').insert(order);
      placed.push(order);
    }

    res.json({ message: `Scan complete — ${placed.length} order(s) placed`, orders: placed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
