/* The check mark the kit animates (a stroked path), used by the typed round and Build an email. */
const SVG = 'http://www.w3.org/2000/svg';

/** The check mark the kit animates (a stroked path). */
export function checkMark() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'check'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  svg.append(p);
  return svg;
}
