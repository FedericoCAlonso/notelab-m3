import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'notelab-m3';
  const base =
    process.env.VITE_BASE_PATH ??
    (mode === 'production' ? `/${repoName}/` : '/');

  const buildId = new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z';

  return {
    base,
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.svg',
          'icons/icon-192.png',
          'icons/icon-512.png',
          'icons/icon-maskable-512.png',
        ],
        manifest: {
          name: 'NoteLab M3 — Apuntes Técnicos & Jupyter',
          short_name: 'NoteLab M3',
          description:
            'Cliente PWA ultrarrápido con Material Design 3 para tomar apuntes técnicos y ejecutar Python en Jupyter Server (Termux).',
          theme_color: '#1b1b1f',
          background_color: '#131316',
          display: 'standalone',
          orientation: 'any',
          scope: base,
          start_url: base,
          categories: ['education', 'productivity', 'utilities'],
          icons: [
            {
              src: 'icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
            },
          ],
        },
        workbox: {
          globPatterns: [
            '**/*.{js,css,html,svg,png,ico,woff,woff2,ttf,json}',
          ],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ request }) =>
                request.destination === 'font' ||
                request.destination === 'style' ||
                request.destination === 'script' ||
                request.destination === 'image',
              handler: 'CacheFirst',
              options: {
                cacheName: 'notelab-static-cache-v1',
                expiration: {
                  maxEntries: 120,
                  maxAgeSeconds: 60 * 60 * 24 * 90,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ],
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'codemirror-vendor': [
              '@uiw/react-codemirror',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/view',
              '@codemirror/state',
            ],
            'markdown-math': [
              'react-markdown',
              'remark-gfm',
              'remark-math',
              'rehype-katex',
              'katex',
            ],
            'math-vendor': ['mathjs'],
          },
        },
      },
    },
  };
});
