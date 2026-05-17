import type { WorkbenchModel } from "@supplystrata/workbench-export";

export interface WorkbenchState {
  model: WorkbenchModel | null;
  selectedSegmentIndex: number | null;
}

export function createInitialState(): WorkbenchState {
  return {
    model: null,
    selectedSegmentIndex: null
  };
}

export function selectSegment(state: WorkbenchState, segmentIndex: number | null): WorkbenchState {
  return {
    ...state,
    selectedSegmentIndex: segmentIndex
  };
}
