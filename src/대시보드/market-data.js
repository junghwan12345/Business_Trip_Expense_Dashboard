export const defaultIndices = [
  { id: "index-kospi", symbol: "^KS11", name: "코스피", market: "KRX", marketType: "INDEX" },
  { id: "index-kosdaq", symbol: "^KQ11", name: "코스닥", market: "KRX", marketType: "INDEX" },
  { id: "index-sp500", symbol: "^GSPC", name: "S&P 500", market: "US", marketType: "INDEX" },
  { id: "index-nasdaq", symbol: "^IXIC", name: "나스닥", market: "US", marketType: "INDEX" }
];

export function detectMarketType(symbol) {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.startsWith("^")) return "INDEX";
  if (normalized.endsWith(".KS") || normalized.endsWith(".KQ")) return "KR";
  return "US";
}

export function quoteSymbolsForState(state) {
  return [...new Set([...(state.stocks || []), ...defaultIndices].map((item) => item.symbol))];
}

export function normalizeYahooQuote(symbol, data) {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    throw new Error("quote unavailable");
  }

  const price = Number(meta.regularMarketPrice || 0);
  const previousClose = Number(meta.previousClose || meta.chartPreviousClose || 0);
  const change = previousClose ? roundNumber(price - previousClose) : 0;
  const changePercent = previousClose ? roundNumber((change / previousClose) * 100) : 0;
  const chartPoints = (result.indicators?.quote?.[0]?.close || [])
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .map((value) => roundNumber(value, 2));

  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    price,
    change,
    changePercent,
    open: Number(meta.regularMarketOpen || 0),
    high: Number(meta.regularMarketDayHigh || 0),
    low: Number(meta.regularMarketDayLow || 0),
    previousClose,
    volume: meta.regularMarketVolume ? Number(meta.regularMarketVolume) : null,
    exchangeName: meta.exchangeName || "",
    updatedAt: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
    chartPoints,
    isFallback: false,
    message: ""
  };
}

function roundNumber(value, digits = 4) {
  return Number(value.toFixed(digits));
}

export function normalizeQuoteFailure(symbol, error) {
  return {
    symbol,
    price: 0,
    change: 0,
    changePercent: 0,
    open: 0,
    high: 0,
    low: 0,
    previousClose: 0,
    volume: null,
    exchangeName: "",
    updatedAt: new Date().toISOString(),
    isFallback: true,
    message: `데이터 갱신 실패: ${error.message || "시세를 불러오지 못했습니다."}`
  };
}

export function buildYahooChartUrl(symbol) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
}

export function buildIssueLinks(stock) {
  const rawSymbol = stock.symbol.replace(/\.(KS|KQ)$/i, "");
  const query = encodeURIComponent(`${stock.name} ${stock.symbol}`);
  const naverCode = rawSymbol.replace(/^\^/, "");
  const links = [
    {
      label: "네이버 금융",
      url: stock.marketType === "KR"
        ? `https://finance.naver.com/item/main.naver?code=${naverCode}`
        : `https://finance.yahoo.com/quote/${encodeURIComponent(stock.symbol)}`
    },
    {
      label: "Google 뉴스",
      url: `https://news.google.com/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`
    },
    {
      label: "Yahoo Finance",
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(stock.symbol)}`
    }
  ];
  return links;
}

export function marketTypeLabel(marketType) {
  return {
    ALL: "전체",
    KR: "한국주식",
    US: "미국주식",
    INDEX: "지수"
  }[marketType] || marketType;
}

export function shouldAutoRefreshQuotes(state, now = new Date(), maxAgeMinutes = 15) {
  const symbols = quoteSymbolsForState(state);
  const cache = state.quoteCache || {};
  const maxAgeMs = maxAgeMinutes * 60 * 1000;

  return symbols.some((symbol) => {
    const quote = cache[symbol];
    if (!quote || quote.isFallback || !quote.updatedAt) return true;
    const age = now.getTime() - new Date(quote.updatedAt).getTime();
    return Number.isNaN(age) || age > maxAgeMs;
  });
}
