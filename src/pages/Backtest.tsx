import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Play, TrendingUp, TrendingDown, Target, BarChart2 } from 'lucide-react';

interface BacktestTrade {
  ticker: string; signal: string; score: number;
  entryDate: string; exitDate: string; daysHeld: number;
  stockPrice: number; strike: number;
  entryOptionPrice: number; exitOptionPrice: number;
  pnlPct: number; pnlDollars: number;
  closeReason: 'profit_target' | 'stop_loss' | 'expired';
}

interface Summary {
  totalTrades: number; winRate: number; totalPnL: number; avgPnL: number;
  bestTrade: number; worstTrade: number;
  bySignal: Record<string, { trades: number; wins: number; pnl: number }>;
}

const SIGNAL_LABELS: Record<string, string> = {
  momentum_dip: 'Momentum Dip',
  breakout: 'Breakout',
  oversold_uptrend: 'Oversold',
};

const CLOSE_COLORS: Record<string, string> = {
  profit_target: 'text-green-400',
  stop_loss: 'text-destructive',
  expired: 'text-muted-foreground',
};

const CLOSE_LABELS: Record<string, string> = {
  profit_target: 'Target',
  stop_loss: 'Stop',
  expired: 'Expired',
};

export default function Backtest() {
  const [tickers, setTickers] = useState('AAPL,MSFT,NVDA,AMZN,META,GOOGL,TSLA,AMD');
  const [days, setDays] = useState('365');
  const [profitTarget, setProfitTarget] = useState('50');
  const [stopLoss, setStopLoss] = useState('35');
  const [minConviction, setMinConviction] = useState('2');
  const [dte, setDte] = useState('45');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);

  const run = async () => {
    setLoading(true);
    setSummary(null);
    setTrades([]);
    try {
      const params = new URLSearchParams({
        tickers, days, profit_target: profitTarget,
        stop_loss: stopLoss, min_conviction: minConviction, dte,
      });
      const res = await fetch(`/api/backtest?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSummary(data.summary);
      setTrades(data.trades);
      if (data.trades.length === 0) toast.info('No signals triggered in this period — try a longer date range or lower min conviction');
      else toast.success(`Backtest complete — ${data.trades.length} trades`);
    } catch (e: any) {
      toast.error(e.message ?? 'Backtest failed');
    }
    setLoading(false);
  };

  // Build equity curve (cumulative P&L per trade)
  const equityCurve = trades.reduce((acc, t) => {
    const prev = acc.length ? acc[acc.length - 1].cumPnL : 0;
    acc.push({ date: t.exitDate, cumPnL: Math.round((prev + t.pnlDollars) * 100) / 100, ticker: t.ticker });
    return acc;
  }, [] as { date: string; cumPnL: number; ticker: string }[]);

  const finalPnL = equityCurve.length ? equityCurve[equityCurve.length - 1].cumPnL : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Backtest</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Simulate the strategy on historical data using Black-Scholes option pricing
        </p>
      </div>

      {/* Settings */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tickers (comma separated)</label>
            <Input
              value={tickers}
              onChange={e => setTickers(e.target.value.toUpperCase())}
              placeholder="AAPL,MSFT,NVDA..."
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Days Back', value: days, set: setDays },
              { label: 'Profit Target %', value: profitTarget, set: setProfitTarget },
              { label: 'Stop Loss %', value: stopLoss, set: setStopLoss },
              { label: 'Min Conviction', value: minConviction, set: setMinConviction },
              { label: 'Option DTE', value: dte, set: setDte },
            ].map(({ label, value, set }) => (
              <div key={label} className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
                <Input
                  type="number"
                  value={value}
                  onChange={e => set(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>
          <Button onClick={run} disabled={loading} className="w-full md:w-auto">
            <Play className="h-3.5 w-3.5 mr-2" />
            {loading ? 'Running backtest...' : 'Run Backtest'}
          </Button>
          {loading && (
            <p className="text-xs text-muted-foreground">
              Fetching historical data and simulating trades — takes 10–30 seconds...
            </p>
          )}
        </CardContent>
      </Card>

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      )}

      {summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                  <Target className="h-3 w-3" /> Win Rate
                </div>
                <div className={`text-2xl font-bold ${summary.winRate >= 55 ? 'gain' : summary.winRate < 45 ? 'loss' : 'text-foreground'}`}>
                  {summary.winRate}%
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{summary.totalTrades} trades</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                  {finalPnL >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} Total P&L
                </div>
                <div className={`text-2xl font-bold ${finalPnL >= 0 ? 'gain' : 'loss'}`}>
                  {finalPnL >= 0 ? '+' : ''}${finalPnL.toFixed(0)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">1 contract/trade</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Best Trade</div>
                <div className="text-2xl font-bold gain">+{summary.bestTrade.toFixed(1)}%</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Worst Trade</div>
                <div className="text-2xl font-bold loss">{summary.worstTrade.toFixed(1)}%</div>
              </CardContent>
            </Card>
          </div>

          {/* Signal breakdown */}
          <div className="grid md:grid-cols-3 gap-3">
            {Object.entries(summary.bySignal).map(([sig, stats]) => (
              <Card key={sig}>
                <CardContent className="p-4">
                  <div className="text-xs font-semibold mb-2">{SIGNAL_LABELS[sig] ?? sig}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-lg font-bold">{stats.trades}</div>
                      <div className="text-[10px] text-muted-foreground">Trades</div>
                    </div>
                    <div>
                      <div className={`text-lg font-bold ${Math.round(stats.wins / stats.trades * 100) >= 55 ? 'gain' : 'loss'}`}>
                        {Math.round(stats.wins / stats.trades * 100)}%
                      </div>
                      <div className="text-[10px] text-muted-foreground">Win Rate</div>
                    </div>
                    <div>
                      <div className={`text-lg font-bold ${stats.pnl >= 0 ? 'gain' : 'loss'}`}>
                        {stats.pnl >= 0 ? '+' : ''}${stats.pnl.toFixed(0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">P&L</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Equity curve */}
          {equityCurve.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4" /> Cumulative P&L
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={equityCurve}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }}
                      formatter={(v: any, _: any, props: any) => [`$${v.toFixed(2)} — ${props.payload.ticker}`, 'Cumulative P&L']}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <Line
                      type="monotone"
                      dataKey="cumPnL"
                      stroke={finalPnL >= 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Trade table */}
          <Card>
            <CardHeader><CardTitle>All Trades ({trades.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground">
                      <th className="text-left px-4 py-2">Ticker</th>
                      <th className="text-left px-4 py-2">Signal</th>
                      <th className="text-left px-4 py-2">Entry</th>
                      <th className="text-left px-4 py-2">Exit</th>
                      <th className="text-right px-4 py-2">Days</th>
                      <th className="text-right px-4 py-2">Stock</th>
                      <th className="text-right px-4 py-2">Entry $</th>
                      <th className="text-right px-4 py-2">Exit $</th>
                      <th className="text-right px-4 py-2">P&L %</th>
                      <th className="text-right px-4 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {trades.map((t, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="px-4 py-2 font-semibold">{t.ticker}</td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="text-[9px]">{SIGNAL_LABELS[t.signal] ?? t.signal}</Badge>
                        </td>
                        <td className="px-4 py-2 tabular-nums text-muted-foreground">{t.entryDate}</td>
                        <td className="px-4 py-2 tabular-nums text-muted-foreground">{t.exitDate}</td>
                        <td className="px-4 py-2 tabular-nums text-right">{t.daysHeld}</td>
                        <td className="px-4 py-2 tabular-nums text-right">${t.stockPrice.toFixed(2)}</td>
                        <td className="px-4 py-2 tabular-nums text-right">${t.entryOptionPrice.toFixed(2)}</td>
                        <td className="px-4 py-2 tabular-nums text-right">${t.exitOptionPrice.toFixed(2)}</td>
                        <td className={`px-4 py-2 tabular-nums text-right font-semibold ${t.pnlPct > 0 ? 'gain' : t.pnlPct < 0 ? 'loss' : ''}`}>
                          {t.pnlPct > 0 ? '+' : ''}{t.pnlPct.toFixed(1)}%
                        </td>
                        <td className={`px-4 py-2 text-right ${CLOSE_COLORS[t.closeReason]}`}>
                          {CLOSE_LABELS[t.closeReason]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!summary && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <BarChart2 className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">Configure settings and click Run Backtest</p>
          <p className="text-xs mt-1">Uses Black-Scholes pricing on real historical price data</p>
        </div>
      )}
    </div>
  );
}
