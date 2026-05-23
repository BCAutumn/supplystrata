import type { WorkbenchModel } from "@supplystrata/workbench-export";
import { drawChain } from "./draw.js";
import { hitTestSegment } from "./hit-test.js";
import { layoutWorkbench, type ChainLayout } from "./layout.js";

export interface ChainCanvasController {
  render(model: WorkbenchModel, selectedSegmentIndex: number | null): void;
}

export function createChainCanvas(
  canvas: HTMLCanvasElement,
  input: { onSegmentSelect: (segmentIndex: number | null) => void; canSelectSegment?: () => boolean }
): ChainCanvasController {
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Canvas 2D context is unavailable.");
  let layout: ChainLayout | null = null;

  canvas.addEventListener("click", (event) => {
    if (input.canSelectSegment?.() === false) return;
    if (layout === null) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    input.onSegmentSelect(
      hitTestSegment(layout, {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
      })
    );
  });

  return {
    render(model, selectedSegmentIndex) {
      layout = layoutWorkbench(model);
      canvas.width = layout.width;
      canvas.height = layout.height;
      drawChain(ctx, layout, selectedSegmentIndex);
    }
  };
}
