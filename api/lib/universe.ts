// Curated universe of ~180 highly liquid, optionable large/mid-cap US stocks.
// Selection criteria: high options open interest, tight bid/ask spreads, market cap > $5B,
// strong trading volume, covered by major market makers.

export const UNIVERSE: Record<string, string[]> = {
  'Tech': [
    'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AVGO', 'ORCL',
    'CSCO', 'AMD', 'QCOM', 'TXN', 'MU', 'AMAT', 'LRCX', 'KLAC', 'MRVL', 'ADI',
    'SNPS', 'CDNS', 'NOW', 'CRM', 'ADBE', 'INTU', 'PANW', 'CRWD', 'FTNT', 'ZS',
    'PLTR', 'UBER', 'LYFT', 'SNAP', 'PINS', 'RBLX', 'COIN', 'HOOD',
  ],
  'Financials': [
    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BLK', 'SCHW', 'AXP', 'V', 'MA',
    'PYPL', 'COF', 'USB', 'TFC', 'PNC', 'BK', 'ICE', 'CME', 'SPGI', 'MCO',
    'CB', 'PGR', 'MET', 'PRU', 'AFL', 'HIG', 'ALL',
  ],
  'Healthcare': [
    'JNJ', 'UNH', 'ABT', 'TMO', 'DHR', 'MDT', 'ISRG', 'BSX', 'SYK', 'BDX',
    'DXCM', 'IDXX', 'IQV', 'HUM', 'CVS', 'CI', 'BIIB', 'GILD', 'AMGN', 'REGN',
    'VRTX', 'MRNA', 'LLY', 'PFE', 'MRK', 'BMY', 'ABBV', 'ZTS', 'EW', 'RMD',
  ],
  'Consumer': [
    'WMT', 'COST', 'TGT', 'HD', 'LOW', 'MCD', 'SBUX', 'NKE', 'PEP', 'KO',
    'PM', 'MO', 'CL', 'PG', 'ULTA', 'LULU', 'CMG', 'YUM', 'DPZ', 'DKNG',
    'MGM', 'WYNN', 'LVS', 'MAR', 'HLT', 'BKNG', 'EXPE', 'ABNB', 'DASH',
  ],
  'Energy': [
    'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY', 'VLO', 'PSX', 'MPC', 'DVN',
    'HAL', 'BKR', 'FANG', 'HES', 'APA', 'MRO',
  ],
  'Industrials': [
    'BA', 'CAT', 'DE', 'GE', 'HON', 'LMT', 'RTX', 'NOC', 'GD', 'UPS', 'FDX',
    'UNP', 'CSX', 'NSC', 'EMR', 'ETN', 'ITW', 'MMM', 'PH', 'ROK', 'CARR', 'OTIS',
    'WM', 'RSG', 'URI',
  ],
  'Communication': [
    'NFLX', 'DIS', 'CMCSA', 'T', 'VZ', 'TMUS', 'CHTR', 'PARA', 'WBD', 'SPOT',
  ],
  'Semis & Chips': [
    'INTC', 'TSM', 'ASML', 'ARM', 'MCHP', 'ON', 'SWKS', 'QRVO', 'MPWR', 'WOLF',
  ],
  'ETFs (high OI)': [
    'SPY', 'QQQ', 'IWM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'GLD', 'SLV',
    'TLT', 'EEM', 'EFA', 'HYG', 'GDX', 'ARKK',
  ],
};

export const ALL_TICKERS = Object.values(UNIVERSE).flat();

// Tickers with the absolute deepest options markets — used as the default scan set
export const TIER1_TICKERS = [
  'SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'AMZN', 'META', 'MSFT', 'GOOGL', 'AMD',
  'NFLX', 'COIN', 'BKNG', 'GS', 'JPM', 'BAC', 'XOM', 'CVX', 'LLY', 'AMGN',
  'BA', 'UBER', 'PLTR', 'CRWD', 'PANW', 'V', 'MA', 'UNH', 'HD', 'COST',
  'IWM', 'XLF', 'XLK', 'GLD', 'TLT',
];
