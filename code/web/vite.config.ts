import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Puerto fijo: si está ocupado, falla en lugar de cambiarse en silencio.
    port: 5173,
    strictPort: true,
    // El front se conecta a /ws en su mismo host; Vite lo reenvía al servidor ws.
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
