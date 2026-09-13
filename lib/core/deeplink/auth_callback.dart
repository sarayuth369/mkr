/// The custom URI MKR listens on for Supabase's email-confirmation (and any
/// future magic-link/OAuth) redirect. Must be added verbatim to Supabase
/// Dashboard → Authentication → URL Configuration → Redirect URLs, or
/// Supabase silently falls back to the project's Site URL instead (the
/// exact cause of the `localhost:3000` redirect this exists to fix).
const String mkrAuthCallbackUrl = 'mkr://auth-callback';

/// Just the scheme part, for platform-level registration (Windows registry
/// key, Android intent-filter `android:scheme`).
const String mkrAuthCallbackScheme = 'mkr';
