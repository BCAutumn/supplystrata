import type { WorkbenchModel } from "@supplystrata/workbench-export";
import { parseWorkbenchModel } from "@supplystrata/workbench-export/schema";

export async function loadWorkbenchModelFromFile(file: File, signal?: AbortSignal): Promise<WorkbenchModel> {
  return parseWorkbenchModel(await readFileText(file, signal));
}

export async function loadWorkbenchModelFromUrl(reportUrl: string, signal?: AbortSignal): Promise<WorkbenchModel> {
  const init: RequestInit = { headers: { Accept: "application/json" } };
  if (signal !== undefined) init.signal = signal;
  const response = await fetch(reportUrl, init);
  if (!response.ok) {
    throw new Error(`Failed to load workbench JSON from ${reportUrl}: HTTP ${response.status}`);
  }
  return parseWorkbenchModel(await response.text());
}

function readFileText(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(createAbortError());
      return;
    }

    const reader = new FileReader();
    const cleanup = (): void => {
      reader.removeEventListener("load", onLoad);
      reader.removeEventListener("error", onError);
      reader.removeEventListener("abort", onAbort);
      signal?.removeEventListener("abort", onSignalAbort);
    };
    const settle = (fn: () => void): void => {
      cleanup();
      fn();
    };
    const onLoad = (): void => {
      const result = reader.result;
      settle(() => {
        if (typeof result === "string") {
          resolve(result);
        } else {
          reject(new Error(`FileReader returned non-text content for ${file.name}`));
        }
      });
    };
    const onError = (): void => {
      settle(() => reject(reader.error ?? new Error(`Failed to read ${file.name}`)));
    };
    const onAbort = (): void => {
      settle(() => reject(createAbortError()));
    };
    const onSignalAbort = (): void => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };

    reader.addEventListener("load", onLoad);
    reader.addEventListener("error", onError);
    reader.addEventListener("abort", onAbort);
    signal?.addEventListener("abort", onSignalAbort, { once: true });
    reader.readAsText(file);
  });
}

function createAbortError(): DOMException {
  return new DOMException("Workbench file load aborted.", "AbortError");
}
