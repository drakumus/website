import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on :3000 (loopback). `/api` proxies to the Fastify dev server, stripping the
// `/api` prefix to mirror prod Caddy's `handle_path /api/*`.
//
// The dev API runs on :8001 (see api/package.json), NOT :8000, because the production
// stack runs on this same box and its api container already holds :8000. Keeping dev on a
// separate port lets `npm run dev` hot-reload the API alongside the live containers.
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind all interfaces: this box is headless, so dev is previewed from other LAN
    // devices (e.g. http://<your-lan-ip>:3000). LAN-only — never internet-facing.
    host: true,
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
