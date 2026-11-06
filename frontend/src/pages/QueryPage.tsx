import { useEffect, useState } from 'react'
import { api, type PipelineStep, type QueryRun } from '../api'
import { Card, ResultTable, StatusLine, useAction } from '../components/ui'
import { Chart } from '../components/Chart'
import { useEngineName } from './useConfig'

type HistoryItem = Omit<QueryRun, 'rows'> & { rowCount: number }

const stages = (engine: string) => [
  { key: 'sparql', label: 'NL → SPARQL' },
  { key: 'sql', label: 'SPARQL → SQL' },
  { key: 'execute', label: `Run on ${engine}` },
  { key: 'insights', label: 'Insights' },
]

export function QueryPage() {
  const engine = useEngineName()
  const [question, setQuestion] = useState('')
  const [sparql, setSparql] = useState('')
  const [run, setRun] = useState<QueryRun | null>(null)
  const [steps, setSteps] = useState<PipelineStep[]>([])
  const [tab, setTab] = useState<'results' | 'sparql' | 'sql'>('results')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const a = useAction()

  const loadHistory = () => api.get<HistoryItem[]>('/api/query/history').then(setHistory)
  useEffect(() => { loadHistory() }, [])

  const ask = (q = question, withSparql?: string) => a.run(async () => {
    setQuestion(q)
    setRun(null)
    setSteps([])
    const r = await api.post<{ run: QueryRun; steps: PipelineStep[] }>('/api/query/run', { question: q, sparql: withSparql })
    setRun(r.run)
    setSparql(r.run.sparql)
    setSteps(r.steps)
    setTab('results')
    loadHistory()
    if (r.run.error) throw new Error(r.run.error)
  })

  const draft = () => a.run(async () => {
    const r = await api.post<{ sparql: string; steps: PipelineStep[] }>('/api/query/sparql', { question })
    setSparql(r.sparql)
    setSteps(r.steps)
    setTab('sparql')
  }, () => 'SPARQL drafted. Edit it if needed, then Run SPARQL.')

  const done = new Set(steps.filter((s) => s.ok).map((s) => s.step))

  return (
    <>
      <h1>Ask</h1>
      <p className="lead">Ask a business question. It is translated to SPARQL over the ontology, rewritten by Ontop into {engine} SQL, executed, and summarised.</p>
      <Card>
        <textarea rows={2} value={question} placeholder="e.g. Which 10 customers had the highest order value last quarter?"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && question.trim()) ask() }} />
        <div className="row">
          <button className="primary" disabled={a.busy || !question.trim()} onClick={() => ask()}>Ask</button>
          <button disabled={a.busy || !question.trim()} onClick={draft}>Draft SPARQL only</button>
          {sparql && <button disabled={a.busy} onClick={() => ask(question, sparql)}>Run SPARQL</button>}
          <span className="muted">Ctrl+Enter to ask</span>
        </div>
        <ol className="pipeline">
          {stages(engine).map((s) => <li key={s.key} className={done.has(s.key) ? 'done' : ''}>{s.label}</li>)}
        </ol>
        {steps.filter((s) => !s.ok || s.step === 'retrieve').map((s, i) => (
          <div key={i} className={`status ${s.ok ? 'info' : 'error'}`}>{s.detail}</div>
        ))}
        <StatusLine status={a.status} />
      </Card>

      {run?.insights && (
        <Card title="Insights">
          <p>{run.insights.summary}</p>
          {run.insights.keyFindings.length > 0 && <ul>{run.insights.keyFindings.map((f) => <li key={f}>{f}</li>)}</ul>}
          <Chart spec={run.insights.chart} rows={run.rows} />
          {run.insights.followUps.length > 0 && (
            <div className="row wrap">
              {run.insights.followUps.map((f) => <button key={f} className="chip" disabled={a.busy} onClick={() => ask(f)}>{f}</button>)}
            </div>
          )}
        </Card>
      )}

      {(run || sparql) && (
        <Card>
          <div className="tabs">
            <button className={tab === 'results' ? 'tab active' : 'tab'} onClick={() => setTab('results')}>Results {run ? `(${run.rows.length})` : ''}</button>
            <button className={tab === 'sparql' ? 'tab active' : 'tab'} onClick={() => setTab('sparql')}>SPARQL</button>
            <button className={tab === 'sql' ? 'tab active' : 'tab'} onClick={() => setTab('sql')}>SQL</button>
          </div>
          {tab === 'results' && (run ? <ResultTable columns={run.columns} rows={run.rows} /> : <p className="muted">Run the query to see results.</p>)}
          {tab === 'sparql' && <textarea className="code short" spellCheck={false} value={sparql} onChange={(e) => setSparql(e.target.value)} />}
          {tab === 'sql' && <pre className="code">{run?.sql || 'Run the query to see the SQL Ontop generates.'}</pre>}
        </Card>
      )}

      {history.length > 0 && (
        <Card title="History">
          <ul className="history">
            {history.map((h) => (
              <li key={h.id}>
                <button className="link" onClick={() => api.get<QueryRun>(`/api/query/history/${h.id}`).then((r) => {
                  setRun(r); setSparql(r.sparql); setQuestion(r.question); setSteps([]); setTab('results')
                })}>{h.question}</button>
                <span className="muted">{h.error ? 'failed' : `${h.rowCount} rows`} · {new Date(h.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
