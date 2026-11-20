<script lang="ts">
  /** A thin native progress bar whose fill takes a colour, e.g. that of a team. */
  interface Props {
    value: number;
    max: number;
    label: string;
    color: string;
    class?: string;
  }
  let { value, max, label, color, class: className = '' }: Props = $props();
</script>

<progress
  class="fortschritt block h-1.5 w-full {className}"
  {value}
  {max}
  aria-label={label}
  style:--fortschritt-farbe={color}
></progress>

<style>
  .fortschritt {
    appearance: none;
    border: 0 solid;
    overflow: clip;
    background: var(--color-neutral-200);
  }
  .fortschritt::-webkit-progress-bar {
    background: transparent;
  }
  .fortschritt::-webkit-progress-value {
    background: var(--fortschritt-farbe);
    transition: inline-size var(--motion-quick);
  }
  .fortschritt::-moz-progress-bar {
    background: var(--fortschritt-farbe);
  }
</style>
