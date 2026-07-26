import { createTheme, type MantineColorsTuple } from '@mantine/core';
import type { CSSProperties } from 'react';

// Shared panel look: a solid-ish dark fill with a subtle gold-trim outline and a soft
// shadow. Used for the portfolio identity/bio panel and the landing server dashboard.
export const panelStyle: CSSProperties = {
  background: 'rgba(22, 23, 27, 0.92)',
  border: '1px solid rgba(196, 160, 84, 0.28)',
  boxShadow: '0 10px 30px -16px rgba(0, 0, 0, 0.75)',
};

// Maroon / red — the interactive accent (links, buttons, badges, icons, hero name).
// White (headings/body) and the gold border trim carry the rest; the base stays
// neutral black/dark-gray so red reads as an accent, not the whole theme.
const maroon: MantineColorsTuple = [
  '#ffe9e9',
  '#ffd3d3',
  '#f4a3a3',
  '#ec7474',
  '#e44d4d',
  '#dc3535',
  '#c62828',
  '#9e1f1f',
  '#791818',
  '#531010',
];

export const theme = createTheme({
  colors: { maroon },
  primaryColor: 'maroon',
  primaryShade: { light: 6, dark: 6 },
  defaultRadius: 'md',
  fontFamily:
    '"Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
  // Headings share the Open Sans body font (inherits theme.fontFamily).
  headings: {
    fontWeight: '700',
    sizes: {
      h1: { fontSize: 'clamp(2.5rem, 8vw, 4.5rem)', lineHeight: '1.05' },
    },
  },
});
