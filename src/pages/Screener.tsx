import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Search, Plus, Trash2, Zap } from 'lucide-react';

interface ScreenerResult {
  ticker: string;
  price: number;
  change_pct: number;
  above_50ma: boolean;
  above_200ma: boolean;
  rsi: number;
  iv_rank: number;
  signal: string;
  score: number;
}

interface WatchlistItem {
  id: string;
  ticker: string;
  notes: string;
}

const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'SPY', 'QQQ', 'AMD'];

export default function Screener() {
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTicker, setNewTicker] = useState('');
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);

  const loadWatchlist = async () => {
    const { data } = await supabase.from('oe_watchlist' as any).select('*').order('added_at');
    if (data) setWatchlist(data as WatchlistItem[]);
    setWatchlistLoaded(true);
  };

  if (!watchlistLoaded) loadWatchlist();

  const addTicker = async () => {
    const t = newTicker.toUpperCase().trim();
    if (!t) return;
    const item = { id: crypto.randomUUID(), ticker: t, notes: '', added_at: new Date().toISOString() };
    await supabase.from('oe_watchlist' as any).insert(item);
    setWatchlist(prev => [...prev, item as WatchlistItem]);
    setNewTicker('');
  };

  const removeTicker = async (id: string) => {
    await supabase.from('oe_watchlist' as any).delete().eq('id', id);
    setWatchlist(prev => prev.filter(w => w.id !== id));
  };

  const runScreener = async () => {
    const tickers = watchlist.length ? watchlist.map(w => w.ticker) : DEFAULT_WATCHLIST;
    setLoading(true);
    setResults([]);
    try {
      const res = await fetch(`/api/screener?tickers=${tickers.join(',')}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results ?? []);
      // Save signals to Supabase
      const signals = (data.results ?? []).filter((r: ScreenerResult) => r.signal !== 'none');
      if (signals.length) {
        const rows = signals.map((r: ScreenerResult) => ({
          id: crypto.randomUUID(),
          ticker: r.ticker,
          signal_type: r.signal,
          details: { price: r.price, rsi: r.rsi, iv_rank: r.iv_rank, score: r.score },
          detected_at: new Date().toISOString(),
        }));
        await supabase.from('oe_signals' as any).insert(rows);
      }
      toast.success(`Screener complete — ${signals.length} signal(s) found`);
    } catch (e: any) {
      toast.error(e.message ?? 'Screener failed');
    }
    setLoading(false);
  };

  const signalBadge = (signal: string) => {
    if (signal === 'none') return null;
    const colors: Record<string, string> = {
      momentum_dip: 'bg-primary/20 text-primary border-primary/30',
      breakout: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      oversold_uptrend: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    };
    const labels: Record<string, string> = {
      momentum_dip: 'Momentum Dip',
      breakout: 'Breakout',
      oversold_uptrend: 'Oversold',
    };
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${colors[signal] ?? 'bg-muted text-muted-foreground border-border'}`}>
        {labels[signal] ?? signal}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Screener</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Scan for momentum dips, breakouts, and oversold setups</p>
        </div>
        <Button onClick={runScreener} disabled={loading}>
          <Zap className="h-3.5 w-3.5 mr-1" />
          {loading ? 'Scanning...' : 'Run Screener'}
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Watchlist */}
        <Card>
          <CardHeader><CardTitle>Watchlist</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={newTicker}
                onChange={e => setNewTicker(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && addTicker()}
                placeholder="Add ticker..."
                className="h-8 text-xs uppercase"
                maxLength={6}
              />
              <Button size="sm" onClick={addTicker}><Plus className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="space-y-1">
              {watchlist.length === 0 && (
                <p className="text-xs text-muted-foreground">Empty — will screen default large caps</p>
              )}
              {watchlist.map(w => (
                <div key={w.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/30">
                  <span className="text-sm font-medium">{w.ticker}</span>
                  <button onClick={() => removeTicker(w.id)} className="text-muted-foreground/40 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="md:col-span-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Search className="h-4 w-4" /> Results</CardTitle></CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : results.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">Run the screener to see results</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Chg%</TableHead>
                      <TableHead className="text-center">MA50</TableHead>
                      <TableHead className="text-right">RSI</TableHead>
                      <TableHead className="text-right">IVR</TableHead>
                      <TableHead>Signal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.sort((a, b) => b.score - a.score).map(r => (
                      <TableRow key={r.ticker} className={r.signal !== 'none' ? 'bg-primary/5' : ''}>
                        <TableCell className="font-semibold">{r.ticker}</TableCell>
                        <TableCell className="text-right tabular-nums">${r.price.toFixed(2)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${r.change_pct >= 0 ? 'gain' : 'loss'}`}>
                          {r.change_pct >= 0 ? '+' : ''}{r.change_pct.toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={r.above_50ma ? 'gain' : 'loss'}>{r.above_50ma ? '✓' : '✗'}</span>
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${r.rsi < 35 ? 'text-blue-400' : r.rsi > 70 ? 'loss' : ''}`}>
                          {r.rsi.toFixed(0)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${r.iv_rank < 30 ? 'loss' : 'text-muted-foreground'}`}>
                          {r.iv_rank.toFixed(0)}
                        </TableCell>
                        <TableCell>{signalBadge(r.signal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
