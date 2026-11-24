import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Сборка в один IIFE-скрипт + один CSS для публикации одной HTML-страницей (см. scripts/make-artifact.mjs)
const empty = fileURLToPath(new URL('./scripts/empty.css', import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@fontsource-variable/inter': empty, '@fontsource-variable/exo-2': empty } },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-artifact', emptyOutDir: true, cssCodeSplit: false,
    lib: { entry: 'src/main.tsx', formats: ['iife'], name: 'ODQ', fileName: () => 'app.js', cssFileName: 'app' },
  },
});
