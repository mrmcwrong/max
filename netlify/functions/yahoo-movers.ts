import { handleMovers } from '../../server/yahooProxy.js'
import { createProxyHandler } from '../../server/netlifyAdapter.js'

export const handler = createProxyHandler(handleMovers, 'Yahoo movers proxy failed')
