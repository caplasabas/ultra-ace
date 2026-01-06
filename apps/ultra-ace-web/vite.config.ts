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
          res.end()
          return
        }

        let body = ''
        req.on('data', chunk => (body += chunk))
        req.on('end', () => {
          try {
            const { action } = JSON.parse(body || '{}')

            console.log('[ARCADE INPUT]', action)

            // Send event to the browser via Vite HMR WS
            server.ws.send({
              type: 'custom',
              event: 'arcade-input',
              data: action,
            })

            res.statusCode = 200
            res.end('OK')
          } catch {
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
      ,
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
