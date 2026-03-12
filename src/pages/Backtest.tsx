import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Play, TrendingUp, TrendingDown, Target, BarChart2, Info, CheckCircle2, Calendar } from 'lucide-react';

interface BacktestTrade {
  ticker: string; signal: string; score: number;
  entryDate: string; exitDate: string; daysHeld: number;
  stockEntryPrice: number; strike: number;
  optionSymbol: string;
  entryOptionPrice: number; exitOptionPrice: number; peakOptionPrice: number;
  contracts: number; capitalRisked: number;
  pnlPct: number; pnlDollars: number;
  closeReason: 'profit_target' | 'trailing_stop' | 'stop_loss' | 'expired';
}

interface EquityPoint { date: string; balance: number; ticker: string; }

interface Summary {
  startingBalance: number; finalBalance: number;
  totalPnL: number; totalReturn: number;
  totalTrades: number; tradesPerWeek: number;
  winRate: number; avgPnL: number;
  bestTrade: number; worstTrade: number;
  bySignal: Record<string, { trades: number; wins: number; pnl: number }>;
  byReason: Record<string, number>;
}

const SIGNAL_LABELS: Record<string, string> = {
  momentum_dip:    'Momentum Dip',
  ma50_support:    'MA50 Support',
  oversold_uptrend:'Oversold',
  breakout:        'Breakout',
};
const SIGNAL_DESCRIPTIONS: Record<string, string> = {
  momentum_dip:    'Above MA50+MA200, RSI<38, pulled back 4–12% on fading volume, within 20% of 52w high',
  ma50_support:    'Price touches MA50 from above (within 1.5%), RSI 35–52 — classic buy-the-dip-at-support',
  oversold_uptrend:'Above MA50+MA200, RSI<32, within 20% of 52w high — deep oversold in uptrend',
  breakout:        'Above MA50+MA200, new 20-day high on 2x volume, RSI 50–70 — momentum continuation',
};
const CLOSE_COLORS: Record<string, string> = {
  profit_target: 'text-green-400', trailing_stop: 'text-blue-400',
  stop_loss: 'text-destructive',   expired: 'text-muted-foreground',
};
const CLOSE_LABELS: Record<string, string> = {
  profit_target: 'Target', trailing_stop: 'Trailing',
  stop_loss: 'Stop',        expired: 'Expired',
};
const ALL_SECTORS = [
  'Tech','Financials','Healthcare','Consumer',
  'Energy','Industrials','Communication','Semis & Chips','ETFs (high OI)',
];
const UNIVERSE_COUNTS: Record<string, number> = {
  'Tech':37,'Financials':28,'Healthcare':30,'Consumer':29,
  'Energy':16,'Industrials':25,'Communication':10,'Semis & Chips':10,'ETFs (high OI)':16,
};

function fmt(n: number) {
  return n >= 0 ? `+$${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `-$${Math.abs(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Backtest() {
  const [scanMode, setScanMode]           = useState<'tier1'|'all'|'sectors'>('tier1');
  const [selectedSectors, setSelectedSectors] = useState<string[]>(ALL_SECTORS);
  const [days, setDays]                   = useState('365');
  const [startingBalance, setStartingBalance] = useState('10000');
  const [riskMode, setRiskMode]           = useState<'conviction'|'fixed'>('conviction');
  const [fixedRiskPct, setFixedRiskPct]   = useState('2');
  const [profitTarget, setProfitTarget]   = useState('75');
  const [stopLoss, setStopLoss]           = useState('35');
  const [useTrailing, setUseTrailing]     = useState(true);
  const [trailTrigger, setTrailTrigger]   = useState('25');
  const [trailPct, setTrailPct]           = useState('25');
  const [minConviction, setMinConviction] = useState('2');
  const [dte, setDte]                     = useState('45');
  const [cooldown, setCooldown]           = useState('15');

  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trades, setTrades]   = useState<BacktestTrade[]>([]);
  const [equity, setEquity]   = useState<EquityPoint[]>([]);

  const toggleSector = (s: string) =>
    setSelectedSectors(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);

  const totalUniverseCount = Object.values(UNIVERSE_COUNTS).reduce((a, b) => a + b, 0);
  const tickerCount = scanMode === 'tier1' ? 35
    : scanMode === 'all' ? totalUniverseCount
    : selectedSectors.reduce((n, s) => n + (UNIVERSE_COUNTS[s] ?? 0), 0);

  const run = async () => {
    setLoading(true); setSummary(null); setTrades([]); setEquity([]);
    try {
      const sectors = scanMode === 'tier1' ? 'tier1'
        : scanMode === 'all' ? 'all'
        : selectedSectors.length === ALL_SECTORS.length ? 'all'
        : selectedSectors.join(',');
      const params = new URLSearchParams({
        sectors, days, starting_balance: startingBalance,
        risk_per_trade: riskMode === 'conviction' ? 'conviction' : fixedRiskPct,
        profit_target: profitTarget, stop_loss: stopLoss,
        trailing: useTrailing ? 'true' : 'false',
        trail_trigger: trailTrigger, trail_pct: trailPct,
        min_conviction: minConviction, dte, cooldown_days: cooldown,
      });
      const res = await fetch(`/api/backtest?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSummary(data.summary);
      setTrades(data.trades);
      setEquity(data.equityCurve ?? []);
      if (!data.trades.length)
        toast.info('No signals — try longer range, lower conviction, or shorter cooldown');
      else
        toast.success(`${data.trades.length} trades (${data.summary.tradesPerWeek}/wk avg)`);
    } catch (e: any) {
      toast.error(e.message ?? 'Backtest failed');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Backtest — Call Option Contracts</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Simulates buying ATM call contracts sized to your balance. Stop losses enforced on intraday low — no P&L can exceed the stop %.
        </p>
      </div>

      {/* Setup cards */}
      <div className="grid md:grid-cols-4 gap-3">
        {Object.entries(SIGNAL_DESCRIPTIONS).map(([sig, desc]) => (
          <div key={sig} className="rounded-lg border border-border/50 bg-card p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Info className="h-3 w-3 text-primary shrink-0" />
              <span className="text-[11px] font-semibold">{SIGNAL_LABELS[sig]}</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Config */}
      <Card>
        <CardContent className="p-4 space-y-5">

          {/* Universe */}
          <div className="space-y-2">
            <label className="text-xs font-semibold">Universe</label>
            <div className="flex gap-2 flex-wrap">
              {(['tier1','all','sectors'] as const).map(m => (
                <button key={m} onClick={() => setScanMode(m as any)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${scanMode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                  {m === 'tier1' ? 'Top 35 (highest OI)' : m === 'all' ? 'All (~200 stocks)' : 'By Sector'}
                </button>
              ))}
            </div>
            {scanMode === 'sectors' && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button onClick={() => setSelectedSectors(ALL_SECTORS)}
                  className="px-2.5 py-1 rounded text-[11px] font-medium border border-border text-muted-foreground hover:text-foreground">
                  Select All
                </button>
                <button onClick={() => setSelectedSectors([])}
                  className="px-2.5 py-1 rounded text-[11px] font-medium border border-border text-muted-foreground hover:text-foreground">
                  Clear
                </button>
                {ALL_SECTORS.map(s => (
                  <button key={s} onClick={() => toggleSector(s)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${selectedSectors.includes(s) ? 'bg-primary/20 text-primary border-primary/40' : 'border-border text-muted-foreground'}`}>
                    {s} <span className="opacity-50">({UNIVERSE_COUNTS[s]})</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {tickerCount} stocks — all mid/large-cap, deep options markets
            </p>
          </div>

          {/* Capital + position sizing */}
          <div className="space-y-2">
            <label className="text-xs font-semibold">Capital & Position Sizing</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Starting Balance ($)</label>
                <Input type="number" value={startingBalance} onChange={e => setStartingBalance(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-[11px] text-muted-foreground">Risk Per Trade</label>
                <div className="flex gap-2">
                  <button onClick={() => setRiskMode('conviction')}
                    className={`px-3 py-1.5 rounded text-[11px] font-medium border transition-colors ${riskMode === 'conviction' ? 'bg-primary/20 text-primary border-primary/40' : 'border-border text-muted-foreground'}`}>
                    By Conviction (1%/2%/3%)
                  </button>
                  <button onClick={() => setRiskMode('fixed')}
                    className={`px-3 py-1.5 rounded text-[11px] font-medium border transition-colors ${riskMode === 'fixed' ? 'bg-primary/20 text-primary border-primary/40' : 'border-border text-muted-foreground'}`}>
                    Fixed %
                  </button>
                  {riskMode === 'fixed' && (
                    <div className="flex items-center gap-1">
                      <Input type="number" value={fixedRiskPct} onChange={e => setFixedRiskPct(e.target.value)} className="h-8 w-16 text-sm" />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  )}
                </div>
                {riskMode === 'conviction' && (
                  <p className="text-[10px] text-muted-foreground">Score 3 = 3% · Score 2 = 2% · Score 1 = 1% of current balance</p>
                )}
              </div>
            </div>
          </div>

          {/* Trade params */}
          <div className="space-y-2">
            <label className="text-xs font-semibold">Trade Parameters</label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Days Back',      value: days,          set: setDays },
                { label: 'Option DTE',     value: dte,           set: setDte },
                { label: 'Min Conviction', value: minConviction, set: setMinConviction },
                { label: 'Cooldown Days',  value: cooldown,      set: setCooldown,
                  hint: 'Min days between trades on same ticker' },
              ].map(({ label, value, set, hint }) => (
                <div key={label} className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">{label}</label>
                  <Input type="number" value={value} onChange={e => set(e.target.value)} className="h-8 text-sm" />
                  {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
                </div>
              ))}
              <div className="space-y-1">
                <label className={`text-[11px] ${useTrailing ? 'text-muted-foreground/40' : 'text-muted-foreground'}`}>
                  Profit Target %
                </label>
                <Input
                  type="number" value={profitTarget}
                  onChange={e => setProfitTarget(e.target.value)}
                  disabled={useTrailing}
                  className={`h-8 text-sm ${useTrailing ? 'opacity-40' : ''}`}
                />
                {useTrailing
                  ? <p className="text-[10px] text-blue-400">Unlimited — trailing stop exits</p>
                  : <p className="text-[10px] text-muted-foreground">Hard cap on upside</p>
                }
              </div>
            </div>
          </div>

          {/* Stop settings */}
          <div className="rounded-lg border border-border/50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">Trailing Stop</span>
                  <Badge variant={useTrailing ? 'default' : 'secondary'} className="text-[9px]">
                    {useTrailing ? 'ON' : 'OFF'}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {useTrailing
                    ? `Unlimited upside — once up ${trailTrigger}%, trails ${trailPct}% below the intraday peak. Profit target is disabled.`
                    : 'Fixed stop + profit target. Exits at exactly the stop % (enforced on intraday low).'}
                </p>
              </div>
              <button onClick={() => setUseTrailing(!useTrailing)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${useTrailing ? 'bg-primary' : 'bg-muted border border-border'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${useTrailing ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Hard Stop Loss %</label>
                <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} className="h-8 text-sm" />
                <p className="text-[10px] text-muted-foreground">Max loss on any trade</p>
              </div>
              {useTrailing && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Start Trailing At %</label>
                    <Input type="number" value={trailTrigger} onChange={e => setTrailTrigger(e.target.value)} className="h-8 text-sm" />
                    <p className="text-[10px] text-muted-foreground">Min gain before trailing activates</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Trail % Below Peak</label>
                    <Input type="number" value={trailPct} onChange={e => setTrailPct(e.target.value)} className="h-8 text-sm" />
                    <p className="text-[10px] text-muted-foreground">How far below peak to set stop</p>
                  </div>
                </>
              )}
            </div>
          </div>

          <Button onClick={run} disabled={loading || (scanMode === 'sectors' && !selectedSectors.length)} size="lg">
            <Play className="h-4 w-4 mr-2" />
            {loading ? 'Running backtest...' : `Run Backtest (${tickerCount} stocks, $${parseInt(startingBalance).toLocaleString()})`}
          </Button>
          {loading && <p className="text-xs text-muted-foreground">Fetching price history and simulating option contracts... 15–60s</p>}
        </CardContent>
      </Card>

      {loading && <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>}

      {summary && (
        <>
          {/* Summary stats */}
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
                  {summary.totalReturn >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} Total Return
                </div>
                <div className={`text-2xl font-bold ${summary.totalReturn >= 0 ? 'gain' : 'loss'}`}>
                  {summary.totalReturn >= 0 ? '+' : ''}{summary.totalReturn.toFixed(1)}%
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  ${summary.startingBalance.toLocaleString()} → ${summary.finalBalance.toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Trades / Week
                </div>
                <div className={`text-2xl font-bold ${summary.tradesPerWeek >= 3 ? 'gain' : summary.tradesPerWeek < 1 ? 'loss' : 'text-foreground'}`}>
                  {summary.tradesPerWeek}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">target: 3–10/wk</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Best / Worst
                </div>
                <div className="text-lg font-bold gain">+{summary.bestTrade.toFixed(1)}%</div>
                <div className="text-sm font-semibold loss">{summary.worstTrade.toFixed(1)}%</div>
              </CardContent>
            </Card>
          </div>

          {/* Exit reason pill row */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground font-medium">Exit breakdown:</span>
            {Object.entries(summary.byReason).map(([r, n]) => (
              <span key={r} className={`${CLOSE_COLORS[r]} font-semibold`}>
                {CLOSE_LABELS[r]} {n} ({Math.round(n / summary.totalTrades * 100)}%)
              </span>
            ))}
          </div>

          {/* Per signal */}
          <div className="grid md:grid-cols-4 gap-3">
            {Object.entries(summary.bySignal).map(([sig, s]) => (
              <Card key={sig}>
                <CardContent className="p-3">
                  <div className="text-[11px] font-semibold mb-2">{SIGNAL_LABELS[sig] ?? sig}</div>
                  <div className="grid grid-cols-3 gap-1 text-center">
                    <div><div className="text-base font-bold">{s.trades}</div><div className="text-[9px] text-muted-foreground">Trades</div></div>
                    <div>
                      <div className={`text-base font-bold ${Math.round(s.wins/s.trades*100) >= 55 ? 'gain' : 'loss'}`}>
                        {Math.round(s.wins/s.trades*100)}%
                      </div>
                      <div className="text-[9px] text-muted-foreground">Win Rate</div>
                    </div>
                    <div>
                      <div className={`text-base font-bold ${s.pnl >= 0 ? 'gain' : 'loss'}`}>
                        {s.pnl >= 0 ? '+' : ''}${Math.round(s.pnl)}
                      </div>
                      <div className="text-[9px] text-muted-foreground">P&L</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Equity curve */}
          {equity.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <BarChart2 className="h-4 w-4" />
                  Account Balance Over Time (starting ${parseInt(startingBalance).toLocaleString()})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={equity}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toLocaleString()}`} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }}
                      formatter={(v: any, _: any, p: any) => [`$${Number(v).toLocaleString()} — ${p.payload.ticker}`, 'Balance']}
                    />
                    <ReferenceLine y={parseFloat(startingBalance)} stroke="hsl(var(--border))" strokeDasharray="4 2" />
                    <Line type="monotone" dataKey="balance"
                      stroke={summary.finalBalance >= summary.startingBalance ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}
                      strokeWidth={2} dot={false} />
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
                      <th className="text-left px-3 py-2">Stock</th>
                      <th className="text-left px-3 py-2">Setup</th>
                      <th className="text-left px-3 py-2">Contract</th>
                      <th className="text-left px-3 py-2">Entry</th>
                      <th className="text-left px-3 py-2">Exit</th>
                      <th className="text-right px-3 py-2">Days</th>
                      <th className="text-right px-3 py-2">Stock $</th>
                      <th className="text-right px-3 py-2">Strike</th>
                      <th className="text-right px-3 py-2 text-primary">Contract Buy</th>
                      <th className="text-right px-3 py-2 text-muted-foreground">Peak</th>
                      <th className="text-right px-3 py-2 text-primary">Contract Sell</th>
                      <th className="text-right px-3 py-2">Contracts</th>
                      <th className="text-right px-3 py-2">P&L %</th>
                      <th className="text-right px-3 py-2">P&L $</th>
                      <th className="text-right px-3 py-2">Exit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {trades.map((t, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="px-3 py-1.5 font-semibold">{t.ticker}</td>
                        <td className="px-3 py-1.5"><Badge variant="outline" className="text-[9px]">{SIGNAL_LABELS[t.signal] ?? t.signal}</Badge></td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground whitespace-nowrap">{t.optionSymbol}</td>
                        <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{t.entryDate}</td>
                        <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{t.exitDate}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right">{t.daysHeld}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right">${t.stockEntryPrice.toFixed(2)}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right">${t.strike}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right font-medium text-primary">${t.entryOptionPrice.toFixed(2)}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right text-muted-foreground">${t.peakOptionPrice.toFixed(2)}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right font-medium text-primary">${t.exitOptionPrice.toFixed(2)}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right">{t.contracts}</td>
                        <td className={`px-3 py-1.5 tabular-nums text-right font-semibold ${t.pnlPct > 0 ? 'gain' : t.pnlPct < 0 ? 'loss' : ''}`}>
                          {t.pnlPct > 0 ? '+' : ''}{t.pnlPct.toFixed(1)}%
                        </td>
                        <td className={`px-3 py-1.5 tabular-nums text-right font-semibold ${t.pnlDollars > 0 ? 'gain' : t.pnlDollars < 0 ? 'loss' : ''}`}>
                          {fmt(t.pnlDollars)}
                        </td>
                        <td className={`px-3 py-1.5 text-right ${CLOSE_COLORS[t.closeReason]}`}>
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
          <p className="text-sm">Set your starting balance and run</p>
          <p className="text-xs mt-1 max-w-sm text-center">
            Stop losses are enforced on the intraday low — no trade can lose more than your stop %. Trailing stop locks in gains without capping upside.
          </p>
        </div>
      )}
    </div>
  );
}
