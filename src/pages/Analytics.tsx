import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmt, fmtPct } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line } from 'recharts';

interface Trade {
  id: string; ticker: string; strategy?: string;
  pnl_dollars?: number; pnl_pct?: number; status: string; entry_date: string;
}

export default function Analytics() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('oe_trades' as any).select('*').eq('status', 'closed').order('exit_date')
      .then(({ data }) => { if (data) setTrades(data as Trade[]); setLoading(false); });
  }, []);

  const closed = trades;
  const winners = closed.filter(t => (t.pnl_dollars ?? 0) > 0);
  const losers = closed.filter(t => (t.pnl_dollars ?? 0) <= 0);
  const totalPnL = closed.reduce((s, t) => s + (t.pnl_dollars ?? 0), 0);
  const avgWin = winners.length ? winners.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / winners.length : 0;
  const avgLoss = losers.length ? losers.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / losers.length : 0;
  const winRate = closed.length ? (winners.length / closed.length) * 100 : 0;
  const expectancy = (winRate / 100) * avgWin + ((1 - winRate / 100)) * avgLoss;

  // Cumulative P&L over time
  const cumulativeData = closed.reduce<{ date: string; cumulative: number }[]>((acc, t) => {
    const prev = acc.length ? acc[acc.length - 1].cumulative : 0;
    acc.push({ date: t.entry_date, cumulative: prev + (t.pnl_dollars ?? 0) });
    return acc;
  }, []);

  // By strategy
  const byStrategy = closed.reduce<Record<string, { wins: number; losses: number; pnl: number }>>((acc, t) => {
    const s = t.strategy || 'Other';
    if (!acc[s]) acc[s] = { wins: 0, losses: 0, pnl: 0 };
    (t.pnl_dollars ?? 0) > 0 ? acc[s].wins++ : acc[s].losses++;
    acc[s].pnl += t.pnl_dollars ?? 0;
    return acc;
  }, {});

  const strategyData = Object.entries(byStrategy).map(([name, d]) => ({
    name, wins: d.wins, losses: d.losses, pnl: d.pnl,
    winRate: Math.round((d.wins / (d.wins + d.losses)) * 100),
  }));

  const stats = [
    { label: 'Total Closed', value: closed.length.toString() },
    { label: 'Win Rate', value: closed.length ? `${winRate.toFixed(1)}%` : '—' },
    { label: 'Total P&L', value: closed.length ? fmt(totalPnL) : '—', color: totalPnL >= 0 ? 'gain' : 'loss' },
    { label: 'Avg Winner', value: winners.length ? fmtPct(avgWin) : '—', color: 'gain' },
    { label: 'Avg Loser', value: losers.length ? fmtPct(avgLoss) : '—', color: 'loss' },
    { label: 'Expectancy', value: closed.length ? fmtPct(expectancy) : '—', color: expectancy >= 0 ? 'gain' : 'loss' },
  ];

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>;

  if (closed.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Analytics</h1>
        <div className="py-16 text-center text-muted-foreground text-sm">Close some trades to see analytics</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Analytics</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">{s.label}</div>
              <div className={`text-xl font-bold ${s.color ?? ''}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cumulative P&L chart */}
      {cumulativeData.length > 1 && (
        <Card>
          <CardHeader><CardTitle>Cumulative P&L</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={cumulativeData}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ backgroundColor: 'hsl(222 25% 13%)', border: '1px solid hsl(222 20% 20%)', borderRadius: 6, fontSize: 12 }} />
                <Line type="monotone" dataKey="cumulative" stroke={totalPnL >= 0 ? 'hsl(152 60% 45%)' : 'hsl(0 65% 55%)'} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* By Strategy */}
      {strategyData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>By Strategy</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {strategyData.map(s => (
                <div key={s.name} className="flex items-center gap-3">
                  <div className="w-28 text-xs text-muted-foreground truncate">{s.name}</div>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${s.winRate}%` }} />
                  </div>
                  <div className="text-xs font-medium w-10 text-right">{s.winRate}%</div>
                  <div className={`text-xs font-semibold w-20 text-right ${s.pnl >= 0 ? 'gain' : 'loss'}`}>{fmt(s.pnl)}</div>
                  <div className="text-[10px] text-muted-foreground w-12 text-right">{s.wins}W / {s.losses}L</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Win/Loss bar chart */}
      <Card>
        <CardHeader><CardTitle>Individual Trade P&L</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={closed.slice(-20).map(t => ({ ticker: t.ticker, pnl: t.pnl_dollars ?? 0 }))}>
              <XAxis dataKey="ticker" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ backgroundColor: 'hsl(222 25% 13%)', border: '1px solid hsl(222 20% 20%)', borderRadius: 6, fontSize: 12 }} />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {closed.slice(-20).map((t, i) => (
                  <Cell key={i} fill={(t.pnl_dollars ?? 0) >= 0 ? 'hsl(152 60% 45%)' : 'hsl(0 65% 55%)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
