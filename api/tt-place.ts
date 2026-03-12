import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTTToken, TT_BASE } from './tt-auth';

const ACCOUNT = process.env.TT_ACCOUNT!;

// Build OCC option symbol: AAPL  240119C00150000
export function buildOCCSymbol(
  ticker: string,
  expiration: string, // YYYY-MM-DD
  type: 'call' | 'put',
  strike: number
): string {
  const d = new Date(expiration);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const cp = type === 'call' ? 'C' : 'P';
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${ticker.padEnd(6, ' ')}${yy}${mm}${dd}${cp}${strikeStr}`;
}

// Build Polygon options ticker: O:AAPL240119C00150000
export function buildPolygonSymbol(
  ticker: string,
  expiration: string,
  type: 'call' | 'put',
  strike: number
): string {
  const d = new Date(expiration);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const cp = type === 'call' ? 'C' : 'P';
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  return `O:${ticker}${yy}${mm}${dd}${cp}${strikeStr}`;
}

export async function placeLiveOrder(
  ticker: string,
  expiration: string,
  type: 'call' | 'put',
  strike: number,
  contracts: number,
  limitPrice: number
): Promise<{ orderId: string; fillPrice: number }> {
  const token = await getTTToken();
  const occSymbol = buildOCCSymbol(ticker, expiration, type, strike);

  const body = {
    'time-in-force': 'Day',
    'order-type': 'Limit',
    price: limitPrice.toFixed(2),
    'price-effect': 'Debit',
    legs: [
      {
        'instrument-type': 'Equity Option',
        symbol: occSymbol,
        quantity: contracts,
        action: 'Buy to Open',
      },
    ],
  };

  const res = await fetch(`${TT_BASE}/accounts/${ACCOUNT}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? 'Order placement failed');

  return {
    orderId: data.data.order.id,
    fillPrice: limitPrice,
  };
}

// HTTP handler (for manual testing)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { ticker, expiration, type, strike, contracts, limitPrice } = req.body;
  try {
    const result = await placeLiveOrder(ticker, expiration, type, strike, contracts, limitPrice);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
