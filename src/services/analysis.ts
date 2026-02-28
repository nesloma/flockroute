/**
 * ALPR-aware route analysis.
 * Uses Turf.js to calculate which cameras are near each route
 * and scores routes by surveillance exposure.
 */

import * as turf from '@turf/turf';
import type { ALPRCamera } from './overpass';
import type { Route } from './routing';

export type RouteLabel = 'Camera Free' | 'Least Surveillance' | 'Direct Route' | string;

export interface RouteAnalysis {
  route: Route;
  alprCount: number;           // cameras within threshold
  nearbyCameraIds: Set<number>; // IDs of cameras near this route
  score: number;               // lower is better (fewer cameras)
  label: RouteLabel;
  isDirect: boolean;           // true for fastest/most direct route
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
  const analyses = routes.map((route, originalIndex) => {
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
      label: '' as RouteLabel,
      isDirect: originalIndex === 0, // OSRM's first result is the fastest
    };
  });

  // Sort by camera count (fewest first)
  analyses.sort((a, b) => a.score - b.score);

  // Assign labels
  const directRoute = analyses.find((a) => a.isDirect)!;
  const bestRoute = analyses[0]; // fewest cameras after sort

  // Label the best avoidance route
  if (bestRoute.alprCount === 0) {
    bestRoute.label = 'Camera Free';
  } else {
    bestRoute.label = 'Least Surveillance';
  }

  // Label the direct route (if it's not already the best)
  if (directRoute !== bestRoute) {
    directRoute.label = 'Direct Route';
  }

  // Label remaining alternatives
  let altNum = 1;
  for (const a of analyses) {
    if (!a.label) {
      a.label = `Alternative ${altNum++}`;
    }
  }

  return analyses;
}

/**
 * Given a route with cameras nearby, compute waypoints that detour around
 * those cameras. Returns 1-2 waypoints to pass through for avoidance routing.
 */
export function computeAvoidanceWaypoints(
  route: Route,
  cameras: ALPRCamera[],
  nearbyCameraIds: Set<number>,
  offsetKm: number = 1,
): { lat: number; lng: number }[] {
  const nearbyCameras = cameras.filter((c) => nearbyCameraIds.has(c.id));
  if (nearbyCameras.length === 0) return [];

  const lineCoords = route.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
  const line = turf.lineString(lineCoords);

  // Find centroid of cameras near the route
  const camPoints = turf.points(nearbyCameras.map((c) => [c.lon, c.lat]));
  const centroid = turf.center(camPoints);

  // Find the point on the route nearest to camera centroid
  const nearest = turf.nearestPointOnLine(line, centroid);
  const idx = nearest.properties.index ?? 0;
  const nextIdx = Math.min(idx + 1, lineCoords.length - 1);

  // Route bearing at the nearest point
  const routeBearing = turf.bearing(
    turf.point(lineCoords[idx]),
    turf.point(lineCoords[nextIdx]),
  );

  // Two perpendicular candidates (left and right of route)
  const nearestCoords = nearest.geometry.coordinates as [number, number];
  const perpBearing1 = routeBearing + 90;
  const perpBearing2 = routeBearing - 90;

  const wp1 = turf.destination(turf.point(nearestCoords), offsetKm, perpBearing1, { units: 'kilometers' });
  const wp2 = turf.destination(turf.point(nearestCoords), offsetKm, perpBearing2, { units: 'kilometers' });

  // Pick the side that's further from the camera centroid (away from cameras)
  const dist1 = turf.distance(wp1, centroid, { units: 'kilometers' });
  const dist2 = turf.distance(wp2, centroid, { units: 'kilometers' });
  const bestWp = dist1 > dist2 ? wp1 : wp2;

  const [lng, lat] = bestWp.geometry.coordinates;
  return [{ lat, lng }];
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
