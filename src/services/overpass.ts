/**
 * Fetches ALPR camera locations from OpenStreetMap via the Overpass API.
 * Queries for nodes/ways tagged with man_made=surveillance + surveillance:type=ALPR.
 */

export interface ALPRCamera {
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function buildQuery(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  const bboxStr = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:30];
(
  node["man_made"="surveillance"]["surveillance:type"="ALPR"](${bboxStr});
  way["man_made"="surveillance"]["surveillance:type"="ALPR"](${bboxStr});
  node["man_made"="surveillance"]["surveillance:type"="camera"]["description"~"ALPR|LPR|license plate|number plate",i](${bboxStr});
);
out center body;
`.trim();
}

export async function fetchALPRCameras(bbox: BBox): Promise<ALPRCamera[]> {
  const query = buildQuery(bbox);

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  return data.elements.map((el: Record<string, unknown>) => ({
    id: el.id as number,
    lat: (el.lat ?? (el.center as Record<string, number>)?.lat) as number,
    lon: (el.lon ?? (el.center as Record<string, number>)?.lon) as number,
    tags: (el.tags ?? {}) as Record<string, string>,
  }));
}
