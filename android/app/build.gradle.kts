import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Reads google-services.json (must come after the Android/Kotlin/Flutter
    // plugins, same ordering Firebase's own setup docs specify).
    id("com.google.gms.google-services")
}

// 2026-09-16 Closed Testing readiness task (material blocker): a release
// build signed with the DEBUG keystore is rejected outright by Google Play
// Console - it can never be uploaded. `android/key.properties` (already
// gitignored - see android/.gitignore and the root .gitignore, both
// already excluding key.properties/*.jks/*.keystore, anticipating exactly
// this file) is never committed and never generated here - creating and
// safeguarding the actual release keystore/passwords is the app owner's
// own decision (losing it permanently blocks future updates to an
// already-published app, so Claude does not generate one on the owner's
// behalf). When that file is present, its 4 properties
// (storePassword/keyPassword/keyAlias/storeFile) back a real release
// signing config; when absent, release still falls back to the debug
// keystore so `flutter run --release`/local testing keeps working exactly
// as before - but `flutter build appbundle --release` for actual Play
// Store submission requires a real key.properties to produce a build Play
// Console will accept.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties()
val hasReleaseSigningConfig = keystorePropertiesFile.exists()
if (hasReleaseSigningConfig) {
    keystoreProperties.load(keystorePropertiesFile.inputStream())
} else {
    // 2026-09-16 Final Release Gate audit finding: previously this fallback
    // was silent - `flutter build appbundle --release` would succeed with
    // no warning at all while actually producing a debug-signed AAB, and
    // the ONLY place that failure became visible was a later, separate
    // Play Console upload rejection. Printed at Gradle configuration time
    // so it surfaces in the build's own console output immediately,
    // whichever build type is invoked.
    println("WARNING: android/key.properties not found - release builds will fall back to DEBUG signing, which Google Play Console will reject on upload. See this file's own doc comment above for how to provision a real release keystore.")
}

android {
    namespace = "com.mlabs.mkr"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.mlabs.mkr"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigningConfig) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // See the key.properties doc comment above this file's plugins block.
            signingConfig = if (hasReleaseSigningConfig) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
