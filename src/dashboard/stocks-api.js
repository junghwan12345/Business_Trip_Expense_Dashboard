import {
  buildYahooChartUrl,
  normalizeQuoteFailure,
  normalizeYahooQuote,
  quoteSymbolsForState
} from "./market-data.js";

export function buildQuoteUrl(symbol) {
  return buildYahooChartUrl(symbol);
}

export function mapQuoteResponse(symbol, data) {
  return normalizeYahooQuote(symbol, data);
}

export function normalizeStockFailure(symbol, error) {
  return normalizeQuoteFailure(symbol, error);
}

export async function fetchQuotesForState(state) {
  const symbols = quoteSymbolsForState(state);
  const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchQuote(symbol) {
  try {
    const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbol)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const quotes = await response.json();
    return quotes[symbol] || normalizeQuoteFailure(symbol, new Error("quote unavailable"));
  } catch (error) {
    return normalizeQuoteFailure(symbol, error);
  }
}

export function buildSparkline(seed = 1, points = 28) {
  let value = 50 + seed * 3;
  return Array.from({ length: points }, (_, index) => {
    value += Math.sin((index + seed) * 0.8) * 4 + Math.cos(index * 0.35 + seed) * 2;
    return Math.max(8, Math.round(value));
  });
}
