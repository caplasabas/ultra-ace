import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],

  server: {
    host: '0.0.0.0',
    port: 5176,
    allowedHosts: [
      'localhost',
      '.browserstack.com',
      '.ngrok-free.app',
      'nontenurially-backbreaking-olga.ngrok-free.app',
    ],
  },
  resolve: {
    alias: {
      '@ultra-ace/engine': path.resolve(__dirname, '../../packages/engine/src'),
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
})
