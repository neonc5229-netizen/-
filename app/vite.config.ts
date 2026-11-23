import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '日语阅读学习',
        short_name: '读日语',
        description: '逐句分析小说文本的日语学习应用',
        lang: 'zh-CN',
        display: 'standalone',
        start_url: './',
        scope: './',
        background_color: '#f7f4ee',
        theme_color: '#f7f4ee',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        globIgnores: ['kuromoji/**'],
        navigateFallbackDenylist: [/^\/kuromoji\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/kuromoji/'),
            handler: 'CacheFirst',
            options: { cacheName: 'kuromoji', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
})
