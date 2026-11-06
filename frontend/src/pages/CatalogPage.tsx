import { useEffect, useMemo, useState } from 'react'
import { api, tablePath, type Catalog, type RelationModel, type TableModel } from '../api'
import { Card, Field, ResultTable, StatusLine, useAction } from '../components/ui'
import { useEngineName } from './useConfig'

interface TableInfo { schema: string; name: string; type: string }
interface Suggestion {
  className: string
  description: string
  columns: Record<string, { propertyName: string; description: string }>
}

const key = (t: { schema: string; name: string }) => `${t.schema}.${t.name}`
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

export function CatalogPage() {
  const [catalog, setCatalog] = useState<Catalog>({ database: '', tables: [] })
  const [databases, setDatabases] = useState<string[]>([])
  const [database, setDatabase] = useState('')
  const [available, setAvailable] = useState<TableInfo[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const browse = useAction()
  const engine = useEngineName()

  useEffect(() => {
    api.get<Catalog>('/api/catalog').then((c) => {
      setCatalog(c)
      if (c.database) setDatabase(c.database)
      if (c.tables[0]) setSelected(key(c.tables[0]))
    })
    browse.run(() => api.get<string[]>('/api/redshift/databases').then(setDatabases))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!database) return
    setPicked(new Set())
    browse.run(() => api.get<TableInfo[]>(`/api/redshift/tables?database=${encodeURIComponent(database)}`).then(setAvailable))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database])

  const inCatalog = useMemo(() => new Set(catalog.tables.map(key)), [catalog])
  const visible = available.filter((t) => key(t).toLowerCase().includes(filter.toLowerCase()))

  const addTables = () =>
    browse.run(async () => {
      const tables = available.filter((t) => picked.has(key(t))).map(({ schema, name }) => ({ schema, name }))
      const c = await api.post<Catalog>('/api/catalog/tables', { database, tables })
      setCatalog(c)
      setPicked(new Set())
      if (!selected && c.tables[0]) setSelected(key(c.tables[0]))
      return tables.length
    }, (n) => `Added ${n} table(s)`)

  const current = catalog.tables.find((t) => key(t) === selected) ?? null
  const replaceTable = (t: TableModel) => setCatalog((c) => ({ ...c, tables: c.tables.map((x) => (key(x) === key(t) ? t : x)) }))

  return (
    <>
      <h1>Catalog</h1>
      <p className="lead">Choose a database and tables, then describe them in business terms. These descriptions become the ontology the model reasons over.</p>
      <div className="split">
        <Card title={`${engine} tables`}>
          <Field label="Database">
            <select value={database} onChange={(e) => setDatabase(e.target.value)}
              disabled={!!catalog.database && catalog.tables.length > 0}>
              <option value="">Select…</option>
              {databases.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <input placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="picklist">
            {visible.map((t) => {
              const k = key(t)
              const added = inCatalog.has(k)
              return (
                <li key={k}>
                  <label className={added ? 'muted' : ''}>
                    <input type="checkbox" disabled={added} checked={added || picked.has(k)}
                      onChange={(e) => setPicked((p) => {
                        const n = new Set(p)
                        if (e.target.checked) n.add(k)
                        else n.delete(k)
                        return n
                      })} />
                    {k} {!/^(BASE )?TABLE$/.test(t.type) &&<span className="pill">{t.type.toLowerCase()}</span>}
                  </label>
                </li>
              )
            })}
          </ul>
          <button className="primary" disabled={!picked.size || browse.busy} onClick={addTables}>
            Add {picked.size || ''} to catalog
          </button>
          <StatusLine status={browse.status} />
        </Card>

        <div>
          <div className="tabs wrap">
            {catalog.tables.map((t) => (
              <button key={key(t)} className={key(t) === selected ? 'tab active' : 'tab'} onClick={() => setSelected(key(t))}>
                {t.className} <span className="muted">{t.name}</span>
              </button>
            ))}
          </div>
          {current
            ? <TableEditor key={key(current)} table={current} catalog={catalog} onChange={replaceTable}
                onRemoved={(c) => { setCatalog(c); setSelected(c.tables[0] ? key(c.tables[0]) : null) }} />
            : <p className="muted">Add tables from the list to start describing them.</p>}
        </div>
      </div>
    </>
  )
}

function TableEditor({ table, catalog, onChange, onRemoved }: {
  table: TableModel; catalog: Catalog; onChange: (t: TableModel) => void; onRemoved: (c: Catalog) => void
}) {
  const [t, setT] = useState(table)
  const [preview, setPreview] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null)
  const a = useAction()

  const setCol = (i: number, patch: Partial<TableModel['columns'][number]>) =>
    setT((x) => ({ ...x, columns: x.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  const togglePk = (name: string) =>
    setT((x) => ({ ...x, primaryKey: x.primaryKey.includes(name) ? x.primaryKey.filter((k) => k !== name) : [...x.primaryKey, name] }))
  const setRel = (i: number, patch: Partial<RelationModel>) =>
    setT((x) => ({ ...x, relations: x.relations.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  const save = () => a.run(async () => {
    const saved = await api.put<TableModel>(tablePath(t), t)
    onChange(saved)
  }, () => 'Saved')

  const suggest = () => a.run(async () => {
    const s = await api.post<Suggestion>(`${tablePath(t)}/suggest`)
    // Only fill empty fields so user-written text is never overwritten.
    setT((x) => ({
      ...x,
      className: s.className || x.className,
      description: x.description || s.description,
      columns: x.columns.map((c) => {
        const sc = s.columns[c.name]
        return sc ? { ...c, description: c.description || sc.description, propertyName: sc.propertyName || c.propertyName } : c
      }),
    }))
  }, () => 'AI suggestions applied to empty fields. Review, then Save.')

  const others = catalog.tables.filter((x) => key(x) !== key(t))

  return (
    <Card
      title={`${t.schema}.${t.name}`}
      actions={<>
        <button disabled={a.busy} onClick={suggest}>Suggest with AI</button>
        <button disabled={a.busy} onClick={() => a.run(async () => {
          setPreview(await api.get(`/api/redshift/preview?database=${encodeURIComponent(catalog.database)}&schema=${encodeURIComponent(t.schema)}&table=${encodeURIComponent(t.name)}`))
        })}>Preview data</button>
        <button className="danger" disabled={a.busy} onClick={() => a.run(async () => onRemoved(await api.del<Catalog>(tablePath(t))))}>Remove</button>
        <button className="primary" disabled={a.busy} onClick={save}>Save</button>
      </>}
    >
      <StatusLine status={a.status} />
      <div className="grid2">
        <Field label="Ontology class"><input value={t.className} onChange={(e) => setT({ ...t, className: e.target.value })} /></Field>
        <Field label="Primary key" hint="Tick Key on the columns below. Required to map instances.">
          <input readOnly value={t.primaryKey.join(', ') || '(none)'} />
        </Field>
      </div>
      <Field label="Table description">
        <textarea rows={2} value={t.description} placeholder="What does one row represent?"
          onChange={(e) => setT({ ...t, description: e.target.value })} />
      </Field>

      <h3>Columns</h3>
      <div className="table-wrap">
        <table className="edit">
          <thead><tr><th>Use</th><th>Key</th><th>Column</th><th>Type</th><th>Property</th><th>Description</th></tr></thead>
          <tbody>
            {t.columns.map((c, i) => (
              <tr key={c.name}>
                <td><input type="checkbox" checked={c.include} onChange={(e) => setCol(i, { include: e.target.checked })} /></td>
                <td><input type="checkbox" checked={t.primaryKey.includes(c.name)} onChange={() => togglePk(c.name)} /></td>
                <td><code>{c.name}</code></td>
                <td className="muted">{c.dataType}</td>
                <td><input value={c.propertyName} onChange={(e) => setCol(i, { propertyName: e.target.value })} /></td>
                <td><input value={c.description} placeholder="Business meaning, units, codes…" onChange={(e) => setCol(i, { description: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Relationships</h3>
      <p className="muted">Links to other catalog tables become object properties (e.g. Order hasCustomer Customer).</p>
      {t.relations.map((r, i) => (
        <div className="row rel" key={i}>
          <input value={r.name} placeholder="hasCustomer" onChange={(e) => setRel(i, { name: e.target.value })} />
          <input value={r.fromColumns.join(', ')} placeholder="from column(s)" onChange={(e) => setRel(i, { fromColumns: csv(e.target.value) })} />
          <span>→</span>
          <select value={`${r.toSchema}.${r.toTable}`} onChange={(e) => {
            const [toSchema, ...rest] = e.target.value.split('.')
            setRel(i, { toSchema, toTable: rest.join('.') })
          }}>
            <option value=".">target table…</option>
            {[`${r.toSchema}.${r.toTable}`, ...others.map(key)].filter((v, j, arr) => v !== '.' && arr.indexOf(v) === j)
              .map((k) => <option key={k}>{k}</option>)}
          </select>
          <input value={r.toColumns.join(', ')} placeholder="target column(s)" onChange={(e) => setRel(i, { toColumns: csv(e.target.value) })} />
          <button className="danger" onClick={() => setT({ ...t, relations: t.relations.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button onClick={() => setT({ ...t, relations: [...t.relations, { name: '', fromColumns: [], toSchema: '', toTable: '', toColumns: [] }] })}>
        + Add relationship
      </button>

      {preview && (<><h3>Sample rows</h3><ResultTable columns={preview.columns} rows={preview.rows} /></>)}
    </Card>
  )
}
