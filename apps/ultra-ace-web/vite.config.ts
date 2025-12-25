import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['localhost', 'nontenurially-backbreaking-olga.ngrok-free.app'],
  },

  resolve: {
    alias: {
      // Use ENGINE SOURCE for dev, but BUILD expects compiled JS
      '@ultra-ace/engine': path.resolve(__dirname, '../../packages/engine/src'),
    },
  },

  build: {
    outDir: 'dist', // 🔴 THIS IS WHAT VERCEL NEEDS
    emptyOutDir: true,
    sourcemap: false,
  },
})
