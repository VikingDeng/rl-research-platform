import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const base = (env.VITE_BASE || '/').trim() || '/';
    return {
      base,
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api/v1': {
            target: 'http://127.0.0.1:8000',
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      build: {
        chunkSizeWarningLimit: 700,
        rollupOptions: {
          output: {
            manualChunks: (id) => {
              if (!id.includes('node_modules')) return;
              if (id.includes('/recharts/') || id.includes('/d3-')) {
                return 'vendor-viz';
              }
              if (id.includes('/lucide-react/')) {
                return 'vendor-ui';
              }
              if (id.includes('/@openai/')) {
                return 'vendor-ai';
              }
              return;
            },
          },
        },
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
