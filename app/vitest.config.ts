import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest reuses the app's React transform (the same @vitejs/plugin-react the dev/build use) and
// runs in jsdom so Mantine/React components render. Tests live under test/ (not src/) so the
// production `tsc -b && vite build` never typechecks or bundles them.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
