export interface ScbomComponentRegistry {
  readonly registered: readonly string[];
}

export function registerScbomComponents(): ScbomComponentRegistry {
  return { registered: [] };
}

export { createScbomView } from "./index.js";
