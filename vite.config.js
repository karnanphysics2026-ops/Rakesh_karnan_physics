import { defineConfig } from 'vite';
import { resolve } from 'path';

// Plain static multi-page app — no framework, no JSX. Vite is used purely as
// a dev server (fast reload) and production bundler (minify + cache-busting
// hashed filenames). Output is deployable as-is to Vercel as static files.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        en: resolve(__dirname, 'en/index.html'),
        ta: resolve(__dirname, 'ta/index.html'),
        electrostatics: resolve(__dirname, 'class12/electrostatics/index.html'),
      },
    },
  },
});
