import { useState } from 'react'
import { ArrowRight, ChevronDown, ChevronUp, Database, Lightbulb } from 'lucide-react'
import { runSql, type QueryResult } from './engine/sqlEngine'

export const SCHEMA_TABLES = [
  { name: 'customers', columns: 'id, name, city, email, signup_date, referred_by' },
  { name: 'categories', columns: 'id, name, parent_id' },
  { name: 'products', columns: 'id, name, category, price, category_id' },
  { name: 'orders', columns: 'id, customer_id, order_date, status, shipped_at, discount_code' },
  { name: 'order_items', columns: 'id, order_id, product_id, quantity' },
  { name: 'payments', columns: 'id, order_id, amount, paid_at, method' },
  { name: 'reviews', columns: 'id, product_id, customer_id, rating, created_at' },
]

interface SchemaPanelProps {
  onSkip?: () => void
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export default function SchemaPanel({ onSkip }: SchemaPanelProps) {
  const [expandedTable, setExpandedTable] = useState<string | null>(null)
  const [cache, setCache] = useState<Record<string, QueryResult>>({})
  const [loadingTable, setLoadingTable] = useState<string | null>(null)

  async function handleToggleTable(tableName: string) {
    if (expandedTable === tableName) {
      setExpandedTable(null)
      return
    }

    setExpandedTable(tableName)
    if (cache[tableName]) return

    setLoadingTable(tableName)
    try {
      const output = await runSql(`SELECT * FROM ${tableName} LIMIT 8;`)
      if (output.result) {
        setCache((prev) => ({ ...prev, [tableName]: output.result! }))
      }
    } catch {
      // Ignore preview errors
    } finally {
      setLoadingTable(null)
    }
  }

  return (
    <aside className="schema-panel">
      <div className="schema-panel-heading">
        <Database size={19} />
        <div>
          <strong>Shop database</strong>
          <span>Click a table to preview rows</span>
        </div>
      </div>
      <p>Use these tables to solve the challenge. Click any table to inspect its columns and data rows.</p>
      <div className="schema-tables">
        {SCHEMA_TABLES.map((table) => {
          const isExpanded = expandedTable === table.name
          const preview = cache[table.name]
          const isLoading = loadingTable === table.name

          return (
            <div
              className={`schema-table ${isExpanded ? 'is-expanded' : ''}`}
              key={table.name}
            >
              <button
                type="button"
                className="schema-table-btn"
                onClick={() => handleToggleTable(table.name)}
                aria-expanded={isExpanded}
                title={`Click to ${isExpanded ? 'hide' : 'view'} ${table.name} data`}
              >
                <div className="schema-table-title-row">
                  <strong>{table.name}</strong>
                  <span className="schema-row-tag">
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {isExpanded ? 'Hide data' : 'View data'}
                  </span>
                </div>
                <code>{table.columns}</code>
              </button>

              {isExpanded && (
                <div className="schema-table-data-preview">
                  {isLoading ? (
                    <div className="schema-preview-loading">Loading rows…</div>
                  ) : preview ? (
                    <div className="schema-mini-table-wrap">
                      <table className="schema-mini-table">
                        <thead>
                          <tr>
                            {preview.columns.map((col, idx) => (
                              <th key={`${col}-${idx}`}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                              {row.map((cell, cellIdx) => (
                                <td
                                  key={cellIdx}
                                  className={cell === null ? 'null-cell' : undefined}
                                >
                                  {displayCell(cell)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="schema-preview-empty">No rows found</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="schema-note">
        <Lightbulb size={17} />
        <span>SQL runs locally in your browser.</span>
      </div>

      {onSkip && (
        <button type="button" className="skip-button" onClick={onSkip}>
          Skip this question <ArrowRight size={16} />
        </button>
      )}
    </aside>
  )
}
