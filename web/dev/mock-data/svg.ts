/**
 * Generated SVG placeholders for the mock API (leader photos, blog and Instagram images,
 * download previews). No network access, no binary assets.
 */

export const STUFE_COLORS: Record<string, string> = {
  Wölflinge: '#ff6400',
  Jungpfadfinder: '#2f53a7',
  Pfadfinder: '#00823c',
  Rover: '#cc1f2f',
  Vorstand: '#003056',
  Leitende: '#810a1a',
};

const PALETTE = ['#ff6400', '#2f53a7', '#00823c', '#cc1f2f', '#003056', '#810a1a', '#009fe3'];

/** Small deterministic hash, so the same input always yields the same picture. */
export function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  return hash;
}

export function pickColor(seed: string): string {
  return PALETTE[hashString(seed) % PALETTE.length];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Square portrait with initials and a stylised person silhouette. */
export function avatarSvg(name: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}"/>
      <stop offset="1" stop-color="#1f2937"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <circle cx="200" cy="165" r="78" fill="#ffffff" fill-opacity="0.22"/>
  <path d="M60 400c10-90 70-140 140-140s130 50 140 140z" fill="#ffffff" fill-opacity="0.22"/>
  <text x="200" y="190" text-anchor="middle" font-family="Georgia, serif" font-size="96"
    font-weight="700" fill="#ffffff">${escapeXml(initials(name))}</text>
</svg>`;
}

/** Landscape scene (mountains, lake, tent, sun) in a colour derived from the seed. */
export function sceneSvg(seed: string, width: number, height: number, label?: string): string {
  const hash = hashString(seed);
  const color = PALETTE[hash % PALETTE.length];
  const sunX = 0.15 + ((hash >> 3) % 70) / 100;
  const night = hash % 5 === 0;
  const sky = night ? '#1e2a4a' : '#bfe3f5';
  const sky2 = night ? '#4b3b6b' : '#fef3c7';
  const w = width;
  const h = height;
  const m1 = `M0 ${h * 0.7} L${w * 0.22} ${h * 0.38} L${w * 0.4} ${h * 0.6} L${w * 0.62} ${h * 0.3} L${w} ${h * 0.66} L${w} ${h} L0 ${h}Z`;
  const m2 = `M0 ${h * 0.8} L${w * 0.3} ${h * 0.58} L${w * 0.55} ${h * 0.75} L${w * 0.8} ${h * 0.55} L${w} ${h * 0.72} L${w} ${h} L0 ${h}Z`;
  const tentX = w * (0.3 + ((hash >> 5) % 40) / 100);
  const tentY = h * 0.88;
  const tentS = Math.min(w, h) * 0.16;
  const text = label
    ? `<text x="${w / 2}" y="${h * 0.16}" text-anchor="middle" font-family="system-ui, sans-serif"
    font-size="${Math.round(Math.min(w, h) * 0.06)}" font-weight="600" fill="${night ? '#ffffff' : '#1f2937'}"
    fill-opacity="0.75">${escapeXml(label)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky}"/>
      <stop offset="1" stop-color="${sky2}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  <circle cx="${w * sunX}" cy="${h * 0.25}" r="${Math.min(w, h) * 0.08}" fill="${night ? '#f1f5f9' : '#fbbf24'}"/>
  <path d="${m1}" fill="${color}" fill-opacity="0.55"/>
  <path d="${m2}" fill="#14532d" fill-opacity="0.85"/>
  <rect y="${h * 0.86}" width="${w}" height="${h * 0.14}" fill="#166534"/>
  <path d="M${tentX - tentS} ${tentY} L${tentX} ${tentY - tentS} L${tentX + tentS} ${tentY}Z" fill="${color}"/>
  <path d="M${tentX - tentS * 0.25} ${tentY} L${tentX} ${tentY - tentS * 0.45} L${tentX + tentS * 0.25} ${tentY}Z" fill="#111827" fill-opacity="0.6"/>
  ${text}
</svg>`;
}

/** First page of a document with a coloured header and grey text lines. */
export function documentPreviewSvg(fileName: string, width: number, height: number): string {
  const color = pickColor(fileName);
  const lines = Array.from({ length: 12 }, (_, i) => {
    const y = height * 0.32 + i * height * 0.05;
    const lineWidth = width * (0.55 + (hashString(fileName + i) % 30) / 100);
    return `<rect x="${width * 0.1}" y="${y}" width="${lineWidth * 0.8}" height="${height * 0.018}" rx="2" fill="#d1d5db"/>`;
  }).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <rect width="${width}" height="${height * 0.2}" fill="${color}"/>
  <text x="${width * 0.1}" y="${height * 0.13}" font-family="system-ui, sans-serif"
    font-size="${Math.round(width * 0.06)}" font-weight="700" fill="#ffffff">${escapeXml(fileName.replace(/\.[^.]+$/, '').slice(0, 28))}</text>
  ${lines}
</svg>`;
}
