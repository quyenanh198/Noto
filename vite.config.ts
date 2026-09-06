import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Set VITE_BASE_PATH (e.g. `/Noto/`) when the app is served from a sub-path such as GitHub Pages.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
