import React, { useEffect, useMemo, useState } from 'react'
import {
  Database,
  Table2,
  Plus,
  RefreshCw,
  Download,
  Trash2,
  Pencil,
  X,
  Check,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Layers,
  Columns3,
  Key,
  FileSpreadsheet,
  Loader2,
  Rows3,
  Lock,
  Save,
  Wand2,
  Copy,
  Search,
  Sparkles
} from 'lucide-react'

interface Props {
  api: <T = any>(path: string, method?: string, body?: any) => Promise<T>
  currentUser?: {
    id: number
    name: string
    email: string
    role: string
    is_super_admin: boolean
  } | null
  initialProjectId?: number | null
}

interface ColumnMeta {
  column_name: string
  data_type: string
  udt_name?: string
  is_nullable: 'YES' | 'NO'
  column_default: string | null
  is_identity?: 'YES' | 'NO'
  is_generated?: string
  character_maximum_length?: number | null
}

interface TableMeta {
  name: string
  rows_count: number
  row_estimate: number
  total_bytes: number
  total_mb: number
  table_mb: number
  index_mb: number
  columns: ColumnMeta[]
  primary_key: string[]
}

interface TableData {
  table: string
  columns: ColumnMeta[]
  primary_key: string[]
  rows: any[]
  total: number
  page: number
  limit: number
  total_pages: number
}

interface ColumnDraft {
  name: string
  type: string
  primary_key: boolean
  not_null: boolean
  unique: boolean
  default: string
}

const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Angka', types: ['SMALLINT', 'INTEGER', 'BIGINT', 'SERIAL', 'BIGSERIAL', 'NUMERIC(12,2)', 'DECIMAL(12,2)', 'REAL', 'DOUBLE PRECISION', 'MONEY'] },
  { label: 'Teks', types: ['VARCHAR(255)', 'VARCHAR(100)', 'VARCHAR(50)', 'TEXT', 'CHAR(50)'] },
  { label: 'Boolean & Waktu', types: ['BOOLEAN', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ'] },
  { label: 'JSON & Lainnya', types: ['JSONB', 'JSON', 'UUID', 'BYTEA'] }
]

const inp =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500'
const btn =
  'inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50'
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50'
const btnDanger =
  'inline-flex items-center gap-1.5 rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-950 disabled:opacity-50'

const apiBase = (): string => {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('pgm_backend_url')
    if (custom) return custom.trim().replace(/\/$/, '')
  }
  return (((import.meta as any).env?.VITE_API_URL || '') as string).trim().replace(/\/$/, '')
}

const formatBytes = (bytes?: number | null) => {
  if (bytes === null || bytes === undefined) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB'
  return (bytes / 1073741824).toFixed(2) + ' GB'
}

const isJsonType = (col: ColumnMeta) =>
  ['json', 'jsonb'].includes((col.udt_name || col.data_type || '').toLowerCase())

const isBooleanType = (col: ColumnMeta) =>
  (col.udt_name || col.data_type || '').toLowerCase() === 'bool' ||
  (col.data_type || '').toLowerCase() === 'boolean'

const isNumberType = (col: ColumnMeta) =>
  ['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'money', 'serial', 'bigserial'].includes(
    (col.udt_name || '').toLowerCase()
  ) || /int|numeric|decimal|real|double|money|serial/i.test(col.data_type || '')

const editableColumns = (columns: ColumnMeta[]) =>
  columns.filter(c => c.is_generated !== 'ALWAYS' && c.is_identity !== 'YES')

const pgTypeOf = (col: ColumnMeta): string => {
  const dt = (col.data_type || '').toLowerCase()
  const len = col.character_maximum_length
  if (dt === 'character varying') return len ? `VARCHAR(${len})` : 'VARCHAR'
  if (dt === 'character') return len ? `CHAR(${len})` : 'CHAR'
  if (dt === 'timestamp without time zone') return 'TIMESTAMP'
  if (dt === 'timestamp with time zone') return 'TIMESTAMPTZ'
  if (dt === 'time without time zone') return 'TIME'
  if (dt === 'time with time zone') return 'TIMETZ'
  if (dt === 'double precision') return 'DOUBLE PRECISION'
  if (dt === 'numeric') return 'NUMERIC'
  return dt.toUpperCase()
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 'max-w-2xl'
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  width?: string
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className={`w-full ${width} max-h-[92vh] overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Notice({ notice }: { notice: { type: 'success' | 'error'; text: string } }) {
  const isOk = notice.type === 'success'
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
        isOk
          ? 'border-emerald-800 bg-emerald-950/60 text-emerald-300'
          : 'border-red-900 bg-red-950/60 text-red-300'
      }`}
    >
      {isOk ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
      <span className="whitespace-pre-wrap break-words">{notice.text}</span>
    </div>
  )
}

export default function DatabaseExplorer({ api, currentUser, initialProjectId }: Props) {
  const isOperator = currentUser?.role === 'user' && !currentUser?.is_super_admin

  const [projects, setProjects] = useState<any[]>([])
  const [projectId, setProjectId] = useState<string>(initialProjectId ? String(initialProjectId) : '')
  const [tables, setTables] = useState<TableMeta[]>([])
  const [dbName, setDbName] = useState('')
  const [loadingTables, setLoadingTables] = useState(false)
  const [selectedTable, setSelectedTable] = useState<string>('')
  const [view, setView] = useState<'data' | 'structure'>('data')
  const [tableFilter, setTableFilter] = useState('')

  const [data, setData] = useState<TableData | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [sort, setSort] = useState('')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [refreshTick, setRefreshTick] = useState(0)

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Create table modal
  const [createOpen, setCreateOpen] = useState(false)
  const [tableName, setTableName] = useState('')
  const [drafts, setDrafts] = useState<ColumnDraft[]>([
    { name: 'id', type: 'BIGSERIAL', primary_key: true, not_null: true, unique: false, default: '' },
    { name: 'created_at', type: 'TIMESTAMPTZ', primary_key: false, not_null: false, unique: false, default: 'NOW()' }
  ])

  // Add / edit / rename column modals
  const [addColumnOpen, setAddColumnOpen] = useState(false)
  const [newColumn, setNewColumn] = useState<ColumnDraft>({
    name: '',
    type: 'TEXT',
    primary_key: false,
    not_null: false,
    unique: false,
    default: ''
  })
  const [editColumn, setEditColumn] = useState<ColumnMeta | null>(null)
  const [editColumnForm, setEditColumnForm] = useState({ type: '', not_null: false, default: '' })
  const [renameColumn, setRenameColumn] = useState<ColumnMeta | null>(null)
  const [renameColumnName, setRenameColumnName] = useState('')
  const [renameTableOpen, setRenameTableOpen] = useState(false)
  const [renameTableName, setRenameTableName] = useState('')

  // Row modal
  const [rowModal, setRowModal] = useState<{ mode: 'insert' | 'edit'; row?: any } | null>(null)
  const [rowValues, setRowValues] = useState<Record<string, string>>({})
  const [rowError, setRowError] = useState('')

  // Confirmation dialog
  const [confirm, setConfirm] = useState<{
    title: string
    message: string
    action: () => Promise<void>
  } | null>(null)

  useEffect(() => {
    api<any[]>('/projects')
      .then(list => {
        setProjects(list || [])
        setProjectId(prev => prev || (initialProjectId ? String(initialProjectId) : list?.[0]?.id ? String(list[0].id) : ''))
      })
      .catch((e: any) => setNotice({ type: 'error', text: e?.message || 'Gagal memuat daftar proyek.' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (initialProjectId) setProjectId(String(initialProjectId))
  }, [initialProjectId])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])

  const selectedMeta = useMemo(
    () => tables.find(t => t.name === selectedTable) || null,
    [tables, selectedTable]
  )

  const loadTables = async (pid = projectId, keepSelection = true) => {
    if (!pid) return
    try {
      setLoadingTables(true)
      const res = await api<{ db_name: string; tables: TableMeta[] }>(`/projects/${pid}/tables`)
      setTables(res.tables || [])
      setDbName(res.db_name || '')
      setSelectedTable(prev => {
        if (keepSelection && prev && (res.tables || []).some(t => t.name === prev)) return prev
        return res.tables?.[0]?.name || ''
      })
    } catch (e: any) {
      setTables([])
      setSelectedTable('')
      setNotice({ type: 'error', text: e?.message || 'Gagal memuat tabel database.' })
    } finally {
      setLoadingTables(false)
    }
  }

  useEffect(() => {
    setSelectedTable('')
    setData(null)
    setPage(1)
    setSort('')
    if (projectId) loadTables(projectId, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!projectId || !selectedTable) {
      setData(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        setLoadingData(true)
        const qs = new URLSearchParams({
          page: String(page),
          limit: String(limit),
          ...(sort ? { sort, dir } : {})
        })
        const res = await api<TableData>(`/projects/${projectId}/tables/${selectedTable}/rows?${qs.toString()}`)
        if (!cancelled) setData(res)
      } catch (e: any) {
        if (!cancelled) {
          setData(null)
          setNotice({ type: 'error', text: e?.message || 'Gagal memuat data tabel.' })
        }
      } finally {
        if (!cancelled) setLoadingData(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedTable, page, limit, sort, dir, refreshTick])

  const refreshAll = async () => {
    await loadTables(projectId, true)
    setRefreshTick(t => t + 1)
  }

  const selectTable = (name: string) => {
    setSelectedTable(name)
    setPage(1)
    setSort('')
    setDir('desc')
  }

  const toggleSort = (col: string) => {
    if (sort === col) {
      setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(col)
      setDir('asc')
    }
    setPage(1)
  }

  const downloadFile = async (path: string, fallbackName: string) => {
    try {
      setBusy(true)
      const res = await fetch(apiBase() + '/api' + path, {
        credentials: 'include',
        headers: { Accept: '*/*' }
      })
      if (!res.ok) {
        const msg = await res.json().catch(() => null)
        throw { message: msg?.message || `Unduhan gagal (HTTP ${res.status}).` }
      }
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') || ''
      const match = /filename="?([^";]+)"?/i.exec(cd)
      const filename = match?.[1] || fallbackName
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setNotice({ type: 'success', text: `Berhasil mengunduh ${filename}.` })
    } catch (e: any) {
      setNotice({ type: 'error', text: e?.message || 'Gagal mengunduh file.' })
    } finally {
      setBusy(false)
    }
  }

  const createTable = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectId) return
    if (!/^[a-z][a-z0-9_]{1,60}$/.test(tableName)) {
      setNotice({ type: 'error', text: 'Nama tabel harus huruf kecil/angka/underscore, diawali huruf, minimal 2 karakter.' })
      return
    }
    if (!drafts.length) {
      setNotice({ type: 'error', text: 'Tambahkan minimal satu kolom.' })
      return
    }
    try {
      setBusy(true)
      const res = await api<any>(`/projects/${projectId}/tables`, 'POST', {
        table_name: tableName,
        columns: drafts
      })
      setCreateOpen(false)
      setTableName('')
      setDrafts([
        { name: 'id', type: 'BIGSERIAL', primary_key: true, not_null: true, unique: false, default: '' },
        { name: 'created_at', type: 'TIMESTAMPTZ', primary_key: false, not_null: false, unique: false, default: 'NOW()' }
      ])
      setNotice({ type: 'success', text: res?.message || 'Tabel berhasil dibuat.' })
      await loadTables(projectId, false)
      if (res?.table) selectTable(res.table)
    } catch (e: any) {
      setNotice({ type: 'error', text: e?.message || 'Gagal membuat tabel.' })
    } finally {
      setBusy(false)
    }
  }

  const submitStructure = async (operations: any[], successText: string) => {
    if (!projectId || !selectedTable) return
    try {
      setBusy(true)
      const res = await api<any>(`/projects/${projectId}/tables/${selectedTable}`, 'PUT', { operations })
      setNotice({ type: 'success', text: res?.message || successText })
      if (res?.table && res.table !== selectedTable) {
        setSelectedTable(res.table)
      }
      await loadTables(projectId, true)
      setRefreshTick(t => t + 1)
    } catch (e: any) {
      setNotice({ type: 'error', text: e?.message || 'Gagal mengubah struktur tabel.' })
    } finally {
      setBusy(false)
    }
  }

  const addColumn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(newColumn.name)) {
      setNotice({ type: 'error', text: 'Nama kolom harus huruf kecil/angka/underscore dan diawali huruf.' })
      return
    }
    await submitStructure([{ action: 'add_column', ...newColumn }], 'Kolom berhasil ditambahkan.')
    setAddColumnOpen(false)
    setNewColumn({ name: '', type: 'TEXT', primary_key: false, not_null: false, unique: false, default: '' })
  }

  const saveEditedColumn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editColumn) return
    const operation: any = {
      action: 'alter_column',
      name: editColumn.column_name,
      type: editColumnForm.type,
      not_null: editColumnForm.not_null
    }
    // Only touch DEFAULT when the user actually changed it, so expression
    // defaults such as nextval(...) on SERIAL columns stay intact.
    if (editColumnForm.default !== (editColumn.column_default || '')) {
      operation.default = editColumnForm.default
    }
    await submitStructure([operation], 'Kolom berhasil diperbarui.')
    setEditColumn(null)
  }

  const submitRenameColumn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renameColumn) return
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(renameColumnName)) {
      setNotice({ type: 'error', text: 'Nama kolom baru tidak valid.' })
      return
    }
    await submitStructure(
      [{ action: 'rename_column', from: renameColumn.column_name, to: renameColumnName }],
      'Nama kolom berhasil diubah.'
    )
    setRenameColumn(null)
  }

  const submitRenameTable = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[a-z][a-z0-9_]{1,60}$/.test(renameTableName)) {
      setNotice({ type: 'error', text: 'Nama tabel baru tidak valid (2-60 karakter, huruf kecil).' })
      return
    }
    await submitStructure([{ action: 'rename_table', to: renameTableName }], 'Nama tabel berhasil diubah.')
    setRenameTableOpen(false)
  }

  const deleteTable = (tbl: string) => {
    setConfirm({
      title: `Hapus tabel "${tbl}"?`,
      message: 'Seluruh baris dan struktur tabel akan dihapus permanen (CASCADE). Tindakan ini tidak dapat dibatalkan.',
      action: async () => {
        await api(`/projects/${projectId}/tables/${tbl}`, 'DELETE')
        setNotice({ type: 'success', text: `Tabel "${tbl}" berhasil dihapus.` })
        setSelectedTable('')
        await loadTables(projectId, false)
      }
    })
  }

  const dropColumn = (col: ColumnMeta) => {
    setConfirm({
      title: `Hapus kolom "${col.column_name}"?`,
      message: 'Kolom beserta datanya akan dihapus permanen dari tabel.',
      action: async () => {
        await submitStructure([{ action: 'drop_column', name: col.column_name }], 'Kolom berhasil dihapus.')
      }
    })
  }

  const openRowModal = (mode: 'insert' | 'edit', row?: any) => {
    const cols = data?.columns || []
    const values: Record<string, string> = {}
    if (mode === 'edit' && row) {
      for (const c of cols) {
        const v = row[c.column_name]
        values[c.column_name] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
      }
    }
    setRowValues(values)
    setRowError('')
    setRowModal({ mode, row })
  }

  const getRowKey = (row: any) => {
    const pk = data?.primary_key || []
    if (pk.length) {
      const key: Record<string, any> = {}
      for (const p of pk) key[p] = row[p]
      return key
    }
    return { _ctid: row?._ctid }
  }

  const submitRow = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!data || !projectId || !rowModal) return

    const payload: Record<string, any> = {}
    for (const col of editableColumns(data.columns)) {
      const raw = rowValues[col.column_name] ?? ''
      if (rowModal.mode === 'insert' && raw === '') continue
      if (raw === '') {
        payload[col.column_name] = null
        continue
      }
      if (isJsonType(col)) {
        try {
          payload[col.column_name] = JSON.parse(raw)
        } catch {
          setRowError(`Kolom "${col.column_name}" berisi JSON tidak valid.`)
          return
        }
      } else {
        payload[col.column_name] = raw
      }
    }

    try {
      setBusy(true)
      if (rowModal.mode === 'insert') {
        await api(`/projects/${projectId}/tables/${data.table}/rows`, 'POST', { values: payload })
        setNotice({ type: 'success', text: 'Baris data berhasil ditambahkan.' })
      } else {
        await api(`/projects/${projectId}/tables/${data.table}/rows`, 'PUT', {
          values: payload,
          row_key: getRowKey(rowModal.row)
        })
        setNotice({ type: 'success', text: 'Baris data berhasil diperbarui.' })
      }
      setRowModal(null)
      setRefreshTick(t => t + 1)
      await loadTables(projectId, true)
    } catch (err: any) {
      setRowError(err?.message || 'Gagal menyimpan baris data.')
    } finally {
      setBusy(false)
    }
  }

  const deleteRow = (row: any) => {
    if (!data) return
    setConfirm({
      title: 'Hapus baris data ini?',
      message: 'Baris yang dipilih akan dihapus permanen dari tabel.',
      action: async () => {
        await api(`/projects/${projectId}/tables/${data.table}/rows`, 'DELETE', { row_key: getRowKey(row) })
        setNotice({ type: 'success', text: 'Baris data berhasil dihapus.' })
        setRefreshTick(t => t + 1)
        await loadTables(projectId, true)
      }
    })
  }

  const renderCell = (v: any) => {
    if (v === null || v === undefined) return <span className="text-slate-600 italic">NULL</span>
    if (typeof v === 'boolean') {
      return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${v ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
          {String(v)}
        </span>
      )
    }
    if (typeof v === 'object') {
      const s = JSON.stringify(v)
      return <span className="font-mono text-[11px] text-cyan-300" title={s}>{s.length > 60 ? s.slice(0, 60) + '…' : s}</span>
    }
    const s = String(v)
    return <span title={s}>{s.length > 70 ? s.slice(0, 70) + '…' : s}</span>
  }

  const filteredTables = useMemo(
    () => tables.filter(t => t.name.toLowerCase().includes(tableFilter.toLowerCase())),
    [tables, tableFilter]
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" />
            Database Explorer
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Lihat tabel, generate struktur baru, edit kolom, dan kelola data langsung dari browser.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 min-w-[210px]"
          >
            <option value="">— Pilih Proyek Database —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.db_name})
              </option>
            ))}
          </select>

          <button onClick={() => refreshAll()} disabled={!projectId || loadingTables} className={btnGhost} title="Muat ulang tabel & data">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingTables ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => downloadFile(`/projects/${projectId}/database/export`, `${dbName || 'database'}_full.zip`)}
            disabled={!projectId || busy}
            className={btnGhost}
            title="Unduh seluruh tabel database sebagai ZIP berisi CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh DB (ZIP CSV)</span>
          </button>

          {!isOperator && (
            <button onClick={() => setCreateOpen(true)} disabled={!projectId} className={btn}>
              <Plus className="w-3.5 h-3.5" />
              <span>Buat Tabel</span>
            </button>
          )}
        </div>
      </div>

      {notice && <Notice notice={notice} />}

      {isOperator && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <Lock className="w-4 h-4" />
          <span>Mode Operator (Read-Only): Anda dapat melihat tabel, data, dan mengunduh CSV, tetapi tidak dapat mengubah struktur atau isi database.</span>
        </div>
      )}

      {!projectId ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-10 text-center">
          <Database className="w-10 h-10 text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-300 font-medium">Pilih proyek database terlebih dahulu</p>
          <p className="text-xs text-slate-500 mt-1">Daftar proyek akan tampil otomatis sesuai hak akses akun Anda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Sidebar tables */}
          <div className="lg:col-span-3 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-slate-800">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  Tabel
                  <span className="text-[10px] font-normal text-slate-500">({tables.length})</span>
                </p>
                {dbName && <span className="text-[10px] font-mono text-emerald-400/80 truncate max-w-[110px]" title={dbName}>{dbName}</span>}
              </div>
              <div className="relative mt-2">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                <input
                  value={tableFilter}
                  onChange={e => setTableFilter(e.target.value)}
                  placeholder="Cari tabel..."
                  className="w-full rounded-md border border-slate-700 bg-slate-950 pl-8 pr-2 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="max-h-[calc(100vh-280px)] overflow-y-auto p-1.5 space-y-1">
              {loadingTables ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Memuat tabel...
                </div>
              ) : filteredTables.length === 0 ? (
                <div className="py-8 px-3 text-center">
                  <Table2 className="w-7 h-7 text-slate-700 mx-auto mb-2" />
                  <p className="text-[11px] text-slate-400">Belum ada tabel.</p>
                  {!isOperator && <p className="text-[10px] text-slate-500 mt-1">Klik "Buat Tabel" untuk generate struktur pertama.</p>}
                </div>
              ) : (
                filteredTables.map(t => (
                  <button
                    key={t.name}
                    onClick={() => selectTable(t.name)}
                    className={`w-full text-left rounded-lg px-2.5 py-2 border transition ${
                      selectedTable === t.name
                        ? 'border-emerald-700/70 bg-emerald-950/30'
                        : 'border-transparent hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs font-semibold truncate flex items-center gap-1.5 ${selectedTable === t.name ? 'text-emerald-300' : 'text-slate-200'}`}>
                        <Table2 className="w-3.5 h-3.5 shrink-0" />
                        {t.name}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0">
                        {t.rows_count.toLocaleString('id-ID')} baris
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                      <span>{t.columns.length} kolom</span>
                      <span>•</span>
                      <span>{formatBytes(t.total_bytes)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Main panel */}
          <div className="lg:col-span-9 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            {!selectedTable || !selectedMeta ? (
              <div className="p-12 text-center">
                <Table2 className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-slate-300 font-medium">Pilih tabel di panel kiri</p>
                <p className="text-xs text-slate-500 mt-1">Lihat data, edit struktur, atau unduh CSV per tabel.</p>
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Table2 className="w-4 h-4 text-emerald-400" />
                      {selectedMeta.name}
                      {selectedMeta.primary_key.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                          <Key className="w-2.5 h-2.5" /> PK
                        </span>
                      )}
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {selectedMeta.rows_count.toLocaleString('id-ID')} baris • {selectedMeta.columns.length} kolom • {formatBytes(selectedMeta.total_bytes)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-md border border-slate-700 overflow-hidden">
                      <button
                        onClick={() => setView('data')}
                        className={`px-3 py-1.5 text-xs flex items-center gap-1.5 ${view === 'data' ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
                      >
                        <Rows3 className="w-3.5 h-3.5" /> Data
                      </button>
                      <button
                        onClick={() => setView('structure')}
                        className={`px-3 py-1.5 text-xs flex items-center gap-1.5 border-l border-slate-700 ${view === 'structure' ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'}`}
                      >
                        <Columns3 className="w-3.5 h-3.5" /> Struktur
                      </button>
                    </div>

                    <button
                      onClick={() => downloadFile(`/projects/${projectId}/tables/${selectedMeta.name}/csv`, `${selectedMeta.name}.csv`)}
                      disabled={busy}
                      className={btnGhost}
                      title="Unduh tabel ini sebagai CSV"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>CSV</span>
                    </button>

                    {!isOperator && view === 'data' && (
                      <button onClick={() => openRowModal('insert')} className={btn}>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Tambah Baris</span>
                      </button>
                    )}

                    {!isOperator && view === 'structure' && (
                      <>
                        <button onClick={() => { setRenameTableName(selectedMeta.name); setRenameTableOpen(true) }} className={btnGhost}>
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Rename Tabel</span>
                        </button>
                        <button onClick={() => setAddColumnOpen(true)} className={btn}>
                          <Plus className="w-3.5 h-3.5" />
                          <span>Tambah Kolom</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* DATA VIEW */}
                {view === 'data' && (
                  <div>
                    {loadingData ? (
                      <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin" /> Memuat data...
                      </div>
                    ) : !data || data.rows.length === 0 ? (
                      <div className="py-16 text-center">
                        <Rows3 className="w-9 h-9 text-slate-700 mx-auto mb-3" />
                        <p className="text-sm text-slate-300 font-medium">Tabel masih kosong</p>
                        {!isOperator && (
                          <button onClick={() => openRowModal('insert')} className={btn + ' mt-3'}>
                            <Plus className="w-3.5 h-3.5" /> Tambah Baris Pertama
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-950/70 border-b border-slate-800">
                            <tr>
                              <th className="px-2 py-2 text-left text-[10px] font-semibold text-slate-500 w-10">#</th>
                              {data.columns.map(c => (
                                <th
                                  key={c.column_name}
                                  onClick={() => toggleSort(c.column_name)}
                                  className="px-3 py-2 text-left font-semibold text-slate-300 whitespace-nowrap cursor-pointer hover:bg-slate-900 select-none"
                                  title={`Urutkan berdasarkan ${c.column_name}`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    {c.column_name}
                                    {data.primary_key.includes(c.column_name) && <Key className="w-2.5 h-2.5 text-amber-400" />}
                                    <ArrowUpDown className={`w-3 h-3 ${sort === c.column_name ? 'text-emerald-400' : 'text-slate-600'}`} />
                                  </span>
                                  <span className="block text-[9px] font-normal text-slate-500 mt-0.5">
                                    {c.data_type}{c.is_nullable === 'NO' ? ' • not null' : ''}
                                  </span>
                                </th>
                              ))}
                              {!isOperator && <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 w-24">Aksi</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {data.rows.map((row, idx) => (
                              <tr key={row._ctid || idx} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                                <td className="px-2 py-2 text-[10px] text-slate-600 font-mono">
                                  {(data.page - 1) * data.limit + idx + 1}
                                </td>
                                {data.columns.map(c => (
                                  <td key={c.column_name} className="px-3 py-2 text-slate-300 align-top max-w-[280px] break-words">
                                    {renderCell(row[c.column_name])}
                                  </td>
                                ))}
                                {!isOperator && (
                                  <td className="px-3 py-2 text-right whitespace-nowrap">
                                    <button
                                      onClick={() => openRowModal('edit', row)}
                                      className="p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-800"
                                      title="Edit baris"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => deleteRow(row)}
                                      className="p-1 rounded text-slate-400 hover:text-red-300 hover:bg-slate-800"
                                      title="Hapus baris"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Pagination */}
                    {data && data.total > 0 && (
                      <div className="px-4 py-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span>Baris per halaman</span>
                          <select
                            value={limit}
                            onChange={e => { setLimit(Number(e.target.value)); setPage(1) }}
                            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white"
                          >
                            {[10, 25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <span className="text-slate-500">
                            {Math.min((data.page - 1) * data.limit + 1, data.total)}–{Math.min(data.page * data.limit, data.total)} dari {data.total.toLocaleString('id-ID')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            disabled={data.page <= 1}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            className={btnGhost}
                          >
                            <ChevronLeft className="w-3.5 h-3.5" /> Sebelumnya
                          </button>
                          <span className="text-[11px] text-slate-400">
                            Halaman {data.page} / {Math.max(1, data.total_pages)}
                          </span>
                          <button
                            disabled={data.page >= data.total_pages}
                            onClick={() => setPage(p => p + 1)}
                            className={btnGhost}
                          >
                            Berikutnya <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STRUCTURE VIEW */}
                {view === 'structure' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-950/70 border-b border-slate-800">
                        <tr>
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500">Kolom</th>
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500">Tipe Data</th>
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500">Null</th>
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500">Default</th>
                          <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-500">Atribut</th>
                          {!isOperator && <th className="px-4 py-2 text-right text-[10px] font-semibold text-slate-500">Aksi</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedMeta.columns.map(c => (
                          <tr key={c.column_name} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                            <td className="px-4 py-2.5 font-semibold text-slate-200">
                              <span className="flex items-center gap-1.5">
                                <Columns3 className="w-3.5 h-3.5 text-slate-500" />
                                {c.column_name}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-cyan-300">{c.data_type}</td>
                            <td className="px-4 py-2.5 text-slate-400">{c.is_nullable === 'YES' ? 'Nullable' : 'NOT NULL'}</td>
                            <td className="px-4 py-2.5 font-mono text-[10px] text-slate-400 max-w-[180px] truncate" title={c.column_default || ''}>
                              {c.column_default || '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {selectedMeta.primary_key.includes(c.column_name) && (
                                  <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">PK</span>
                                )}
                                {c.is_identity === 'YES' && (
                                  <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">Identity</span>
                                )}
                                {c.is_generated === 'ALWAYS' && (
                                  <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30">Generated</span>
                                )}
                              </div>
                            </td>
                            {!isOperator && (
                              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                <button
                                  onClick={() => {
                                    setEditColumn(c)
                                    setEditColumnForm({
                                      type: pgTypeOf(c),
                                      not_null: c.is_nullable === 'NO',
                                      default: c.column_default || ''
                                    })
                                  }}
                                  className="p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-800"
                                  title="Ubah tipe / null / default"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => { setRenameColumn(c); setRenameColumnName(c.column_name) }}
                                  className="p-1 rounded text-slate-400 hover:text-blue-300 hover:bg-slate-800"
                                  title="Ganti nama kolom"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => dropColumn(c)}
                                  className="p-1 rounded text-slate-400 hover:text-red-300 hover:bg-slate-800"
                                  title="Hapus kolom"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {!isOperator && (
                      <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between gap-2">
                        <p className="text-[10px] text-slate-500">
                          Perubahan struktur langsung diterapkan ke database PostgreSQL proyek.
                        </p>
                        <button onClick={() => deleteTable(selectedMeta.name)} className={btnDanger}>
                          <Trash2 className="w-3.5 h-3.5" /> Hapus Tabel
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* CREATE TABLE MODAL */}
      {createOpen && (
        <Modal
          title="Generate Tabel Baru"
          subtitle="Susun kolom, tipe data, dan constraint — tabel langsung dibuat di database proyek."
          onClose={() => setCreateOpen(false)}
          width="max-w-4xl"
        >
          <form onSubmit={createTable} className="space-y-4">
            {/* Template Presets (1-Klik Generate) */}
            <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/80 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Template Skema Cepat (1-Klik Generate):</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTableName('iot_telemetry')
                    setDrafts([
                      { name: 'id', type: 'BIGSERIAL', primary_key: true, not_null: true, unique: false, default: '' },
                      { name: 'device_id', type: 'VARCHAR(100)', primary_key: false, not_null: true, unique: false, default: '' },
                      { name: 'temperature', type: 'DOUBLE PRECISION', primary_key: false, not_null: false, unique: false, default: '' },
                      { name: 'humidity', type: 'DOUBLE PRECISION', primary_key: false, not_null: false, unique: false, default: '' },
                      { name: 'gas', type: 'DOUBLE PRECISION', primary_key: false, not_null: false, unique: false, default: '' },
                      { name: 'payload', type: 'JSONB', primary_key: false, not_null: false, unique: false, default: '' },
                      { name: 'created_at', type: 'TIMESTAMPTZ', primary_key: false, not_null: false, unique: false, default: 'NOW()' },
                    ])
                  }}
                  className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 hover:border-cyan-700 hover:bg-slate-850 text-left transition"
                >
                  <p className="text-xs font-bold text-cyan-300">📡 IoT Telemetry</p>
                  <p className="text-[10px] text-slate-400">Ala Smartroom (DHT, Gas, JSONB)</p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTableName('devices')
                    setDrafts([
                      { name: 'device_id', type: 'VARCHAR(100)', primary_key: true, not_null: true, unique: true, default: '' },
                      { name: 'name', type: 'VARCHAR(150)', primary_key: false, not_null: true, unique: false, default: '' },
                      { name: 'location', type: 'VARCHAR(150)', primary_key: false, not_null: false, unique: false, default: '' },
                      { name: 'auth_token', type: 'VARCHAR(255)', primary_key: false, not_null: false, unique: true, default: '' },
                      { name: 'pairing_hash', type: 'VARCHAR(255)', primary_key: false, not_null: false, unique: false, default: '' },
                      { name: 'is_online', type: 'BOOLEAN', primary_key: false, not_null: false, unique: false, default: 'false' },
                      { name: 'last_seen', type: 'TIMESTAMPTZ', primary_key: false, not_null: false, unique: false, default: 'NOW()' },
                    ])
                  }}
                  className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 hover:border-emerald-700 hover:bg-slate-850 text-left transition"
                >
                  <p className="text-xs font-bold text-emerald-300">📟 Perangkat IoT</p>
                  <p className="text-[10px] text-slate-400">Device ID, Auth Token, Hash</p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTableName('app_users')
                    setDrafts([
                      { name: 'id', type: 'BIGSERIAL', primary_key: true, not_null: true, unique: false, default: '' },
                      { name: 'username', type: 'VARCHAR(100)', primary_key: false, not_null: true, unique: true, default: '' },
                      { name: 'email', type: 'VARCHAR(255)', primary_key: false, not_null: true, unique: true, default: '' },
                      { name: 'password_hash', type: 'VARCHAR(255)', primary_key: false, not_null: true, unique: false, default: '' },
                      { name: 'role', type: 'VARCHAR(50)', primary_key: false, not_null: true, unique: false, default: "'user'" },
                      { name: 'created_at', type: 'TIMESTAMPTZ', primary_key: false, not_null: false, unique: false, default: 'NOW()' },
                    ])
                  }}
                  className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 hover:border-purple-700 hover:bg-slate-850 text-left transition"
                >
                  <p className="text-xs font-bold text-purple-300">👤 Pengguna Web</p>
                  <p className="text-[10px] text-slate-400">User, Email, Password, Role</p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTableName('app_store')
                    setDrafts([
                      { name: 'id', type: 'BIGSERIAL', primary_key: true, not_null: true, unique: false, default: '' },
                      { name: 'key', type: 'VARCHAR(255)', primary_key: false, not_null: true, unique: true, default: '' },
                      { name: 'value', type: 'JSONB', primary_key: false, not_null: true, unique: false, default: "'{}'" },
                      { name: 'updated_at', type: 'TIMESTAMPTZ', primary_key: false, not_null: false, unique: false, default: 'NOW()' },
                    ])
                  }}
                  className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 hover:border-amber-700 hover:bg-slate-850 text-left transition"
                >
                  <p className="text-xs font-bold text-amber-300">🗄️ Key-Value Store</p>
                  <p className="text-[10px] text-slate-400">Firebase-like JSON Doc Store</p>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Nama Tabel</label>
              <input
                value={tableName}
                onChange={e => setTableName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                placeholder="contoh: sensor_readings"
                className={inp}
                autoFocus
              />
              <p className="text-[10px] text-slate-500 mt-1">Huruf kecil, angka, dan underscore. Diawali huruf (2-60 karakter).</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Columns3 className="w-3.5 h-3.5 text-emerald-400" /> Definisi Kolom
                </label>
                <button
                  type="button"
                  onClick={() => setDrafts(d => [...d, { name: '', type: 'TEXT', primary_key: false, not_null: false, unique: false, default: '' }])}
                  className={btnGhost}
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah Kolom
                </button>
              </div>

              <div className="space-y-2">
                {drafts.map((d, i) => (
                  <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                      <div className="md:col-span-3">
                        <label className="block text-[10px] text-slate-500 mb-1">Nama Kolom</label>
                        <input
                          value={d.name}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } : x))}
                          placeholder="nama_kolom"
                          className={inp + ' py-1.5 text-xs'}
                        />
                      </div>
                      <div className="md:col-span-4">
                        <label className="block text-[10px] text-slate-500 mb-1">Tipe Data</label>
                        <select
                          value={d.type}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                          className={inp + ' py-1.5 text-xs'}
                        >
                          {TYPE_GROUPS.map(g => (
                            <optgroup key={g.label} label={g.label}>
                              {g.types.map(t => <option key={t} value={t}>{t}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-3">
                        <label className="block text-[10px] text-slate-500 mb-1">Default (opsional)</label>
                        <input
                          value={d.default}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, default: e.target.value } : x))}
                          placeholder="NOW()"
                          className={inp + ' py-1.5 text-xs font-mono'}
                        />
                      </div>
                      <div className="md:col-span-2 flex items-center justify-end gap-1 pb-1">
                        <button
                          type="button"
                          onClick={() => setDrafts(ds => ds.filter((_, j) => j !== i))}
                          disabled={drafts.length <= 1}
                          className="p-1.5 rounded text-slate-500 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
                          title="Hapus kolom"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 mt-2">
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <input
                          type="checkbox"
                          checked={d.primary_key}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, primary_key: e.target.checked, not_null: e.target.checked || x.not_null } : x))}
                          className="accent-emerald-500"
                        />
                        Primary Key
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <input
                          type="checkbox"
                          checked={d.not_null}
                          disabled={d.primary_key}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, not_null: e.target.checked } : x))}
                          className="accent-emerald-500"
                        />
                        NOT NULL
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <input
                          type="checkbox"
                          checked={d.unique}
                          disabled={d.primary_key}
                          onChange={e => setDrafts(ds => ds.map((x, j) => j === i ? { ...x, unique: e.target.checked } : x))}
                          className="accent-emerald-500"
                        />
                        UNIQUE
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800">
              <p className="text-[10px] text-slate-500 flex items-center gap-1">
                <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
                Tabel akan langsung dibuat tanpa perlu menulis SQL.
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setCreateOpen(false)} className={btnGhost}>Batal</button>
                <button type="submit" disabled={busy} className={btn}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{busy ? 'Membuat...' : 'Generate Tabel'}</span>
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* ADD COLUMN MODAL */}
      {addColumnOpen && (
        <Modal title="Tambah Kolom" subtitle={`Tambahkan kolom baru ke tabel "${selectedTable}".`} onClose={() => setAddColumnOpen(false)} width="max-w-lg">
          <form onSubmit={addColumn} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Nama Kolom</label>
              <input
                value={newColumn.name}
                onChange={e => setNewColumn(c => ({ ...c, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                placeholder="nama_kolom"
                className={inp}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Tipe Data</label>
              <select value={newColumn.type} onChange={e => setNewColumn(c => ({ ...c, type: e.target.value }))} className={inp}>
                {TYPE_GROUPS.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.types.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Default (opsional)</label>
              <input value={newColumn.default} onChange={e => setNewColumn(c => ({ ...c, default: e.target.value }))} placeholder="NOW() atau nilai teks" className={inp + ' font-mono'} />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <input type="checkbox" checked={newColumn.not_null} onChange={e => setNewColumn(c => ({ ...c, not_null: e.target.checked }))} className="accent-emerald-500" /> NOT NULL
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <input type="checkbox" checked={newColumn.unique} onChange={e => setNewColumn(c => ({ ...c, unique: e.target.checked }))} className="accent-emerald-500" /> UNIQUE
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button type="button" onClick={() => setAddColumnOpen(false)} className={btnGhost}>Batal</button>
              <button type="submit" disabled={busy} className={btn}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Tambah Kolom
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* EDIT COLUMN MODAL */}
      {editColumn && (
        <Modal title={`Ubah Kolom "${editColumn.column_name}"`} onClose={() => setEditColumn(null)} width="max-w-lg">
          <form onSubmit={saveEditedColumn} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Tipe Data</label>
              <input
                value={editColumnForm.type}
                onChange={e => setEditColumnForm(f => ({ ...f, type: e.target.value }))}
                className={inp + ' font-mono'}
                placeholder="VARCHAR(255)"
              />
              <p className="text-[10px] text-slate-500 mt-1">Contoh: TEXT, INTEGER, NUMERIC(12,2), TIMESTAMPTZ. Perubahan tipe memakai cast otomatis.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Default (opsional)</label>
              <input value={editColumnForm.default} onChange={e => setEditColumnForm(f => ({ ...f, default: e.target.value }))} className={inp + ' font-mono'} placeholder="Kosongkan untuk menghapus default" />
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <input type="checkbox" checked={editColumnForm.not_null} onChange={e => setEditColumnForm(f => ({ ...f, not_null: e.target.checked }))} className="accent-emerald-500" /> NOT NULL
            </label>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button type="button" onClick={() => setEditColumn(null)} className={btnGhost}>Batal</button>
              <button type="submit" disabled={busy} className={btn}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Simpan
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* RENAME COLUMN MODAL */}
      {renameColumn && (
        <Modal title={`Ganti Nama Kolom "${renameColumn.column_name}"`} onClose={() => setRenameColumn(null)} width="max-w-md">
          <form onSubmit={submitRenameColumn} className="space-y-3">
            <input
              value={renameColumnName}
              onChange={e => setRenameColumnName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              className={inp}
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button type="button" onClick={() => setRenameColumn(null)} className={btnGhost}>Batal</button>
              <button type="submit" disabled={busy} className={btn}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Simpan
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* RENAME TABLE MODAL */}
      {renameTableOpen && (
        <Modal title={`Ganti Nama Tabel "${selectedTable}"`} onClose={() => setRenameTableOpen(false)} width="max-w-md">
          <form onSubmit={submitRenameTable} className="space-y-3">
            <input
              value={renameTableName}
              onChange={e => setRenameTableName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              className={inp}
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button type="button" onClick={() => setRenameTableOpen(false)} className={btnGhost}>Batal</button>
              <button type="submit" disabled={busy} className={btn}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Simpan
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ROW MODAL */}
      {rowModal && data && (
        <Modal
          title={rowModal.mode === 'insert' ? `Tambah Baris — ${data.table}` : `Edit Baris — ${data.table}`}
          subtitle="Kolom kosong akan memakai nilai default (saat insert) atau diisi NULL (saat edit)."
          onClose={() => setRowModal(null)}
          width="max-w-2xl"
        >
          <form onSubmit={submitRow} className="space-y-3">
            {rowError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{rowError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {editableColumns(data.columns).map(col => (
                <div key={col.column_name} className={isJsonType(col) ? 'md:col-span-2' : ''}>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1 flex items-center gap-1.5">
                    {col.column_name}
                    <span className="text-[9px] font-normal text-slate-500 font-mono">{col.data_type}</span>
                    {data.primary_key.includes(col.column_name) && <Key className="w-2.5 h-2.5 text-amber-400" />}
                    {col.is_nullable === 'NO' && <span className="text-[9px] text-red-400">*wajib</span>}
                  </label>

                  {isBooleanType(col) ? (
                    <select
                      value={rowValues[col.column_name] ?? ''}
                      onChange={e => setRowValues(v => ({ ...v, [col.column_name]: e.target.value }))}
                      className={inp}
                    >
                      <option value="">— NULL / default —</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : isJsonType(col) ? (
                    <textarea
                      rows={3}
                      value={rowValues[col.column_name] ?? ''}
                      onChange={e => setRowValues(v => ({ ...v, [col.column_name]: e.target.value }))}
                      placeholder='{"suhu": 27.5, "kelembapan": 60}'
                      className={inp + ' font-mono text-xs'}
                    />
                  ) : col.data_type === 'text' ? (
                    <textarea
                      rows={2}
                      value={rowValues[col.column_name] ?? ''}
                      onChange={e => setRowValues(v => ({ ...v, [col.column_name]: e.target.value }))}
                      className={inp + ' text-xs'}
                    />
                  ) : (
                    <input
                      type={isNumberType(col) ? 'number' : 'text'}
                      step={isNumberType(col) ? 'any' : undefined}
                      value={rowValues[col.column_name] ?? ''}
                      onChange={e => setRowValues(v => ({ ...v, [col.column_name]: e.target.value }))}
                      placeholder={col.column_default ? `default: ${col.column_default}` : ''}
                      className={inp + (isNumberType(col) ? ' font-mono' : '')}
                    />
                  )}
                </div>
              ))}
            </div>

            {editableColumns(data.columns).length === 0 && (
              <p className="text-xs text-slate-400 py-4 text-center">Semua kolom bersifat generated/identity. Gunakan DEFAULT VALUES.</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button type="button" onClick={() => setRowModal(null)} className={btnGhost}>Batal</button>
              <button type="submit" disabled={busy} className={btn}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {rowModal.mode === 'insert' ? 'Tambah Baris' : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* CONFIRM MODAL */}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)} width="max-w-md">
          <p className="text-xs text-slate-300 leading-relaxed">{confirm.message}</p>
          <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-slate-800">
            <button onClick={() => setConfirm(null)} className={btnGhost}>Batal</button>
            <button
              onClick={async () => {
                try {
                  setBusy(true)
                  await confirm.action()
                  setConfirm(null)
                } catch (e: any) {
                  setNotice({ type: 'error', text: e?.message || 'Operasi gagal.' })
                  setConfirm(null)
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
              className={btnDanger}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Ya, Lanjutkan
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
