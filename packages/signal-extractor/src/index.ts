export interface OfficialDisclosureSignal {
  title: string;
  cite_text: string;
  evidence_level: 4 | 5;
  confidence: number;
}

export function extractTsmcIrSignalsFromText(text: string): OfficialDisclosureSignal[] {
  const signals: OfficialDisclosureSignal[] = [];
  addPatternSignal(signals, "TSMC describes itself as a dedicated foundry", text, [/pure-play foundry/i, /foundry/i]);
  addPatternSignal(signals, "TSMC reports broad customer and product coverage", text, [/customers/i, /products/i]);
  addPatternSignal(signals, "TSMC links demand to AI and HPC", text, [/\bAI\b/i, /\bHPC\b|high performance computing/i]);
  addPatternSignal(signals, "TSMC highlights advanced packaging capacity", text, [/advanced packaging/i, /packaging/i]);
  return signals;
}

export function extractSkHynixSignalsFromText(text: string): OfficialDisclosureSignal[] {
  const signals: OfficialDisclosureSignal[] = [];
  addPatternSignal(signals, "SK hynix links results to HBM demand", text, [/\bHBM\b/i, /demand|sales|revenue/i]);
  addPatternSignal(signals, "SK hynix describes AI memory momentum", text, [/\bAI\b/i, /memory|HBM|DRAM/i]);
  addPatternSignal(signals, "SK hynix mentions advanced memory products", text, [/HBM|DDR5|DRAM/i, /product|products|portfolio/i]);
  return signals;
}

export function extractSamsungSignalsFromText(text: string): OfficialDisclosureSignal[] {
  const signals: OfficialDisclosureSignal[] = [];
  addPatternSignal(signals, "Samsung describes HBM demand", text, [/\bHBM\b/i, /demand|sales|revenue|memory/i]);
  addPatternSignal(signals, "Samsung links memory business to AI servers", text, [/\bAI\b/i, /server|servers|memory|HBM/i]);
  addPatternSignal(signals, "Samsung mentions foundry performance", text, [/foundry/i, /sales|revenue|demand|customer/i]);
  return signals;
}

export function extractAsmlSignalsFromText(text: string): OfficialDisclosureSignal[] {
  const signals: OfficialDisclosureSignal[] = [];
  addExactSignal(
    signals,
    "ASML links business to semiconductor capacity",
    text,
    "We deliver value throughout the semiconductor value chain. Our comprehensive lithography portfolio enables cost-effective microchip scaling for our customers."
  );
  addExactSignal(signals, "ASML reports EUV lithography demand", text, "TWINSCAN NXE:3800E – full-specification system improves throughput by 37%");
  return signals;
}

function addPatternSignal(signals: OfficialDisclosureSignal[], title: string, text: string, patterns: RegExp[]): void {
  const cite = findSentence(text, patterns);
  if (cite === undefined) return;
  signals.push({ title, cite_text: cite, evidence_level: 4, confidence: 0.84 });
}

function addExactSignal(signals: OfficialDisclosureSignal[], title: string, text: string, exactText: string): void {
  if (!text.includes(exactText)) return;
  signals.push({ title, cite_text: exactText, evidence_level: 4, confidence: 0.84 });
}

function findSentence(text: string, patterns: RegExp[]): string | undefined {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 900);
  const sentence = sentences.find((item) => patterns.every((pattern) => pattern.test(item)));
  return sentence ?? findNearbySnippet(text, patterns);
}

function findNearbySnippet(text: string, patterns: RegExp[]): string | undefined {
  const normalized = text.replace(/\s+/g, " ");
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match === null) continue;
    const start = Math.max(0, match.index - 260);
    const end = Math.min(normalized.length, match.index + 520);
    const snippet = normalized.slice(start, end).trim();
    // signal 只是研究线索，仍然必须保留可回到原文的 cite_text。
    if (snippet.length >= 40 && patterns.every((item) => item.test(snippet))) return snippet;
  }
  return undefined;
}
