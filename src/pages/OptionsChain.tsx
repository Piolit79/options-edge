import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Search, TrendingUp } from 'lucide-react';

interface OptionContract {
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  volume: number;
  open_interest: number;
  implied_volatility: number;
  delta: number;
  theta: number;
  gamma: number;
  in_the_money: boolean;
}

interface ChainData {
  ticker: string;
  price: number;
  change_pct: number;
  iv_rank: number;
  expirations: string[];
  calls: OptionContract[];
  puts: OptionContract[];
}

export default function OptionsChain() {
  const [ticker, setTicker] = useState('');
  const [expiration, setExpiration] = useState('');
  const [chain, setChain] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchChain = async () => {
    const t = ticker.toUpperCase().trim();
    if (!t) return;
    setLoading(true);
    setChain(null);
    try {
      const url = `/api/options-chain?ticker=${t}${expiration ? `&expiration=${expiration}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChain(data);
      if (data.expirations?.length && !expiration) setExpiration(data.expirations[0]);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to fetch options chain');
    }
    setLoading(false);
  };

  const contractRow = (c: OptionContract, highlight = false) => (
    <TableRow key={`${c.strike}-${c.expiration}`} className={highlight ? 'bg-primary/10' : c.in_the_money ? 'bg-muted/30' : ''}>
      <TableCell className={`font-semibold ${highlight ? 'text-primary' : ''}`}>${c.strike}</TableCell>
      <TableCell className="tabular-nums">{c.bid.toFixed(2)}</TableCell>
      <TableCell className="tabular-nums">{c.ask.toFixed(2)}</TableCell>
      <TableCell className="tabular-nums font-medium">{c.mid.toFixed(2)}</TableCell>
      <TableCell className="tabular-nums text-muted-foreground">{(c.implied_volatility * 100).toFixed(1)}%</TableCell>
      <TableCell className="tabular-nums">{c.delta.toFixed(2)}</TableCell>
      <TableCell className="tabular-nums text-destructive">{c.theta.toFixed(3)}</TableCell>
      <TableCell className="tabular-nums text-muted-foreground">{c.open_interest?.toLocaleString() ?? '—'}</TableCell>
      <TableCell className="tabular-nums text-muted-foreground">{c.volume?.toLocaleString() ?? '—'}</TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Options Chain</h1>
        <p className="text-xs text-muted-foreground mt-0.5">View live options data for any ticker</p>
      </div>

      {/* Search */}
      <div className="flex gap-2 max-w-sm">
        <Input
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && fetchChain()}
          placeholder="Ticker (e.g. AAPL)"
          className="h-9 uppercase"
          maxLength={6}
        />
        <Button onClick={fetchChain} disabled={loading}>
          <Search className="h-3.5 w-3.5 mr-1" />
          {loading ? 'Loading...' : 'Load'}
        </Button>
      </div>

      {/* Quote bar */}
      {chain && (
        <div className="flex items-center gap-4 p-3 rounded-lg bg-card border">
          <div>
            <span className="text-xl font-bold">{chain.ticker}</span>
            <span className={`ml-3 text-sm font-semibold ${chain.change_pct >= 0 ? 'gain' : 'loss'}`}>
              ${chain.price.toFixed(2)} ({chain.change_pct >= 0 ? '+' : ''}{chain.change_pct.toFixed(2)}%)
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-xs text-muted-foreground">IV Rank</div>
            <Badge variant={chain.iv_rank > 50 ? 'default' : 'secondary'} className="tabular-nums">
              {chain.iv_rank.toFixed(0)}
            </Badge>
            {chain.iv_rank < 30 && (
              <span className="text-[10px] text-destructive">Low IV — avoid buying</span>
            )}
          </div>
        </div>
      )}

      {/* Expiration selector */}
      {chain?.expirations && chain.expirations.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {chain.expirations.slice(0, 8).map(exp => (
            <button
              key={exp}
              onClick={() => setExpiration(exp)}
              className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${expiration === exp ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'}`}
            >
              {exp}
            </button>
          ))}
        </div>
      )}

      {/* Chain table */}
      {loading && (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
      )}

      {chain && (
        <Tabs defaultValue="calls">
          <TabsList>
            <TabsTrigger value="calls">Calls</TabsTrigger>
            <TabsTrigger value="puts">Puts</TabsTrigger>
          </TabsList>
          <TabsContent value="calls">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strike</TableHead>
                      <TableHead>Bid</TableHead>
                      <TableHead>Ask</TableHead>
                      <TableHead>Mid</TableHead>
                      <TableHead>IV</TableHead>
                      <TableHead>Delta</TableHead>
                      <TableHead>Theta</TableHead>
                      <TableHead>OI</TableHead>
                      <TableHead>Vol</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {chain.calls
                      .filter(c => expiration ? c.expiration === expiration : true)
                      .map(c => contractRow(c, Math.abs(c.delta - 0.5) < 0.05))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="puts">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strike</TableHead>
                      <TableHead>Bid</TableHead>
                      <TableHead>Ask</TableHead>
                      <TableHead>Mid</TableHead>
                      <TableHead>IV</TableHead>
                      <TableHead>Delta</TableHead>
                      <TableHead>Theta</TableHead>
                      <TableHead>OI</TableHead>
                      <TableHead>Vol</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {chain.puts
                      .filter(c => expiration ? c.expiration === expiration : true)
                      .map(c => contractRow(c))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {!chain && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <TrendingUp className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">Enter a ticker to view the options chain</p>
        </div>
      )}
    </div>
  );
}
