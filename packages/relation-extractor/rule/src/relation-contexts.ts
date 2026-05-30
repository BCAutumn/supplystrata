// 关系抽取的"语境探测器"是唯一与语言强相关的部分：判断一句话是否在讲采购/供货/单一来源/客户集中度。
// 把它做成按语言可插拔的 profile —— 英文为默认（与历史实现逐字一致，零回归），日文新增。
// 中文/韩文将来只需再加一个 profile，无需改抽取主流程。
// 注意：交易对手名 / 组件名的匹配是"跨语言共享"的（在 pattern catalog 的 patternSources 里追加 CJK 写法即可），
// 因为 `pattern.test(sentence)` 与语言无关，不属于这里。
export interface RelationContextProfile {
  readonly language: string;
  readonly manufacturingContext: readonly RegExp[];
  readonly foundryListContext: readonly RegExp[];
  readonly manufacturingServiceContext: readonly RegExp[];
  readonly namedCustomer: readonly RegExp[];
  readonly directPurchase: readonly RegExp[];
  readonly purchaseObligation: readonly RegExp[];
  readonly singleSource: readonly RegExp[];
  // 英文 directPurchase 必须同时命中组件（"purchase X from Y"）；日文"主要な仕入先はY"常无组件，
  // 此标志允许无组件的直接采购披露也产出（component 留空），由各语言 profile 自行决定宽严。
  readonly allowComponentlessDirectPurchase: boolean;
}

export const EN_RELATION_CONTEXT_PROFILE: RelationContextProfile = {
  language: "en",
  manufacturingContext: [/(foundr|wafer|fabricat|manufactur|supplier|subcontractor|assembly|test)/i],
  foundryListContext: [/(foundries?.{0,280}(tsmc|taiwan semiconductor manufacturing|samsung)|produce.{0,120}semiconductor wafers)/i],
  manufacturingServiceContext: [/(contract manufactur|manufactur|assembly|testing|packaging|subcontractor)/i],
  namedCustomer: [
    /\b(?:accounted for|represented|contributed|comprised).{0,120}\b(?:revenue|net sales|sales)\b/i,
    /\b(?:sales to|net sales to|revenue from|derive revenue from|derived revenue from)\b/i
  ],
  directPurchase: [
    /\b(?:purchase|purchases|purchased|procure|procures|procured|source|sources|sourced|obtain|obtains|obtained|buy|buys|bought)\b/i
  ],
  purchaseObligation: [
    /\b(?:purchase obligations?|purchase commitments?|long[-\s]?term supply agreements?|wafer supply agreements?|capacity reservations?|prepayments?|take[-\s]?or[-\s]?pay)\b/i
  ],
  singleSource: [/\b(?:sole source|single source|single-source|sole supplier|limited number of suppliers|limited suppliers)\b/i],
  allowComponentlessDirectPurchase: false
};

// 日文语境探测器：CJK 无空格、无大小写，不能用 \b。覆盖有価証券報告書常见措辞：
// 仕入先 / 調達 / 購買 / サプライヤー（采购）、主要な販売先 / 得意先 / 売上高に占める割合（客户集中度）、
// 特定の仕入先に依存 / 単一供給先（单一来源）、購入義務 / 長期供給契約 / テイクオアペイ（采购承诺）。
export const JA_RELATION_CONTEXT_PROFILE: RelationContextProfile = {
  language: "ja",
  manufacturingContext: [/(製造|生産|ファウンドリ|ウェ[ーハ]|ウエハ|受託|委託|外注|組立|検査|後工程|半導体)/],
  foundryListContext: [/(ファウンドリ.{0,40}(TSMC|台湾積体電路|サムスン)|半導体.{0,30}(ウェ[ーハ]|ウエハ).{0,20}(製造|生産))/],
  manufacturingServiceContext: [/(受託(製造|生産)|委託(製造|生産)|EMS|組立|検査|パッケージング|後工程|外注)/],
  namedCustomer: [/(主要な?(販売先|得意先|顧客|納入先))/, /((売上高?|販売(高|実績)).{0,14}(に占める|の割合|を占め|割合))/],
  directPurchase: [/(調達|仕入(れ|先)?|購入|購買|供給を受け|サプライヤー|供給(元|業者|先))/],
  purchaseObligation: [
    /(購入(義務|契約|コミットメント|保証)|購買契約|長期(供給|購買|調達)契約|供給契約|テイクオアペイ|前払|数量(引取|引き取り)義務)/
  ],
  singleSource: [
    /(単一の?(供給|調達|仕入)先|特定の(仕入先|サプライヤー|供給(業者|元))|限られた(数の)?(仕入先|供給(業者|元))|(供給|調達)元が(限られ|限定))/
  ],
  allowComponentlessDirectPurchase: true
};

// 中文语境探测器：覆盖 A 股年报常见措辞（巨潮/交易所）：
// 供应商 / 采购 / 进货（采购）、前五大客户 / 主要客户 / 营业收入占比（客户集中度）、
// 单一供应商 / 唯一供应商 / 依赖特定供应商（单一来源）、采购合同 / 长期供应协议 / 照付不议（采购承诺）。
// 同时容忍繁简：供应商/供應商、采购/採購。
export const ZH_RELATION_CONTEXT_PROFILE: RelationContextProfile = {
  language: "zh",
  manufacturingContext: [/(制造|製造|生产|生產|代工|晶圆|晶圓|封装|封測|测试|組裝|组装|外协|半导体|半導體)/],
  foundryListContext: [
    /((晶圆)?代工.{0,40}(台积电|台積電|三星|中芯)|半导体.{0,30}晶圆.{0,20}(制造|生产))/
  ],
  manufacturingServiceContext: [/(代工|受托(制造|生产)|委托(加工|制造|生产)|EMS|封装|测试|组装|外协|贴牌|代加工)/],
  namedCustomer: [/(前(五|5|十|10)大客户|主要客户|第一大客户|最大客户)/, /((营业收入|销售收入|营收|销售额).{0,14}(占比|的比例|占.{0,6}[%％]|比重))/],
  directPurchase: [/(采购|採購|供应商|供應商|供货商|供貨商|进货|向.{0,12}(采购|购买|采購|購買))/],
  purchaseObligation: [
    /(采购(义务|合同|协议|承诺)|采購(合同|協議)|长期(供应|采购|供货)(协议|合同)|供货(协议|合同)|产能预订|预付款|照付不议|包销)/
  ],
  singleSource: [
    /(单一(供应商|来源|供货商)|唯一(供应商|供货商)|向特定(供应商|供货商)|特定(供应商|供货商).{0,6}(依赖|采购)|供应商.{0,4}(集中|较为集中)|依赖.{0,8}(单一|特定|少数).{0,6}供应商)/
  ],
  allowComponentlessDirectPurchase: true
};

// 韩文语境探测器：覆盖 DART 사업보고서 常见措辞——
// 공급(업체/사/처) / 협력사 / 매입처 / 구매 / 조달 / …로부터 매입(供应商、采购)，
// 주요 고객 / 매출처 / 매출 비중(客户集中度)，단일 공급 / 특정 공급업체 의존(单一来源)，
// 장기 공급계약 / 구매 약정(采购承诺)。
export const KO_RELATION_CONTEXT_PROFILE: RelationContextProfile = {
  language: "ko",
  manufacturingContext: [/(제조|생산|위탁\s*생산|파운드리|반도체|웨이퍼|패키징|조립|가공)/],
  foundryListContext: [/((파운드리).{0,40}(TSMC|삼성|台積電|台积电)|반도체.{0,30}(제조|생산|위탁))/],
  manufacturingServiceContext: [/(위탁\s*생산|수탁\s*생산|OEM|EMS|파운드리|패키징|외주|임가공)/],
  namedCustomer: [/(주요\s*(고객|매출처|판매처)|최대\s*고객|핵심\s*고객)/, /(매출\s*(비중|비율|의\s*[\d.]+\s*[%％]))/],
  directPurchase: [/(공급(업체|사|처)|협력(사|업체)|매입처|구매처|구매|조달|매입|로부터.{0,8}(매입|구매|조달|공급))/],
  purchaseObligation: [/(장기\s*(공급|구매)\s*계약|공급\s*계약|구매\s*약정|장기공급|물량\s*약정)/],
  singleSource: [
    /(단일\s*공급(업체|사|처)?|유일\s*공급|특정\s*공급(업체|사).{0,8}(의존|구매)|공급(업체|사).{0,4}의존|의존도가?\s*(높|크))/
  ],
  allowComponentlessDirectPurchase: true
};

const PROFILES_BY_LANGUAGE: readonly RelationContextProfile[] = [
  EN_RELATION_CONTEXT_PROFILE,
  JA_RELATION_CONTEXT_PROFILE,
  ZH_RELATION_CONTEXT_PROFILE,
  KO_RELATION_CONTEXT_PROFILE
];

// 按文档语言选 profile（前缀匹配："ja"/"ja-JP" → 日文）。未识别语言回退英文，保持既有行为。
export function selectRelationContextProfile(language: string | undefined): RelationContextProfile {
  if (language === undefined) return EN_RELATION_CONTEXT_PROFILE;
  const normalized = language.toLowerCase();
  return PROFILES_BY_LANGUAGE.find((profile) => normalized.startsWith(profile.language)) ?? EN_RELATION_CONTEXT_PROFILE;
}
