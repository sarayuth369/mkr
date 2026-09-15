/// Uniform state wrapper every repository/controller uses so screens can
/// always render loading / content / empty / error — never a blank screen.
sealed class ApiState<T> {
  const ApiState();

  const factory ApiState.loading() = ApiLoading<T>;

  const factory ApiState.success(
    T data, {
    bool isStale,
    DateTime? lastUpdated,
    bool isPartial,
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

  /// True only for a [ApiSuccess] whose underlying fetch was a partial
  /// success (some items resolved, some failed) - e.g. a batch quote fetch
  /// where a few symbols came back with provider errors. Lets a screen show
  /// a small non-blocking degraded indicator without hiding the data that
  /// DID load (task: "render the valid symbols and expose a non-blocking
  /// degraded/error indication rather than hiding all successful data").
  bool get isPartial => switch (this) {
        ApiSuccess<T>(:final isPartial) => isPartial,
        _ => false,
      };
}

final class ApiLoading<T> extends ApiState<T> {
  const ApiLoading();
}

final class ApiSuccess<T> extends ApiState<T> {
  const ApiSuccess(this.data, {this.isStale = false, this.lastUpdated, this.isPartial = false});

  final T data;
  final bool isStale;
  final DateTime? lastUpdated;
  @override
  final bool isPartial;
}

final class ApiEmpty<T> extends ApiState<T> {
  const ApiEmpty();
}

final class ApiError<T> extends ApiState<T> {
  const ApiError(this.message);

  final String message;
}
