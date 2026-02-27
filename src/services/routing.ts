/**
 * Route calculation using OSRM's public API.
 * Fetches multiple alternative routes between two points.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Route {
  geometry: [number, number][]; // [lat, lng] pairs
  distance: number;            // meters
  duration: number;            // seconds
  summary: string;
}

const OSRM_BASE = 'https://router.project-osrm.org';

export async function fetchRoutes(origin: LatLng, destination: LatLng): Promise<Route[]> {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?alternatives=3&overview=full&geometries=geojson&steps=true`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OSRM error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.code !== 'Ok') {
    throw new Error(`OSRM: ${data.code} - ${data.message || 'No route found'}`);
  }

  return data.routes.map((route: Record<string, unknown>) => {
    const geo = route.geometry as { coordinates: [number, number][] };
    const legs = route.legs as { summary: string }[];
    return {
      geometry: geo.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
      distance: route.distance as number,
      duration: route.duration as number,
      summary: legs.map((l) => l.summary).join(' / ') || 'Route',
    };
  });
}
