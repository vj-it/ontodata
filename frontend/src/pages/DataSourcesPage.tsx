import { useState } from 'react'
import { api, type GraphConfig, type VectorStoreConfig } from '../api'
import { Card, Field, StatusLine, useAction } from '../components/ui'
import { useConfigSection } from './useConfig'

const TABS = ['Database', 'Vector store', 'Graph', 'Ontop'] as const

const ENGINES = {
  redshift: { title: 'Amazon Redshift', port: 5439, hostHint: 'Cluster or Serverless workgroup endpoint',
    placeholder: 'my-wg.123456789012.us-east-1.redshift-serverless.amazonaws.com' },
  postgres: { title: 'PostgreSQL (local test)', port: 5432, hostHint: 'Use localhost for the docker-compose Postgres',
    placeholder: 'localhost' },
}

export function DataSourcesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Database')
  return (
    <>
      <h1>Data sources</h1>
      <p className="lead">The database holds the data (Amazon Redshift or PostgreSQL). Ontop serves it as a virtual knowledge graph. A vector store and a graph database (Neo4j or Neptune) are optional.</p>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Database' && <DatabaseForm />}
      {tab === 'Graph' && <GraphForm />}
      {tab === 'Vector store' && <VectorStoreForm />}
      {tab === 'Ontop' && <OntopForm />}
    </>
  )
}

function SaveTest({ save, testUrl, busy, run }: {
  save: () => Promise<unknown>; testUrl?: string; busy: boolean; run: ReturnType<typeof useAction>['run']
}) {
  return (
    <>
      <button disabled={busy} onClick={() => run(save, () => 'Saved')}>Save</button>
      {testUrl && (
        <button className="primary" disabled={busy}
          onClick={() => run(async () => { await save(); return api.post<{ message: string }>(testUrl) }, (r) => r.message)}>
          Save &amp; test
        </button>
      )}
    </>
  )
}

function DatabaseForm() {
  const { value: c, set, save } = useConfigSection('redshift')
  const a = useAction()
  if (!c) return null
  const engine = ENGINES[c.engine]
  return (
    <Card title={engine.title} actions={<SaveTest save={save} testUrl="/api/redshift/test" {...a} />}>
      <div className="grid2">
        <Field label="Engine" hint="PostgreSQL is for local testing; it runs the same pipeline.">
          <select value={c.engine} onChange={(e) => {
            const next = e.target.value as typeof c.engine
            set('engine', next)
            // Swap the port only if it was still the other engine's default.
            if (c.port === engine.port) set('port', ENGINES[next].port)
          }}>
            <option value="redshift">Amazon Redshift</option>
            <option value="postgres">PostgreSQL (local test)</option>
          </select>
        </Field>
        <Field label="Host" hint={engine.hostHint}>
          <input value={c.host} placeholder={engine.placeholder}
            onChange={(e) => set('host', e.target.value)} />
        </Field>
        <Field label="Port"><input type="number" value={c.port} onChange={(e) => set('port', Number(e.target.value))} /></Field>
        <Field label="Default database"><input value={c.database} onChange={(e) => set('database', e.target.value)} /></Field>
        <Field label="User"><input value={c.user} onChange={(e) => set('user', e.target.value)} /></Field>
        <Field label="Password"><input type="password" value={c.password} onChange={(e) => set('password', e.target.value)} /></Field>
        <Field label="SSL">
          <select value={String(c.ssl)} onChange={(e) => set('ssl', e.target.value === 'true')}>
            <option value="true">Required</option><option value="false">Off</option>
          </select>
        </Field>
      </div>
      <StatusLine status={a.status} />
    </Card>
  )
}

const GRAPH_PROVIDERS: Record<GraphConfig['provider'], { title: string; hint: string; publishes: string }> = {
  neo4j: {
    title: 'Neo4j',
    hint: 'Local: docker compose --profile graph up -d neo4j (user neo4j, password ontodata-local; browser UI at http://localhost:7474).',
    publishes: 'Classes become :Class nodes, columns become :Property nodes (HAS_PROPERTY), and relationships become RELATION edges between classes.',
  },
  neptune: {
    title: 'Amazon Neptune',
    hint: 'Uses the AWS default credential chain when IAM auth is on.',
    publishes: 'The ontology (.ttl) is written to a named graph over SPARQL.',
  },
}

function GraphForm() {
  const { value: c, set, save } = useConfigSection('graph')
  const a = useAction()
  if (!c) return null
  const p = GRAPH_PROVIDERS[c.provider]
  return (
    <Card title={`Graph: ${p.title}`}
      actions={<>
        <SaveTest save={save} testUrl="/api/graph/test" {...a} />
        <button disabled={a.busy} onClick={() => a.run(async () => { await save(); return api.post<{ message: string }>('/api/graph/publish') }, (r) => r.message)}>
          Publish ontology
        </button>
      </>}>
      <p className="muted">Optional. Publishes the ontology from the catalog so it can be browsed and reused in a graph database. {p.publishes} Instance data stays in the database and is queried virtually through Ontop.</p>
      <div className="grid2">
        <Field label="Provider" hint={p.hint}>
          <select value={c.provider} onChange={(e) => set('provider', e.target.value as GraphConfig['provider'])}>
            {Object.entries(GRAPH_PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
          </select>
        </Field>

        {c.provider === 'neo4j' && (<>
          <Field label="Bolt URI"><input value={c.neo4jUri} placeholder="bolt://localhost:7687" onChange={(e) => set('neo4jUri', e.target.value)} /></Field>
          <Field label="Database"><input value={c.neo4jDatabase} onChange={(e) => set('neo4jDatabase', e.target.value)} /></Field>
          <Field label="User"><input value={c.neo4jUser} onChange={(e) => set('neo4jUser', e.target.value)} /></Field>
          <Field label="Password"><input type="password" value={c.password} onChange={(e) => set('password', e.target.value)} /></Field>
        </>)}

        {c.provider === 'neptune' && (<>
          <Field label="Cluster endpoint"><input value={c.endpoint} onChange={(e) => set('endpoint', e.target.value)} /></Field>
          <Field label="Port"><input type="number" value={c.port} onChange={(e) => set('port', Number(e.target.value))} /></Field>
          <Field label="Region"><input value={c.region} onChange={(e) => set('region', e.target.value)} /></Field>
          <Field label="IAM auth (SigV4)">
            <select value={String(c.iamAuth)} onChange={(e) => set('iamAuth', e.target.value === 'true')}>
              <option value="true">On</option><option value="false">Off</option>
            </select>
          </Field>
          <Field label="Named graph"><input value={c.namedGraph} onChange={(e) => set('namedGraph', e.target.value)} /></Field>
        </>)}
      </div>
      <StatusLine status={a.status} />
    </Card>
  )
}

const VECTOR_PROVIDERS: Record<VectorStoreConfig['provider'], { title: string; hint: string }> = {
  pgvector: { title: 'pgvector (PostgreSQL)', hint: 'Local: docker compose --profile vectors up -d pgvector (port 5433, user/password ontodata).' },
  s3vectors: { title: 'Amazon S3 Vectors', hint: 'Uses the AWS default credential chain.' },
}

function VectorStoreForm() {
  const { value: c, set, save } = useConfigSection('vectorStore')
  const a = useAction()
  if (!c) return null
  const p = VECTOR_PROVIDERS[c.provider]
  return (
    <Card title={`Vector store: ${p.title}`}
      actions={<>
        <SaveTest save={save} testUrl="/api/vectorstore/test" {...a} />
        <button disabled={a.busy} onClick={() => a.run(async () => { await save(); return api.post<{ message: string }>('/api/vectorstore/sync') }, (r) => r.message)}>
          Index catalog descriptions
        </button>
      </>}>
      <p className="muted">Optional. Table and column descriptions are embedded (with the embedding model on the LLM screen) and stored here. Each question first retrieves the most relevant tables, so large schemas fit in the prompt. Re-index after editing the catalog.</p>
      <div className="grid2">
        <Field label="Provider" hint={p.hint}>
          <select value={c.provider} onChange={(e) => set('provider', e.target.value as VectorStoreConfig['provider'])}>
            {Object.entries(VECTOR_PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
          </select>
        </Field>
        <Field label="Use for questions">
          <select value={String(c.enabled)} onChange={(e) => set('enabled', e.target.value === 'true')}>
            <option value="false">No</option><option value="true">Yes</option>
          </select>
        </Field>
        <Field label={c.provider === 'pgvector' ? 'Table name' : 'Index name'}>
          <input value={c.indexName} onChange={(e) => set('indexName', e.target.value)} />
        </Field>
        <Field label="Top K" hint="How many nearest descriptions to retrieve per question.">
          <input type="number" value={c.topK} onChange={(e) => set('topK', Number(e.target.value))} />
        </Field>

        {c.provider === 's3vectors' && (<>
          <Field label="Region"><input value={c.region} onChange={(e) => set('region', e.target.value)} /></Field>
          <Field label="Vector bucket"><input value={c.bucket} onChange={(e) => set('bucket', e.target.value)} /></Field>
        </>)}

        {c.provider === 'pgvector' && (<>
          <Field label="Host"><input value={c.pgHost} onChange={(e) => set('pgHost', e.target.value)} /></Field>
          <Field label="Port"><input type="number" value={c.pgPort} onChange={(e) => set('pgPort', Number(e.target.value))} /></Field>
          <Field label="Database"><input value={c.pgDatabase} onChange={(e) => set('pgDatabase', e.target.value)} /></Field>
          <Field label="User"><input value={c.pgUser} onChange={(e) => set('pgUser', e.target.value)} /></Field>
          <Field label="Password"><input type="password" value={c.password} onChange={(e) => set('password', e.target.value)} /></Field>
          <Field label="SSL" hint="Required for RDS and Aurora">
            <select value={String(c.pgSsl)} onChange={(e) => set('pgSsl', e.target.value === 'true')}>
              <option value="true">Required</option><option value="false">Off</option>
            </select>
          </Field>
        </>)}

      </div>
      <StatusLine status={a.status} />
    </Card>
  )
}

function OntopForm() {
  const { value: c, set, save } = useConfigSection('ontop')
  const a = useAction()
  if (!c) return null
  return (
    <Card title="Ontop endpoint" actions={<SaveTest save={save} {...a} />}>
      <div className="grid2">
        <Field label="SPARQL endpoint URL" hint="The Ontop container from docker-compose.yml"><input value={c.endpointUrl} onChange={(e) => set('endpointUrl', e.target.value)} /></Field>
        <Field label="Ontology namespace"><input value={c.baseIri} onChange={(e) => set('baseIri', e.target.value)} /></Field>
        <Field label="Instance namespace"><input value={c.dataIri} onChange={(e) => set('dataIri', e.target.value)} /></Field>
      </div>
      <StatusLine status={a.status} />
    </Card>
  )
}
