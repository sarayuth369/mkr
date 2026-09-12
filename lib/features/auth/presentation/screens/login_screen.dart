import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../application/auth_controller.dart';

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
    return Scaffold(
      appBar: AppBar(title: Text(_isRegisterMode ? 'Register' : 'Log in')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            TextField(
              controller: _emailController,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _passwordController,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Password'),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _submitting ? null : _submit,
              child: Text(_isRegisterMode ? 'Register' : 'Log in'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => setState(() => _isRegisterMode = !_isRegisterMode),
              child: Text(_isRegisterMode ? 'Have an account? Log in' : 'New here? Register'),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Continue as guest'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    final controller = context.read<AuthController>();
    if (_isRegisterMode) {
      await controller.register(_emailController.text, _passwordController.text);
    } else {
      await controller.login(_emailController.text, _passwordController.text);
    }
    if (mounted) Navigator.of(context).pop();
  }
}
