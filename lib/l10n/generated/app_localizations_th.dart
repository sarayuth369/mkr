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
  String get calendarRangeToday => 'วันนี้';

  @override
  String get calendarRangeTomorrow => 'พรุ่งนี้';

  @override
  String get calendarRangeWeek => 'สัปดาห์นี้';

  @override
  String get calendarFreshnessLive => 'อัปเดตล่าสุด';

  @override
  String get calendarFreshnessStale => 'ข้อมูลเก่า';

  @override
  String get calendarFreshnessDegraded => 'ข้อมูลไม่สมบูรณ์';

  @override
  String get calendarFreshnessOffline => 'ออฟไลน์';

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
  String get settingsAbout => 'เกี่ยวกับ Market Radar';

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
  String get authError => 'เข้าสู่ระบบไม่สำเร็จ:';

  @override
  String get authCheckEmailToConfirm =>
      'สร้างบัญชีแล้ว — กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ';

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
  String get marketsPartialData => 'บางสัญลักษณ์ไม่พร้อมใช้งานชั่วคราว';

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
  String get premiumConfirmDialogTitle => 'ยืนยันแผนของคุณ';

  @override
  String premiumConfirmDialogBody(String title, String price) {
    return 'คุณกำลังจะเปิดใช้งาน $title ($price) เวอร์ชันนี้ยังไม่มีการเรียกเก็บเงินจริง แผนของคุณจะถูกปลดล็อกบนอุปกรณ์นี้ ดำเนินการต่อหรือไม่';
  }

  @override
  String get confirmLabel => 'ยืนยัน';

  @override
  String premiumActivatedMessage(String title) {
    return 'ปลดล็อก $title แล้ว';
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

  @override
  String get dataModeLive => 'สด';

  @override
  String get dataModeDemo => 'ข้อมูลตัวอย่าง';

  @override
  String get dataModeStale => 'ข้อมูลเก่า';

  @override
  String get dataModeConnecting => 'กำลังเชื่อมต่อ';

  @override
  String get dataModeProviderError => 'ผู้ให้บริการขัดข้อง';

  @override
  String get dataModeOffline => 'ออฟไลน์';

  @override
  String updatedRelative(String time) {
    return 'อัปเดต $time';
  }

  @override
  String get homeMarketPulse => 'ชีพจรตลาด';

  @override
  String get homeMarketSnapshot => 'ภาพรวมตลาด';

  @override
  String get aiReadMore => 'อ่านเพิ่มเติม';

  @override
  String get aiShowLess => 'ย่อ';

  @override
  String get alertStatusActive => 'เปิดใช้งาน';

  @override
  String get alertStatusInactive => 'ปิดใช้งาน';

  @override
  String watchlistLimitReached(int count, int limit) {
    return '$count / $limit รายการ · อัปเกรดเพื่อรายการติดตามไม่จำกัด';
  }

  @override
  String get premiumHeroTitle => 'ปลดล็อกประสบการณ์ MKR แบบเต็มรูปแบบ';

  @override
  String get premiumHeroSubtitle =>
      'นำหน้าตลาดด้วยข้อมูลเชิงลึกที่มากขึ้น การแจ้งเตือนไม่จำกัด และประสบการณ์ที่ไม่มีโฆษณา';

  @override
  String get badgeMostPopular => 'ยอดนิยม';

  @override
  String get badgeBestValue => 'คุ้มค่าที่สุด';

  @override
  String get premiumCtaGetLifetime => 'รับแบบตลอดชีพ';

  @override
  String get settingsSectionAccount => 'บัญชี';

  @override
  String get settingsSectionSubscription => 'การสมัครสมาชิก';

  @override
  String get settingsSectionPreferences => 'การตั้งค่าทั่วไป';

  @override
  String get settingsSectionNotifications => 'การแจ้งเตือน';

  @override
  String get settingsSectionMarket => 'ตลาด';

  @override
  String get settingsSectionLegal => 'กฎหมาย';

  @override
  String get settingsSectionAbout => 'เกี่ยวกับ';

  @override
  String get settingsUnlockPro => 'ปลดล็อก MKR Pro';

  @override
  String get settingsUnlockProSubtitle =>
      'ไม่มีโฆษณา • แจ้งเตือนไม่จำกัด • เครื่องมือตลาดขั้นสูง';

  @override
  String get settingsViewPlans => 'ดูแผนทั้งหมด';

  @override
  String get settingsActive => 'เปิดใช้งานอยู่';

  @override
  String get settingsManagePlan => 'จัดการแผน';

  @override
  String get versionLabel => 'เวอร์ชัน';

  @override
  String get aboutParagraph1 =>
      'MKR — Market Radar เป็นแอปข้อมูลเชิงลึกด้านตลาด ออกแบบมาเพื่อช่วยให้คุณเข้าใจสิ่งสำคัญในตลาดการเงินได้เพียงแวบเดียว';

  @override
  String get aboutParagraph2 =>
      'ติดตามทองคำ หุ้น คริปโต ฟอเร็กซ์ และดัชนีตลาดหลัก ติดตามเหตุการณ์เศรษฐกิจที่มีผลกระทบสูง ค้นพบข่าวที่ขับเคลื่อนตลาด และรับข้อมูลเชิงลึกจาก AI แบบกระชับในที่เดียว';

  @override
  String get aboutParagraph3 =>
      'MKR สร้างขึ้นสำหรับนักลงทุนและผู้ติดตามตลาดที่ต้องการมุมมองตลาดที่ชัดเจนโดยไม่ซับซ้อนเกินความจำเป็น';

  @override
  String get aboutDisclaimerTitle => 'ข้อจำกัดความรับผิดชอบ';

  @override
  String get aboutFooterBrand => 'MKR — Market Radar';

  @override
  String get privacyPolicyBody =>
      'ประกาศความเป็นส่วนตัวของ MKR\n\nMKR จัดเก็บการตั้งค่าของคุณ — ธีม ภาษา รายการติดตาม การแจ้งเตือน และรายการพอร์ตโฟลิโอ — ไว้ในเครื่องของคุณเท่านั้น ไม่จำเป็นต้องมีบัญชีเพื่อใช้ฟีเจอร์หลักของแอป\n\nเมื่อมีการเปิดใช้งานการซิงค์บัญชีและบริการคลาวด์ ข้อมูลจะถูกประมวลผลผ่านระบบหลังบ้านที่ปลอดภัย และประกาศนี้จะได้รับการปรับปรุงก่อนเปิดใช้งานฟีเจอร์ดังกล่าว';

  @override
  String get termsOfServiceBody =>
      'ข้อกำหนดการใช้งานของ MKR\n\nMKR จัดทำขึ้นเพื่อวัตถุประสงค์ในการให้ข้อมูลและการศึกษาเท่านั้น การใช้งานแอปถือว่าคุณรับทราบว่าข้อมูลตลาดอาจล่าช้าหรือคลาดเคลื่อน และเนื้อหาที่สร้างโดย AI เป็นการวิเคราะห์เชิงพรรณนา ไม่ใช่คำแนะนำทางการเงิน\n\nการซื้อการสมัครสมาชิกจะดำเนินการผ่านระบบการเรียกเก็บเงินมาตรฐานของแอปสโตร์เมื่อพร้อมใช้งาน ในกรณีที่ยังไม่ได้ตั้งค่าระบบเรียกเก็บเงิน จะไม่มีการเรียกเก็บเงินใดๆ และฟีเจอร์พรีเมียมจะให้ใช้งานเพื่อการพรีวิวเท่านั้น';

  @override
  String get adBannerPlaceholder => 'โฆษณาทดสอบ · ตัวยึดตำแหน่ง';

  @override
  String get adTestAdTitle => 'โฆษณาทดสอบ';

  @override
  String get adInterstitialPlaceholder =>
      'นี่คือพื้นที่โฆษณาตัวอย่าง ไม่มีเนื้อหาโฆษณาจริงถูกโหลด';

  @override
  String get adAppOpenPlaceholder =>
      'นี่คือพื้นที่โฆษณาแบบเปิดแอปตัวอย่าง ไม่มีเนื้อหาโฆษณาจริงถูกโหลด';

  @override
  String get close => 'ปิด';

  @override
  String get aiAskTitle => 'ผู้ช่วย AI ตลาดการเงิน';

  @override
  String get aiAskSubtitle => 'ถามอะไรก็ได้เกี่ยวกับการลงทุน';

  @override
  String get aiAskInputHint => 'ถามเกี่ยวกับตลาด หุ้น การลงทุน…';

  @override
  String get aiAskPromptGoldOutlook => 'แนวโน้มทองคำ';

  @override
  String get aiAskPromptFedImpact => 'ผลกระทบจาก Fed';

  @override
  String get aiAskPromptTopMovers => 'หุ้นเคลื่อนไหวสูงสุด';

  @override
  String get aiAskPromptMarketSummary => 'สรุปภาพตลาด';

  @override
  String get aiAskPromptExplainStock => 'อธิบายหุ้นตัวนี้';

  @override
  String get aiAskPromptWhyMoving => 'ทำไมตลาดถึงเคลื่อนไหว';

  @override
  String get aiAskThinking => 'กำลังคิด…';

  @override
  String get homeHeaderTitle => 'Market Radar';

  @override
  String get homeHeaderSubtitle => 'รู้ทันตลาด ฉลาดกว่าเดิม';

  @override
  String get homeGlobalMarkets => 'ตลาดโลก';

  @override
  String get homeGlobalMarketsMixed => 'ผสมผสานแต่ยังแข็งแกร่ง';

  @override
  String get homeGlobalMarketsGold => 'ทองคำ';

  @override
  String get homeGlobalMarketsGoldUp => 'ยืนราคาแข็งแกร่งใกล้จุดสูงสุด';

  @override
  String get homeGlobalMarketsGoldDown => 'ปรับตัวลงจากจุดสูงสุดล่าสุด';

  @override
  String get homeGlobalMarketsCrypto => 'คริปโต';

  @override
  String get homeGlobalMarketsCryptoUp => 'ปรับตัวขึ้นจากแรงซื้อใหม่';

  @override
  String get homeGlobalMarketsCryptoDown => 'ปรับตัวลงท่ามกลางความระมัดระวัง';

  @override
  String get marketDetailSentiment => 'อารมณ์ตลาด';

  @override
  String get marketDetailBullish => 'ขาขึ้น';

  @override
  String get marketDetailBearish => 'ขาลง';

  @override
  String get marketDetailDayRange => 'ช่วงราคาวันนี้';

  @override
  String get marketDetail52WeekRange => 'ช่วงราคา 52 สัปดาห์';

  @override
  String get alertStatusTriggered => 'ทำงานแล้ว';

  @override
  String get alertStatusPaused => 'หยุดชั่วคราว';

  @override
  String get premiumMonthly => 'รายเดือน';

  @override
  String get premiumYearly => 'รายปี';

  @override
  String premiumSavePercent(int percent) {
    return 'ประหยัด $percent%';
  }

  @override
  String get premiumCtaGetPro => 'รับ Pro';

  @override
  String get premiumCtaGetAiPro => 'รับ AI Pro';

  @override
  String get aboutHeadline => 'ข้อมูลเชิงลึกตลาดโลกของคุณ';

  @override
  String get aboutFeatureDashboard => 'แดชบอร์ดตลาดที่ทันสมัย';

  @override
  String get aboutFeatureAiAssistant => 'ผู้ช่วย AI ตลาดการเงิน';

  @override
  String get aboutFeatureRealtime => 'ข้อมูลตลาดแบบเรียลไทม์';

  @override
  String get aboutFeatureAlerts => 'การแจ้งเตือนอัจฉริยะ';

  @override
  String get aboutFeatureGlobalCoverage => 'ครอบคลุมตลาดทั่วโลก';

  @override
  String get aboutFeaturePremiumTools => 'เครื่องมือพรีเมียม';

  @override
  String get chartModeLine => 'เส้น';

  @override
  String get chartModeCandle => 'แท่งเทียน';

  @override
  String get chartCandleCaption =>
      'บีบนิ้วเพื่อซูม ลากเพื่อเลื่อน แตะแท่งเทียนเพื่อดู OHLC';

  @override
  String get chartCandleEmpty => 'ไม่มีข้อมูลแท่งเทียนสำหรับกรอบเวลานี้';

  @override
  String get chartSeriesUnavailable => 'ขณะนี้ไม่สามารถโหลดข้อมูลกราฟได้';

  @override
  String get notificationHistoryTitle => 'การแจ้งเตือน';

  @override
  String get notificationHistoryEmpty => 'ยังไม่มีการแจ้งเตือน';

  @override
  String get notificationHistorySignInRequired =>
      'เข้าสู่ระบบเพื่อดูประวัติการแจ้งเตือน';

  @override
  String get notificationHistoryUnavailable =>
      'การแจ้งเตือนแบบพุชยังไม่พร้อมใช้งานในเวอร์ชันนี้';
}
