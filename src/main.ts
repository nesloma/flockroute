import { MapController } from './ui/map';
import { renderRoutesPanel } from './ui/panel';
import { fetchALPRCameras, type ALPRCamera } from './services/overpass';
import { fetchRoutes } from './services/routing';
import { searchAddress, reverseGeocode } from './services/geocoding';
import { analyzeRoutes, routesBoundingBox, type RouteAnalysis } from './services/analysis';

// State
let origin: { lat: number; lng: number } | null = null;
let destination: { lat: number; lng: number } | null = null;
let clickMode: 'origin' | 'destination' = 'origin';
let currentAnalyses: RouteAnalysis[] = [];
let currentCameras: ALPRCamera[] = [];
let activeRouteIndex = 0;

// DOM refs
const originInput = document.getElementById('origin-input') as HTMLInputElement;
const destInput = document.getElementById('dest-input') as HTMLInputElement;
const originSuggestions = document.getElementById('origin-suggestions')!;
const destSuggestions = document.getElementById('dest-suggestions')!;
const routeBtn = document.getElementById('route-btn') as HTMLButtonElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const statusText = document.getElementById('status-text')!;

// Init map
const mapCtrl = new MapController('map');

function setStatus(msg: string, loading = false): void {
  statusText.innerHTML = loading
    ? `<span class="loading-spinner"></span>${msg}`
    : msg;
}

function updateRouteButton(): void {
  routeBtn.disabled = !(origin && destination);
}

// --- Map click handling ---
mapCtrl.map.on('click', async (e: L.LeafletMouseEvent) => {
  const { lat, lng } = e.latlng;

  if (clickMode === 'origin') {
    origin = { lat, lng };
    mapCtrl.setOrigin(lat, lng);
    originInput.value = 'Loading...';
    originInput.classList.add('has-value');
    clickMode = 'destination';
    setStatus('Now click to set your destination');

    const name = await reverseGeocode(lat, lng);
    originInput.value = name;
  } else {
    destination = { lat, lng };
    mapCtrl.setDestination(lat, lng);
    destInput.value = 'Loading...';
    destInput.classList.add('has-value');
    clickMode = 'origin';
    setStatus('Press "Find Routes" to calculate');

    const name = await reverseGeocode(lat, lng);
    destInput.value = name;
  }

  updateRouteButton();
});

// --- Address search with debounce ---
let searchTimeout: ReturnType<typeof setTimeout>;

function setupAddressSearch(
  input: HTMLInputElement,
  suggestionsEl: HTMLElement,
  onSelect: (lat: number, lng: number, name: string) => void,
): void {
  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = input.value.trim();
    if (query.length < 3) {
      suggestionsEl.classList.remove('active');
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const results = await searchAddress(query);
        suggestionsEl.innerHTML = '';
        if (results.length === 0) {
          suggestionsEl.classList.remove('active');
          return;
        }

        for (const result of results) {
          const item = document.createElement('div');
          item.className = 'suggestion-item';
          item.textContent = result.displayName;
          item.addEventListener('click', () => {
            onSelect(result.lat, result.lon, result.displayName);
            suggestionsEl.classList.remove('active');
          });
          suggestionsEl.appendChild(item);
        }
        suggestionsEl.classList.add('active');
      } catch {
        suggestionsEl.classList.remove('active');
      }
    }, 400);
  });

  // Close suggestions when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target as Node) && !suggestionsEl.contains(e.target as Node)) {
      suggestionsEl.classList.remove('active');
    }
  });
}

setupAddressSearch(originInput, originSuggestions, (lat, lng, name) => {
  origin = { lat, lng };
  originInput.value = name;
  originInput.classList.add('has-value');
  mapCtrl.setOrigin(lat, lng);
  mapCtrl.map.setView([lat, lng], 13);
  clickMode = 'destination';
  setStatus('Now set your destination');
  updateRouteButton();
});

setupAddressSearch(destInput, destSuggestions, (lat, lng, name) => {
  destination = { lat, lng };
  destInput.value = name;
  destInput.classList.add('has-value');
  mapCtrl.setDestination(lat, lng);
  clickMode = 'origin';
  setStatus('Press "Find Routes" to calculate');
  updateRouteButton();
});

// --- Route calculation ---
routeBtn.addEventListener('click', async () => {
  if (!origin || !destination) return;

  routeBtn.disabled = true;
  mapCtrl.clearRoutes();
  mapCtrl.clearALPRs();
  currentAnalyses = [];
  currentCameras = [];
  activeRouteIndex = 0;

  try {
    // Step 1: Get routes
    setStatus('Calculating routes...', true);
    const routes = await fetchRoutes(origin, destination);

    if (routes.length === 0) {
      setStatus('No routes found. Try different locations.');
      routeBtn.disabled = false;
      return;
    }

    // Step 2: Fetch ALPR cameras in the route area
    setStatus(`Found ${routes.length} route(s). Fetching ALPR cameras...`, true);
    const bbox = routesBoundingBox(routes);
    currentCameras = await fetchALPRCameras(bbox);

    // Step 3: Analyze routes against cameras
    setStatus('Analyzing surveillance exposure...', true);
    currentAnalyses = analyzeRoutes(routes, currentCameras);

    // Step 4: Display results
    const allNearbyCameraIds = new Set<number>();
    for (const a of currentAnalyses) {
      for (const id of a.nearbyCameraIds) allNearbyCameraIds.add(id);
    }

    mapCtrl.displayRoutes(currentAnalyses);
    mapCtrl.displayALPRCameras(currentCameras, currentAnalyses[activeRouteIndex].nearbyCameraIds);

    renderRoutesPanel(currentAnalyses, selectRoute, activeRouteIndex);

    const totalCameras = currentCameras.length;
    const best = currentAnalyses[0];
    if (totalCameras === 0) {
      setStatus(`${routes.length} route(s) found. No ALPR cameras detected in this area.`);
    } else if (best.alprCount === 0) {
      setStatus(
        `${totalCameras} ALPR camera(s) in area. Camera-free route found!`,
      );
    } else {
      setStatus(
        `${totalCameras} ALPR camera(s) in area. Best route passes ${best.alprCount} camera(s).`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    setStatus(`Error: ${msg}`);
  }

  routeBtn.disabled = false;
  updateRouteButton();
});

function selectRoute(index: number): void {
  activeRouteIndex = index;
  mapCtrl.highlightRoute(index, currentAnalyses);
  mapCtrl.displayALPRCameras(currentCameras, currentAnalyses[index].nearbyCameraIds);
  renderRoutesPanel(currentAnalyses, selectRoute, index);
}

// --- Clear ---
clearBtn.addEventListener('click', () => {
  origin = null;
  destination = null;
  clickMode = 'origin';
  currentAnalyses = [];
  currentCameras = [];
  activeRouteIndex = 0;

  originInput.value = '';
  destInput.value = '';
  originInput.classList.remove('has-value');
  destInput.classList.remove('has-value');

  mapCtrl.clearAll();

  const panel = document.getElementById('routes-panel')!;
  panel.classList.add('hidden');

  routeBtn.disabled = true;
  setStatus('Click the map to set start and destination points');
});

// Kick it off
setStatus('Click the map to set your start point, or search an address');
