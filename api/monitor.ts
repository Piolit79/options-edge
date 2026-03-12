import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getTTToken, TT_BASE } from './tt-auth';

const supabase = createClient(
  process.env.SUPABASE_URL ?? 'https://nlusfndskgdcottasfdy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
);

const POLYGON_KEY = process.env.POLYGON_API_KEY!;
const ACCOUNT = process.env.TT_ACCOUNT!;

async function getCurrentOptionPrice(polygonSymbol: string): Promise<number | null> {
  // Try last trade
  const res = await fetch(
    `https://api.polygon.io/v2/last/trade/${encodeURIComponent(polygonSymbol)}?apiKey=${POLYGON_KEY}`
  );
  const data = await res.json();
  if (data.results?.p) return data.results.p;

  // Fallback: daily bar
  const today = new Date().toISOString().split('T')[0];
  const barRes = await fetch(
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(polygonSymbol)}/prev?apiKey=${POLYGON_KEY}`
  );
  const bar = await barRes.json();
  return bar.results?.[0]?.c ?? null;
}

async function closeLiveOrder(occSymbol: string, contracts: number, limitPrice: number): Promise<void> {
  const token = await getTTToken();
  await fetch(`${TT_BASE}/accounts/${ACCOUNT}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      'time-in-force': 'Day',
      'order-type': 'Limit',
      price: limitPrice.toFixed(2),
      'price-effect': 'Credit',
      legs: [{ 'instrument-type': 'Equity Option', symbol: occSymbol, quantity: contracts, action: 'Sell to Close' }],
    }),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { data: settingsRows } = await supabase.from('oe_settings').select('key, value');
  const settings = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));

  if (settings.auto_enabled !== 'true') {
    return res.json({ message: 'Auto-trader disabled', closed: [] });
  }

  const profitTarget = parseFloat(settings.profit_target_pct ?? '50') / 100;
  const stopLoss = parseFloat(settings.stop_loss_pct ?? '35') / 100;
  const isSimulation = settings.mode !== 'live';

  const { data: openOrders } = await supabase.from('oe_auto_orders').select('*').eq('status', 'open');
  if (!openOrders?.length) return res.json({ message: 'No open positions', closed: [] });

  const closed: any[] = [];

  for (const order of openOrders as any[]) {
    if (!order.polygon_symbol) continue;

    const currentPrice = await getCurrentOptionPrice(order.polygon_symbol).catch(() => null);
    if (!currentPrice) continue;

    const pnlPct = (currentPrice - order.entry_price) / order.entry_price;
    const pnlDollars = (currentPrice - order.entry_price) * order.contracts * 100;

    // Update current price in DB
    await supabase.from('oe_auto_orders').update({ current_price: currentPrice, pnl_dollars: pnlDollars, pnl_pct: pnlPct * 100 }).eq('id', order.id);

    const shouldClose = pnlPct >= profitTarget || pnlPct <= -stopLoss;
    if (!shouldClose) continue;

    const closeReason = pnlPct >= profitTarget ? 'profit_target' : 'stop_loss';

    if (!isSimulation && order.option_symbol) {
      await closeLiveOrder(order.option_symbol, order.contracts, currentPrice).catch(console.error);
    }

    await supabase.from('oe_auto_orders').update({
      status: 'closed',
      exit_price: currentPrice,
      pnl_dollars: pnlDollars,
      pnl_pct: pnlPct * 100,
      close_reason: closeReason,
      closed_at: new Date().toISOString(),
    }).eq('id', order.id);

    closed.push({ ticker: order.ticker, closeReason, pnlPct: (pnlPct * 100).toFixed(1) });
  }

  res.json({ message: `Monitor complete — ${closed.length} position(s) closed`, closed });
}
