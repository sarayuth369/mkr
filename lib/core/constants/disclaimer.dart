/// Financial disclaimer text. Must be shown on the AI Brief card (short form)
/// and in full on Settings → About MKR. Never present AI output as guaranteed.
class Disclaimer {
  Disclaimer._();

  static const String full =
      'MKR provides market information and analytical content for '
      'informational and educational purposes only. It does not constitute '
      'investment, financial, trading, or other professional advice. Market '
      'data may be delayed or inaccurate. Users should conduct their own '
      'research and consider their own risk tolerance before making '
      'financial decisions.';

  static const String short =
      'Informational only — not financial advice. Data may be delayed.';
}
