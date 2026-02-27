/**
 * ALPR-aware route analysis.
 * Uses Turf.js to calculate which cameras are near each route
 * and scores routes by surveillance exposure.
 */

import * as turf from '@turf/turf';
import type { ALPRCamera } from './overpass';
import type { Route } from './routing';

export interface RouteAnalysis {
  route: Route;
  alprCount: number;           // cameras within threshold
  nearbyCameraIds: Set<number>; // IDs of cameras near this route
  score: number;               // lower is better (fewer cameras)
}

/** Default proximity threshold in meters */
const PROXIMITY_THRESHOLD_M = 50;

/**
 * Analyze a set of routes against known ALPR camera positions.
 * Returns routes sorted best-first (fewest cameras).
 */
export function analyzeRoutes(
  routes: Route[],
  cameras: ALPRCamera[],
  thresholdMeters: number = PROXIMITY_THRESHOLD_M,
): RouteAnalysis[] {
  const analyses = routes.map((route) => {
    const lineCoords = route.geometry.map(([lat, lng]) => [lng, lat]);
    const line = turf.lineString(lineCoords);

    const nearbyCameraIds = new Set<number>();

    for (const cam of cameras) {
      const point = turf.point([cam.lon, cam.lat]);
      const distance = turf.pointToLineDistance(point, line, { units: 'meters' });
      if (distance <= thresholdMeters) {
        nearbyCameraIds.add(cam.id);
      }
    }

    return {
      route,
      alprCount: nearbyCameraIds.size,
      nearbyCameraIds,
      score: nearbyCameraIds.size,
    };
  });

  analyses.sort((a, b) => a.score - b.score);
  return analyses;
}

/**
 * Compute a bounding box that covers all routes with some padding.
 */
export function routesBoundingBox(routes: Route[]): { south: number; west: number; north: number; east: number } {
  let south = 90, north = -90, west = 180, east = -180;

  for (const route of routes) {
    for (const [lat, lng] of route.geometry) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
  }

  // Add ~1km padding
  const latPad = 0.01;
  const lngPad = 0.01;
  return {
    south: south - latPad,
    north: north + latPad,
    west: west - lngPad,
    east: east + lngPad,
  };
}
