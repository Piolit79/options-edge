import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmt, fmtPct, gainLoss } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, BookOpen, Target, AlertCircle } from 'lucide-react';

interface Trade {
  id: string; ticker: string; strike: number; expiration: string;
  option_type: string; contracts: number; entry_price: number; entry_date: string;
  status: string; exit_price?: number; pnl_dollars?: number; pnl_pct?: number;
  strategy?: string; notes?: string;
}

interface Signal {
  id: string; ticker: string; signal_type: string; details: Record<string, unknown>;
  acted_on: boolean; detected_at: string;
}

const SIGNAL_LABELS: Record<string, string> = {
  momentum_dip: 'Momentum Dip',
  breakout: 'Breakout',
  oversold_uptrend: 'Oversold in Uptrend',
};

export default function Dashboard() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('oe_trades' as any).select('*').order('entry_date', { ascending: false }),
      supabase.from('oe_signals' as any).select('*').order('detected_at', { ascending: false }).limit(10),
    ]).then(([tradesRes, signalsRes]) => {
      if (tradesRes.data) setTrades(tradesRes.data as Trade[]);
      if (signalsRes.data) setSignals(signalsRes.data as Signal[]);
      setLoading(false);
    });
  }, []);

  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status === 'closed');
  const winners = closedTrades.filter(t => (t.pnl_dollars ?? 0) > 0);
  const totalPnL = closedTrades.reduce((s, t) => s + (t.pnl_dollars ?? 0), 0);
  const winRate = closedTrades.length ? Math.round((winners.length / closedTrades.length) * 100) : 0;

  const statCards = [
    { label: 'Open Positions', value: openTrades.length.toString(), icon: BookOpen, color: 'text-primary' },
    { label: 'Win Rate', value: closedTrades.length ? `${winRate}%` : '—', icon: Target, color: winRate >= 55 ? 'text-success' : 'text-destructive' },
    { label: 'Total P&L', value: closedTrades.length ? fmt(totalPnL) : '—', icon: totalPnL >= 0 ? TrendingUp : TrendingDown, color: totalPnL >= 0 ? 'text-success' : 'text-destructive' },
    { label: 'Total Trades', value: closedTrades.length.toString(), icon: AlertCircle, color: 'text-muted-foreground' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-foreground">Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Overview of your options activity</p>
      </div>

      {/* Stat Cards */}
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
        {/* Open Positions */}
        <Card>
          <CardHeader><CardTitle>Open Positions</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : openTrades.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No open positions</div>
            ) : (
              <div className="divide-y divide-border/50">
                {openTrades.map(t => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <span className="font-semibold text-sm">{t.ticker}</span>
                      <span className="text-xs text-muted-foreground ml-2">${t.strike} {t.option_type.toUpperCase()} {t.expiration}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">{t.contracts}x @ {fmt(t.entry_price)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Signals */}
        <Card>
          <CardHeader><CardTitle>Recent Signals</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : signals.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">No signals yet — run the screener</div>
            ) : (
              <div className="divide-y divide-border/50">
                {signals.slice(0, 6).map(s => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <span className="font-semibold text-sm">{s.ticker}</span>
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {SIGNAL_LABELS[s.signal_type] ?? s.signal_type}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{new Date(s.detected_at).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Closed Trades */}
      {closedTrades.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent Closed Trades</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {closedTrades.slice(0, 5).map(t => (
                <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="font-semibold text-sm">{t.ticker}</span>
                    <span className="text-xs text-muted-foreground ml-2">${t.strike} {t.option_type.toUpperCase()} {t.expiration}</span>
                  </div>
                  <div className={`text-sm font-semibold ${gainLoss(t.pnl_dollars ?? 0)}`}>
                    {fmt(t.pnl_dollars ?? 0)}
                    <span className="text-xs ml-1">({fmtPct(t.pnl_pct ?? 0)})</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
