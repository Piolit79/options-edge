import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmt, fmtPct, gainLoss } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, BookOpen, Target, AlertCircle, FlaskConical } from 'lucide-react';

interface AutoOrder {
  id: string; ticker: string; strike: number; expiration: string;
  option_type: string; contracts: number; entry_price: number;
  signal_type: string; conviction: number; status: string;
  simulated: boolean; current_price?: number;
  pnl_dollars?: number; pnl_pct?: number; close_reason?: string;
  opened_at: string; closed_at?: string;
}

const SIGNAL_LABELS: Record<string, string> = {
  momentum_dip: 'Momentum Dip',
  breakout: 'Breakout',
  oversold_uptrend: 'Oversold',
};

const CONVICTION_COLORS: Record<number, string> = {
  3: 'bg-green-500/20 text-green-400 border-green-500/30',
  2: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  1: 'bg-muted text-muted-foreground border-border',
};

export default function Dashboard() {
  const [orders, setOrders] = useState<AutoOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('oe_auto_orders' as any)
      .select('*')
      .order('opened_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (data) setOrders(data as AutoOrder[]);
        setLoading(false);
      });
  }, []);

  const openOrders = orders.filter(o => o.status === 'open');
  const closedOrders = orders.filter(o => o.status === 'closed');
  const winners = closedOrders.filter(o => (o.pnl_dollars ?? 0) > 0);
  const totalPnL = closedOrders.reduce((s, o) => s + (o.pnl_dollars ?? 0), 0);
  const winRate = closedOrders.length ? Math.round((winners.length / closedOrders.length) * 100) : 0;
  const simCount = closedOrders.filter(o => o.simulated).length;

  const statCards = [
    { label: 'Open Positions', value: openOrders.length.toString(), icon: BookOpen, color: 'text-primary' },
    { label: 'Win Rate', value: closedOrders.length ? `${winRate}%` : '—', icon: Target, color: winRate >= 55 ? 'text-green-400' : closedOrders.length ? 'text-destructive' : 'text-muted-foreground' },
    { label: 'Total P&L', value: closedOrders.length ? fmt(totalPnL) : '—', icon: totalPnL >= 0 ? TrendingUp : TrendingDown, color: totalPnL >= 0 ? 'text-green-400' : 'text-destructive' },
    { label: 'Total Trades', value: closedOrders.length.toString(), icon: AlertCircle, color: 'text-muted-foreground' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-foreground">Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Overview of your auto-trader activity</p>
      </div>

      {simCount > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground border border-border/50 rounded px-3 py-1.5 bg-muted/20">
          <FlaskConical className="h-3 w-3" />
          {simCount} of {closedOrders.length} closed trades are simulated
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              {loading ? <Skeleton className="h-6 w-16" /> : <div className={`text-xl font-bold ${color}`}>{value}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Open Positions ({openOrders.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : openOrders.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No open positions</div>
            ) : (
              <div className="divide-y divide-border/50">
                {openOrders.map(o => {
                  const unrealized = o.current_price && o.entry_price
                    ? (o.current_price - o.entry_price) / o.entry_price * 100
                    : null;
                  return (
                    <div key={o.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{o.ticker}</span>
                          <span className="text-xs text-muted-foreground">${o.strike} {o.expiration}</span>
                          {o.signal_type && (
                            <Badge variant="outline" className={`text-[9px] ${CONVICTION_COLORS[o.conviction]}`}>
                              {SIGNAL_LABELS[o.signal_type] ?? o.signal_type}
                            </Badge>
                          )}
                          {o.simulated && <span className="text-[9px] text-muted-foreground border border-border rounded px-1">SIM</span>}
                        </div>
                        {unrealized !== null ? (
                          <span className={`text-sm font-semibold ${unrealized >= 0 ? 'gain' : 'loss'}`}>
                            {unrealized >= 0 ? '+' : ''}{unrealized.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{o.contracts}x @ {fmt(o.entry_price)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent Closed Trades</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : closedOrders.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No closed trades yet</div>
            ) : (
              <div className="divide-y divide-border/50">
                {closedOrders.slice(0, 8).map(o => (
                  <div key={o.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{o.ticker}</span>
                      <span className="text-xs text-muted-foreground">${o.strike}</span>
                      {o.close_reason && (
                        <span className={`text-[9px] ${o.close_reason === 'profit_target' ? 'gain' : 'loss'}`}>
                          {o.close_reason === 'profit_target' ? 'Target' : 'Stop'}
                        </span>
                      )}
                      {o.simulated && <span className="text-[9px] text-muted-foreground border border-border rounded px-1">SIM</span>}
                    </div>
                    <div className={`text-sm font-semibold ${gainLoss(o.pnl_dollars ?? 0)}`}>
                      {o.pnl_dollars !== undefined ? `${o.pnl_dollars >= 0 ? '+' : ''}${fmt(o.pnl_dollars)}` : '—'}
                      {o.pnl_pct !== undefined && <span className="text-xs ml-1 font-normal">({fmtPct(o.pnl_pct)})</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
