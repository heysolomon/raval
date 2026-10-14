/**
 * Freehand ink on the canvas. The outline itself is worked out in `@raval/shared`
 * (the website's demo draws the same strokes); this turns it into something a canvas can fill.
 */
import { inkPathData, type InkPoint } from '@raval/shared';

export type { InkPoint };

/** The filled shape of a stroke. See `inkPathData` for what `size` and `complete` mean. */
export function inkPath(raw: InkPoint[], size: number, complete = true): Path2D {
  return new Path2D(inkPathData(raw, size, complete));
}
