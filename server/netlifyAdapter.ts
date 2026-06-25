import type { IncomingMessage, ServerResponse } from 'node:http'

type NetlifyEvent = {
  httpMethod: string
  queryStringParameters?: Record<string, string | undefined> | null
}

type NetlifyResult = {
  statusCode: number
  headers?: Record<string, string>
  body: string
}

function toQueryUrl(event: NetlifyEvent): string {
  const params = event.queryStringParameters ?? {}
  const qs = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      qs.set(key, value)
    }
  }

  const query = qs.toString()
  return query ? `/?${query}` : '/'
}

export function createProxyHandler(
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  errorMessage: string,
) {
  return async (event: NetlifyEvent): Promise<NetlifyResult> => {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' }
    }

    try {
      return await new Promise<NetlifyResult>((resolve) => {
        const req = { url: toQueryUrl(event) } as IncomingMessage
        const res = {
          statusCode: 200,
          headers: {} as Record<string, string>,
          setHeader(name: string, value: string) {
            this.headers[name] = value
          },
          end(body: string) {
            resolve({
              statusCode: this.statusCode,
              headers: this.headers,
              body,
            })
          },
        } as unknown as ServerResponse

        void handle(req, res)
      })
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: errorMessage }),
      }
    }
  }
}
