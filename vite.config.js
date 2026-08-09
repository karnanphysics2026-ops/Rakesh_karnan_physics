import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        en: resolve(__dirname, 'en/index.html'),
        ta: resolve(__dirname, 'ta/index.html'),
        electrostatics: resolve(__dirname, 'class12/electrostatics/index.html'),
        admin: resolve(__dirname, 'admin/index.html')
      }
    }
  }
});
