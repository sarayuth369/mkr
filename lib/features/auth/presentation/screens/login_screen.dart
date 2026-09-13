import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../../alerts/application/alerts_controller.dart';
import '../../../watchlist/application/watchlist_controller.dart';
import '../../application/auth_controller.dart';
import '../../domain/email_confirmation_required_exception.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _isRegisterMode = false;
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(_isRegisterMode ? l10n.authRegister : l10n.authLogin)),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            TextField(
              controller: _emailController,
              keyboardType: TextInputType.emailAddress,
              decoration: InputDecoration(labelText: l10n.authEmail),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _passwordController,
              obscureText: true,
              decoration: InputDecoration(labelText: l10n.authPassword),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _submitting ? null : _submit,
              child: Text(_isRegisterMode ? l10n.authRegister : l10n.authLogin),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => setState(() => _isRegisterMode = !_isRegisterMode),
              child: Text(_isRegisterMode ? l10n.authHaveAccountLogin : l10n.authNewHereRegister),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text(l10n.authContinueAsGuest),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    final controller = context.read<AuthController>();
    try {
      if (_isRegisterMode) {
        await controller.register(_emailController.text, _passwordController.text);
      } else {
        await controller.login(_emailController.text, _passwordController.text);
      }
    } on EmailConfirmationRequiredException {
      // Account created but Supabase's "Confirm email" setting means there's
      // no active session yet — tell the user what to do next rather than
      // silently popping this screen as if they were signed in.
      if (mounted) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppLocalizations.of(context).authCheckEmailToConfirm)));
        Navigator.of(context).pop();
      }
      return;
    } catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('${AppLocalizations.of(context).authError} ${_friendlyMessage(e)}')));
      }
      return;
    }
    // Pulls the just-logged-in user's cloud watchlist/alerts (merging in
    // whatever was saved locally as a guest) — a no-op when Supabase isn't
    // configured, since both controllers still just re-read local storage
    // in that case.
    if (mounted) await context.read<WatchlistController>().refresh();
    if (mounted) await context.read<AlertsController>().refresh();
    if (mounted) Navigator.of(context).pop();
  }

  /// [SupabaseAuthService] re-throws Supabase errors as a plain
  /// `Exception(message)` specifically so this stays a clean, readable
  /// string instead of a raw stack-trace-shaped type name.
  String _friendlyMessage(Object error) => error.toString().replaceFirst('Exception: ', '');
}
