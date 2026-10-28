import { KITCHEN, TEAM_ROLES } from './nikolausEinteilung';
import type { EinteilungAssignment, EinteilungDay, TeamRole } from './nikolausEinteilung';

/**
 * Compact picture of the Einteilung, e.g. to post in a messenger group: one block per day with
 * the teams side by side and the kitchen below, so everybody finds their posts at a glance.
 */

export interface EinteilungBildPost {
  role: TeamRole;
  /** Name of the person on the post, or null while it is open. */
  name: string | null;
}

export interface EinteilungBildTeam {
  name: string;
  color: string;
  posts: EinteilungBildPost[];
}

export interface EinteilungBildDay {
  label: string;
  teams: EinteilungBildTeam[];
  kitchen: string[];
}

export interface EinteilungBild {
  title: string;
  subtitle: string;
  days: EinteilungBildDay[];
}

/** Collects what the picture shows from the days and all assignments, kitchen included. */
export function buildEinteilungBild(
  days: EinteilungDay[],
  assignments: EinteilungAssignment[],
  name: (personId: string) => string,
  teamColor: (team: string) => string,
  dayLabel: (date: string) => string
): EinteilungBildDay[] {
  return days.map((day) => {
    const ofDay = assignments.filter((a) => a.date === day.date);
    return {
      label: dayLabel(day.date),
      teams: day.teams.map((team) => ({
        name: team,
        color: teamColor(team),
        posts: TEAM_ROLES.map((role) => {
          const post = ofDay.find((a) => a.team === team && a.role === role);
          return { role, name: post ? name(post.personId) : null };
        }),
      })),
      kitchen: ofDay
        .filter((a) => a.team === KITCHEN)
        .map((a) => name(a.personId))
        .sort((a, b) => a.localeCompare(b, 'de')),
    };
  });
}

const SCALE = 2;
const PAD = 20;
const GAP = 10;
const COLUMN = 270;
const MIN_WIDTH = 520;
const LABEL = 72;
const ROW = 22;
const CARD_HEAD = 30;
const KITCHEN_LINE = 19;

const COLORS = {
  background: '#ffffff',
  card: '#f6f7f9',
  border: '#dde1e6',
  heading: '#003056',
  text: '#1c2430',
  muted: '#5f6b7a',
  open: '#b42318',
};

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > width) end--;
  return `${text.slice(0, end)}…`;
}

/** Breaks the kitchen names into lines, never inside a name. */
function wrap(ctx: CanvasRenderingContext2D, words: string[], width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line}, ${word}` : word;
    if (line && ctx.measureText(`${next},`).width > width) {
      lines.push(`${line},`);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function dayHeight(lines: number): number {
  return 26 + CARD_HEAD + TEAM_ROLES.length * ROW + 10 + 8 + Math.max(lines, 1) * KITCHEN_LINE + 18;
}

/** Draws the picture and encodes it as PNG. */
export async function renderEinteilungBild(bild: EinteilungBild): Promise<Blob> {
  const family =
    getComputedStyle(document.body).getPropertyValue('font-family').trim() || 'sans-serif';
  await document.fonts.ready;
  const font = (weight: number, size: number) => `${weight} ${size}px ${family}`;

  const columns = Math.max(1, ...bild.days.map((day) => day.teams.length));
  const width = Math.max(MIN_WIDTH, PAD * 2 + columns * COLUMN + (columns - 1) * GAP);
  const inner = width - PAD * 2;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas wird nicht unterstützt.');

  ctx.font = font(400, 14);
  const kitchenLines = bild.days.map((day) =>
    wrap(ctx, day.kitchen.length ? day.kitchen : ['niemand'], inner - 56)
  );
  const height =
    PAD + 58 + kitchenLines.reduce((sum, lines) => sum + dayHeight(lines.length), 0) + PAD - 18;

  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = COLORS.heading;
  ctx.font = font(700, 22);
  ctx.fillText(fit(ctx, bild.title, inner), PAD, PAD + 12);
  ctx.fillStyle = COLORS.muted;
  ctx.font = font(400, 13);
  ctx.fillText(fit(ctx, bild.subtitle, inner), PAD, PAD + 36);

  let y = PAD + 58;
  bild.days.forEach((day, index) => {
    ctx.fillStyle = COLORS.heading;
    ctx.font = font(700, 17);
    ctx.fillText(day.label, PAD, y + 10);
    y += 26;

    const cardHeight = CARD_HEAD + TEAM_ROLES.length * ROW + 10;
    day.teams.forEach((team, column) => {
      const x = PAD + column * (COLUMN + GAP);
      ctx.fillStyle = COLORS.card;
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, COLUMN - 1, cardHeight - 1, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = team.color;
      ctx.beginPath();
      ctx.roundRect(x, y, COLUMN, 5, [6, 6, 0, 0]);
      ctx.fill();

      ctx.font = font(700, 15);
      ctx.fillText(`Team ${team.name}`, x + 10, y + 19);

      team.posts.forEach((post, row) => {
        const rowY = y + CARD_HEAD + row * ROW + ROW / 2;
        ctx.fillStyle = COLORS.muted;
        ctx.font = font(400, 13);
        ctx.fillText(post.role, x + 10, rowY);
        const room = COLUMN - LABEL - 18;
        ctx.fillStyle = post.name ? COLORS.text : COLORS.open;
        ctx.font = post.name ? font(600, 15) : font(400, 14);
        // Long names get smaller before they are cut: everybody must find their own name
        for (let size = 14; post.name && size >= 12; size--) {
          if (ctx.measureText(post.name).width <= room) break;
          ctx.font = font(600, size);
        }
        ctx.fillText(fit(ctx, post.name ?? 'offen', room), x + 10 + LABEL, rowY);
      });
    });
    y += cardHeight + 8;

    ctx.fillStyle = COLORS.muted;
    ctx.font = font(600, 14);
    ctx.fillText('Küche', PAD, y + KITCHEN_LINE / 2);
    ctx.fillStyle = day.kitchen.length ? COLORS.text : COLORS.muted;
    ctx.font = font(400, 14);
    kitchenLines[index].forEach((line, i) => {
      ctx.fillText(line, PAD + 56, y + i * KITCHEN_LINE + KITCHEN_LINE / 2);
    });
    y += kitchenLines[index].length * KITCHEN_LINE + 18;

    if (index < bild.days.length - 1) {
      ctx.strokeStyle = COLORS.border;
      ctx.beginPath();
      ctx.moveTo(PAD, y - 9.5);
      ctx.lineTo(width - PAD, y - 9.5);
      ctx.stroke();
    }
  });

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Das Bild konnte nicht erstellt werden.')),
      'image/png'
    )
  );
}

/**
 * Hands the picture to the share sheet where the device offers it (phones: straight into a
 * messenger), otherwise saves it as a file. Resolves false if the person cancelled sharing.
 */
export async function shareOrSaveImage(
  blob: Blob,
  fileName: string,
  save: (blob: Blob, fileName: string) => void
): Promise<boolean> {
  const file = new File([blob], fileName, { type: 'image/png' });
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false;
      // E.g. the user gesture expired while drawing: fall back to saving the file
    }
  }
  save(blob, fileName);
  return true;
}
