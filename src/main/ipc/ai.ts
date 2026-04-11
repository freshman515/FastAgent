import { ipcMain, net } from 'electron'

interface ChatOptions {
  baseUrl: string
  apiKey: string
  model: string
  provider: string
  messages: Array<{ role: string; content: string }>
  maxTokens?: number
}

function electronFetch(url: string, options: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: options.method })
    for (const [k, v] of Object.entries(options.headers)) {
      req.setHeader(k, v)
    }
    let responseData = ''
    req.on('response', (response) => {
      response.on('data', (chunk) => { responseData += chunk.toString() })
      response.on('end', () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          text: async () => responseData,
        })
      })
    })
    req.on('error', reject)
    req.write(options.body)
    req.end()
  })
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:chat', async (_event, options: ChatOptions) => {
    const { baseUrl, apiKey, model, provider, messages, maxTokens = 1024 } = options

    try {
      if (provider === 'anthropic') {
        const res = await electronFetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system: messages.find((m) => m.role === 'system')?.content ?? '',
            messages: messages.filter((m) => m.role !== 'system'),
          }),
        })
        const text = await res.text()
        if (!res.ok) return { content: '', error: `API error ${res.status}: ${text}` }
        const data = JSON.parse(text)
        return {
          content: data.content?.[0]?.text ?? '',
          tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        }
      }

      // OpenAI-compatible (OpenAI, MiniMax, local models, etc.)
      const res = await electronFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
      })
      const text = await res.text()
      if (!res.ok) return { content: '', error: `API error ${res.status}: ${text}` }
      const data = JSON.parse(text)
      return {
        content: data.choices?.[0]?.message?.content ?? '',
        tokens: data.usage?.total_tokens,
      }
    } catch (err) {
      return { content: '', error: err instanceof Error ? err.message : String(err) }
    }
  })
}
