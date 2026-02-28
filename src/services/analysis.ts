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
 * For each camera near the route, compute a pair of "bracket" waypoints:
 * one before the camera and one after, both offset to the same side.
 * This forces OSRM to leave the main road before reaching each camera
 * and rejoin after passing it — much more effective than a single midpoint.
 *
 * @param bracketKm  how far before/after each camera (along route) to place brackets
 * @param offsetKm   how far to the side of the route to offset each bracket
 * @param side       which side of the route to offset toward
 */
export function computeBracketWaypoints(
  route: Route,
  cameras: ALPRCamera[],
  nearbyCameraIds: Set<number>,
  bracketKm: number = 0.3,
  offsetKm: number = 0.4,
  side: 'auto' | 'left' | 'right' = 'auto',
): { lat: number; lng: number }[] {
  const nearbyCameras = cameras.filter((c) => nearbyCameraIds.has(c.id));
  if (nearbyCameras.length === 0) return [];

  const lineCoords = route.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
  const line = turf.lineString(lineCoords);
  const routeLength = turf.length(line, { units: 'kilometers' });

  if (routeLength < 0.2) return []; // route too short

  // Project each camera onto the route
  const projections = nearbyCameras.map((cam) => {
    const pt = turf.point([cam.lon, cam.lat]);
    const snapped = turf.nearestPointOnLine(line, pt);
    return {
      cam,
      location: snapped.properties.location as number, // km along route
    };
  });
  projections.sort((a, b) => a.location - b.location);

  // Cluster cameras within 0.3km of each other (merge overlapping brackets)
  const clusters: { start: number; end: number; cams: typeof projections }[] = [];
  let cur = { start: projections[0].location, end: projections[0].location, cams: [projections[0]] };
  for (let i = 1; i < projections.length; i++) {
    if (projections[i].location - cur.end <= bracketKm * 2) {
      cur.end = projections[i].location;
      cur.cams.push(projections[i]);
    } else {
      clusters.push(cur);
      cur = { start: projections[i].location, end: projections[i].location, cams: [projections[i]] };
    }
  }
  clusters.push(cur);

  const waypoints: { lat: number; lng: number }[] = [];
  const minKm = 0.05; // stay away from route endpoints
  const maxKm = routeLength - 0.05;

  for (const cluster of clusters) {
    // Pre-bracket: a point before the first camera in cluster
    const preLoc = Math.max(minKm, cluster.start - bracketKm);
    // Post-bracket: a point after the last camera in cluster
    const postLoc = Math.min(maxKm, cluster.end + bracketKm);

    for (const loc of [preLoc, postLoc]) {
      const ptOnLine = turf.along(line, loc, { units: 'kilometers' });
      const ptCoords = ptOnLine.geometry.coordinates as [number, number];

      // Get route bearing at this point
      const snapped = turf.nearestPointOnLine(line, ptOnLine);
      const idx = snapped.properties.index ?? 0;
      const nextIdx = Math.min(idx + 1, lineCoords.length - 1);
      const bearing = turf.bearing(
        turf.point(lineCoords[idx]),
        turf.point(lineCoords[nextIdx]),
      );

      const leftWp = turf.destination(turf.point(ptCoords), offsetKm, bearing + 90, { units: 'kilometers' });
      const rightWp = turf.destination(turf.point(ptCoords), offsetKm, bearing - 90, { units: 'kilometers' });

      let chosen;
      if (side === 'left') {
        chosen = leftWp;
      } else if (side === 'right') {
        chosen = rightWp;
      } else {
        // 'auto': pick side away from the camera cluster centroid
        const camPts = turf.points(cluster.cams.map((p) => [p.cam.lon, p.cam.lat]));
        const centroid = turf.center(camPts);
        const dL = turf.distance(leftWp, centroid, { units: 'kilometers' });
        const dR = turf.distance(rightWp, centroid, { units: 'kilometers' });
        chosen = dL > dR ? leftWp : rightWp;
      }

      const [lng, lat] = chosen.geometry.coordinates;
      waypoints.push({ lat, lng });
    }
  }

  return waypoints;
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
