import type { SourcePlanContext, SourcePlanForComponentsInput, TradeObservationContext, TradeObservationDirection } from "./definitions.js";

export function createContext(
  input: Pick<
    SourcePlanForComponentsInput,
    | "entity_ids"
    | "officialDisclosureTargetNodes"
    | "tradeObservationMonth"
    | "tradeObservationCountryCode"
    | "tradeObservationDirections"
    | "officialDisclosureYear"
    | "materialObservationYear"
    | "commodityObservationMonth"
  >
): SourcePlanContext {
  return {
    entityIds: new Set(input.entity_ids ?? []),
    officialDisclosureTargetNodes: input.officialDisclosureTargetNodes ?? [],
    ...(input.officialDisclosureYear === undefined
      ? {}
      : {
          officialDisclosure: {
            year: normalizeOfficialDisclosureYear(input.officialDisclosureYear)
          }
        }),
    ...(input.tradeObservationMonth === undefined
      ? {}
      : {
          tradeObservation: {
            month: normalizeTradeObservationMonth(input.tradeObservationMonth),
            ...(input.tradeObservationCountryCode === undefined ? {} : { countryCode: input.tradeObservationCountryCode.trim() }),
            directions: normalizeTradeObservationDirections(input.tradeObservationDirections)
          }
        }),
    ...(input.materialObservationYear === undefined && input.commodityObservationMonth === undefined
      ? {}
      : {
          materialObservation: {
            ...(input.materialObservationYear === undefined ? {} : { year: normalizeMaterialObservationYear(input.materialObservationYear) }),
            ...(input.commodityObservationMonth === undefined ? {} : { month: normalizeTradeObservationMonth(input.commodityObservationMonth) })
          }
        })
  };
}

export function tradeObservationInput(tradeObservation: TradeObservationContext | undefined):
  | {
      tradeObservationMonth: string;
      tradeObservationCountryCode?: string;
      tradeObservationDirections: readonly TradeObservationDirection[];
    }
  | undefined {
  if (tradeObservation === undefined) return undefined;
  return {
    tradeObservationMonth: tradeObservation.month,
    ...(tradeObservation.countryCode === undefined ? {} : { tradeObservationCountryCode: tradeObservation.countryCode }),
    tradeObservationDirections: tradeObservation.directions
  };
}

function normalizeTradeObservationMonth(value: string): string {
  const trimmed = value.trim();
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(trimmed)) throw new Error(`trade observation month must use YYYY-MM format: ${value}`);
  return trimmed;
}

function normalizeTradeObservationDirections(value: readonly TradeObservationDirection[] | undefined): TradeObservationDirection[] {
  const directions = value ?? ["imports", "exports"];
  const unique = [...new Set(directions)];
  if (unique.length === 0) throw new Error("trade observation directions must include imports or exports");
  for (const direction of unique) {
    if (direction !== "imports" && direction !== "exports") throw new Error(`unsupported trade observation direction: ${String(direction)}`);
  }
  return unique.sort();
}

function normalizeMaterialObservationYear(value: string): string {
  const trimmed = value.trim();
  if (!/^[0-9]{4}$/.test(trimmed)) throw new Error(`material observation year must use YYYY format: ${value}`);
  return trimmed;
}

function normalizeOfficialDisclosureYear(value: string): string {
  const trimmed = value.trim();
  if (!/^[0-9]{4}$/.test(trimmed)) throw new Error(`official disclosure year must use YYYY format: ${value}`);
  return trimmed;
}
