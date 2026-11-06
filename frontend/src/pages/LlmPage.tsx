import { useState } from 'react'
import { api, type LlmConfig } from '../api'
import { Card, Field, StatusLine, useAction } from '../components/ui'
import { useConfigSection } from './useConfig'

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']

const DEFAULT_MODEL: Record<LlmConfig['provider'], string> = {
  anthropic: 'claude-opus-5-5',
  bedrock: 'anthropic.claude-opus-5-5',
  openai: '',
}

const EMBEDDING_DEFAULTS: Record<LlmConfig['embeddingProvider'], { model: string; dimension: number }> = {
  bedrock: { model: 'amazon.titan-embed-text-v2:0', dimension: 1024 },
  openai: { model: 'text-embedding-3-small', dimension: 1536 },
}

export function LlmPage() {
  const { value: c, set, save } = useConfigSection('llm')
  const [models, setModels] = useState<string[]>([])
  const { busy, status, run } = useAction()
  if (!c) return <p className="muted">Loading…</p>

  const loadModels = () =>
    run(async () => {
      await save()
      const ids = await api.get<string[]>('/api/llm/models')
      setModels(ids)
      return ids.length
    }, (n) => `Loaded ${n} models`)

  const suggestions = models.length ? models : c.provider === 'anthropic' ? CLAUDE_MODELS : c.provider === 'bedrock' ? CLAUDE_MODELS.map((m) => `anthropic.${m}`) : []
  const usesAws = c.provider === 'bedrock' || c.embeddingProvider === 'bedrock'
  const usesOpenAI = c.provider === 'openai' || c.embeddingProvider === 'openai'

  return (
    <>
      <h1>LLM configuration</h1>
      <p className="lead">The model that turns questions into SPARQL, drafts table descriptions and writes insights.</p>
      <Card
        title="Model"
        actions={
          <>
            <button disabled={busy} onClick={() => run(save, () => 'Saved')}>Save</button>
            <button className="primary" disabled={busy || !c.model}
              onClick={() => run(async () => { await save(); return api.post<{ message: string }>('/api/llm/test') }, (r) => r.message)}>
              Save &amp; test
            </button>
          </>
        }
      >
        <div className="grid2">
          <Field label="Provider">
            <select value={c.provider} onChange={(e) => {
              const p = e.target.value as LlmConfig['provider']
              set('provider', p)
              set('model', DEFAULT_MODEL[p])
              setModels([])
            }}>
              <option value="anthropic">Anthropic API</option>
              <option value="bedrock">Amazon Bedrock</option>
              <option value="openai">OpenAI</option>
            </select>
          </Field>
          <Field label="Model"
            hint={c.provider === 'bedrock' ? 'Bedrock model IDs take an "anthropic." prefix.'
              : c.provider === 'openai' && !c.model ? 'Enter your API key, then Load models to pick one.' : undefined}>
            <div className="row">
              <input list="models" value={c.model} onChange={(e) => set('model', e.target.value)} />
              {c.provider !== 'bedrock' && <button disabled={busy} onClick={loadModels}>Load models</button>}
            </div>
            <datalist id="models">
              {suggestions.map((m) => <option key={m} value={m} />)}
            </datalist>
          </Field>
          {c.provider === 'anthropic' && (
            <Field label="Anthropic API key" hint="Leave empty to use ANTHROPIC_API_KEY from the server environment.">
              <input type="password" value={c.apiKey ?? ''} onChange={(e) => set('apiKey', e.target.value)} />
            </Field>
          )}
          <Field label="Effort" hint={c.provider === 'openai'
            ? 'Sent as reasoning_effort; ignored for models without reasoning.'
            : 'Higher effort writes better SPARQL for complex questions but is slower.'}>
            <select value={c.effort} onChange={(e) => set('effort', e.target.value as typeof c.effort)}>
              {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Embeddings (for vector store schema search)">
        <div className="grid2">
          <Field label="Embedding provider">
            <select value={c.embeddingProvider} onChange={(e) => {
              const p = e.target.value as LlmConfig['embeddingProvider']
              set('embeddingProvider', p)
              set('embeddingModel', EMBEDDING_DEFAULTS[p].model)
              set('embeddingDimension', EMBEDDING_DEFAULTS[p].dimension)
            }}>
              <option value="bedrock">Amazon Bedrock</option>
              <option value="openai">OpenAI</option>
            </select>
          </Field>
          <Field label="Embedding model">
            <input value={c.embeddingModel} onChange={(e) => set('embeddingModel', e.target.value)} />
          </Field>
          <Field label="Dimension" hint="Must match the vector store index. Changing it needs a new index name.">
            <input type="number" value={c.embeddingDimension} onChange={(e) => set('embeddingDimension', Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      {(usesOpenAI || usesAws) && (
        <Card title="Credentials">
          <div className="grid2">
            {usesOpenAI && (
              <>
                <Field label="OpenAI API key" hint="Leave empty to use OPENAI_API_KEY from the server environment.">
                  <input type="password" value={c.openaiApiKey ?? ''} onChange={(e) => set('openaiApiKey', e.target.value)} />
                </Field>
                <Field label="OpenAI base URL (optional)" hint="For Azure OpenAI or another OpenAI-compatible endpoint.">
                  <input value={c.openaiBaseUrl ?? ''} placeholder="https://api.openai.com/v1" onChange={(e) => set('openaiBaseUrl', e.target.value)} />
                </Field>
              </>
            )}
            {usesAws && (
              <Field label="AWS region" hint="For Bedrock. Credentials come from the AWS default chain.">
                <input value={c.region ?? ''} onChange={(e) => set('region', e.target.value)} />
              </Field>
            )}
          </div>
        </Card>
      )}
      <StatusLine status={status} />
    </>
  )
}
