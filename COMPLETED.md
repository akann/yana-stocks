# Spec Audit — stocks.yanatech.co.uk

Audited: 2026-06-27 against original product spec.

**Verdict: all must-haves and nice-to-haves are implemented.**

---

## Must Haves

| Requirement                         | Status | Detail                                                                                                                                                                 |
| ----------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ETFs as well as shares              | ✓      | Market Browser → ETFs tab: SPY, IVV, VOO, QQQ, VTI, IWM, DIA, XLK — all with + buttons, all navigable to stock detail page                                             |
| Volume data                         | ✓      | Stock header shows OPEN/HIGH/LOW/VOLUME (e.g. 65.2M for AAPL); volume pane rendered below candlesticks in chart                                                        |
| News specific to current asset      | ✓      | RECENT NEWS section with benzinga/newsapi articles, per-article sentiment labels (positive/negative/neutral)                                                           |
| Candlestick graphs                  | ✓      | Line/Candle toggle, 7 time ranges (1H/1D/1W/1M/3M/6M/1Y), OHLCV crosshair on hover                                                                                     |
| Momentum indicators (MA, RSI, MACD) | ✓      | Toggle bar: SMA 20/50/200, EMA 12/26 overlay on price chart; RSI 14 and MACD each render as sub-panes below the main chart (requires ≥1M range for enough data points) |

## Nice-to-Haves

| Requirement                 | Status | Detail                                                                                                                                                     |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| News integrated into graphs | ✓      | Numbered circle markers on chart candles (e.g. "8" on a date) — clicking shows news headline popup                                                         |
| Location specific           | ✓      | Profile → "Default market" dropdown (US Equities / UK Equities / ETFs / Global); Market Browser has UK Equities tab; FTSE 100 index card + sector rotation |
| Consensus / Analyst ratings | ✓      | Right sidebar on stock detail: Buy/Hold/Sell bar with Str Buy/Buy/Hold/Sell/Str Sell counts and price target                                               |
| Simplified buy/sell signals | ✓      | "Oversold" / "Overbought" badge next to chart title when RSI crosses threshold (e.g. RSI 14 = 29.47 → "Oversold")                                          |

## Other

| Requirement                     | Status | Detail                                                                                                                                 |
| ------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Home screen — indices & sectors | ✓      | S&P 500/Nasdaq/FTSE 100 index cards; Factor Performance (6 tiles, 1D/1W/1M toggle); Market News feed                                   |
| Index rotations & heatmap       | ✓      | Sector Rotation: Today view (market-cap-weighted treemap) + History view (colour-coded 12-day table); S&P 500 and FTSE 100 supported   |
| Consistent watchlist add        | ✓      | "+" button on: home Top Gainers/Losers, Market Browser rows, ETF tab rows, Stock Screener rows, stock detail page header               |
| Stock screener                  | ✓      | Filters: Market Cap, Min Volume, Min Div Yield, Sector, Min Momentum %; results table with Price/Chg%/Mkt Cap/Vol/Div% + watchlist add |

---

## Minor Observations (not spec gaps)

1. **RSI/MACD sub-panes** only appear clearly on **1M+ range** — with 1W there
   is not enough data to compute them, so the pane collapses. Could add a user
   hint such as "Select 1M or longer to view RSI/MACD."
2. **ML predictions** showing large negative divergence from live price (1-day
   prediction -10% while stock was +2.67%) — model may need retraining, not a
   feature gap.
3. **Dark mode** is in the Profile Theme dropdown but was not verified as
   working end-to-end.
