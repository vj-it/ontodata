import { useState, type ReactNode } from 'react'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          <div className="row">{actions}</div>
        </header>
      )}
      {children}
    </section>
  )
}

export type Status = { kind: 'ok' | 'error' | 'info'; text: string } | null

export function StatusLine({ status }: { status: Status }) {
  if (!status) return null
  return <div className={`status ${status.kind}`}>{status.text}</div>
}

/** Runs an async action with a busy flag and a status message. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  async function run<T>(fn: () => Promise<T>, ok?: (r: T) => string) {
    setBusy(true)
    setStatus({ kind: 'info', text: 'Working…' })
    try {
      const r = await fn()
      setStatus(ok ? { kind: 'ok', text: ok(r) } : null)
      return r
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return { busy, status, setStatus, run }
}

/** SPARQL decimals arrive as strings like "8403438.5280000000000000000000"; show them at 2 places. */
function formatCell(v: unknown): string {
  const s = String(v ?? '')
  return /^-?\d+\.\d{3,}$/.test(s) ? Number(s).toLocaleString(undefined, { maximumFractionDigits: 2 }) : s
}

export function ResultTable({ columns, rows, max = 200 }: { columns: string[]; rows: Record<string, unknown>[]; max?: number }) {
  if (!rows.length) return <p className="muted">No rows.</p>
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c}>{formatCell(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="muted">Showing {max} of {rows.length} rows.</p>}
    </div>
  )
}
