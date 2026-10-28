import { z } from 'zod';

/** The matrix answer of Azure Maps: the list of cells, each checked on its own. */
export const matrixResponseSchema = z.object({
  properties: z.object({ matrix: z.array(z.unknown()) }),
});

/** Whether a cell's status says that no route exists, unlike a failure that may pass. */
function isNoRoute(statusCode: unknown): boolean {
  return (
    typeof statusCode === 'number' &&
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 408 &&
    statusCode !== 429
  );
}

/**
 * One cell: the points it is about and the driving minutes. The minutes are `null` where no
 * route exists and `undefined` where the cell failed or has no usable duration.
 */
export const matrixCellSchema = z
  .object({
    originIndex: z.int(),
    destinationIndex: z.int(),
    statusCode: z.unknown().optional(),
    durationInSeconds: z.unknown().optional(),
    durationTrafficInSeconds: z.unknown().optional(),
  })
  .transform(
    (cell): { origin: number; destination: number; minutes: number | null | undefined } => {
      const { originIndex: origin, destinationIndex: destination, statusCode } = cell;
      if (statusCode !== undefined && statusCode !== 200) {
        // A client error such as OUT_OF_REGION: there is no route between the two points
        return { origin, destination, minutes: isNoRoute(statusCode) ? null : undefined };
      }
      const seconds =
        typeof cell.durationTrafficInSeconds === 'number'
          ? cell.durationTrafficInSeconds
          : cell.durationInSeconds;
      const usable = typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0;
      return { origin, destination, minutes: usable ? seconds / 60 : undefined };
    }
  );

/** The route answer of Azure Maps: its features, of which the `RoutePath` one is searched. */
export const routeResponseSchema = z.object({ features: z.array(z.unknown()) });

/** A feature that is marked as the course of the route. */
export const routePathFeatureSchema = z.object({
  properties: z.object({ type: z.literal('RoutePath') }),
});

/** The geometry of the route: one line, or else a list of lines. */
export const routeGeometrySchema = z.object({
  type: z.unknown().optional(),
  coordinates: z.array(z.unknown()),
});

/** `[lon, lat]` of a point on the route; an altitude after it is ignored. */
export const routePointSchema = z.tuple([z.number(), z.number()], z.unknown());
