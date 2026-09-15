PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-15 MKR Candle Element Validation Correction
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_FRONTEND_MARKET_DATA_HARDENING_CANDLE_ELEMENT_VALIDATION_CORRECTION_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_FRONTEND_MARKET_DATA_HARDENING_CANDLE_ELEMENT_VALIDATION_CORRECTION_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Candle Failure Semantics Correction, completed, was
WAITING_FOR_GPT_REVIEW (commit 8ab11fe). Mac reviewed and found one
smaller remaining parsing gap in the candle-failure work.

THIS PASS - closed exactly this one gap, nothing else:

Gap: a valid, non-empty top-level candle array whose entries are ALL
malformed (bad OHLC or timestamp) still collapsed to [] -
TwelveDataParser.parseCandles()/AlpacaParser.parseBars() silently skip
unparseable entries and return whatever survives, which can itself be
[] when nothing survives. That made a real malformed payload
indistinguishable from a genuinely empty history, even after the prior
pass's envelope-level fix.

Fix: both providers already hold the raw pre-parse JSON array
(rawData/rawBars) right where they call the parser. Added one
condition after each parser call: if the raw list is non-empty but the
parsed candle list came back empty, throw MarketFetchException (every
entry was unparseable - a real fetch fault); otherwise return the
parsed candles unchanged - genuine empty stays [], a mixed valid/
malformed list still returns just the valid candles exactly as the
parser already computed them, no fabrication. TwelveDataParser.parseCandles/
AlpacaParser.parseBars themselves were NOT touched - they still
silently skip malformed entries exactly as before; their own existing
per-entry-skip test still passes unchanged, proving the parser contract
is genuinely untouched and 100% of the new work is in the provider.
Quote parsing was not touched at all.

AUDIT:
Re-grepped every call site of parseCandles/parseBars in lib/ - still
exactly one call site each, the two provider methods just extended. No
other real-mode candle path exists that could still collapse a
non-empty malformed payload into [] indistinguishable from genuine
empty history.

REGRESSION:
- Backend: 525/525 passing (unchanged - no backend files touched this
  pass). TypeScript typecheck clean.
- Flutter: 302/302 passing (6 new, added to the two provider test files
  created in the prior pass:
  test/logic/twelve_data_provider_test.dart and
  test/logic/alpaca_provider_test.dart, 3 each covering genuine-empty/
  all-malformed/mixed). No existing test was weakened, deleted, or
  needed updating - purely additive. `flutter analyze`: no issues.
  `flutter build apk --debug`: succeeds.
- Security scan (established pattern) against the diff: no secrets.
- git diff reviewed - scoped to exactly the two provider files (39
  lines of production code changed combined) and their two existing
  test files; no Market Pool, Firebase/FCM, Economic Calendar, News
  Radar, Supabase, or backend changes; auc/backend untouched.

PRODUCTION:
- No backend changes this pass - nothing to deploy. This fix is
  entirely frontend-only.
- Live smoke check performed: /api/mkr/health OK;
  /api/mkr/market/candles?symbol=AAPL&interval=d1 returns 200 (success
  path unaffected - a healthy backend's well-formed candle response is
  untouched by this fix). The "all-entries-malformed" condition itself
  isn't currently reproducible against the live (healthy) backend, so
  it's covered by the mocked-HTTP-client regression tests instead, same
  approach as the prior pass's envelope-level fix.

NEXT:
Claude has completed this correction and stopped, per its own
instruction. No further improvement loop started. Waiting for GPT/Mac
review.
