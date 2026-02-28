/**
 * Sidebar route panel - displays route comparison cards.
 */

import type { RouteAnalysis } from '../services/analysis';

function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  return miles < 0.1 ? `${Math.round(meters)} m` : `${miles.toFixed(1)} mi`;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

function badgeClassForLabel(label: string): string {
  if (label === 'Camera Free') return 'badge-free';
  if (label === 'Least Surveillance') return 'badge-best';
  if (label === 'Direct Route') return 'badge-direct';
  return 'badge-alt';
}

function alprSeverityClass(count: number): string {
  if (count === 0) return 'low';
  if (count <= 3) return 'medium';
  return '';
}

export function renderRoutesPanel(
  analyses: RouteAnalysis[],
  onSelect: (index: number) => void,
  activeIndex: number = 0,
): void {
  const panel = document.getElementById('routes-panel')!;
  const list = document.getElementById('routes-list')!;

  panel.classList.remove('hidden');
  list.innerHTML = '';

  analyses.forEach((analysis, i) => {
    const isBest = i === 0;
    const card = document.createElement('div');
    card.className = `route-card${i === activeIndex ? ' active' : ''}${isBest ? ' recommended' : ''}`;
    card.addEventListener('click', () => onSelect(i));

    const badgeClass = badgeClassForLabel(analysis.label);
    const sevClass = alprSeverityClass(analysis.alprCount);

    card.innerHTML = `
      <span class="route-badge ${badgeClass}">${analysis.label}</span>
      <div class="route-name">${analysis.route.summary || `Route ${i + 1}`}</div>
      <div class="route-stats">
        <div class="route-stat">
          <span class="stat-value alpr-count ${sevClass}">${analysis.alprCount}</span>
          <span class="stat-label">ALPRs</span>
        </div>
        <div class="route-stat">
          <span class="stat-value">${formatDistance(analysis.route.distance)}</span>
          <span class="stat-label">Distance</span>
        </div>
        <div class="route-stat">
          <span class="stat-value">${formatDuration(analysis.route.duration)}</span>
          <span class="stat-label">Duration</span>
        </div>
      </div>
    `;

    list.appendChild(card);
  });
}
