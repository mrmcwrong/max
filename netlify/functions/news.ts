import { handleNewsFeed } from '../../server/yahooProxy.js'
import { createProxyHandler } from '../../server/netlifyAdapter.js'

export const handler = createProxyHandler(handleNewsFeed, 'News feed proxy failed')
