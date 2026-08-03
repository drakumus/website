import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Builds ONLY the finance entry (finance.html) into a SEPARATE output dir (dist-finance), served by
// the finance-web container on finance.zoci.me. Kept out of the public site's `dist` so no finance
// UI code ever reaches the public zoci.me bundle. Mirrors vite.admin.config.ts.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-finance',
    rollupOptions: {
      input: resolve(__dirname, 'finance.html'),
    },
  },
});
