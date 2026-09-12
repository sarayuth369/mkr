/// Uniform state wrapper every repository/controller uses so screens can
/// always render loading / content / empty / error — never a blank screen.
sealed class ApiState<T> {
  const ApiState();

  const factory ApiState.loading() = ApiLoading<T>;

  const factory ApiState.success(
    T data, {
    bool isStale,
    DateTime? lastUpdated,
  }) = ApiSuccess<T>;

  const factory ApiState.empty() = ApiEmpty<T>;

  const factory ApiState.error(String message) = ApiError<T>;

  R when<R>({
    required R Function() loading,
    required R Function(T data, bool isStale, DateTime? lastUpdated) success,
    required R Function() empty,
    required R Function(String message) error,
  }) {
    final self = this;
    return switch (self) {
      ApiLoading<T>() => loading(),
      ApiSuccess<T>(:final data, :final isStale, :final lastUpdated) =>
        success(data, isStale, lastUpdated),
      ApiEmpty<T>() => empty(),
      ApiError<T>(:final message) => error(message),
    };
  }

  T? get dataOrNull => switch (this) {
        ApiSuccess<T>(:final data) => data,
        _ => null,
      };
}

final class ApiLoading<T> extends ApiState<T> {
  const ApiLoading();
}

final class ApiSuccess<T> extends ApiState<T> {
  const ApiSuccess(this.data, {this.isStale = false, this.lastUpdated});

  final T data;
  final bool isStale;
  final DateTime? lastUpdated;
}

final class ApiEmpty<T> extends ApiState<T> {
  const ApiEmpty();
}

final class ApiError<T> extends ApiState<T> {
  const ApiError(this.message);

  final String message;
}
