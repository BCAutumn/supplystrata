import type { ResearchPackInput, WorkbenchSnapshotPackInput } from "./definitions.js";

export interface SourcePlanWindowInput {
  generatedAt: string;
  tradeObservationMonth?: string;
  tradeObservationCountryCode?: string;
  tradeObservationDirections?: ResearchPackInput["tradeObservationDirections"];
  officialDisclosureYear?: string;
  materialObservationYear?: string;
  commodityObservationMonth?: string;
}

export type SourcePlanWindowFields = Required<
  Pick<SourcePlanWindowInput, "tradeObservationMonth" | "officialDisclosureYear" | "materialObservationYear" | "commodityObservationMonth">
> &
  Pick<SourcePlanWindowInput, "tradeObservationCountryCode" | "tradeObservationDirections">;

// 研究包默认输出的是“可执行数据准备计划”，不是事实结论；因此可以从 generatedAt 派生保守窗口，让 source-plan 产生可排队 target。
export function resolveSourcePlanWindowFields(input: SourcePlanWindowInput): SourcePlanWindowFields {
  const generatedAt = parseGeneratedAt(input.generatedAt);
  const previousMonth = previousUtcMonth(generatedAt);
  const previousYear = String(generatedAt.getUTCFullYear() - 1);
  return {
    tradeObservationMonth: input.tradeObservationMonth ?? previousMonth,
    ...(input.tradeObservationCountryCode === undefined ? {} : { tradeObservationCountryCode: input.tradeObservationCountryCode }),
    ...(input.tradeObservationDirections === undefined ? {} : { tradeObservationDirections: input.tradeObservationDirections }),
    officialDisclosureYear: input.officialDisclosureYear ?? previousYear,
    materialObservationYear: input.materialObservationYear ?? previousYear,
    commodityObservationMonth: input.commodityObservationMonth ?? previousMonth
  };
}

export function withSourcePlanWindowDefaults<T extends ResearchPackInput | WorkbenchSnapshotPackInput>(
  input: T,
  generatedAt: string
): T & SourcePlanWindowFields {
  return {
    ...input,
    ...resolveSourcePlanWindowFields({
      generatedAt,
      ...(input.tradeObservationMonth === undefined ? {} : { tradeObservationMonth: input.tradeObservationMonth }),
      ...(input.tradeObservationCountryCode === undefined ? {} : { tradeObservationCountryCode: input.tradeObservationCountryCode }),
      ...(input.tradeObservationDirections === undefined ? {} : { tradeObservationDirections: input.tradeObservationDirections }),
      ...(input.officialDisclosureYear === undefined ? {} : { officialDisclosureYear: input.officialDisclosureYear }),
      ...(input.materialObservationYear === undefined ? {} : { materialObservationYear: input.materialObservationYear }),
      ...(input.commodityObservationMonth === undefined ? {} : { commodityObservationMonth: input.commodityObservationMonth })
    })
  };
}

function parseGeneratedAt(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`generatedAt must be a valid ISO timestamp for source-plan windows: ${value}`);
  return parsed;
}

function previousUtcMonth(value: Date): string {
  const year = value.getUTCMonth() === 0 ? value.getUTCFullYear() - 1 : value.getUTCFullYear();
  const month = value.getUTCMonth() === 0 ? 12 : value.getUTCMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
}
