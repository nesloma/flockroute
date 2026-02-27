# FlockRoute

Navigate around ALPR surveillance cameras. FlockRoute shows you how many Automatic License Plate Readers you'd pass on your route and finds alternatives that minimize surveillance exposure.

## How It Works

1. Set a start and destination (click the map or search an address)
2. FlockRoute calculates multiple driving routes via OSRM
3. ALPR camera locations are fetched from OpenStreetMap (same data as [DeFlock](https://deflock.org))
4. Each route is scored by how many cameras you'd drive past (within 50m)
5. Routes are ranked — the one with the fewest ALPRs is recommended

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Tech Stack

- **Vite + TypeScript** — build tooling
- **Leaflet** — interactive map
- **Overpass API** — ALPR camera data from OpenStreetMap
- **OSRM** — open-source driving route calculation
- **Turf.js** — geospatial analysis (camera-to-route proximity)
- **Nominatim** — address search / geocoding

Entirely client-side — no backend required.
