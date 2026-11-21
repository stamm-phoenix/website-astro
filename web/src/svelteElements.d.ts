// The native switch (`<input type="checkbox" switch>`) is not in Svelte's element types yet.
declare module 'svelte/elements' {
  interface HTMLInputAttributes {
    switch?: boolean | null;
  }
}

export {};
