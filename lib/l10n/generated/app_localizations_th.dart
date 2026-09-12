// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Thai (`th`).
class AppLocalizationsTh extends AppLocalizations {
  AppLocalizationsTh([String locale = 'th']) : super(locale);

  @override
  String get appName => 'MKR';

  @override
  String get navHome => 'หน้าแรก';

  @override
  String get navMarkets => 'ตลาด';

  @override
  String get navWatchlist => 'รายการติดตาม';

  @override
  String get navAlerts => 'แจ้งเตือน';

  @override
  String get navSettings => 'ตั้งค่า';

  @override
  String get homeMarketStatus => 'สถานะตลาด';

  @override
  String get homeTodaysRadar => 'เรดาร์วันนี้';

  @override
  String get homeAiBrief => 'สรุปตลาดโดย AI';

  @override
  String get homeGoldRadar => 'เรดาร์ทองคำ';

  @override
  String get homeUsMarket => 'ตลาดสหรัฐ';

  @override
  String get homeCrypto => 'คริปโต';

  @override
  String get seeAll => 'ดูทั้งหมด';

  @override
  String get retry => 'ลองใหม่';

  @override
  String get loading => 'กำลังโหลด…';

  @override
  String get somethingWentWrong => 'เกิดข้อผิดพลาด';

  @override
  String get noDataYet => 'ยังไม่มีข้อมูล';

  @override
  String lastUpdated(String time) {
    return 'อัปเดตล่าสุด $time';
  }

  @override
  String get staleData => 'แสดงข้อมูลที่แคชไว้ — ออฟไลน์';

  @override
  String get demoDataBanner => 'ข้อมูลตัวอย่างสำหรับการพรีวิว';

  @override
  String get aiWhatHappened => 'เกิดอะไรขึ้น';

  @override
  String get aiWhyItMatters => 'ทำไมถึงสำคัญ';

  @override
  String get aiWhatToWatch => 'สิ่งที่ต้องจับตา';

  @override
  String get aiRisks => 'ความเสี่ยง';

  @override
  String get aiWhatIsDriving => 'อะไรคือปัจจัยขับเคลื่อน';

  @override
  String get aiKeyImportantToday => 'สิ่งสำคัญวันนี้';

  @override
  String get marketsTitle => 'ตลาด';

  @override
  String get searchSymbolHint => 'ค้นหาสัญลักษณ์หรือชื่อ';

  @override
  String get categoryGold => 'ทองคำ';

  @override
  String get categoryUsStocks => 'หุ้นสหรัฐ';

  @override
  String get categoryIndices => 'ดัชนี';

  @override
  String get categoryCrypto => 'คริปโต';

  @override
  String get categoryForex => 'ฟอเร็กซ์';

  @override
  String get categoryThailand => 'ไทย';

  @override
  String get marketDetailHigh => 'สูงสุด';

  @override
  String get marketDetailLow => 'ต่ำสุด';

  @override
  String get marketDetailOpen => 'เปิด';

  @override
  String get marketDetailPrevClose => 'ปิดก่อนหน้า';

  @override
  String get marketDetailVolume => 'ปริมาณ';

  @override
  String get marketDetailRelatedNews => 'ข่าวที่เกี่ยวข้อง';

  @override
  String get marketDetailRelatedEvents => 'เหตุการณ์ที่เกี่ยวข้อง';

  @override
  String get marketDetailAiInsight => 'ข้อมูลเชิงลึกจาก AI';

  @override
  String get addToWatchlist => 'เพิ่มในรายการติดตาม';

  @override
  String get removeFromWatchlist => 'ลบออกจากรายการติดตาม';

  @override
  String get createAlert => 'สร้างการแจ้งเตือน';

  @override
  String get timeframe1D => '1D';

  @override
  String get timeframe1W => '1W';

  @override
  String get timeframe1M => '1M';

  @override
  String get timeframe3M => '3M';

  @override
  String get timeframe1Y => '1Y';

  @override
  String get goldSupport => 'แนวรับ';

  @override
  String get goldResistance => 'แนวต้าน';

  @override
  String get goldTrend => 'แนวโน้ม';

  @override
  String get goldMomentum => 'โมเมนตัม';

  @override
  String get goldVolatility => 'ความผันผวน';

  @override
  String get goldImportantEvents => 'เหตุการณ์สำคัญ';

  @override
  String get calendarTitle => 'ปฏิทินเศรษฐกิจ';

  @override
  String get filterAll => 'ทั้งหมด';

  @override
  String get filterHigh => 'สูง';

  @override
  String get filterMedium => 'ปานกลาง';

  @override
  String get filterLow => 'ต่ำ';

  @override
  String get calendarPrevious => 'ครั้งก่อน';

  @override
  String get calendarForecast => 'คาดการณ์';

  @override
  String get calendarActual => 'ผลจริง';

  @override
  String get newsTitle => 'เรดาร์ข่าว';

  @override
  String get newsAffectedAssets => 'สินทรัพย์ที่ได้รับผลกระทบ';

  @override
  String get watchlistTitle => 'รายการติดตาม';

  @override
  String get watchlistEmpty => 'รายการติดตามของคุณว่างเปล่า';

  @override
  String get watchlistAddSome => 'เพิ่มสัญลักษณ์เพื่อติดตามที่นี่';

  @override
  String get alertsTitle => 'แจ้งเตือน';

  @override
  String get alertsEmpty => 'ยังไม่มีการแจ้งเตือน';

  @override
  String get alertsCreateFirst => 'สร้างการแจ้งเตือนแรกของคุณ';

  @override
  String get alertTypePrice => 'ราคา';

  @override
  String get alertTypePercentage => 'เปอร์เซ็นต์';

  @override
  String get alertTypeEvent => 'เหตุการณ์';

  @override
  String get alertTypeRadar => 'เรดาร์';

  @override
  String get alertEnable => 'เปิดใช้งาน';

  @override
  String get delete => 'ลบ';

  @override
  String get save => 'บันทึก';

  @override
  String get cancel => 'ยกเลิก';

  @override
  String get portfolioTitle => 'พอร์ตโฟลิโอ';

  @override
  String get portfolioTotalValue => 'มูลค่ารวม';

  @override
  String get portfolioDailyPl => 'กำไร/ขาดทุนรายวัน';

  @override
  String get portfolioTotalPl => 'กำไร/ขาดทุนรวม';

  @override
  String get portfolioAllocation => 'สัดส่วนการลงทุน';

  @override
  String get portfolioAddHolding => 'เพิ่มการถือครอง';

  @override
  String get portfolioSymbol => 'สัญลักษณ์';

  @override
  String get portfolioQuantity => 'จำนวน';

  @override
  String get portfolioAvgPrice => 'ราคาเฉลี่ย';

  @override
  String get portfolioEmpty => 'ยังไม่มีการถือครอง';

  @override
  String get premiumTitle => 'พรีเมียม';

  @override
  String get premiumFree => 'ฟรี';

  @override
  String get premiumPro => 'โปร';

  @override
  String get premiumAiPro => 'AI โปร';

  @override
  String get premiumLifetime => 'โปรตลอดชีพ';

  @override
  String get premiumPerMonth => '/เดือน';

  @override
  String get premiumPerYear => '/ปี';

  @override
  String get premiumOneTime => 'ครั้งเดียว';

  @override
  String get premiumUpgrade => 'อัปเกรด';

  @override
  String get premiumCurrentPlan => 'แผนปัจจุบัน';

  @override
  String get premiumSimulatePurchase => 'จำลองการซื้อ (โหมดทดสอบ Phase 1)';

  @override
  String get premiumRestorePurchases => 'กู้คืนการซื้อ';

  @override
  String get settingsTitle => 'ตั้งค่า';

  @override
  String get settingsAccount => 'บัญชี';

  @override
  String get settingsAppearance => 'การแสดงผล';

  @override
  String get settingsNotifications => 'การแจ้งเตือน';

  @override
  String get settingsMarketPreferences => 'การตั้งค่าตลาด';

  @override
  String get settingsCurrency => 'สกุลเงิน';

  @override
  String get settingsLanguage => 'ภาษา';

  @override
  String get settingsSubscription => 'การสมัครสมาชิก';

  @override
  String get settingsRestorePurchases => 'กู้คืนการซื้อ';

  @override
  String get settingsPrivacyPolicy => 'นโยบายความเป็นส่วนตัว';

  @override
  String get settingsTerms => 'ข้อกำหนดการใช้งาน';

  @override
  String get settingsAbout => 'เกี่ยวกับ MKR';

  @override
  String get settingsAppVersion => 'เวอร์ชันแอป';

  @override
  String get settingsThemeLight => 'สว่าง';

  @override
  String get settingsThemeDark => 'มืด';

  @override
  String get settingsThemeSystem => 'ตามระบบ';

  @override
  String get onboardingTitle1 => 'รู้ว่าตลาดกำลังจับตาอะไร';

  @override
  String get onboardingTitle2 => 'ติดตามทองคำ หุ้น คริปโต และฟอเร็กซ์';

  @override
  String get onboardingTitle3 => 'รับการแจ้งเตือนเมื่อมีเรื่องสำคัญเกิดขึ้น';

  @override
  String get onboardingTitle4 => 'สรุปตลาดด้วยพลัง AI';

  @override
  String get onboardingStart => 'เริ่มใช้งาน MKR';

  @override
  String get onboardingSkip => 'ข้าม';

  @override
  String get authLogin => 'เข้าสู่ระบบ';

  @override
  String get authRegister => 'สมัครสมาชิก';

  @override
  String get authLogout => 'ออกจากระบบ';

  @override
  String get authEmail => 'อีเมล';

  @override
  String get authPassword => 'รหัสผ่าน';

  @override
  String get authContinueAsGuest => 'ใช้งานแบบผู้เยี่ยมชม';

  @override
  String get financialDisclaimer =>
      'MKR ให้ข้อมูลตลาดและเนื้อหาวิเคราะห์เพื่อวัตถุประสงค์ในการให้ข้อมูลและการศึกษาเท่านั้น ไม่ถือเป็นคำแนะนำด้านการลงทุน การเงิน การเทรด หรือคำแนะนำทางวิชาชีพอื่นใด ข้อมูลตลาดอาจล่าช้าหรือคลาดเคลื่อน ผู้ใช้ควรศึกษาข้อมูลด้วยตนเองและพิจารณาความเสี่ยงที่ยอมรับได้ก่อนตัดสินใจทางการเงิน';

  @override
  String get settingsAccountGuest => 'ผู้เยี่ยมชม';

  @override
  String get purchasesRestoredMessage => 'กู้คืนการซื้อเรียบร้อยแล้ว';

  @override
  String get homeNothingScheduled => 'วันนี้ยังไม่มีเหตุการณ์สำคัญ';

  @override
  String get marketsNoMarketsAvailable => 'ไม่มีข้อมูลตลาด';

  @override
  String get marketsNoSymbolsMatch => 'ไม่พบสัญลักษณ์ที่ตรงกับการค้นหา';

  @override
  String get marketDetailSymbolNotFound => 'ไม่พบสัญลักษณ์นี้';

  @override
  String get goldRadarUnavailable => 'ไม่มีข้อมูลทองคำ';

  @override
  String get goldSpotSubtitle => 'ทองคำสปอต';

  @override
  String get goldAiInsightTitle => 'อะไรคือปัจจัยขับเคลื่อนราคาทองคำ';

  @override
  String get trendBullish => 'ขาขึ้น';

  @override
  String get trendNeutral => 'เป็นกลาง';

  @override
  String get trendBearish => 'ขาลง';

  @override
  String get momentumStrong => 'แรง';

  @override
  String get momentumModerate => 'ปานกลาง';

  @override
  String get momentumWeak => 'อ่อน';

  @override
  String get volatilityElevated => 'สูง';

  @override
  String get volatilityNormal => 'ปกติ';

  @override
  String get volatilityLow => 'ต่ำ';

  @override
  String get radarTransitionNeutralBullish => 'เป็นกลาง → ขาขึ้น';

  @override
  String get radarTransitionNeutralBearish => 'เป็นกลาง → ขาลง';

  @override
  String get radarTransitionBullishNeutral => 'ขาขึ้น → เป็นกลาง';

  @override
  String get radarTransitionBearishNeutral => 'ขาลง → เป็นกลาง';

  @override
  String get priceDirectionAbove => 'สูงกว่า';

  @override
  String get priceDirectionBelow => 'ต่ำกว่า';

  @override
  String get targetPriceLabel => 'ราคาเป้าหมาย';

  @override
  String get percentageThresholdLabel => 'เกณฑ์เปอร์เซ็นต์ (±%)';

  @override
  String get eventKeywordLabel =>
      'คำค้นเหตุการณ์ (เช่น CPI, FOMC, NFP, Fed Speech)';

  @override
  String get radarTransitionFieldLabel => 'การเปลี่ยนแปลงเรดาร์';

  @override
  String get portfolioEmptyHint => 'เพิ่มการถือครองแรกของคุณ';

  @override
  String get portfolioHoldingsSectionTitle => 'การถือครอง';

  @override
  String get watchlistAddSymbolTooltip => 'เพิ่มสัญลักษณ์';

  @override
  String get newsEmpty => 'ยังไม่มีข่าว';

  @override
  String get premiumChooseYourPlan => 'เลือกแผนของคุณ';

  @override
  String get premiumFreeFeatures =>
      'ข้อมูลตลาดพื้นฐาน · ข่าวพื้นฐาน · ปฏิทินพื้นฐาน\nรายการติดตามและแจ้งเตือนแบบจำกัด · สรุป AI พื้นฐาน · มีโฆษณา';

  @override
  String get premiumSimulatePurchaseDialogTitle => 'จำลองการซื้อ';

  @override
  String premiumMockPurchaseConfirm(String title, String price) {
    return 'นี่คือการจำลองการซื้อสำหรับ Phase 1 สำหรับ $title ($price) จะไม่มีการชำระเงินจริงเกิดขึ้น ดำเนินการต่อหรือไม่';
  }

  @override
  String get confirmLabel => 'ยืนยัน';

  @override
  String premiumActivatedMessage(String title) {
    return 'เปิดใช้งาน $title แล้ว (จำลอง)';
  }

  @override
  String premiumGateFeatureLocked(String feature) {
    return '$feature เป็นฟีเจอร์พรีเมียม';
  }

  @override
  String get authHaveAccountLogin => 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ';

  @override
  String get authNewHereRegister => 'ยังไม่มีบัญชี? สมัครสมาชิก';

  @override
  String get calendarNoEventsYet => 'ยังไม่มีเหตุการณ์';

  @override
  String get calendarNoEventsMatchFilter => 'ไม่พบเหตุการณ์ที่ตรงกับตัวกรองนี้';

  @override
  String get aiDisclaimerShort =>
      'เพื่อข้อมูลเท่านั้น ไม่ใช่คำแนะนำทางการเงิน ข้อมูลอาจล่าช้า';

  @override
  String get onboardingNext => 'ถัดไป';
}
