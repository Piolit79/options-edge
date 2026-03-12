import type { VercelRequest, VercelResponse } from '@vercel/node';
import { UNIVERSE, TIER1_TICKERS } from './lib/universe.js';

const POLYGON = 'https://api.polygon.io';
const POLYGON_KEY = process.env.POLYGON_API_KEY!;

// ── Black-Scholes ────────────────────────────────────────────────────────────
function normalCDF(x: number): number {
  const a = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  let poly = 0, kn = k;
  for (const ai of a) { poly += ai * kn; kn *= k; }
  const pdf = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

function bsCall(S: number, K: number, T: number, sigma: number, r = 0.045): number {
  if (T <= 0) return Math.max(S - K, 0);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
}

function annualVol(closes: number[], window = 30): number {
  const slice = closes.slice(-window);
  if (slice.length < 10) return 0.30;
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0) returns.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (returns.length < 5) return 0.30;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

// ── Improved signal detection ────────────────────────────────────────────────
// Tighter criteria vs v1 + market regime filter (spyAboveMa50)
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const gains: number[] = [], losses: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function detectSignal(
  closes: number[],
  volumes: number[],
  spyAboveMa50: boolean,
): { signal: string; score: number } | null {
  if (closes.length < 201) return null;

  const price  = closes[closes.length - 1];
  const prev1  = closes[closes.length - 2];
  const ma50   = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const ma200  = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
  const high52 = Math.max(...closes.slice(-252));
  const rsi    = calcRSI(closes.slice(-16));

  const above50  = price > ma50;
  const above200 = price > ma200;
  // Only trade long calls when broad market is in an uptrend
  if (!spyAboveMa50) return null;

  const recentHigh10 = Math.max(...closes.slice(-10));
  const dipPct = ((recentHigh10 - price) / recentHigh10) * 100;

  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const lastVol  = volumes[volumes.length - 1];

  // ── Momentum Dip (best setup) ─────────────────────────────────────────────
  // Requirements: strong uptrend, fresh RSI oversold, dip is 4-12% (not a collapse),
  // dip volume not surging (institutional buying, not panic selling),
  // still within 20% of 52w high (the trend is intact)
  if (
    above50 && above200 &&
    rsi < 38 &&
    dipPct >= 4 && dipPct <= 12 &&
    lastVol < avgVol20 * 1.5 &&        // volume fading = selling exhaustion
    price > high52 * 0.80              // still within 20% of year high
  ) return { signal: 'momentum_dip', score: 3 };

  // ── Oversold in Uptrend ───────────────────────────────────────────────────
  // Deeper oversold RSI, still in uptrend, within 20% of high
  if (
    above50 && above200 &&
    rsi < 32 &&
    price > high52 * 0.80
  ) return { signal: 'oversold_uptrend', score: 2 };

  // ── Breakout ──────────────────────────────────────────────────────────────
  // New 20-day high on strong volume, RSI in healthy momentum zone (not overbought)
  const high20prev = Math.max(...closes.slice(-21, -1));
  if (
    above50 && above200 &&
    price > high20prev &&
    lastVol > avgVol20 * 2.0 &&        // strong volume confirmation (raised from 1.5x)
    rsi > 50 && rsi < 70              // healthy momentum, not overbought
  ) return { signal: 'breakout', score: 2 };

  return null;
}

// ── Fetch historical bars from Polygon ───────────────────────────────────────
async function fetchBars(ticker: string, days: number): Promise<{ c: number; v: number; t: string }[]> {
  const from = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const to   = new Date().toISOString().split('T')[0];
  const url  = `${POLYGON}/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?limit=1000&apiKey=${POLYGON_KEY}`;
  const r = await fetch(url);
  const d = await r.json();
  return (d.results ?? []).map((b: any) => ({ c: b.c, v: b.v, t: new Date(b.t).toISOString().split('T')[0] }));
}

export interface BacktestTrade {
  ticker: string;
  signal: string;
  score: number;
  entryDate: string;
  exitDate: string;
  daysHeld: number;
  stockEntryPrice: number;
  strike: number;
  entryOptionPrice: number;
  exitOptionPrice: number;
  peakOptionPrice: number;     // highest price the option reached
  pnlPct: number;
  pnlDollars: number;
  closeReason: 'profit_target' | 'trailing_stop' | 'stop_loss' | 'expired';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const {
    sectors      = 'tier1',
    days         = '365',
    profit_target = '50',
    stop_loss    = '35',
    trailing     = 'true',    // trailing stop on by default
    trail_pct    = '25',      // trail 25% below peak once in profit
    trail_trigger = '25',     // start trailing once up 25%
    min_conviction = '2',
    dte          = '45',
  } = req.query as Record<string, string>;

  // Resolve ticker list from universe
  let tickerList: string[];
  if (sectors === 'tier1') {
    tickerList = TIER1_TICKERS;
  } else if (sectors === 'all') {
    tickerList = Object.values(UNIVERSE).flat();
  } else {
    const sectorList = sectors.split(',').map(s => s.trim());
    tickerList = sectorList.flatMap(s => UNIVERSE[s] ?? []);
    if (!tickerList.length) tickerList = TIER1_TICKERS;
  }

  const daysBack      = parseInt(days);
  const profitTarget  = parseFloat(profit_target) / 100;
  const stopLoss      = parseFloat(stop_loss) / 100;
  const useTrailing   = trailing === 'true';
  const trailPct      = parseFloat(trail_pct) / 100;      // e.g. 0.25 = trail 25% below peak
  const trailTrigger  = parseFloat(trail_trigger) / 100;  // e.g. 0.25 = start trailing at +25%
  const minConviction = parseInt(min_conviction);
  const targetDte     = parseInt(dte);

  // Fetch SPY first for market regime filter
  const spyBars = await fetchBars('SPY', daysBack + 300).catch(() => [] as { c: number; v: number; t: string }[]);

  const allTrades: BacktestTrade[] = [];

  for (const ticker of tickerList) {
    try {
      const bars = await fetchBars(ticker, daysBack + 260);
      if (bars.length < 220) continue;

      let lastEntryIdx = -999;

      for (let i = 200; i < bars.length; i++) {
        // Only scan bars within the requested date range
        const barDate = bars[i].t;
        const cutoff  = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
        if (barDate < cutoff) continue;

        const closes  = bars.slice(0, i + 1).map(b => b.c);
        const volumes = bars.slice(0, i + 1).map(b => b.v);

        // Market regime: is SPY above its 50-day MA on this date?
        const spyIdx = spyBars.findIndex(b => b.t >= barDate);
        const spySlice = spyIdx >= 50 ? spyBars.slice(0, spyIdx + 1).map(b => b.c) : [];
        const spyMa50 = spySlice.length >= 50
          ? spySlice.slice(-50).reduce((a, b) => a + b, 0) / 50
          : null;
        const spyAboveMa50 = spyMa50 === null || spySlice[spySlice.length - 1] > spyMa50;

        const sig = detectSignal(closes, volumes, spyAboveMa50);
        if (!sig || sig.score < minConviction) continue;

        // Avoid re-entering within 30 days on same ticker
        if (i - lastEntryIdx < 30) continue;
        lastEntryIdx = i;

        const stockEntryPrice = bars[i].c;
        const strike          = Math.round(stockEntryPrice / 5) * 5;
        const sigma           = annualVol(closes);
        const T0              = targetDte / 365.25;
        const entryOptionPrice = bsCall(stockEntryPrice, strike, T0, sigma);
        if (entryOptionPrice < 0.10) continue;

        // ── Simulate the trade day-by-day ──────────────────────────────────
        let exitDate        = bars[Math.min(i + targetDte, bars.length - 1)].t;
        let exitOptionPrice = entryOptionPrice;
        let peakOptionPrice = entryOptionPrice;
        let closeReason: BacktestTrade['closeReason'] = 'expired';
        let daysHeld        = 0;
        let trailingStopLevel = 0; // 0 = not yet active

        for (let j = i + 1; j < Math.min(i + targetDte + 1, bars.length); j++) {
          const daysLeft = targetDte - (j - i);
          const T        = Math.max(daysLeft / 365.25, 0);
          const futSigma = annualVol(bars.slice(0, j + 1).map(b => b.c));
          const curPrice = bsCall(bars[j].c, strike, T, futSigma);
          const curPnlPct = (curPrice - entryOptionPrice) / entryOptionPrice;

          // Update peak
          if (curPrice > peakOptionPrice) peakOptionPrice = curPrice;

          // Activate / update trailing stop
          if (useTrailing && curPnlPct >= trailTrigger) {
            const newStop = peakOptionPrice * (1 - trailPct);
            trailingStopLevel = Math.max(trailingStopLevel, newStop);
          }

          // Fixed profit target
          if (curPnlPct >= profitTarget) {
            exitDate = bars[j].t; exitOptionPrice = curPrice;
            closeReason = 'profit_target'; daysHeld = j - i; break;
          }

          // Trailing stop (only fires if we're still above entry)
          if (useTrailing && trailingStopLevel > 0 && curPrice <= trailingStopLevel) {
            exitDate = bars[j].t; exitOptionPrice = curPrice;
            closeReason = 'trailing_stop'; daysHeld = j - i; break;
          }

          // Hard stop loss
          if (curPnlPct <= -stopLoss) {
            exitDate = bars[j].t; exitOptionPrice = curPrice;
            closeReason = 'stop_loss'; daysHeld = j - i; break;
          }

          if (j === Math.min(i + targetDte, bars.length - 1)) {
            exitDate = bars[j].t; exitOptionPrice = curPrice;
            closeReason = 'expired'; daysHeld = j - i;
          }
        }

        const pnlPct    = ((exitOptionPrice - entryOptionPrice) / entryOptionPrice) * 100;
        const pnlDollars = (exitOptionPrice - entryOptionPrice) * 100;

        allTrades.push({
          ticker,
          signal:          sig.signal,
          score:           sig.score,
          entryDate:       barDate,
          exitDate,
          daysHeld,
          stockEntryPrice: Math.round(stockEntryPrice * 100) / 100,
          strike,
          entryOptionPrice: Math.round(entryOptionPrice * 100) / 100,
          exitOptionPrice:  Math.round(exitOptionPrice * 100) / 100,
          peakOptionPrice:  Math.round(peakOptionPrice * 100) / 100,
          pnlPct:           Math.round(pnlPct * 10) / 10,
          pnlDollars:       Math.round(pnlDollars * 100) / 100,
          closeReason,
        });
      }
    } catch (e: any) {
      console.error(`Backtest error for ${ticker}:`, e.message);
    }
  }

  allTrades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  const winners   = allTrades.filter(t => t.pnlPct > 0);
  const totalPnL  = allTrades.reduce((s, t) => s + t.pnlDollars, 0);
  const avgPnL    = allTrades.length ? totalPnL / allTrades.length : 0;
  const winRate   = allTrades.length ? Math.round((winners.length / allTrades.length) * 100) : 0;

  // Close reason breakdown
  const byReason = allTrades.reduce((acc, t) => {
    acc[t.closeReason] = (acc[t.closeReason] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const bySignal = allTrades.reduce((acc, t) => {
    if (!acc[t.signal]) acc[t.signal] = { trades: 0, wins: 0, pnl: 0 };
    acc[t.signal].trades++;
    if (t.pnlPct > 0) acc[t.signal].wins++;
    acc[t.signal].pnl += t.pnlDollars;
    return acc;
  }, {} as Record<string, { trades: number; wins: number; pnl: number }>);

  res.json({
    summary: {
      totalTrades: allTrades.length,
      winRate,
      totalPnL:  Math.round(totalPnL * 100) / 100,
      avgPnL:    Math.round(avgPnL * 100) / 100,
      bestTrade:  allTrades.length ? Math.max(...allTrades.map(t => t.pnlPct)) : 0,
      worstTrade: allTrades.length ? Math.min(...allTrades.map(t => t.pnlPct)) : 0,
      bySignal,
      byReason,
    },
    trades: allTrades,
  });
}
