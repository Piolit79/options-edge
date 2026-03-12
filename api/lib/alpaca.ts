// Alpaca Markets API wrapper — paper trading account provides free options data with greeks/IV/bid-ask
const DATA_BASE = 'https://data.alpaca.markets';
const PAPER_BASE = 'https://paper-api.alpaca.markets';

function headers() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
    'Content-Type': 'application/json',
  };
}

async function alpacaGet(url: string) {
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`Alpaca ${r.status}: ${await r.text()}`);
  return r.json();
}

// Daily stock bars
export async function getStockBars(symbol: string, days = 260): Promise<Bar[]> {
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const url = `${DATA_BASE}/v2/stocks/${symbol}/bars?timeframe=1Day&start=${start}&limit=1000&adjustment=split`;
  const data = await alpacaGet(url);
  return (data.bars || []) as Bar[];
}

// Latest stock snapshot (price, prev close)
export async function getStockSnapshot(symbol: string): Promise<StockSnapshot> {
  const url = `${DATA_BASE}/v2/stocks/${symbol}/snapshot`;
  return alpacaGet(url);
}

// Options chain — calls or puts, filtered by DTE range and optional strike bounds
export async function getOptionsChain(
  symbol: string,
  type: 'call' | 'put' = 'call',
  minDte: number = 0,
  maxDte: number = 90,
  strikeLow?: number,
  strikeHigh?: number,
): Promise<OptionContract[]> {
  const today = new Date();
  const minExp = new Date(today.getTime() + minDte * 86400000).toISOString().slice(0, 10);
  const maxExp = new Date(today.getTime() + maxDte * 86400000).toISOString().slice(0, 10);

  let url = `${PAPER_BASE}/v2/options/contracts?underlying_symbols=${symbol}&type=${type}&expiration_date_gte=${minExp}&expiration_date_lte=${maxExp}&status=active&limit=200`;
  if (strikeLow != null) url += `&strike_price_gte=${strikeLow.toFixed(2)}`;
  if (strikeHigh != null) url += `&strike_price_lte=${strikeHigh.toFixed(2)}`;
  const data = await alpacaGet(url);
  return (data.option_contracts || []) as OptionContract[];
}

// Batch option snapshots — returns greeks, IV, bid/ask, OI
export async function getOptionSnapshots(symbols: string[]): Promise<Record<string, OptionSnapshot>> {
  if (symbols.length === 0) return {};
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 50) chunks.push(symbols.slice(i, i + 50));
  const results: Record<string, OptionSnapshot> = {};
  for (const chunk of chunks) {
    const url = `${DATA_BASE}/v2/options/snapshots?symbols=${chunk.join(',')}&feed=indicative`;
    try {
      const data = await alpacaGet(url);
      Object.assign(results, data.snapshots ?? data);
    } catch {}
  }
  return results;
}

// Single option snapshot
export async function getOptionSnapshot(contractSymbol: string): Promise<OptionSnapshot | null> {
  try {
    const url = `${DATA_BASE}/v2/options/snapshots/${contractSymbol}`;
    const data = await alpacaGet(url);
    return data[contractSymbol] ?? null;
  } catch {
    return null;
  }
}

// Get all unique expirations for a symbol
export async function getExpirations(symbol: string, minDte = 0, maxDte = 365): Promise<string[]> {
  const contracts = await getOptionsChain(symbol, 'call', minDte, maxDte);
  const exps = [...new Set(contracts.map(c => c.expiration_date))].sort();
  return exps;
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface StockSnapshot {
  latestTrade?: { p: number };
  latestQuote?: { ap: number; bp: number };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number };
  prevDailyBar?: { c: number };
}

export interface OptionContract {
  symbol: string;
  underlying_symbol: string;
  type: string;
  strike_price: number | string;
  expiration_date: string;
  open_interest: number | string;
  size: number;
}

export interface OptionSnapshot {
  greeks?: { delta: number; gamma: number; theta: number; vega: number };
  impliedVolatility?: number;
  latestQuote?: { ap: number; bp: number };
  latestTrade?: { p: number };
  openInterest?: number;
}
