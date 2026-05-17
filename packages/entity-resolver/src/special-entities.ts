import { normalizeAlias, type ResolveResult } from "@supplystrata/core";

export function resolveSpecialEntity(
  surface: string,
  context: string,
): ResolveResult | undefined {
  const samsung = resolveSamsungBusinessUnit(surface, context);
  if (samsung !== undefined) return samsung;
  const foxconn = resolveFoxconnFamily(surface, context);
  if (foxconn !== undefined) return foxconn;
  const tsmc = resolveTsmcFamily(surface, context);
  if (tsmc !== undefined) return tsmc;
  return undefined;
}

function resolveSamsungBusinessUnit(
  surface: string,
  context: string,
): ResolveResult | undefined {
  const normalizedSurface = normalizeAlias(surface);
  if (normalizedSurface !== "samsung") return undefined;
  const normalizedContext = normalizeAlias(context);
  if (/\bfoundry|wafer|fabricat|manufactur/.test(normalizedContext)) {
    return {
      status: "resolved",
      entity_id: "ENT-SAMSUNG-FOUNDRY",
      confidence: 0.9,
      needs_human_review: false,
    };
  }
  if (/\bmemory|dram|hbm|high bandwidth/.test(normalizedContext)) {
    return {
      status: "resolved",
      entity_id: "ENT-SAMSUNG-MEMORY",
      confidence: 0.9,
      needs_human_review: false,
    };
  }
  if (
    /\bgalaxy|smartphone|tv|consumer electronics|mobile device/.test(
      normalizedContext,
    )
  ) {
    return {
      status: "resolved",
      entity_id: "ENT-SAMSUNG-ELECTRONICS",
      confidence: 0.85,
      needs_human_review: false,
    };
  }
  return {
    status: "ambiguous",
    confidence: 0.45,
    needs_human_review: true,
    candidates: [
      {
        entity_id: "ENT-SAMSUNG-ELECTRONICS",
        confidence: 0.4,
        reason: "孤立 Samsung 可能指母公司",
      },
      {
        entity_id: "ENT-SAMSUNG-FOUNDRY",
        confidence: 0.3,
        reason: "供应链语境可能指 Foundry",
      },
      {
        entity_id: "ENT-SAMSUNG-MEMORY",
        confidence: 0.3,
        reason: "供应链语境可能指 Memory",
      },
      {
        entity_id: "ENT-SAMSUNG-DISPLAY",
        confidence: 0.2,
        reason: "消费电子语境可能指 Display",
      },
    ],
  };
}

function resolveFoxconnFamily(
  surface: string,
  context: string,
): ResolveResult | undefined {
  const normalizedSurface = normalizeAlias(surface);
  if (
    ![
      "foxconn",
      "hon hai",
      "hon hai precision industry",
      "鴻海",
      "鸿海",
      "富士康",
      "fii",
      "fih",
      "hongfujin",
    ].includes(normalizedSurface)
  )
    return undefined;
  const normalizedContext = normalizeAlias(context);
  if (
    /\bindustrial internet\b|\bfii\b|工业互联网/.test(normalizedContext) ||
    normalizedSurface === "fii"
  ) {
    return {
      status: "resolved",
      entity_id: "ENT-FOXCONN-FII",
      confidence: 0.9,
      needs_human_review: false,
    };
  }
  if (
    /\bfih\b|mobile|handset/.test(normalizedContext) ||
    normalizedSurface === "fih"
  ) {
    return {
      status: "resolved",
      entity_id: "ENT-FIH-MOBILE",
      confidence: 0.88,
      needs_human_review: false,
    };
  }
  if (
    /hongfujin|shenzhen|深圳/.test(normalizedContext) ||
    normalizedSurface === "hongfujin"
  ) {
    return {
      status: "resolved",
      entity_id: "ENT-HONGFUJIN-SHENZHEN",
      confidence: 0.86,
      needs_human_review: false,
    };
  }
  if (/ohio|wisconsin|mt\.?\s*pleasant/.test(normalizedContext)) {
    return {
      status: "ambiguous",
      confidence: 0.65,
      needs_human_review: true,
      candidates: [
        {
          entity_id: "ENT-FOXCONN-OHIO",
          confidence: 0.55,
          reason: "美国厂区语境可能指 Foxconn Ohio",
        },
        {
          entity_id: "ENT-FOXCONN-ASSEMBLY",
          confidence: 0.45,
          reason: "美国组装法人也可能相关",
        },
      ],
    };
  }
  return {
    status: "resolved",
    entity_id: "ENT-FOXCONN",
    confidence: 0.92,
    needs_human_review: false,
  };
}

function resolveTsmcFamily(
  surface: string,
  context: string,
): ResolveResult | undefined {
  const normalizedSurface = normalizeAlias(surface);
  if (normalizedSurface !== "tsmc") return undefined;
  const normalizedContext = normalizeAlias(context);
  if (/arizona/.test(normalizedContext))
    return {
      status: "resolved",
      entity_id: "ENT-TSMC-ARIZONA",
      confidence: 0.9,
      needs_human_review: false,
    };
  if (/jasm|kumamoto|japan advanced semiconductor/.test(normalizedContext)) {
    return {
      status: "resolved",
      entity_id: "ENT-JASM",
      confidence: 0.88,
      needs_human_review: false,
    };
  }
  return {
    status: "resolved",
    entity_id: "ENT-TSMC",
    confidence: 0.96,
    needs_human_review: false,
  };
}
