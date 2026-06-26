import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handleFredHistory } from './server/fredProxy.js'
import { handleFredBundle } from './server/fredBundle.js'
import { handleMarketBundle } from './server/marketBundle.js'
import { handleMovers, handleNewsFeed, handleYahooChart } from './server/yahooProxy.js'

function marketApiPlugin(): Plugin {
  const attachRoutes = (server: { middlewares: { use: Function } }) => {
    server.middlewares.use('/api/yahoo/chart', (req: any, res: any, next: () => void) => {
      if (req.method !== 'GET') {
        next()
        return
      }

      void handleYahooChart(req, res).catch(() => {
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'Yahoo chart proxy failed' }))
      })
    })

    server.middlewares.use('/api/yahoo/movers', (req: any, res: any, next: () => void) => {
      if (req.method !== 'GET') {
        next()
        return
      }

      void handleMovers(req, res).catch(() => {
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'Movers proxy failed' }))
      })
    })

    server.middlewares.use('/api/news', (req: any, res: any, next: () => void) => {
      if (req.method !== 'GET') {
        next()
        return
      }

      void handleNewsFeed(req, res).catch(() => {
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'News feed proxy failed' }))
      })
    })

    server.middlewares.use('/api/fred/history', (req: any, res: any, next: () => void) => {
      if (req.method !== 'GET') {
        next()
        return
      }

      void handleFredHistory(req, res).catch(() => {
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'FRED history proxy failed' }))
      })
    })

    server.middlewares.use('/api/fred/bundle', (req: any, res: any, next: () => void) => {
      if (req.method !== 'POST') {
        next()
        return
      }

      void handleFredBundle(req, res).catch(() => {
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'FRED bundle failed' }))
      })
    })

    server.middlewares.use('/api/markets/bundle', (req: any, res: any, next: () => void) => {
      if (req.method !== 'POST') {
        next()
        return
      }

      void handleMarketBundle(req, res).catch(() => {
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'Market bundle failed' }))
      })
    })
  }

  return {
    name: 'market-api',
    configureServer: attachRoutes,
    configurePreviewServer: attachRoutes,
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), marketApiPlugin()],
})
