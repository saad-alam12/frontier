import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: { index: resolve(__dirname, 'backend/main.ts') } },
      rollupOptions: { output: { format: 'es' } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: { index: resolve(__dirname, 'backend/api/preload.ts') } },
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'ui'),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'ui/index.html') },
    },
  },
});
