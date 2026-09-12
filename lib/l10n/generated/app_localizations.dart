import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_th.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('th'),
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'MKR'**
  String get appName;

  /// No description provided for @navHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get navHome;

  /// No description provided for @navMarkets.
  ///
  /// In en, this message translates to:
  /// **'Markets'**
  String get navMarkets;

  /// No description provided for @navWatchlist.
  ///
  /// In en, this message translates to:
  /// **'Watchlist'**
  String get navWatchlist;

  /// No description provided for @navAlerts.
  ///
  /// In en, this message translates to:
  /// **'Alerts'**
  String get navAlerts;

  /// No description provided for @navSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get navSettings;

  /// No description provided for @homeMarketStatus.
  ///
  /// In en, this message translates to:
  /// **'Market Status'**
  String get homeMarketStatus;

  /// No description provided for @homeTodaysRadar.
  ///
  /// In en, this message translates to:
  /// **'Today\'s Radar'**
  String get homeTodaysRadar;

  /// No description provided for @homeAiBrief.
  ///
  /// In en, this message translates to:
  /// **'AI Market Brief'**
  String get homeAiBrief;

  /// No description provided for @homeGoldRadar.
  ///
  /// In en, this message translates to:
  /// **'Gold Radar'**
  String get homeGoldRadar;

  /// No description provided for @homeUsMarket.
  ///
  /// In en, this message translates to:
  /// **'US Market'**
  String get homeUsMarket;

  /// No description provided for @homeCrypto.
  ///
  /// In en, this message translates to:
  /// **'Crypto'**
  String get homeCrypto;

  /// No description provided for @seeAll.
  ///
  /// In en, this message translates to:
  /// **'See all'**
  String get seeAll;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading…'**
  String get loading;

  /// No description provided for @somethingWentWrong.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong'**
  String get somethingWentWrong;

  /// No description provided for @noDataYet.
  ///
  /// In en, this message translates to:
  /// **'No data yet'**
  String get noDataYet;

  /// No description provided for @lastUpdated.
  ///
  /// In en, this message translates to:
  /// **'Last updated {time}'**
  String lastUpdated(String time);

  /// No description provided for @staleData.
  ///
  /// In en, this message translates to:
  /// **'Showing cached data — offline'**
  String get staleData;

  /// No description provided for @demoDataBanner.
  ///
  /// In en, this message translates to:
  /// **'Demo data for preview purposes'**
  String get demoDataBanner;

  /// No description provided for @aiWhatHappened.
  ///
  /// In en, this message translates to:
  /// **'What happened'**
  String get aiWhatHappened;

  /// No description provided for @aiWhyItMatters.
  ///
  /// In en, this message translates to:
  /// **'Why it matters'**
  String get aiWhyItMatters;

  /// No description provided for @aiWhatToWatch.
  ///
  /// In en, this message translates to:
  /// **'What to watch'**
  String get aiWhatToWatch;

  /// No description provided for @aiRisks.
  ///
  /// In en, this message translates to:
  /// **'Risks'**
  String get aiRisks;

  /// No description provided for @aiWhatIsDriving.
  ///
  /// In en, this message translates to:
  /// **'What is driving this?'**
  String get aiWhatIsDriving;

  /// No description provided for @aiKeyImportantToday.
  ///
  /// In en, this message translates to:
  /// **'What\'s important today'**
  String get aiKeyImportantToday;

  /// No description provided for @marketsTitle.
  ///
  /// In en, this message translates to:
  /// **'Markets'**
  String get marketsTitle;

  /// No description provided for @searchSymbolHint.
  ///
  /// In en, this message translates to:
  /// **'Search symbol or name'**
  String get searchSymbolHint;

  /// No description provided for @categoryGold.
  ///
  /// In en, this message translates to:
  /// **'Gold'**
  String get categoryGold;

  /// No description provided for @categoryUsStocks.
  ///
  /// In en, this message translates to:
  /// **'US Stocks'**
  String get categoryUsStocks;

  /// No description provided for @categoryIndices.
  ///
  /// In en, this message translates to:
  /// **'Indices'**
  String get categoryIndices;

  /// No description provided for @categoryCrypto.
  ///
  /// In en, this message translates to:
  /// **'Crypto'**
  String get categoryCrypto;

  /// No description provided for @categoryForex.
  ///
  /// In en, this message translates to:
  /// **'Forex'**
  String get categoryForex;

  /// No description provided for @categoryThailand.
  ///
  /// In en, this message translates to:
  /// **'Thailand'**
  String get categoryThailand;

  /// No description provided for @marketDetailHigh.
  ///
  /// In en, this message translates to:
  /// **'High'**
  String get marketDetailHigh;

  /// No description provided for @marketDetailLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get marketDetailLow;

  /// No description provided for @marketDetailOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get marketDetailOpen;

  /// No description provided for @marketDetailPrevClose.
  ///
  /// In en, this message translates to:
  /// **'Prev. Close'**
  String get marketDetailPrevClose;

  /// No description provided for @marketDetailVolume.
  ///
  /// In en, this message translates to:
  /// **'Volume'**
  String get marketDetailVolume;

  /// No description provided for @marketDetailRelatedNews.
  ///
  /// In en, this message translates to:
  /// **'Related News'**
  String get marketDetailRelatedNews;

  /// No description provided for @marketDetailRelatedEvents.
  ///
  /// In en, this message translates to:
  /// **'Related Events'**
  String get marketDetailRelatedEvents;

  /// No description provided for @marketDetailAiInsight.
  ///
  /// In en, this message translates to:
  /// **'AI Insight'**
  String get marketDetailAiInsight;

  /// No description provided for @addToWatchlist.
  ///
  /// In en, this message translates to:
  /// **'Add to Watchlist'**
  String get addToWatchlist;

  /// No description provided for @removeFromWatchlist.
  ///
  /// In en, this message translates to:
  /// **'Remove from Watchlist'**
  String get removeFromWatchlist;

  /// No description provided for @createAlert.
  ///
  /// In en, this message translates to:
  /// **'Create Alert'**
  String get createAlert;

  /// No description provided for @timeframe1D.
  ///
  /// In en, this message translates to:
  /// **'1D'**
  String get timeframe1D;

  /// No description provided for @timeframe1W.
  ///
  /// In en, this message translates to:
  /// **'1W'**
  String get timeframe1W;

  /// No description provided for @timeframe1M.
  ///
  /// In en, this message translates to:
  /// **'1M'**
  String get timeframe1M;

  /// No description provided for @timeframe3M.
  ///
  /// In en, this message translates to:
  /// **'3M'**
  String get timeframe3M;

  /// No description provided for @timeframe1Y.
  ///
  /// In en, this message translates to:
  /// **'1Y'**
  String get timeframe1Y;

  /// No description provided for @goldSupport.
  ///
  /// In en, this message translates to:
  /// **'Support'**
  String get goldSupport;

  /// No description provided for @goldResistance.
  ///
  /// In en, this message translates to:
  /// **'Resistance'**
  String get goldResistance;

  /// No description provided for @goldTrend.
  ///
  /// In en, this message translates to:
  /// **'Trend'**
  String get goldTrend;

  /// No description provided for @goldMomentum.
  ///
  /// In en, this message translates to:
  /// **'Momentum'**
  String get goldMomentum;

  /// No description provided for @goldVolatility.
  ///
  /// In en, this message translates to:
  /// **'Volatility'**
  String get goldVolatility;

  /// No description provided for @goldImportantEvents.
  ///
  /// In en, this message translates to:
  /// **'Important Events'**
  String get goldImportantEvents;

  /// No description provided for @calendarTitle.
  ///
  /// In en, this message translates to:
  /// **'Economic Calendar'**
  String get calendarTitle;

  /// No description provided for @filterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get filterAll;

  /// No description provided for @filterHigh.
  ///
  /// In en, this message translates to:
  /// **'High'**
  String get filterHigh;

  /// No description provided for @filterMedium.
  ///
  /// In en, this message translates to:
  /// **'Medium'**
  String get filterMedium;

  /// No description provided for @filterLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get filterLow;

  /// No description provided for @calendarPrevious.
  ///
  /// In en, this message translates to:
  /// **'Previous'**
  String get calendarPrevious;

  /// No description provided for @calendarForecast.
  ///
  /// In en, this message translates to:
  /// **'Forecast'**
  String get calendarForecast;

  /// No description provided for @calendarActual.
  ///
  /// In en, this message translates to:
  /// **'Actual'**
  String get calendarActual;

  /// No description provided for @newsTitle.
  ///
  /// In en, this message translates to:
  /// **'News Radar'**
  String get newsTitle;

  /// No description provided for @newsAffectedAssets.
  ///
  /// In en, this message translates to:
  /// **'Affected'**
  String get newsAffectedAssets;

  /// No description provided for @watchlistTitle.
  ///
  /// In en, this message translates to:
  /// **'Watchlist'**
  String get watchlistTitle;

  /// No description provided for @watchlistEmpty.
  ///
  /// In en, this message translates to:
  /// **'Your watchlist is empty'**
  String get watchlistEmpty;

  /// No description provided for @watchlistAddSome.
  ///
  /// In en, this message translates to:
  /// **'Add symbols to track them here'**
  String get watchlistAddSome;

  /// No description provided for @alertsTitle.
  ///
  /// In en, this message translates to:
  /// **'Alerts'**
  String get alertsTitle;

  /// No description provided for @alertsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No alerts yet'**
  String get alertsEmpty;

  /// No description provided for @alertsCreateFirst.
  ///
  /// In en, this message translates to:
  /// **'Create your first alert'**
  String get alertsCreateFirst;

  /// No description provided for @alertTypePrice.
  ///
  /// In en, this message translates to:
  /// **'Price'**
  String get alertTypePrice;

  /// No description provided for @alertTypePercentage.
  ///
  /// In en, this message translates to:
  /// **'Percentage'**
  String get alertTypePercentage;

  /// No description provided for @alertTypeEvent.
  ///
  /// In en, this message translates to:
  /// **'Event'**
  String get alertTypeEvent;

  /// No description provided for @alertTypeRadar.
  ///
  /// In en, this message translates to:
  /// **'Radar'**
  String get alertTypeRadar;

  /// No description provided for @alertEnable.
  ///
  /// In en, this message translates to:
  /// **'Enabled'**
  String get alertEnable;

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @portfolioTitle.
  ///
  /// In en, this message translates to:
  /// **'Portfolio'**
  String get portfolioTitle;

  /// No description provided for @portfolioTotalValue.
  ///
  /// In en, this message translates to:
  /// **'Total Value'**
  String get portfolioTotalValue;

  /// No description provided for @portfolioDailyPl.
  ///
  /// In en, this message translates to:
  /// **'Daily P/L'**
  String get portfolioDailyPl;

  /// No description provided for @portfolioTotalPl.
  ///
  /// In en, this message translates to:
  /// **'Total P/L'**
  String get portfolioTotalPl;

  /// No description provided for @portfolioAllocation.
  ///
  /// In en, this message translates to:
  /// **'Allocation'**
  String get portfolioAllocation;

  /// No description provided for @portfolioAddHolding.
  ///
  /// In en, this message translates to:
  /// **'Add Holding'**
  String get portfolioAddHolding;

  /// No description provided for @portfolioSymbol.
  ///
  /// In en, this message translates to:
  /// **'Symbol'**
  String get portfolioSymbol;

  /// No description provided for @portfolioQuantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity'**
  String get portfolioQuantity;

  /// No description provided for @portfolioAvgPrice.
  ///
  /// In en, this message translates to:
  /// **'Average Price'**
  String get portfolioAvgPrice;

  /// No description provided for @portfolioEmpty.
  ///
  /// In en, this message translates to:
  /// **'No holdings yet'**
  String get portfolioEmpty;

  /// No description provided for @premiumTitle.
  ///
  /// In en, this message translates to:
  /// **'Premium'**
  String get premiumTitle;

  /// No description provided for @premiumFree.
  ///
  /// In en, this message translates to:
  /// **'Free'**
  String get premiumFree;

  /// No description provided for @premiumPro.
  ///
  /// In en, this message translates to:
  /// **'Pro'**
  String get premiumPro;

  /// No description provided for @premiumAiPro.
  ///
  /// In en, this message translates to:
  /// **'AI Pro'**
  String get premiumAiPro;

  /// No description provided for @premiumLifetime.
  ///
  /// In en, this message translates to:
  /// **'Pro Lifetime'**
  String get premiumLifetime;

  /// No description provided for @premiumPerMonth.
  ///
  /// In en, this message translates to:
  /// **'/month'**
  String get premiumPerMonth;

  /// No description provided for @premiumPerYear.
  ///
  /// In en, this message translates to:
  /// **'/year'**
  String get premiumPerYear;

  /// No description provided for @premiumOneTime.
  ///
  /// In en, this message translates to:
  /// **'one-time'**
  String get premiumOneTime;

  /// No description provided for @premiumUpgrade.
  ///
  /// In en, this message translates to:
  /// **'Upgrade'**
  String get premiumUpgrade;

  /// No description provided for @premiumCurrentPlan.
  ///
  /// In en, this message translates to:
  /// **'Current Plan'**
  String get premiumCurrentPlan;

  /// No description provided for @premiumSimulatePurchase.
  ///
  /// In en, this message translates to:
  /// **'Simulate purchase (Phase 1 mock)'**
  String get premiumSimulatePurchase;

  /// No description provided for @premiumRestorePurchases.
  ///
  /// In en, this message translates to:
  /// **'Restore Purchases'**
  String get premiumRestorePurchases;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @settingsAccount.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get settingsAccount;

  /// No description provided for @settingsAppearance.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get settingsAppearance;

  /// No description provided for @settingsNotifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get settingsNotifications;

  /// No description provided for @settingsMarketPreferences.
  ///
  /// In en, this message translates to:
  /// **'Market preferences'**
  String get settingsMarketPreferences;

  /// No description provided for @settingsCurrency.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get settingsCurrency;

  /// No description provided for @settingsLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;

  /// No description provided for @settingsSubscription.
  ///
  /// In en, this message translates to:
  /// **'Subscription'**
  String get settingsSubscription;

  /// No description provided for @settingsRestorePurchases.
  ///
  /// In en, this message translates to:
  /// **'Restore Purchases'**
  String get settingsRestorePurchases;

  /// No description provided for @settingsPrivacyPolicy.
  ///
  /// In en, this message translates to:
  /// **'Privacy Policy'**
  String get settingsPrivacyPolicy;

  /// No description provided for @settingsTerms.
  ///
  /// In en, this message translates to:
  /// **'Terms of Service'**
  String get settingsTerms;

  /// No description provided for @settingsAbout.
  ///
  /// In en, this message translates to:
  /// **'About MKR'**
  String get settingsAbout;

  /// No description provided for @settingsAppVersion.
  ///
  /// In en, this message translates to:
  /// **'App version'**
  String get settingsAppVersion;

  /// No description provided for @settingsThemeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settingsThemeLight;

  /// No description provided for @settingsThemeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settingsThemeDark;

  /// No description provided for @settingsThemeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsThemeSystem;

  /// No description provided for @onboardingTitle1.
  ///
  /// In en, this message translates to:
  /// **'Know what matters in the market.'**
  String get onboardingTitle1;

  /// No description provided for @onboardingTitle2.
  ///
  /// In en, this message translates to:
  /// **'Track Gold, Stocks, Crypto and Forex.'**
  String get onboardingTitle2;

  /// No description provided for @onboardingTitle3.
  ///
  /// In en, this message translates to:
  /// **'Get alerts when important things happen.'**
  String get onboardingTitle3;

  /// No description provided for @onboardingTitle4.
  ///
  /// In en, this message translates to:
  /// **'AI-powered market brief.'**
  String get onboardingTitle4;

  /// No description provided for @onboardingStart.
  ///
  /// In en, this message translates to:
  /// **'Start using MKR'**
  String get onboardingStart;

  /// No description provided for @onboardingSkip.
  ///
  /// In en, this message translates to:
  /// **'Skip'**
  String get onboardingSkip;

  /// No description provided for @authLogin.
  ///
  /// In en, this message translates to:
  /// **'Log in'**
  String get authLogin;

  /// No description provided for @authRegister.
  ///
  /// In en, this message translates to:
  /// **'Register'**
  String get authRegister;

  /// No description provided for @authLogout.
  ///
  /// In en, this message translates to:
  /// **'Log out'**
  String get authLogout;

  /// No description provided for @authEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get authEmail;

  /// No description provided for @authPassword.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get authPassword;

  /// No description provided for @authContinueAsGuest.
  ///
  /// In en, this message translates to:
  /// **'Continue as guest'**
  String get authContinueAsGuest;

  /// No description provided for @financialDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'MKR provides market information and analytical content for informational and educational purposes only. It does not constitute investment, financial, trading, or other professional advice. Market data may be delayed or inaccurate. Users should conduct their own research and consider their own risk tolerance before making financial decisions.'**
  String get financialDisclaimer;

  /// No description provided for @settingsAccountGuest.
  ///
  /// In en, this message translates to:
  /// **'Guest'**
  String get settingsAccountGuest;

  /// No description provided for @purchasesRestoredMessage.
  ///
  /// In en, this message translates to:
  /// **'Purchases restored'**
  String get purchasesRestoredMessage;

  /// No description provided for @homeNothingScheduled.
  ///
  /// In en, this message translates to:
  /// **'Nothing major scheduled today'**
  String get homeNothingScheduled;

  /// No description provided for @marketsNoMarketsAvailable.
  ///
  /// In en, this message translates to:
  /// **'No markets available'**
  String get marketsNoMarketsAvailable;

  /// No description provided for @marketsNoSymbolsMatch.
  ///
  /// In en, this message translates to:
  /// **'No symbols match your search'**
  String get marketsNoSymbolsMatch;

  /// No description provided for @marketDetailSymbolNotFound.
  ///
  /// In en, this message translates to:
  /// **'Symbol not found'**
  String get marketDetailSymbolNotFound;

  /// No description provided for @goldRadarUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Gold data unavailable'**
  String get goldRadarUnavailable;

  /// No description provided for @goldSpotSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Gold Spot'**
  String get goldSpotSubtitle;

  /// No description provided for @goldAiInsightTitle.
  ///
  /// In en, this message translates to:
  /// **'What is driving Gold?'**
  String get goldAiInsightTitle;

  /// No description provided for @trendBullish.
  ///
  /// In en, this message translates to:
  /// **'Bullish'**
  String get trendBullish;

  /// No description provided for @trendNeutral.
  ///
  /// In en, this message translates to:
  /// **'Neutral'**
  String get trendNeutral;

  /// No description provided for @trendBearish.
  ///
  /// In en, this message translates to:
  /// **'Bearish'**
  String get trendBearish;

  /// No description provided for @momentumStrong.
  ///
  /// In en, this message translates to:
  /// **'Strong'**
  String get momentumStrong;

  /// No description provided for @momentumModerate.
  ///
  /// In en, this message translates to:
  /// **'Moderate'**
  String get momentumModerate;

  /// No description provided for @momentumWeak.
  ///
  /// In en, this message translates to:
  /// **'Weak'**
  String get momentumWeak;

  /// No description provided for @volatilityElevated.
  ///
  /// In en, this message translates to:
  /// **'Elevated'**
  String get volatilityElevated;

  /// No description provided for @volatilityNormal.
  ///
  /// In en, this message translates to:
  /// **'Normal'**
  String get volatilityNormal;

  /// No description provided for @volatilityLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get volatilityLow;

  /// No description provided for @radarTransitionNeutralBullish.
  ///
  /// In en, this message translates to:
  /// **'Neutral → Bullish'**
  String get radarTransitionNeutralBullish;

  /// No description provided for @radarTransitionNeutralBearish.
  ///
  /// In en, this message translates to:
  /// **'Neutral → Bearish'**
  String get radarTransitionNeutralBearish;

  /// No description provided for @radarTransitionBullishNeutral.
  ///
  /// In en, this message translates to:
  /// **'Bullish → Neutral'**
  String get radarTransitionBullishNeutral;

  /// No description provided for @radarTransitionBearishNeutral.
  ///
  /// In en, this message translates to:
  /// **'Bearish → Neutral'**
  String get radarTransitionBearishNeutral;

  /// No description provided for @priceDirectionAbove.
  ///
  /// In en, this message translates to:
  /// **'Above'**
  String get priceDirectionAbove;

  /// No description provided for @priceDirectionBelow.
  ///
  /// In en, this message translates to:
  /// **'Below'**
  String get priceDirectionBelow;

  /// No description provided for @targetPriceLabel.
  ///
  /// In en, this message translates to:
  /// **'Target price'**
  String get targetPriceLabel;

  /// No description provided for @percentageThresholdLabel.
  ///
  /// In en, this message translates to:
  /// **'Percentage threshold (±%)'**
  String get percentageThresholdLabel;

  /// No description provided for @eventKeywordLabel.
  ///
  /// In en, this message translates to:
  /// **'Event keyword (e.g. CPI, FOMC, NFP, Fed Speech)'**
  String get eventKeywordLabel;

  /// No description provided for @radarTransitionFieldLabel.
  ///
  /// In en, this message translates to:
  /// **'Radar transition'**
  String get radarTransitionFieldLabel;

  /// No description provided for @portfolioEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Add your first holding'**
  String get portfolioEmptyHint;

  /// No description provided for @portfolioHoldingsSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Holdings'**
  String get portfolioHoldingsSectionTitle;

  /// No description provided for @watchlistAddSymbolTooltip.
  ///
  /// In en, this message translates to:
  /// **'Add symbol'**
  String get watchlistAddSymbolTooltip;

  /// No description provided for @newsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No news yet'**
  String get newsEmpty;

  /// No description provided for @premiumChooseYourPlan.
  ///
  /// In en, this message translates to:
  /// **'Choose your plan'**
  String get premiumChooseYourPlan;

  /// No description provided for @premiumFreeFeatures.
  ///
  /// In en, this message translates to:
  /// **'Basic market data · Basic news · Basic calendar\nLimited watchlist & alerts · Basic AI brief · Ads'**
  String get premiumFreeFeatures;

  /// No description provided for @premiumSimulatePurchaseDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Simulate purchase'**
  String get premiumSimulatePurchaseDialogTitle;

  /// No description provided for @premiumMockPurchaseConfirm.
  ///
  /// In en, this message translates to:
  /// **'This is a Phase 1 mock purchase for {title} ({price}). No real payment will be made. Continue?'**
  String premiumMockPurchaseConfirm(String title, String price);

  /// No description provided for @confirmLabel.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get confirmLabel;

  /// No description provided for @premiumActivatedMessage.
  ///
  /// In en, this message translates to:
  /// **'{title} activated (mock)'**
  String premiumActivatedMessage(String title);

  /// No description provided for @premiumGateFeatureLocked.
  ///
  /// In en, this message translates to:
  /// **'{feature} is a premium feature'**
  String premiumGateFeatureLocked(String feature);

  /// No description provided for @authHaveAccountLogin.
  ///
  /// In en, this message translates to:
  /// **'Have an account? Log in'**
  String get authHaveAccountLogin;

  /// No description provided for @authNewHereRegister.
  ///
  /// In en, this message translates to:
  /// **'New here? Register'**
  String get authNewHereRegister;

  /// No description provided for @calendarNoEventsYet.
  ///
  /// In en, this message translates to:
  /// **'No events yet'**
  String get calendarNoEventsYet;

  /// No description provided for @calendarNoEventsMatchFilter.
  ///
  /// In en, this message translates to:
  /// **'No events match this filter'**
  String get calendarNoEventsMatchFilter;

  /// No description provided for @aiDisclaimerShort.
  ///
  /// In en, this message translates to:
  /// **'Informational only — not financial advice. Data may be delayed.'**
  String get aiDisclaimerShort;

  /// No description provided for @onboardingNext.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get onboardingNext;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'th'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'th':
      return AppLocalizationsTh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
