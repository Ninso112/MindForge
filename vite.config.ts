// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'esnext',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false
  }
});
