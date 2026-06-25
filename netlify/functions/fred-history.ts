import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleFredHistory } from '../../server/fredProxy.js'
import { createProxyHandler } from '../../server/netlifyAdapter.js'

export const handler = createProxyHandler(handleFredHistory, 'FRED history proxy failed')
