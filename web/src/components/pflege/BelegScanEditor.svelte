<script lang="ts">
  import type { Point, Quad } from '../../lib/belegScan';
  import {
    eckenVon,
    griffPunkt,
    rechteckUm,
    ziehen,
    type Griff,
    type Rechteck,
    type ZuschnittArt,
  } from '../../lib/belegZuschnittRechteck';

  interface Props {
    /** URL of the original photo. */
    src: string;
    width: number;
    height: number;
    quad: Quad;
    /** Whether the corners move freely or a rectangle is moved and resized. */
    art?: ZuschnittArt;
    disabled?: boolean;
    /** Called with the new corners when a corner has been moved. */
    onchange: (quad: Quad) => void;
  }

  let { src, width, height, quad, art = 'frei', disabled = false, onchange }: Props = $props();

  const LABELS = ['oben links', 'oben rechts', 'unten rechts', 'unten links'];
  /** Handles of the rectangle: the corners, then the middle of each side. */
  const GRIFFE: { griff: Exclude<Griff, 'mitte'>; label: string; cursor: string }[] = [
    { griff: 'nw', label: 'Ecke oben links', cursor: 'nwse-resize' },
    { griff: 'ne', label: 'Ecke oben rechts', cursor: 'nesw-resize' },
    { griff: 'se', label: 'Ecke unten rechts', cursor: 'nwse-resize' },
    { griff: 'sw', label: 'Ecke unten links', cursor: 'nesw-resize' },
    { griff: 'n', label: 'Oberen Rand', cursor: 'ns-resize' },
    { griff: 'e', label: 'Rechten Rand', cursor: 'ew-resize' },
    { griff: 's', label: 'Unteren Rand', cursor: 'ns-resize' },
    { griff: 'w', label: 'Linken Rand', cursor: 'ew-resize' },
  ];

  let svg = $state<SVGSVGElement | null>(null);
  /** Corners while dragging; reset to the committed corners afterwards. */
  let draft = $state<Quad | null>(null);
  /** The free corner being dragged. */
  let dragging = $state<number | null>(null);
  /** The handle of the rectangle being dragged, with where the drag started. */
  let zug = $state<{ griff: Griff; von: Point; start: Rechteck } | null>(null);

  const shown = $derived(draft ?? quad);
  const rechteck = $derived(rechteckUm(shown, width, height));
  const handleRadius = $derived(Math.max(width, height) * 0.03);
  const stroke = $derived(Math.max(width, height) * 0.006);

  function toImage(event: PointerEvent): Point {
    const rect = svg!.getBoundingClientRect();
    return {
      x: Math.min(width, Math.max(0, ((event.clientX - rect.left) / rect.width) * width)),
      y: Math.min(height, Math.max(0, ((event.clientY - rect.top) / rect.height) * height)),
    };
  }

  function move(index: number, point: Point): void {
    const next = [...shown] as Quad;
    next[index] = point;
    draft = next;
  }

  function pointerMove(event: PointerEvent): void {
    if (dragging !== null) move(dragging, toImage(event));
    else if (zug) {
      const p = toImage(event);
      const { start, griff, von } = zug;
      draft = eckenVon(ziehen(start, griff, p.x - von.x, p.y - von.y, width, height));
    }
  }

  function commit(): void {
    if (draft) onchange(draft);
    draft = null;
    dragging = null;
    zug = null;
  }

  function start(event: PointerEvent, index: number): void {
    if (disabled) return;
    event.preventDefault();
    svg?.setPointerCapture(event.pointerId);
    dragging = index;
  }

  function startZug(event: PointerEvent, griff: Griff): void {
    if (disabled) return;
    event.preventDefault();
    svg?.setPointerCapture(event.pointerId);
    zug = { griff, von: toImage(event), start: rechteck };
  }

  /** The step of an arrow key, or null for other keys. */
  function arrow(event: KeyboardEvent): Point | null {
    if (disabled) return null;
    const step = Math.max(width, height) / (event.shiftKey ? 20 : 100);
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    return delta[event.key] ?? null;
  }

  function keydown(event: KeyboardEvent, index: number): void {
    const d = arrow(event);
    if (!d) return;
    event.preventDefault();
    const corner = shown[index];
    move(index, {
      x: Math.min(width, Math.max(0, corner.x + d.x)),
      y: Math.min(height, Math.max(0, corner.y + d.y)),
    });
  }

  function keydownRechteck(event: KeyboardEvent, griff: Griff): void {
    const d = arrow(event);
    if (!d) return;
    event.preventDefault();
    draft = eckenVon(ziehen(rechteck, griff, d.x, d.y, width, height));
  }
</script>

<!-- A block, so it starts on its own line after an inline label; as wide as the picture -->
<div class="relative w-fit max-w-full">
  <img
    {src}
    alt="Originalfoto mit dem erkannten Beleg"
    {width}
    {height}
    class="block h-auto max-h-[max(24rem,calc(100dvh-16rem))] w-auto max-w-full rounded-md border border-neutral-200 bg-neutral-100"
  />
  <svg
    bind:this={svg}
    viewBox="0 0 {width} {height}"
    preserveAspectRatio="none"
    class="absolute inset-0 h-full w-full touch-none select-none"
    role="group"
    aria-label={art === 'frei' ? 'Ecken des Belegs' : 'Ausschnitt des Belegs'}
    onpointermove={pointerMove}
    onpointerup={commit}
    onpointercancel={commit}
  >
    <path
      d="M0 0H{width}V{height}H0Z M{shown.map((p) => `${p.x} ${p.y}`).join('L')}Z"
      fill="rgb(0 0 0 / 0.45)"
      fill-rule="evenodd"
    />
    {#if art === 'frei'}
      <polygon
        points={shown.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke="#fff"
        stroke-width={stroke}
      />
      {#each shown as corner, index (index)}
        <circle
          cx={corner.x}
          cy={corner.y}
          r={handleRadius}
          fill="var(--color-dpsg-blue, #003056)"
          stroke="#fff"
          stroke-width={stroke}
          class="cursor-grab outline-none focus-visible:stroke-[#ffd200]"
          tabindex={disabled ? -1 : 0}
          role="button"
          aria-label="Ecke {LABELS[index]} verschieben (Pfeiltasten)"
          onpointerdown={(event) => start(event, index)}
          onkeydown={(event) => keydown(event, index)}
          onkeyup={(event) => event.key.startsWith('Arrow') && commit()}
        />
      {/each}
    {:else}
      <!-- The inside moves the whole rectangle: transparent, but it takes the pointer -->
      <rect
        x={rechteck.links}
        y={rechteck.oben}
        width={rechteck.rechts - rechteck.links}
        height={rechteck.unten - rechteck.oben}
        fill="transparent"
        pointer-events="all"
        stroke="#fff"
        stroke-width={stroke}
        class="cursor-move outline-none focus-visible:stroke-[#ffd200]"
        tabindex={disabled ? -1 : 0}
        role="button"
        aria-label="Ausschnitt verschieben (Pfeiltasten)"
        onpointerdown={(event) => startZug(event, 'mitte')}
        onkeydown={(event) => keydownRechteck(event, 'mitte')}
        onkeyup={(event) => event.key.startsWith('Arrow') && commit()}
      />
      {#each GRIFFE as { griff, label, cursor } (griff)}
        {@const punkt = griffPunkt(rechteck, griff)}
        {@const seite = griff.length === 1}
        <circle
          cx={punkt.x}
          cy={punkt.y}
          r={seite ? handleRadius * 0.75 : handleRadius}
          fill={seite ? '#fff' : 'var(--color-dpsg-blue, #003056)'}
          stroke={seite ? 'var(--color-dpsg-blue, #003056)' : '#fff'}
          stroke-width={stroke}
          style:cursor
          class="outline-none focus-visible:stroke-[#ffd200]"
          tabindex={disabled ? -1 : 0}
          role="button"
          aria-label="{label} verschieben (Pfeiltasten)"
          onpointerdown={(event) => startZug(event, griff)}
          onkeydown={(event) => keydownRechteck(event, griff)}
          onkeyup={(event) => event.key.startsWith('Arrow') && commit()}
        />
      {/each}
    {/if}
  </svg>
</div>
