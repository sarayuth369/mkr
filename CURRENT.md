PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-15 MKR Candle Failure Semantics Correction
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_FRONTEND_MARKET_DATA_HARDENING_CANDLE_ENVELOPE_CORRECTION_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_FRONTEND_MARKET_DATA_HARDENING_CANDLE_ENVELOPE_CORRECTION_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Frontend Market Data Hardening - Final Final Correction, completed,
was WAITING_FOR_GPT_REVIEW (commit 8f853aa). Mac reviewed and found one
concrete remaining gap in that pass's Defect 3 (candle failure
semantics).

THIS PASS - closed exactly this one gap, nothing else:

Gap: HTTP 200 error/malformed candle envelope could still become []:
TwelveDataProvider.getHistoricalCandles()/AlpacaProvider.getHistoricalCandles()
already threw MarketFetchException for network failures/non-200
status/malformed JSON (from the prior pass), but never checked the
MKR/Alpaca envelope itself before handing the body to
TwelveDataParser.parseCandles()/AlpacaParser.parseBars() - both parsers
intentionally still return [] for an error envelope or a missing/
non-list candle array (their pre-existing, unchanged "never throws"
contract). So an HTTP 200 response shaped as an error envelope, or one
whose data/bars isn't a list, was silently treated as a genuine empty
history, indistinguishable from a real fetch fault.

Fix: validated the envelope in the provider, right before the existing
(untouched) parser call - the smallest of the two options the task
explicitly allowed. Both providers now check
isErrorEnvelope/isErrorResponse and that the candle array is actually a
List, throwing MarketFetchException (carrying the backend's own error
message when available) for either case. TwelveDataParser.parseCandles/
AlpacaParser.parseBars themselves were NOT touched - their existing
tests (parseCandles returns empty for an error envelope / when data is
missing or not a list) still pass completely unchanged, proving the
parser contract is genuinely preserved. Manager/service propagation
from the prior pass needed no changes - they already surface any thrown
exception correctly regardless of where in the provider it originated.

AUDIT:
Grepped every call site of parseCandles/parseBars in lib/ - each is
called from exactly one place, the two provider methods just fixed. No
other real-mode candle path exists that could still convert a provider
error or malformed payload into [] where the caller can't distinguish
it from valid empty history. demo_market_data_provider.dart (demo mode
only) doesn't use either parser.

REGRESSION:
- Backend: 525/525 passing (unchanged - no backend files touched this
  pass). TypeScript typecheck clean.
- Flutter: 296/296 passing (9 new, in two new files:
  test/logic/twelve_data_provider_test.dart (5 tests) and
  test/logic/alpaca_provider_test.dart (4 tests)). No existing test was
  weakened, deleted, or needed updating - this is a purely additive
  provider-layer fix. `flutter analyze`: no issues. `flutter build apk
  --debug`: succeeds.
- Security scan (established pattern) against the diff: no secrets.
- git diff reviewed - scoped to exactly the two provider files and
  their two new test files (27 lines of production code changed across
  both providers combined); no Market Pool, Firebase/FCM, Economic
  Calendar, News Radar, Supabase, or backend changes; auc/backend
  untouched.

PRODUCTION:
- No backend changes this pass - nothing to deploy. This fix is
  entirely frontend-only.
- Live smoke check performed: /api/mkr/health OK;
  /api/mkr/market/candles?symbol=AAPL&interval=d1 returns 200 with real
  OHLC data (success path unaffected);
  /api/mkr/market/candles?symbol=DXY&interval=d1 still returns HTTP 400
  with an error envelope (unchanged from the prior pass's live check).

NEXT:
Claude has completed this correction and stopped, per its own
instruction. No further improvement loop started. Waiting for GPT/Mac
review.
