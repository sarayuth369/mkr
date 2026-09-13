/// Thrown by [AuthService.register] when an account was created but no
/// session was established yet — e.g. Supabase's default "Confirm email"
/// project setting requires the user to click a confirmation link before
/// they can actually sign in. Lets the caller show "check your email"
/// instead of treating this as a registration failure or (worse) treating
/// the caller as already authenticated with no real session behind it.
class EmailConfirmationRequiredException implements Exception {
  const EmailConfirmationRequiredException();

  @override
  String toString() => 'EmailConfirmationRequiredException';
}
