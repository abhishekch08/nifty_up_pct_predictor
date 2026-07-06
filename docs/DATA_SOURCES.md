# Data sources and availability

## Automated baseline

The `YahooChartSource` adapter retrieves daily chart data for:

| Internal label | Yahoo symbol | Intended use |
|---|---:|---|
| NIFTY | `^NSEI` | Target, price, momentum, trend, realized volatility |
| INDIA_VIX | `^INDIAVIX` | Implied daily move and volatility regime |
| SP500 | `^GSPC` | US risk cue |
| NASDAQ100 | `^NDX` | US growth cue |
| DOW | `^DJI` | US blue-chip cue |
| NIKKEI | `^N225` | Asian cue |
| HANGSENG | `^HSI` | Asian cue |
| USDINR | `INR=X` | Rupee pressure |
| DXY | `DX-Y.NYB` | Dollar pressure |
| BRENT | `BZ=F` | Imported inflation pressure |
| US10Y | `^TNX` | Global duration pressure |

The adapter uses three attempts with exponential delay, a six-hour JSON disk cache, stale-cache fallback, source attribution, and response-shape validation. A failed series does not abort all sources and is written to `data_quality_log`.

## Official NSE EOD overlays

The long Yahoo history is never trusted as the sole freshness source. After every refresh, the application obtains the official NSE `allIndices` closing snapshot and overwrites the latest Nifty 50 and India VIX rows with `nse_official` provenance. Intraday snapshots before 15:30 IST are rejected rather than mislabeled as EOD.

For the same official trading date it also retrieves:

- FII/FPI and DII cash activity from NSE's FII/DII report endpoint.
- Four participant categories from the NSE Clearing participant-OI CSV archive.
- Nifty option OI, change in OI, volume, close, expiry and strike from the NSE FO UDiFF bhavcopy ZIP.

The official bhavcopy does not publish implied volatility, so IV remains missing rather than being guessed. PCR, walls, straddle price and OI analytics still use the published EOD fields. A newly introduced feed is excluded from model training until it has enough historical observations; it remains visible on the relevant dashboard page immediately.

Yahoo is not an exchange-authoritative feed. Replace or supplement this adapter with a licensed market-data source for investment operations.

## Official/manual EOD datasets

NSE India and other institutions change download endpoints and anti-automation controls. For these datasets, production policy is: use an official downloadable report where stable and permitted; otherwise ingest an audited CSV after close.

- FII/DII cash activity: NSE published cash-market activity report.
- Participant OI and volumes: NSE participant-wise F&O EOD report.
- Nifty options: NSE EOD option bhavcopy/chain snapshot, with expiry and strike retained.
- Breadth: exchange market-statistics report or a locally computed licensed constituent universe.
- GIFT Nifty: licensed/historical feed or explicit daily entry.
- RBI, Budget, elections and special events: maintained event calendar with human review.

Never scrape a page in a way that violates its terms, bypass access controls, or silently changes a missing feature to zero.

## Timestamp policy

- Nifty and India VIX EOD records are stamped after the Indian close and predict the next session.
- FII/DII, participant OI and options EOD for date T can predict T+1 only.
- US date-T close occurs after the Indian date-T close but before the next Indian open; it may therefore be aligned to the T+1 decision cutoff.
- All source adapters must preserve `available_at`. `assert_asof_availability` rejects any feature later than the evaluation cutoff.
- Daily Yahoo timestamps need source-specific exchange-calendar testing before a new symbol is admitted.

## Quality states

- **Complete:** required columns present and validation passed.
- **Partial:** data is usable but warnings exist.
- **Degraded:** important series or many features are absent; confidence is capped.
- **Unsafe:** target data/model is absent; no actionable prediction should be produced.
