import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 設定
// Railway での preview / dev に対応するためポートとホストを設定
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true,
  },
});
