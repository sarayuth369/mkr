PROJECT: MKR

PROTOCOL: D:\FlutterProjects\gpt-claude\GPT_CLAUDE_PROTOCOL.md

TASK: 2026-09-15 MKR Candle Numeric Validation Correction
TITLE: Fix per D:\FlutterProjects\gpt-claude\GPT_TO_CLAUDE_MKR_FRONTEND_MARKET_DATA_HARDENING_CANDLE_NUMERIC_VALIDATION_CORRECTION_TASK.md
STATUS: WAITING_FOR_GPT_REVIEW

CLAUDE REPORT:
D:\FlutterProjects\gpt-claude\CLAUDE_TO_GPT_MKR_FRONTEND_MARKET_DATA_HARDENING_CANDLE_NUMERIC_VALIDATION_CORRECTION_REPORT.md

This file mirrors D:\FlutterProjects\gpt-claude\CURRENT.md (the protocol's
authoritative shared-state file); both are kept in sync.

PREVIOUS STATE:
MKR Candle Element Validation Correction, completed, was
WAITING_FOR_GPT_REVIEW (commit 354c79e). Mac reviewed and found one last
remaining candle-parsing edge.

THIS PASS - closed exactly this one gap, nothing else:

Gap: TwelveDataParser._num()/AlpacaParser._num() accepted any parseable
double, including non-finite NaN/Infinity values - reachable via a
malformed string field like "open": "NaN" (double.tryParse genuinely
parses "NaN"/"Infinity"/"-Infinity" per Dart's numeric string grammar).
So a candle entry with a non-finite OHLC value, or for Twelve Data a
non-finite numeric timestamp, was accepted as a real value instead of
rejected as malformed - a non-finite timestamp could even have reached
DateTime.fromMillisecondsSinceEpoch(...toInt()).

Fix: added .isFinite checks to each parser's existing per-entry
validation condition (alongside the existing null checks) - no new
helper, no parser redesign. TwelveDataParser.parseCandles now also
requires the numeric timestamp itself to be finite. AlpacaParser.parseBars'
timestamp is an ISO8601 string (DateTime.tryParse), inherently finite
when it succeeds, so no separate timestamp check was needed there. The
shared _num() helper (also used by ALL quote parsing) was NOT touched -
kept the change entirely inside the two candle-parsing loops, per the
task's explicit "quote parsing is out of scope" boundary. No
provider-level changes were needed - the prior pass's "raw non-empty
but parsed empty -> throw MarketFetchException" check is generic to
WHY parsing yielded nothing, so it already covers "all entries
non-finite" automatically now that the parser treats a non-finite entry
as unparseable, same as it already covered "all entries missing a
field."

AUDIT:
Re-grepped every call site of parseCandles/parseBars - unchanged,
exactly one call site each. Traced every numeric field feeding a
MarketCandle from these two parsers - all now finiteness-checked where
applicable; volume (optional, not named in the task) was left
unchanged, matching "close only this data-validation gap." One
adjacent path was identified and deliberately left out of scope:
TwelveDataProvider.watchCandles/AlpacaProvider.watchCandles build a
LIVE candle directly from a WebSocket tick's quote.price
(parseWsTick/parseWsTrade, quote parsers using the same shared _num()),
not from parseCandles/parseBars - a malformed live tick could in
principle carry a non-finite price into a live-updating candle. This is
a quote-parsing path (out of scope) and a materially different code
path (WebSocket ticks, not the REST historical fetch this task's
defect describes) - flagged for visibility, not fixed, since fixing it
would mean touching the shared _num() helper or quote parsing, both
explicitly out of scope here.

REGRESSION:
- Backend: 525/525 passing (unchanged - no backend files touched this
  pass). TypeScript typecheck clean.
- Flutter: 313/313 passing (11 new: 4 in twelve_data_parser_test.dart
  (parseCandles group), 3 in alpaca_parser_test.dart (parseBars group),
  2 in twelve_data_provider_test.dart, 2 in alpaca_provider_test.dart -
  covering NaN OHLC, Infinity OHLC, non-finite timestamp (Twelve Data
  parser-level only - unreachable via real JSON at the provider level),
  mixed valid/non-finite, and all-non-finite-throws for both providers
  using a "NaN"/"Infinity" string OHLC value, the real wire vector).
  No existing test was weakened, deleted, or needed updating - purely
  additive. `flutter analyze`: no issues. `flutter build apk --debug`:
  succeeds.
- Security scan (established pattern) against the diff: no secrets.
- git diff reviewed - scoped to exactly the two parser files (39 lines
  of production code changed combined) and their four test files; no
  provider-level production changes, no Market Pool, Firebase/FCM,
  Economic Calendar, News Radar, Supabase, or backend changes;
  auc/backend untouched.

PRODUCTION:
- No backend changes this pass - nothing to deploy. This fix is
  entirely frontend-only.
- No new live smoke check needed beyond the prior passes' - this fix
  only changes which malformed candle entries are rejected, not any
  network/envelope/status behavior already verified live.

NEXT:
Claude has completed this correction and stopped, per its own
instruction. No further improvement loop started. The live-tick-candle
(WebSocket) non-finite-price path noted in the audit above is flagged
for GPT/Mac to decide whether it warrants its own follow-up task.
Waiting for GPT/Mac review.
