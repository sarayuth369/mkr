import 'package:flutter/foundation.dart';

@immutable
class UserProfile {
  const UserProfile({required this.id, required this.email, this.isGuest = false});

  final String id;
  final String email;
  final bool isGuest;

  Map<String, dynamic> toJson() => {'id': id, 'email': email, 'isGuest': isGuest};

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        id: json['id'] as String,
        email: json['email'] as String,
        isGuest: json['isGuest'] as bool? ?? false,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is UserProfile && other.id == id && other.email == email && other.isGuest == isGuest);

  @override
  int get hashCode => Object.hash(id, email, isGuest);
}
