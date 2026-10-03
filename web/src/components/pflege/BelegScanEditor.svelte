<script lang="ts">
  import type { Point, Quad } from '../../lib/belegScan';

  interface Props {
    /** URL of the original photo. */
    src: string;
    width: number;
    height: number;
    quad: Quad;
    disabled?: boolean;
    /** Called with the new corners when a corner has been moved. */
    onchange: (quad: Quad) => void;
  }

  let { src, width, height, quad, disabled = false, onchange }: Props = $props();

  const LABELS = ['oben links', 'oben rechts', 'unten rechts', 'unten links'];

  let svg = $state<SVGSVGElement | null>(null);
  /** Corners while dragging; reset to the committed corners afterwards. */
  let draft = $state<Quad | null>(null);
  let dragging = $state<number | null>(null);

  const shown = $derived(draft ?? quad);
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

  function commit(): void {
    if (draft) onchange(draft);
    draft = null;
    dragging = null;
  }

  function start(event: PointerEvent, index: number): void {
    if (disabled) return;
    event.preventDefault();
    svg?.setPointerCapture(event.pointerId);
    dragging = index;
  }

  function keydown(event: KeyboardEvent, index: number): void {
    if (disabled) return;
    const step = Math.max(width, height) / (event.shiftKey ? 20 : 100);
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    const corner = shown[index];
    move(index, {
      x: Math.min(width, Math.max(0, corner.x + d.x)),
      y: Math.min(height, Math.max(0, corner.y + d.y)),
    });
  }
</script>

<div class="relative inline-block max-w-full">
  <img
    {src}
    alt="Originalfoto mit dem erkannten Beleg"
    {width}
    {height}
    class="block h-auto max-h-96 w-auto max-w-full rounded-md border border-neutral-200 bg-neutral-100"
  />
  <svg
    bind:this={svg}
    viewBox="0 0 {width} {height}"
    preserveAspectRatio="none"
    class="absolute inset-0 h-full w-full touch-none select-none"
    role="group"
    aria-label="Ecken des Belegs"
    onpointermove={(event) => dragging !== null && move(dragging, toImage(event))}
    onpointerup={commit}
    onpointercancel={commit}
  >
    <path
      d="M0 0H{width}V{height}H0Z M{shown.map((p) => `${p.x} ${p.y}`).join('L')}Z"
      fill="rgb(0 0 0 / 0.45)"
      fill-rule="evenodd"
    />
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
  </svg>
</div>
