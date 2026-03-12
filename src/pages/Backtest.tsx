import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Play, TrendingUp, TrendingDown, Target, BarChart2, Info, CheckCircle2 } from 'lucide-react';

interface BacktestTrade {
  ticker: string; signal: string; score: number;
  entryDate: string; exitDate: string; daysHeld: number;
  stockEntryPrice: number; strike: number;
  entryOptionPrice: number; exitOptionPrice: number; peakOptionPrice: number;
  pnlPct: number; pnlDollars: number;
  closeReason: 'profit_target' | 'trailing_stop' | 'stop_loss' | 'expired';
}

interface Summary {
  totalTrades: number; winRate: number; totalPnL: number; avgPnL: number;
  bestTrade: number; worstTrade: number;
  bySignal: Record<string, { trades: number; wins: number; pnl: number }>;
  byReason: Record<string, number>;
}

const SIGNAL_LABELS: Record<string, string> = {
  momentum_dip: 'Momentum Dip',
  breakout: 'Breakout',
  oversold_uptrend: 'Oversold',
};

const SIGNAL_DESCRIPTIONS: Record<string, string> = {
  momentum_dip:    'Uptrend (above MA50+MA200), RSI<38, dipped 4–12% on fading volume, within 20% of 52w high',
  oversold_uptrend:'Uptrend, RSI<32, within 20% of 52w high — deeper pullback but trend intact',
  breakout:        'Uptrend, new 20-day high on 2x+ volume, RSI 50–70 (healthy momentum, not overbought)',
};

const CLOSE_COLORS: Record<string, string> = {
  profit_target:  'text-green-400',
  trailing_stop:  'text-blue-400',
  stop_loss:      'text-destructive',
  expired:        'text-muted-foreground',
};
const CLOSE_LABELS: Record<string, string> = {
  profit_target: 'Target',
  trailing_stop: 'Trailing',
  stop_loss:     'Stop',
  expired:       'Expired',
};

const ALL_SECTORS = [
  'Tech', 'Financials', 'Healthcare', 'Consumer',
  'Energy', 'Industrials', 'Communication', 'Semis & Chips', 'ETFs (high OI)',
];
const UNIVERSE_COUNTS: Record<string, number> = {
  'Tech': 37, 'Financials': 28, 'Healthcare': 30, 'Consumer': 29,
  'Energy': 16, 'Industrials': 25, 'Communication': 10,
  'Semis & Chips': 10, 'ETFs (high OI)': 16,
};

export default function Backtest() {
  const [scanMode, setScanMode]           = useState<'tier1' | 'sectors'>('tier1');
  const [selectedSectors, setSelectedSectors] = useState<string[]>(ALL_SECTORS);
  const [days, setDays]                   = useState('365');
  const [profitTarget, setProfitTarget]   = useState('75');
  const [stopLoss, setStopLoss]           = useState('40');
  const [minConviction, setMinConviction] = useState('2');
  const [dte, setDte]                     = useState('45');
  const [useTrailing, setUseTrailing]     = useState(true);
  const [trailTrigger, setTrailTrigger]   = useState('25');
  const [trailPct, setTrailPct]           = useState('25');

  const [loading, setLoading]   = useState(false);
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [trades, setTrades]     = useState<BacktestTrade[]>([]);

  const toggleSector = (s: string) =>
    setSelectedSectors(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const tickerCount = scanMode === 'tier1' ? 35
    : selectedSectors.reduce((n, s) => n + (UNIVERSE_COUNTS[s] ?? 0), 0);

  const run = async () => {
    setLoading(true); setSummary(null); setTrades([]);
    try {
      const sectors = scanMode === 'tier1' ? 'tier1'
        : selectedSectors.length === ALL_SECTORS.length ? 'all'
        : selectedSectors.join(',');
      const params = new URLSearchParams({
        sectors, days,
        profit_target: profitTarget, stop_loss: stopLoss,
        trailing: useTrailing ? 'true' : 'false',
        trail_trigger: trailTrigger, trail_pct: trailPct,
        min_conviction: minConviction, dte,
      });
      const res = await fetch(`/api/backtest?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSummary(data.summary);
      setTrades(data.trades);
      if (!data.trades.length)
        toast.info('No signals triggered — try a longer range or lower conviction');
      else
        toast.success(`${data.trades.length} option trades simulated across ${tickerCount} stocks`);
    } catch (e: any) {
      toast.error(e.message ?? 'Backtest failed');
    }
    setLoading(false);
  };

  const equityCurve = trades.reduce((acc, t) => {
    const prev = acc.length ? acc[acc.length - 1].cumPnL : 0;
    acc.push({ date: t.exitDate, cumPnL: Math.round((prev + t.pnlDollars) * 100) / 100, ticker: t.ticker });
    return acc;
  }, [] as { date: string; cumPnL: number; ticker: string }[]);

  const finalPnL = equityCurve.length ? equityCurve[equityCurve.length - 1].cumPnL : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Backtest — Call Options</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Simulates buying ATM call option contracts on signal. Prices calculated with Black-Scholes using 30-day historical volatility.
        </p>
      </div>

      {/* Setup explanations */}
      <div className="grid md:grid-cols-3 gap-3">
        {Object.entries(SIGNAL_DESCRIPTIONS).map(([sig, desc]) => (
          <div key={sig} className="rounded-lg border border-border/50 bg-card p-3">
            <div className="flex items-center gap-2 mb-1">
              <Info className="h-3 w-3 text-primary shrink-0" />
              <span className="text-xs font-semibold">{SIGNAL_LABELS[sig]}</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Config */}
      <Card>
        <CardContent className="p-4 space-y-4">

          {/* Universe */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Stock Universe (mid/large-cap, high options OI only)</label>
            <div className="flex gap-2">
              {(['tier1', 'sectors'] as const).map(m => (
                <button key={m} onClick={() => setScanMode(m)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${scanMode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                  {m === 'tier1' ? 'Top 35 (highest OI)' : 'By Sector'}
                </button>
              ))}
            </div>
            {scanMode === 'sectors' && (
              <div className="flex flex-wrap gap-2 pt-1">
                {ALL_SECTORS.map(s => (
                  <button key={s} onClick={() => toggleSector(s)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${selectedSectors.includes(s) ? 'bg-primary/20 text-primary border-primary/40' : 'border-border text-muted-foreground'}`}>
                    {s} <span className="opacity-60">({UNIVERSE_COUNTS[s]})</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Scanning <strong>{tickerCount}</strong> stocks — all above $5B market cap with deep options markets
            </p>
          </div>

          {/* Trade parameters */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Days Back', value: days, set: setDays },
              { label: 'Option DTE', value: dte, set: setDte },
              { label: 'Min Conviction (1–3)', value: minConviction, set: setMinConviction },
              { label: 'Hard Profit Target %', value: profitTarget, set: setProfitTarget },
            ].map(({ label, value, set }) => (
              <div key={label} className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
                <Input type="number" value={value} onChange={e => set(e.target.value)} className="h-8 text-sm" />
              </div>
            ))}
          </div>

          {/* Stop settings */}
          <div className="rounded-lg border border-border/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold">Trailing Stop</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Once the option gains {trailTrigger}%, the stop trails {trailPct}% below the peak.
                  Locks in profits on big winners instead of giving them back.
                </p>
              </div>
              <button onClick={() => setUseTrailing(!useTrailing)}
                className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors ${useTrailing ? 'bg-primary' : 'bg-muted'}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${useTrailing ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>
            {useTrailing && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Hard Stop Loss %</label>
                  <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Start Trailing At %</label>
                  <Input type="number" value={trailTrigger} onChange={e => setTrailTrigger(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Trail % Below Peak</label>
                  <Input type="number" value={trailPct} onChange={e => setTrailPct(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
            )}
            {!useTrailing && (
              <div className="space-y-1 max-w-[120px]">
                <label className="text-[11px] text-muted-foreground">Hard Stop Loss %</label>
                <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} className="h-8 text-sm" />
              </div>
            )}
          </div>

          <Button onClick={run} disabled={loading || (scanMode === 'sectors' && !selectedSectors.length)}>
            <Play className="h-3.5 w-3.5 mr-2" />
            {loading ? 'Running...' : `Run Backtest (${tickerCount} stocks)`}
          </Button>
          {loading && <p className="text-xs text-muted-foreground">Fetching price history + simulating option trades... 15–60s</p>}
        </CardContent>
      </Card>

      {loading && <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>}

      {summary && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Win Rate', value: `${summary.winRate}%`, sub: `${summary.totalTrades} option trades`, color: summary.winRate >= 55 ? 'gain' : summary.winRate < 45 ? 'loss' : 'text-foreground', icon: Target },
              { label: 'Total P&L', value: `${finalPnL >= 0 ? '+' : ''}$${finalPnL.toFixed(0)}`, sub: '1 contract / trade', color: finalPnL >= 0 ? 'gain' : 'loss', icon: finalPnL >= 0 ? TrendingUp : TrendingDown },
              { label: 'Best Trade', value: `+${summary.bestTrade.toFixed(1)}%`, sub: 'on option contract', color: 'gain', icon: CheckCircle2 },
              { label: 'Worst Trade', value: `${summary.worstTrade.toFixed(1)}%`, sub: 'on option contract', color: 'loss', icon: TrendingDown },
            ].map(({ label, value, sub, color, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                    <Icon className="h-3 w-3" /> {label}
                  </div>
                  <div className={`text-2xl font-bold ${color}`}>{value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Exit reason breakdown */}
          {summary.byReason && (
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="text-muted-foreground">Exits:</span>
              {Object.entries(summary.byReason).map(([reason, count]) => (
                <span key={reason} className={`${CLOSE_COLORS[reason]} font-medium`}>
                  {CLOSE_LABELS[reason]} {count}
                </span>
              ))}
            </div>
          )}

          {/* Per-signal */}
          <div className="grid md:grid-cols-3 gap-3">
            {Object.entries(summary.bySignal).map(([sig, stats]) => (
              <Card key={sig}>
                <CardContent className="p-4">
                  <div className="text-xs font-semibold mb-1">{SIGNAL_LABELS[sig] ?? sig}</div>
                  <div className="text-[10px] text-muted-foreground mb-3 leading-relaxed">{SIGNAL_DESCRIPTIONS[sig]}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-lg font-bold">{stats.trades}</div><div className="text-[10px] text-muted-foreground">Trades</div></div>
                    <div>
                      <div className={`text-lg font-bold ${Math.round(stats.wins/stats.trades*100) >= 55 ? 'gain' : 'loss'}`}>
                        {Math.round(stats.wins/stats.trades*100)}%
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
              <CardHeader><CardTitle className="flex items-center gap-2"><BarChart2 className="h-4 w-4" /> Cumulative P&L — Option Contracts</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={equityCurve}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }}
                      formatter={(v: any, _: any, p: any) => [`$${Number(v).toFixed(2)} — ${p.payload.ticker}`, 'Cum. P&L']}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <Line type="monotone" dataKey="cumPnL"
                      stroke={finalPnL >= 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}
                      strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Trade table */}
          <Card>
            <CardHeader><CardTitle>All Option Trades ({trades.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground">
                      <th className="text-left px-4 py-2">Stock</th>
                      <th className="text-left px-4 py-2">Setup</th>
                      <th className="text-left px-4 py-2">Entry Date</th>
                      <th className="text-left px-4 py-2">Exit Date</th>
                      <th className="text-right px-4 py-2">Days</th>
                      <th className="text-right px-4 py-2">Stock $</th>
                      <th className="text-right px-4 py-2">Strike</th>
                      <th className="text-right px-4 py-2 text-primary">Contract Buy</th>
                      <th className="text-right px-4 py-2 text-primary">Peak</th>
                      <th className="text-right px-4 py-2 text-primary">Contract Sell</th>
                      <th className="text-right px-4 py-2">P&L %</th>
                      <th className="text-right px-4 py-2">Exit</th>
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
                        <td className="px-4 py-2 tabular-nums text-right">${t.stockEntryPrice.toFixed(2)}</td>
                        <td className="px-4 py-2 tabular-nums text-right">${t.strike}</td>
                        <td className="px-4 py-2 tabular-nums text-right font-medium text-primary">${t.entryOptionPrice.toFixed(2)}</td>
                        <td className="px-4 py-2 tabular-nums text-right text-muted-foreground">${t.peakOptionPrice.toFixed(2)}</td>
                        <td className="px-4 py-2 tabular-nums text-right font-medium text-primary">${t.exitOptionPrice.toFixed(2)}</td>
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
          <p className="text-sm">Configure and run to simulate option contract trades</p>
          <p className="text-xs mt-1 max-w-sm text-center">
            Uses real historical stock prices + Black-Scholes to price ATM call contracts. Market regime filter ensures you only trade when SPY is above its 50-day MA.
          </p>
        </div>
      )}
    </div>
  );
}
