import { handleYahooChart } from '../../server/yahooProxy.js'
import { createProxyHandler } from '../../server/netlifyAdapter.js'

export const handler = createProxyHandler(handleYahooChart, 'Yahoo chart proxy failed')
