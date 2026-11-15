import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = `http://127.0.0.1:${process.env.PORT || 4477}`;
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5177,
    fs: { allow: ['..'] },        // the page shares a few files with the server (the shared folder)
    proxy: {
      '/api': target, '/files': target, '/download': target,
      '/ws': { target, ws: true }, '/rtc': { target, ws: true },
    },
  },
});
