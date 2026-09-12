import 'package:flutter/material.dart';

/// Small in-app brand mark — the same glyph used for the launcher icon,
/// shown on a rounded primary-color tile. Used in the Home header and the
/// About screen.
class AppLogoMark extends StatelessWidget {
  const AppLogoMark({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: size,
      height: size,
      padding: EdgeInsets.all(size * 0.16),
      decoration: BoxDecoration(
        color: theme.colorScheme.primary,
        borderRadius: BorderRadius.circular(size * 0.28),
      ),
      child: Image.asset('assets/icon/icon_foreground.png', fit: BoxFit.contain),
    );
  }
}
