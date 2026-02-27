/**
 * Leaflet map initialization and layer management.
 */

import L from 'leaflet';
import type { ALPRCamera } from '../services/overpass';
import type { RouteAnalysis } from '../services/analysis';

const ROUTE_COLORS = ['#00d4aa', '#ffd93d', '#ff9f43', '#a29bfe'];
const INACTIVE_ROUTE_COLOR = '#4a5568';

export class MapController {
  map: L.Map;
  private originMarker: L.Marker | null = null;
  private destMarker: L.Marker | null = null;
  private alprLayer: L.LayerGroup;
  private routeLayers: L.Polyline[] = [];
  private activeRouteIndex = 0;

  constructor(containerId: string) {
    this.map = L.map(containerId, {
      center: [39.8283, -98.5795], // center of US
      zoom: 5,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.alprLayer = L.layerGroup().addTo(this.map);
  }

  setOrigin(lat: number, lng: number): void {
    if (this.originMarker) this.map.removeLayer(this.originMarker);
    this.originMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'origin-marker',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    })
      .addTo(this.map)
      .bindPopup('Start');
  }

  setDestination(lat: number, lng: number): void {
    if (this.destMarker) this.map.removeLayer(this.destMarker);
    this.destMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'dest-marker',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    })
      .addTo(this.map)
      .bindPopup('Destination');
  }

  clearRoutes(): void {
    for (const layer of this.routeLayers) {
      this.map.removeLayer(layer);
    }
    this.routeLayers = [];
  }

  clearALPRs(): void {
    this.alprLayer.clearLayers();
  }

  clearAll(): void {
    this.clearRoutes();
    this.clearALPRs();
    if (this.originMarker) {
      this.map.removeLayer(this.originMarker);
      this.originMarker = null;
    }
    if (this.destMarker) {
      this.map.removeLayer(this.destMarker);
      this.destMarker = null;
    }
  }

  displayRoutes(analyses: RouteAnalysis[]): void {
    this.clearRoutes();

    // Draw inactive routes first (behind), then active on top
    for (let i = analyses.length - 1; i >= 0; i--) {
      const isActive = i === this.activeRouteIndex;
      const coords = analyses[i].route.geometry.map(
        ([lat, lng]) => [lat, lng] as L.LatLngTuple,
      );

      const polyline = L.polyline(coords, {
        color: isActive ? ROUTE_COLORS[i % ROUTE_COLORS.length] : INACTIVE_ROUTE_COLOR,
        weight: isActive ? 6 : 4,
        opacity: isActive ? 0.9 : 0.4,
      }).addTo(this.map);

      this.routeLayers.push(polyline);
    }

    // Fit map to all routes
    const allCoords = analyses.flatMap((a) =>
      a.route.geometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple),
    );
    if (allCoords.length > 0) {
      this.map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] });
    }
  }

  highlightRoute(index: number, analyses: RouteAnalysis[]): void {
    this.activeRouteIndex = index;
    this.displayRoutes(analyses);
  }

  displayALPRCameras(cameras: ALPRCamera[], nearbyCameraIds?: Set<number>): void {
    this.alprLayer.clearLayers();

    for (const cam of cameras) {
      const isNearRoute = nearbyCameraIds?.has(cam.id) ?? false;
      const marker = L.circleMarker([cam.lat, cam.lon], {
        radius: isNearRoute ? 7 : 5,
        fillColor: isNearRoute ? '#ff0000' : '#ff4444',
        color: isNearRoute ? '#ff0000' : '#cc0000',
        weight: isNearRoute ? 2 : 1,
        fillOpacity: isNearRoute ? 0.9 : 0.6,
      });

      const direction = cam.tags['camera:direction'] || 'Unknown';
      const brand = cam.tags['manufacturer'] || cam.tags['brand'] || cam.tags['operator'] || 'Unknown';
      const zone = cam.tags['surveillance:zone'] || 'Unknown';

      marker.bindPopup(`
        <strong>ALPR Camera</strong><br>
        <b>Brand:</b> ${brand}<br>
        <b>Direction:</b> ${direction}<br>
        <b>Zone:</b> ${zone}<br>
        <small>OSM ID: ${cam.id}</small>
      `);

      this.alprLayer.addLayer(marker);
    }
  }
}
