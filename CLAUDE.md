# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FlockRoute is a client-side web app that shows ALPR (Automatic License Plate Reader) cameras on a map and finds driving routes that minimize surveillance exposure. Named as a play on Flock Safety (major ALPR vendor). All logic runs in the browser — no backend server required.

## Commands

- `npm run dev` — start Vite dev server on port 3000
- `npm run build` — type-check with `tsc` then bundle with Vite (output in `dist/`)
- `npm run preview` — serve the production build locally
- `npx tsc --noEmit` — type-check only

## Architecture

All source code is in `src/`. The app is vanilla TypeScript (no framework) with Leaflet for maps.

### Services (`src/services/`)

- **overpass.ts** — Fetches ALPR cameras from OpenStreetMap via the Overpass API. Queries nodes/ways tagged `man_made=surveillance` + `surveillance:type=ALPR`. Returns camera locations with metadata (direction, brand, zone).
- **routing.ts** — Calculates driving routes via OSRM's public API (`router.project-osrm.org`). Requests up to 3 alternative routes. Returns GeoJSON geometry, distance, and duration.
- **geocoding.ts** — Address search and reverse geocoding via Nominatim. All requests include a `User-Agent` header per Nominatim usage policy.
- **analysis.ts** — Core ALPR-aware logic. Uses Turf.js `pointToLineDistance` to count cameras within 50m of each route. Routes are scored and sorted by camera count (fewest first).

### UI (`src/ui/`)

- **map.ts** — `MapController` class wrapping Leaflet. Manages origin/dest markers, route polylines (color-coded), and ALPR camera circle markers (red, with glow effect for cameras near the active route).
- **panel.ts** — Renders the sidebar route comparison cards showing ALPR count, distance, and duration for each alternative. Best route is labeled "Least Surveillance".

### Entry Point

- **main.ts** — Wires everything together. Handles map click events (set origin/destination), address search with debounce, route calculation flow (OSRM → Overpass → Turf analysis → render), and route selection.

## External APIs (all free, no keys required)

- **Overpass API** (`overpass-api.de`) — OSM data queries. Rate-limited; avoid hammering.
- **OSRM** (`router.project-osrm.org`) — Demo routing server. Not for heavy production use.
- **Nominatim** (`nominatim.openstreetmap.org`) — Geocoding. Max 1 req/sec, requires User-Agent.

## Key Patterns

- All coordinates in the app use `[lat, lng]` ordering internally, but GeoJSON/Turf use `[lng, lat]`. Conversions happen at service boundaries.
- OSRM returns GeoJSON (`[lng, lat]`), which gets flipped to `[lat, lng]` in `routing.ts`.
- The analysis proximity threshold (50m) is the default in `analysis.ts` but is configurable via parameter.
