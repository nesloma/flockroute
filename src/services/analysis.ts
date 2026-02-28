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
 * Cluster nearby cameras by their position along the route.
 * Groups cameras that are within `gapKm` of each other along the route line.
 * Returns one waypoint per cluster, enabling detours around each group.
 */
export function computeClusteredAvoidanceWaypoints(
  route: Route,
  cameras: ALPRCamera[],
  nearbyCameraIds: Set<number>,
  offsetKm: number = 1,
  side: 'auto' | 'left' | 'right' = 'auto',
): { lat: number; lng: number }[] {
  const nearbyCameras = cameras.filter((c) => nearbyCameraIds.has(c.id));
  if (nearbyCameras.length === 0) return [];

  const lineCoords = route.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
  const line = turf.lineString(lineCoords);
  const routeLength = turf.length(line, { units: 'kilometers' });

  // Project each camera onto the route to get its position along the line
  const projections = nearbyCameras.map((cam) => {
    const pt = turf.point([cam.lon, cam.lat]);
    const snapped = turf.nearestPointOnLine(line, pt);
    return {
      cam,
      location: snapped.properties.location as number, // km along route
      point: pt,
    };
  });

  // Sort by position along route
  projections.sort((a, b) => a.location - b.location);

  // Cluster cameras that are within 0.5km of each other along the route
  const gapKm = 0.5;
  const clusters: typeof projections[] = [];
  let currentCluster = [projections[0]];

  for (let i = 1; i < projections.length; i++) {
    if (projections[i].location - projections[i - 1].location <= gapKm) {
      currentCluster.push(projections[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [projections[i]];
    }
  }
  clusters.push(currentCluster);

  // Generate a waypoint for each cluster
  const waypoints: { lat: number; lng: number }[] = [];

  for (const cluster of clusters) {
    // Find the midpoint along the route for this cluster
    const avgLocation = cluster.reduce((sum, p) => sum + p.location, 0) / cluster.length;
    // Clamp to avoid going past route endpoints
    const clampedLocation = Math.max(0.1, Math.min(avgLocation, routeLength - 0.1));
    const midPoint = turf.along(line, clampedLocation, { units: 'kilometers' });
    const midCoords = midPoint.geometry.coordinates as [number, number];

    // Find segment index for bearing calculation
    const snapped = turf.nearestPointOnLine(line, midPoint);
    const idx = snapped.properties.index ?? 0;
    const nextIdx = Math.min(idx + 1, lineCoords.length - 1);

    const routeBearing = turf.bearing(
      turf.point(lineCoords[idx]),
      turf.point(lineCoords[nextIdx]),
    );

    const perpBearing1 = routeBearing + 90;
    const perpBearing2 = routeBearing - 90;

    const wp1 = turf.destination(turf.point(midCoords), offsetKm, perpBearing1, { units: 'kilometers' });
    const wp2 = turf.destination(turf.point(midCoords), offsetKm, perpBearing2, { units: 'kilometers' });

    // Pick which side
    if (side === 'left') {
      const [lng, lat] = wp1.geometry.coordinates;
      waypoints.push({ lat, lng });
    } else if (side === 'right') {
      const [lng, lat] = wp2.geometry.coordinates;
      waypoints.push({ lat, lng });
    } else {
      // 'auto': pick side furthest from the cluster's cameras
      const camPts = turf.points(cluster.map((p) => [p.cam.lon, p.cam.lat]));
      const centroid = turf.center(camPts);
      const dist1 = turf.distance(wp1, centroid, { units: 'kilometers' });
      const dist2 = turf.distance(wp2, centroid, { units: 'kilometers' });
      const bestWp = dist1 > dist2 ? wp1 : wp2;
      const [lng, lat] = bestWp.geometry.coordinates;
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
