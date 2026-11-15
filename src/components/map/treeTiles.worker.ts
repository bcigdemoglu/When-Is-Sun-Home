/**
 * The Trees layer's pixel work, off the main thread: decoding a heights
 * picture, cutting the buildings out and colouring what is left takes tens
 * of milliseconds per tile (hundreds on a slow phone) — on the main thread
 * that is a stutter in the middle of a drag of the time slider.
 */
import { runTreeTileJob, type TreeTileJob, type TreeTileResult } from "./treeTileJob";

interface WorkerScope {
  onmessage: ((event: MessageEvent<TreeTileJob>) => void) | null;
  postMessage(message: TreeTileResult, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const job = event.data;
  runTreeTileJob(job).then(
    ({ size, pixels }) =>
      scope.postMessage({ id: job.id, ok: true, size, pixels: pixels.buffer }, [pixels.buffer]),
    (error: unknown) =>
      scope.postMessage({
        id: job.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};
