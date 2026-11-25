/**
 * The Trees layer's pixel work, off the main thread: decoding a heights
 * picture, cutting the buildings out and colouring what is left takes tens
 * of milliseconds per tile (hundreds on a slow phone) — on the main thread
 * that is a stutter in the middle of a drag of the time slider.
 */
import {
  runCanopyJob,
  runTreeTileJob,
  type CanopyJob,
  type CanopyResult,
  type TreeTileJob,
  type TreeTileResult,
} from "./treeTileJob";

interface WorkerScope {
  onmessage: ((event: MessageEvent<TreeTileJob | CanopyJob>) => void) | null;
  postMessage(message: TreeTileResult | CanopyResult, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

const failure = (id: number, error: unknown) =>
  scope.postMessage({
    id,
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });

scope.onmessage = (event) => {
  const job = event.data;
  if (job.kind === "canopy") {
    // The report's canopy measurements (see `treeCanopy.ts`).
    runCanopyJob(job).then(
      ({ ground, feet, labels, cover }) => {
        const transfer: Transferable[] = [ground.buffer, feet.buffer];
        if (labels) transfer.push(labels.buffer);
        scope.postMessage(
          {
            id: job.id,
            ok: true,
            ground: ground.buffer,
            feet: feet.buffer,
            labels: labels ? labels.buffer : null,
            cover,
          },
          transfer,
        );
      },
      (error: unknown) => failure(job.id, error),
    );
    return;
  }
  runTreeTileJob(job).then(
    ({ size, pixels }) =>
      scope.postMessage({ id: job.id, ok: true, size, pixels: pixels.buffer }, [pixels.buffer]),
    (error: unknown) => failure(job.id, error),
  );
};
