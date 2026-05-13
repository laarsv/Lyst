import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'lyst',
        short_name: 'lyst',
        description: 'Listen, Rezepte und Notizen — minimal und schnell.',
        theme_color: '#00c896',
        background_color: '#f5f5f0',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/logo.png', sizes: 'any', type: 'image/png' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Override via BACKEND_PROXY_TARGET when running vite inside docker
      // (e.g. via docker-compose.dev.yml) so the proxy reaches the
      // sibling `backend` service. Falls back to localhost for the
      // host-side `npm run dev` workflow.
      '/api': {
        target: process.env.BACKEND_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
