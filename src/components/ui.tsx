import type { ReactNode } from 'react'

export function Panel({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  hint?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {hint ? <p className="hint">{hint}</p> : null}
          </div>
          {actions ? <div className="btn-row">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  invalid,
}: {
  label: ReactNode
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  invalid?: boolean
}) {
  return (
    <Field label={label}>
      <input
        className={invalid ? 'invalid' : undefined}
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      />
    </Field>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  invalid,
  mono,
}: {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  placeholder?: string
  invalid?: boolean
  mono?: boolean
}) {
  return (
    <Field label={label}>
      <input
        className={invalid ? 'invalid' : undefined}
        style={mono ? undefined : { fontFamily: 'var(--sans)' }}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: ReactNode
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function Checkbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  )
}

export function Kv({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  )
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  return <div className={`notice ${tone}`}>{children}</div>
}

export function DataTable({ columns, rows }: { columns: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={typeof cell === 'number' ? 'num' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
