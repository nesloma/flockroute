/**
 * Geocoding via Nominatim (OpenStreetMap's geocoding service).
 * Converts address strings to coordinates and vice versa.
 */

export interface GeocodingResult {
  lat: number;
  lon: number;
  displayName: string;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

export async function searchAddress(query: string): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    limit: '5',
  });

  const response = await fetch(`${NOMINATIM_URL}/search?${params}`, {
    headers: { 'User-Agent': 'FlockRoute/0.1 (ALPR avoidance routing app)' },
  });

  if (!response.ok) {
    throw new Error(`Nominatim error: ${response.status}`);
  }

  const data = await response.json();
  return data.map((item: Record<string, unknown>) => ({
    lat: parseFloat(item.lat as string),
    lon: parseFloat(item.lon as string),
    displayName: item.display_name as string,
  }));
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    format: 'json',
  });

  const response = await fetch(`${NOMINATIM_URL}/reverse?${params}`, {
    headers: { 'User-Agent': 'FlockRoute/0.1 (ALPR avoidance routing app)' },
  });

  if (!response.ok) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

  const data = await response.json();
  // Build a short display name
  const addr = data.address ?? {};
  const parts = [
    addr.road,
    addr.city || addr.town || addr.village,
    addr.state,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}
