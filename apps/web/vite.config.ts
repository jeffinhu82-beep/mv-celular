import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');
  const apiTarget = env.VITE_API_TARGET ?? `http://127.0.0.1:${env.API_PORT ?? 3390}`;
  return {
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Loja e Assistência',
          short_name: 'Loja',
          description: 'Caixa, vendas e ordens de serviço',
          lang: 'pt-BR',
          start_url: '/',
          display: 'standalone',
          background_color: '#110e0e',
          theme_color: '#110e0e',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
          runtimeCaching: [],
        },
      }),
    ],
    server: {
      host: '127.0.0.1',
      port: Number(env.WEB_PORT ?? 5190),
      strictPort: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false },
        '/uploads': { target: apiTarget, changeOrigin: false },
      },
    },
    preview: { host: '127.0.0.1', port: Number(env.WEB_PORT ?? 5190) },
  };
});
