import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Builds ONLY the admin entry (admin.html) into a SEPARATE output dir (dist-admin), served by the
// admin-web container on admin.zoci.me. Kept out of the public site's `dist` (the default build
// uses index.html only) so no admin UI code ever reaches the public zoci.me bundle.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-admin',
    rollupOptions: {
      input: resolve(__dirname, 'admin.html'),
    },
  },
});
