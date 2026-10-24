import { defineConfig } from 'vite';
export default defineConfig({ build: { chunkSizeWarningLimit: 850 }, optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1' } });
