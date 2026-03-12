import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getTTToken, TT_BASE } from './tt-auth.js';
import { getOptionSnapshot } from './lib/alpaca.js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? 'https://nlusfndskgdcottasfdy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sdXNmbmRza2dkY290dGFzZmR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NTY0NDYsImV4cCI6MjA4ODMzMjQ0Nn0.sGSdCsQl0wgAHk5L-xi6ZdrLkuAEaHcdhJ8uazjTjbA'
);

const ACCOUNT = process.env.TT_ACCOUNT!;

async function getCurrentOptionPrice(alpacaSymbol: string): Promise<number | null> {
  const snap = await getOptionSnapshot(alpacaSymbol);
  if (!snap) return null;
  const bid = snap.latestQuote?.bp ?? 0;
  const ask = snap.latestQuote?.ap ?? 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (snap.latestTrade?.p) return snap.latestTrade.p;
  return null;
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
    if (!order.option_symbol && !order.polygon_symbol) continue;
    // option_symbol is the Alpaca contract symbol (same as OCC format without spaces)
    const contractSymbol = order.option_symbol ?? order.polygon_symbol;

    const currentPrice = await getCurrentOptionPrice(contractSymbol).catch(() => null);
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
