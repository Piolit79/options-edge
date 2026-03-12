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
  if (T <= 0 || S <= 0 || K <= 0 || sigma <= 0) return Math.max(S - K, 0);
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

// ── Signal detection ─────────────────────────────────────────────────────────
function detectSignal(
  closes: number[],
  volumes: number[],
  spyAboveMa50: boolean,
): { signal: string; score: number } | null {
  if (closes.length < 201) return null;
  if (!spyAboveMa50) return null;  // market regime gate

  const price      = closes[closes.length - 1];
  const ma20       = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const ma50       = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const ma200      = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
  // MA50 from 20 bars ago — confirms the 50-day is trending UP, not rolling over
  const ma50_20ago = closes.slice(-70, -20).reduce((a, b) => a + b, 0) / 50;
  const ma50Rising = ma50 > ma50_20ago;  // no noise threshold — just must be rising
  const high52     = Math.max(...closes.slice(-252));
  const rsi        = calcRSI(closes.slice(-16));
  // RSI 3 bars ago — used only for dip confirmation (not all signals)
  const rsiPrev      = calcRSI(closes.slice(-19, -3));
  const rsiTurningUp = rsi > rsiPrev;
  const above20    = price > ma20;
  const above50    = price > ma50;
  const above200   = price > ma200;

  const recentHigh10 = Math.max(...closes.slice(-10));
  const dipPct       = ((recentHigh10 - price) / recentHigh10) * 100;
  const avgVol20     = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const lastVol      = volumes[volumes.length - 1];
  const distFromMa50 = Math.abs(price - ma50) / ma50 * 100;

  // 1. Momentum Dip — pullback in strong uptrend, RSI turning up confirms bottom
  if (above50 && above200 && ma50Rising &&
      rsi < 40 && rsiTurningUp &&
      dipPct >= 3 && dipPct <= 15 &&
      lastVol < avgVol20 * 2.0 &&     // sellers fading (not panic selling)
      price > high52 * 0.78)
    return { signal: 'momentum_dip', score: 3 };

  // 2. MA50 Support — price pulls back to rising 50-day, RSI mid-range
  if (above200 && above50 && ma50Rising &&
      distFromMa50 <= 3.0 &&          // within 3% of MA50
      rsi >= 30 && rsi <= 55 &&
      price > high52 * 0.72)
    return { signal: 'ma50_support', score: 3 };

  // 3. Oversold in Uptrend — deep RSI reset in an established uptrend
  if (above50 && above200 && ma50Rising &&
      rsi < 33 &&
      price > high52 * 0.78)
    return { signal: 'oversold_uptrend', score: 2 };

  // 4. Breakout — new 20-day high on meaningful volume, all MAs aligned
  const high20prev = Math.max(...closes.slice(-21, -1));
  if (above20 && above50 && above200 &&
      price > high20prev &&
      lastVol > avgVol20 * 1.7 &&
      rsi > 50 && rsi < 72)
    return { signal: 'breakout', score: 2 };

  return null;
}

// ── Fetch bars (OHLCV) ───────────────────────────────────────────────────────
interface Bar { o: number; h: number; l: number; c: number; v: number; t: string; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchBars(ticker: string, days: number, attempt = 0): Promise<Bar[]> {
  const from = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const to   = new Date().toISOString().split('T')[0];
  const url  = `${POLYGON}/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?limit=1000&apiKey=${POLYGON_KEY}`;
  const r = await fetch(url);
  // Retry once on 429 (rate limit) or 5xx after a short back-off
  if ((r.status === 429 || r.status >= 500) && attempt < 2) {
    await sleep(attempt === 0 ? 1000 : 3000);
    return fetchBars(ticker, days, attempt + 1);
  }
  if (!r.ok) throw new Error(`Polygon ${r.status} for ${ticker}`);
  const d = await r.json();
  if (d.status === 'ERROR' || d.error) throw new Error(d.error ?? `Polygon error for ${ticker}`);
  return (d.results ?? []).map((b: any) => ({
    o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
    t: new Date(b.t).toISOString().split('T')[0],
  }));
}

// Pre-fetch all tickers in small parallel batches with pauses to avoid rate limiting
async function prefetchBars(tickers: string[], days: number): Promise<Map<string, Bar[]>> {
  const map = new Map<string, Bar[]>();
  const BATCH = 5; // conservative — Polygon free tier handles ~5 concurrent well
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(t => fetchBars(t, days).then(bars => ({ t, bars })))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') map.set(r.value.t, r.value.bars);
    }
    // Pause between batches so we don't saturate the free-tier rate limit
    if (i + BATCH < tickers.length) await sleep(300);
  }
  return map;
}

const CONVICTION_RISK: Record<number, number> = { 3: 0.03, 2: 0.02, 1: 0.01 };

function buildOCCSymbol(ticker: string, expDate: string, strike: number): string {
  // expDate is YYYY-MM-DD, OCC format: TICKER(6) + YYMMDD + C + 8-digit strike (5 int 3 dec)
  const d = expDate.replace(/-/g, '').slice(2); // YYMMDD
  const strikeStr = Math.round(strike * 1000).toString().padStart(8, '0');
  return `${ticker.padEnd(6)}${d}C${strikeStr}`;
}

export interface BacktestTrade {
  ticker: string; signal: string; score: number;
  entryDate: string; exitDate: string; daysHeld: number;
  stockEntryPrice: number; strike: number;
  optionSymbol: string;
  entryOptionPrice: number; exitOptionPrice: number; peakOptionPrice: number;
  contracts: number; capitalRisked: number;
  pnlPct: number; pnlDollars: number;
  closeReason: 'profit_target' | 'trailing_stop' | 'stop_loss' | 'expired';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const {
    sectors        = 'tier1',
    days           = '365',
    starting_balance = '10000',
    risk_per_trade = 'conviction',   // 'conviction' | fixed pct string e.g. '2'
    profit_target  = '75',
    stop_loss      = '35',
    trailing       = 'true',
    trail_pct      = '25',
    trail_trigger  = '25',
    min_conviction = '2',
    dte            = '45',
    cooldown_days  = '15',
  } = req.query as Record<string, string>;

  // Ticker universe
  let tickerList: string[];
  if (sectors === 'tier1') tickerList = TIER1_TICKERS;
  else if (sectors === 'all') tickerList = Object.values(UNIVERSE).flat();
  else {
    tickerList = sectors.split(',').flatMap(s => UNIVERSE[s.trim()] ?? []);
    if (!tickerList.length) tickerList = TIER1_TICKERS;
  }

  const daysBack       = parseInt(days);
  const balance0       = parseFloat(starting_balance);
  const profitTarget   = parseFloat(profit_target) / 100;
  const stopLoss       = parseFloat(stop_loss) / 100;
  const useTrailing    = trailing !== 'false';
  const trailPct       = parseFloat(trail_pct) / 100;
  const trailTrigger   = parseFloat(trail_trigger) / 100;
  const minConviction  = parseInt(min_conviction);
  const targetDte      = parseInt(dte);
  const cooldown       = parseInt(cooldown_days);

  // Pre-fetch all bars in parallel (including SPY for regime filter)
  // This is far faster than sequential and prevents Vercel timeout on 35+ tickers
  const fetchDays = daysBack + 300;
  const allTickers = tickerList.includes('SPY') ? tickerList : ['SPY', ...tickerList];
  const barsMap = await prefetchBars(allTickers, fetchDays);
  const spyBars = barsMap.get('SPY') ?? [];
  const fetchedCount = barsMap.size;

  // Running balance (compounding)
  let balance = balance0;
  const allTrades: BacktestTrade[] = [];

  for (const ticker of tickerList) {
    try {
      const bars = barsMap.get(ticker) ?? [];
      if (bars.length < 220) continue;

      let lastEntryIdx = -999;

      for (let i = 200; i < bars.length; i++) {
        const barDate = bars[i].t;
        const cutoff  = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
        if (barDate < cutoff) continue;

        // SPY regime
        const spyIdx = spyBars.findIndex(b => b.t >= barDate);
        const spyCloses = spyIdx >= 50 ? spyBars.slice(0, spyIdx + 1).map(b => b.c) : [];
        const spyMa50 = spyCloses.length >= 50
          ? spyCloses.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
        const spyAboveMa50 = spyMa50 === null || spyCloses[spyCloses.length - 1] > spyMa50;

        const closes  = bars.slice(0, i + 1).map(b => b.c);
        const volumes = bars.slice(0, i + 1).map(b => b.v);

        const sig = detectSignal(closes, volumes, spyAboveMa50);
        if (!sig || sig.score < minConviction) continue;
        if (i - lastEntryIdx < cooldown) continue;
        lastEntryIdx = i;

        const stockEntryPrice = bars[i].c;
        const strike          = Math.round(stockEntryPrice / 5) * 5;
        const sigma           = annualVol(closes);
        const T0              = targetDte / 365.25;
        const entryOptionPrice = bsCall(stockEntryPrice, strike, T0, sigma);
        if (entryOptionPrice < 0.10) continue;

        const expirationDate = new Date(new Date(barDate).getTime() + targetDte * 86400000)
          .toISOString().split('T')[0];
        const optionSymbol = buildOCCSymbol(ticker, expirationDate, strike);

        // Position sizing
        const riskFraction = risk_per_trade === 'conviction'
          ? (CONVICTION_RISK[sig.score] ?? 0.02)
          : parseFloat(risk_per_trade) / 100;
        const capitalRisked  = balance * riskFraction;
        const costPerContract = entryOptionPrice * 100;
        const contracts      = Math.max(1, Math.floor(capitalRisked / costPerContract));

        // ── Simulate day-by-day ───────────────────────────────────────────
        let exitDate         = bars[Math.min(i + targetDte, bars.length - 1)].t;
        let exitOptionPrice  = entryOptionPrice;
        let peakOptionPrice  = entryOptionPrice;
        let closeReason: BacktestTrade['closeReason'] = 'expired';
        let daysHeld         = 0;
        let trailingStop     = 0;

        for (let j = i + 1; j < Math.min(i + targetDte + 1, bars.length); j++) {
          const daysLeft  = targetDte - (j - i);
          const T         = Math.max(daysLeft / 365.25, 0);
          const futSigma  = annualVol(bars.slice(0, j + 1).map(b => b.c));

          // Check intraday low first (catches gaps through stop)
          const intradayLowPrice  = bsCall(bars[j].l, strike, T, futSigma);
          const intradayHighPrice = bsCall(bars[j].h, strike, T, futSigma);
          const closePrice        = bsCall(bars[j].c, strike, T, futSigma);

          if (closePrice > peakOptionPrice) peakOptionPrice = closePrice;

          // Activate/update trailing stop using intraday high (best price of day)
          if (useTrailing) {
            const highPnlPct = (intradayHighPrice - entryOptionPrice) / entryOptionPrice;
            if (highPnlPct >= trailTrigger) {
              const newStop = intradayHighPrice * (1 - trailPct);
              trailingStop = Math.max(trailingStop, newStop);
            }
          }

          // Profit target — only applies when trailing stop is OFF
          // When trailing is ON, the trailing stop itself is the exit; no cap on upside
          const highPnlPct = (intradayHighPrice - entryOptionPrice) / entryOptionPrice;
          if (!useTrailing && highPnlPct >= profitTarget) {
            const targetPrice = entryOptionPrice * (1 + profitTarget);
            exitDate = bars[j].t; exitOptionPrice = targetPrice;
            closeReason = 'profit_target'; daysHeld = j - i; break;
          }

          // Trailing stop — check against intraday low
          if (useTrailing && trailingStop > 0 && intradayLowPrice <= trailingStop) {
            exitDate = bars[j].t; exitOptionPrice = trailingStop;
            closeReason = 'trailing_stop'; daysHeld = j - i; break;
          }

          // Hard stop loss — checked against intraday LOW (realistic: stop hits intraday)
          const lowPnlPct = (intradayLowPrice - entryOptionPrice) / entryOptionPrice;
          if (lowPnlPct <= -stopLoss) {
            exitDate = bars[j].t;
            exitOptionPrice = entryOptionPrice * (1 - stopLoss); // exit exactly at stop
            closeReason = 'stop_loss'; daysHeld = j - i; break;
          }

          if (j === Math.min(i + targetDte, bars.length - 1)) {
            exitDate = bars[j].t; exitOptionPrice = closePrice;
            closeReason = 'expired'; daysHeld = j - i;
          }
        }

        const pnlPct    = ((exitOptionPrice - entryOptionPrice) / entryOptionPrice) * 100;
        const pnlDollars = (exitOptionPrice - entryOptionPrice) * contracts * 100;

        // Update running balance
        balance += pnlDollars;

        allTrades.push({
          ticker, signal: sig.signal, score: sig.score,
          entryDate: barDate, exitDate, daysHeld,
          stockEntryPrice: Math.round(stockEntryPrice * 100) / 100,
          strike, optionSymbol,
          entryOptionPrice:  Math.round(entryOptionPrice * 100) / 100,
          exitOptionPrice:   Math.round(exitOptionPrice * 100) / 100,
          peakOptionPrice:   Math.round(peakOptionPrice * 100) / 100,
          contracts,
          capitalRisked:     Math.round(capitalRisked * 100) / 100,
          pnlPct:    Math.round(pnlPct * 10) / 10,
          pnlDollars: Math.round(pnlDollars * 100) / 100,
          closeReason,
        });
      }
    } catch (e: any) {
      console.error(`Backtest error for ${ticker}:`, e.message);
    }
  }

  allTrades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  const winners    = allTrades.filter(t => t.pnlPct > 0);
  const totalPnL   = allTrades.reduce((s, t) => s + t.pnlDollars, 0);
  const finalBal   = balance0 + totalPnL;
  const winRate    = allTrades.length ? Math.round(winners.length / allTrades.length * 100) : 0;
  const weeksInPeriod = daysBack / 7;
  const tradesPerWeek = allTrades.length ? Math.round((allTrades.length / weeksInPeriod) * 10) / 10 : 0;

  const byReason = allTrades.reduce((acc, t) => {
    acc[t.closeReason] = (acc[t.closeReason] ?? 0) + 1; return acc;
  }, {} as Record<string, number>);

  const bySignal = allTrades.reduce((acc, t) => {
    if (!acc[t.signal]) acc[t.signal] = { trades: 0, wins: 0, pnl: 0 };
    acc[t.signal].trades++;
    if (t.pnlPct > 0) acc[t.signal].wins++;
    acc[t.signal].pnl += t.pnlDollars;
    return acc;
  }, {} as Record<string, { trades: number; wins: number; pnl: number }>);

  // Build equity curve (chronological)
  let running = balance0;
  const equityCurve = allTrades.map(t => {
    running += t.pnlDollars;
    return { date: t.exitDate, balance: Math.round(running * 100) / 100, ticker: t.ticker };
  });

  res.json({
    summary: {
      startingBalance: balance0,
      finalBalance: Math.round(finalBal * 100) / 100,
      totalPnL: Math.round(totalPnL * 100) / 100,
      totalReturn: Math.round((totalPnL / balance0) * 1000) / 10,
      totalTrades: allTrades.length,
      tradesPerWeek,
      winRate,
      avgPnL: allTrades.length ? Math.round(totalPnL / allTrades.length * 100) / 100 : 0,
      bestTrade:  allTrades.length ? Math.max(...allTrades.map(t => t.pnlPct)) : 0,
      worstTrade: allTrades.length ? Math.min(...allTrades.map(t => t.pnlPct)) : 0,
      bySignal,
      byReason,
      fetchedTickers: fetchedCount,
      totalTickers: allTickers.length,
    },
    equityCurve,
    trades: allTrades,
  });
}
