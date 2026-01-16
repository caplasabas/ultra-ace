import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

function arcadeInputPlugin() {
  return {
    name: 'arcade-input-plugin',

    configureServer(server) {
      server.middlewares.use('/input', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        let body = ''

        req.on('data', chunk => {
          body += chunk
        })

        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}')

            console.log('[ARCADE INPUT]', payload)

            /**
             * IMPORTANT:
             * Vite HMR reliably transports STRINGS only.
             * Always stringify payloads.
             */
            server.ws.send({
              type: 'custom',
              event: 'arcade-input',
              data: JSON.stringify(payload),
            })

            res.statusCode = 200
            res.end('OK')
          } catch (err) {
            console.error('[ARCADE INPUT] Invalid JSON:', body)
            res.statusCode = 400
            res.end('Invalid JSON')
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), arcadeInputPlugin()],

  server: {
    host: '0.0.0.0',

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
