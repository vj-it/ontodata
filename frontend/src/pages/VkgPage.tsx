import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import { api, type Catalog } from '../api'
import { Card, StatusLine, useAction } from '../components/ui'
import { useEngineName } from './useConfig'

interface VkgState {
  vkg: { generatedAt: string; ontologyTtl: string; mappingObda: string; deployedAt?: string } | null
  status: { up: boolean; detail: string }
}

export function VkgPage() {
  const [state, setState] = useState<VkgState | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [ttl, setTtl] = useState('')
  const [obda, setObda] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [view, setView] = useState<'graph' | 'ontology' | 'mapping'>('graph')
  const [showProps, setShowProps] = useState(false)
  const [restart, setRestart] = useState(true)
  const a = useAction()
  const engine = useEngineName()

  const load = async () => {
    const [s, c] = await Promise.all([api.get<VkgState>('/api/vkg'), api.get<Catalog>('/api/catalog')])
    setState(s)
    setCatalog(c)
    setTtl(s.vkg?.ontologyTtl ?? '')
    setObda(s.vkg?.mappingObda ?? '')
  }
  useEffect(() => { load() }, [])

  const generate = () => a.run(async () => {
    const r = await api.post<{ ontologyTtl: string; mappingObda: string; warnings: string[] }>('/api/vkg/generate')
    setWarnings(r.warnings)
    await load()
    return r
  }, (r) => `Generated ${r.warnings.length ? `with ${r.warnings.length} warning(s)` : 'cleanly'}. Review, then deploy to Ontop.`)

  const saveEdits = () => a.run(() => api.put('/api/vkg', { ontologyTtl: ttl, mappingObda: obda }), () => 'Edits saved')

  const deploy = () => a.run(async () => {
    await api.put('/api/vkg', { ontologyTtl: ttl, mappingObda: obda })
    const r = await api.post<{ message: string }>('/api/vkg/deploy', { restart })
    await load()
    return r
  }, (r) => r.message)

  const dirty = state?.vkg && (ttl !== state.vkg.ontologyTtl || obda !== state.vkg.mappingObda)

  return (
    <>
      <h1>Virtual knowledge graph</h1>
      <p className="lead">The catalog becomes an OWL ontology plus Ontop mappings. Ontop answers SPARQL by rewriting it to {engine} SQL, so no data is copied.</p>
      <div className="row status-bar">
        <span className={`dot ${state?.status.up ? 'up' : 'down'}`} />
        <span>{state?.status.up ? 'Ontop is running' : `Ontop not reachable: ${state?.status.detail ?? '…'}`}</span>
        {state?.vkg && <span className="muted">Generated {new Date(state.vkg.generatedAt).toLocaleString()}</span>}
        {state?.vkg?.deployedAt && <span className="muted">Deployed {new Date(state.vkg.deployedAt).toLocaleString()}</span>}
      </div>
      <Card
        actions={<>
          <button disabled={a.busy} onClick={generate}>{state?.vkg ? 'Regenerate from catalog' : 'Generate from catalog'}</button>
          {dirty && <button disabled={a.busy} onClick={saveEdits}>Save edits</button>}
          <label className="row"><input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} /> restart Ontop</label>
          <button className="primary" disabled={a.busy || !state?.vkg} onClick={deploy}>Deploy to Ontop</button>
        </>}
      >
        <StatusLine status={a.status} />
        {warnings.length > 0 && <ul className="warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <div className="tabs">
          {(['graph', 'ontology', 'mapping'] as const).map((v) => (
            <button key={v} className={v === view ? 'tab active' : 'tab'} onClick={() => setView(v)}>
              {v === 'graph' ? 'Graph' : v === 'ontology' ? 'Ontology (.ttl)' : 'Mapping (.obda)'}
            </button>
          ))}
          {view === 'graph' && (
            <label className="row push"><input type="checkbox" checked={showProps} onChange={(e) => setShowProps(e.target.checked)} /> show data properties</label>
          )}
        </div>
        {view === 'graph' && catalog && <Graph catalog={catalog} showProps={showProps} />}
        {view === 'ontology' && <textarea className="code" spellCheck={false} value={ttl} onChange={(e) => setTtl(e.target.value)} />}
        {view === 'mapping' && <textarea className="code" spellCheck={false} value={obda} onChange={(e) => setObda(e.target.value)} />}
      </Card>
    </>
  )
}

function Graph({ catalog, showProps }: { catalog: Catalog; showProps: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const els: cytoscape.ElementDefinition[] = []
    const id = (s: string, n: string) => `${s}.${n}`
    for (const t of catalog.tables) {
      els.push({ data: { id: id(t.schema, t.name), label: t.className }, classes: 'cls' })
      if (showProps) {
        for (const c of t.columns.filter((c) => c.include)) {
          const pid = `${id(t.schema, t.name)}#${c.name}`
          els.push({ data: { id: pid, label: c.propertyName }, classes: 'prop' })
          els.push({ data: { source: id(t.schema, t.name), target: pid } , classes: 'propedge' })
        }
      }
      for (const r of t.relations) {
        const target = id(r.toSchema, r.toTable)
        if (catalog.tables.some((x) => id(x.schema, x.name) === target)) {
          els.push({ data: { source: id(t.schema, t.name), target, label: r.name }, classes: 'rel' })
        }
      }
    }
    const css = getComputedStyle(document.documentElement)
    const color = (v: string) => css.getPropertyValue(v).trim()
    const cy = cytoscape({
      container: ref.current,
      elements: els,
      layout: { name: 'cose', animate: false, padding: 40, nodeRepulsion: () => 400000, idealEdgeLength: () => (showProps ? 60 : 160), randomize: true },
      style: [
        { selector: 'node.cls', style: { label: 'data(label)', 'background-color': color('--accent'), color: color('--fg'), 'text-valign': 'bottom', 'text-margin-y': 6, 'font-size': 13, width: 34, height: 34 } },
        { selector: 'node.prop', style: { label: 'data(label)', 'background-color': color('--muted'), color: color('--muted'), 'font-size': 10, width: 10, height: 10, 'text-valign': 'bottom' } },
        { selector: 'edge.rel', style: { label: 'data(label)', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', width: 2, 'line-color': color('--accent-2'), 'target-arrow-color': color('--accent-2'), color: color('--fg'), 'font-size': 10, 'text-rotation': 'autorotate', 'text-margin-y': -8, 'text-background-color': color('--card'), 'text-background-opacity': 1 } },
        { selector: 'edge.propedge', style: { width: 1, 'line-color': color('--border') } },
      ],
    })
    return () => cy.destroy()
  }, [catalog, showProps])

  if (!catalog.tables.length) return <p className="muted">The catalog is empty. Add tables on the Catalog screen.</p>
  return <div ref={ref} className="graph" />
}
