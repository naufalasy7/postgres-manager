import React, { useEffect, useState, FormEvent } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import {
  LayoutDashboard,
  BookOpen,
  Database,
  ScrollText,
  LogOut,
  Play,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Sliders,
  GitBranch
} from 'lucide-react'
import GitHubRepoManager from './components/GitHubRepoManager'

const xsrf = () =>
  decodeURIComponent(
    document.cookie
      .split('; ')
      .find(c => c.startsWith('XSRF-TOKEN='))
      ?.split('=')[1] ?? ''
  )

async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-XSRF-TOKEN': xsrf()
    }
  })
  if (!r.ok) throw await r.json().catch(() => ({ message: r.statusText }))
  return (r.status === 204 ? null : await r.json()) as T
}

const gb = (n?: number | null) => (n == null ? '-' : (n / 1073741824).toFixed(2) + ' GB')
const formatBytes = (bytes: number | null) => {
  if (bytes === null || bytes === undefined) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(2) + ' MB'
}

const card = 'rounded-xl border border-slate-800 bg-slate-900 p-4'
const inp =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500'
const btn =
  'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50'

function Login({ onOk }: { onOk: () => void }) {
  const [err, setErr] = useState('')
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    try {
      await api('/login', 'POST', { email: f.get('email'), password: f.get('password') })
      onOk()
    } catch (x: any) {
      setErr(x.message)
    }
  }
  return (
    <div className="grid min-h-screen place-items-center bg-slate-950">
      <form onSubmit={submit} className={card + ' w-84 space-y-4 shadow-2xl'}>
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">POSTGRES MANAGER</h1>
          <p className="text-xs text-slate-400 mt-0.5">Centralized Database & Repository Hub</p>
        </div>
        <div className="space-y-2">
          <input
            name="email"
            type="email"
            placeholder="Email"
            className={inp}
            defaultValue="nnaufalasyam7@gmail.com"
            required
          />
          <input name="password" type="password" placeholder="Password" className={inp} required />
        </div>
        {err && (
          <p className="text-sm text-red-400 bg-red-950/40 p-2 rounded border border-red-900">{err}</p>
        )}
        <button className={btn + ' w-full'}>Masuk</button>
      </form>
    </div>
  )
}

function Table({ title, rows, cols }: { title: string; rows: any[]; cols: string[] }) {
  return (
    <div className={card + ' overflow-x-auto'}>
      <p className="mb-2 text-sm font-semibold text-slate-200">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Belum ada data.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400 border-b border-slate-800 text-xs">
            <tr>
              {cols.map(c => (
                <th key={c} className="py-2 pr-4">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-800/30">
                {cols.map(c => (
                  <td key={c} className="py-2 pr-4 text-slate-300">
                    {String(r[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// =========================================================================
// DASHBOARD: SERVER GLOBAL & PER-PROJECT DATABASE MONITORING
// =========================================================================
function Dashboard({
  targetProjectId,
  onNavigateTab
}: {
  targetProjectId?: string | null
  onNavigateTab: (tab: string, repo?: string) => void
}) {
  const [d, setD] = useState<any>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string>(targetProjectId || 'all')
  const [loading, setLoading] = useState(false)
  const [scriptModal, setScriptModal] = useState<{ open: boolean; scriptPath: string; repo: string } | null>(null)
  const [execResult, setExecResult] = useState<any>(null)
  const [execBusy, setExecBusy] = useState(false)

  const loadDashboard = (projId = selectedProjectId) => {
    setLoading(true)
    const url = projId && projId !== 'all' ? `/dashboard?project_id=${projId}` : '/dashboard'
    api(url)
      .then(res => setD(res))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (targetProjectId) {
      setSelectedProjectId(targetProjectId)
      loadDashboard(targetProjectId)
    } else {
      loadDashboard(selectedProjectId)
    }
  }, [targetProjectId, selectedProjectId])

  const handleExecuteScript = async (repo: string, path: string) => {
    if (!d?.project?.id) return
    try {
      setExecBusy(true)
      setExecResult(null)
      const res = await api(`/projects/${d.project.id}/execute-script`, 'POST', {
        repository: repo,
        path: path
      })
      setExecResult(res)
      loadDashboard(selectedProjectId)
    } catch (e: any) {
      setExecResult({ status: 'error', message: e.message || 'Eksekusi skrip gagal.' })
    } finally {
      setExecBusy(false)
    }
  }

  if (!d && loading) return <p className="text-slate-400 text-sm">Memuat dashboard…</p>
  if (!d) return null

  const stat = (k: string, v: any, sub?: string) => (
    <div className={card}>
      <p className="text-xs text-slate-400">{k}</p>
      <p className="text-xl font-semibold text-white mt-1">{v ?? '-'}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )

  const projectsList = d.projects_list || []

  return (
    <div className="space-y-4">
      {/* Top Switcher: Server Global vs Per-Project Database */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center gap-2.5">
          <Sliders className="w-5 h-5 text-emerald-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Pantau Dashboard:
          </span>
          <select
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">🖥️ Server Global (CPU, RAM, Disk, All DBs)</option>
            {projectsList.map((p: any) => (
              <option key={p.id} value={p.id}>
                🗄️ {p.name} ({p.db_name}) {p.repository ? `[Repo: ${p.repository}]` : ''}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => loadDashboard(selectedProjectId)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. PER-PROJECT DATABASE MONITORING MODE                                   */}
      {/* ========================================================================= */}
      {d.mode === 'project' && d.project && (
        <div className="space-y-4">
          {/* Project Details Banner */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Database className="w-6 h-6 text-emerald-400" />
                <h2 className="text-lg font-bold text-white">{d.project.name}</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                  {d.project.status}
                </span>
                {d.project.repository ? (
                  <button
                    onClick={() => onNavigateTab('repos', d.project.repository)}
                    className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono bg-blue-950 text-blue-300 border border-blue-800 hover:underline"
                    title="Buka repository di tab Repositories"
                  >
                    <BookOpen className="w-3 h-3" />
                    <span>Repo: {d.project.repository}</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-500 font-mono">Tanpa Repository</span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Database: <strong className="text-white font-mono">{d.project.db_name}</strong> • User:{' '}
                <strong className="text-white font-mono">{d.project.db_user}</strong> • Host:{' '}
                <strong className="text-white font-mono">{d.project.host}:{d.project.port}</strong>
              </p>
            </div>

            <div className="flex items-center gap-2">
              {d.project.repository && (
                <button
                  onClick={() => onNavigateTab('repos', d.project.repository)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Buka Repo</span>
                </button>
              )}
            </div>
          </div>

          {/* Project DB Stats Cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stat('Ukuran Database', formatBytes(d.db_stats.size_bytes), d.project.db_name)}
            {stat('Koneksi Aktif DB', d.db_stats.connections, 'pg_stat_activity')}
            {stat('Jumlah Tabel', d.db_stats.table_count + ' tabel', 'skema public')}
            {stat('Buffer Cache Hit', d.db_stats.cache_ratio + '%', 'efisiensi memori')}
            {stat('Transaksi Berhasil', d.db_stats.commits.toLocaleString(), 'commits')}
            {stat('Transaksi Batal', d.db_stats.rollbacks.toLocaleString(), 'rollbacks')}
            {stat('Deadlocks', d.db_stats.deadlocks, 'konflik kunci')}
            {stat('Status Koneksi', d.db_stats.up ? 'CONNECTED' : 'FAILED', d.db_stats.up ? 'Superuser/Owner OK' : 'Error')}
          </div>

          {/* EKOSISTEM: Skrip dari Repository untuk Database Ini */}
          {d.project.repository && (
            <div className={card + ' space-y-3'}>
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-semibold text-sm text-white">
                    Skrip Repository: <span className="font-mono text-emerald-400">{d.project.repository}</span>
                  </h3>
                  <span className="text-xs text-slate-400">(1 Ekosistem Git & Database)</span>
                </div>
                <button
                  onClick={() => onNavigateTab('repos', d.project.repository)}
                  className="text-xs text-emerald-400 hover:underline"
                >
                  Kelola di Git Repo →
                </button>
              </div>

              {d.repo_scripts && d.repo_scripts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {d.repo_scripts.map((s: any) => (
                    <div
                      key={s.path}
                      className="p-3 rounded-lg border border-slate-800 bg-slate-950/70 flex items-center justify-between gap-3"
                    >
                      <div className="truncate">
                        <p className="text-xs font-mono font-semibold text-slate-200 truncate">{s.name}</p>
                        <p className="text-[11px] font-mono text-slate-500 truncate">{s.path}</p>
                      </div>
                      <button
                        disabled={execBusy}
                        onClick={() => handleExecuteScript(d.project.repository, s.path)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium shrink-0 disabled:opacity-50"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Jalankan</span>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Tidak ada file SQL di repository ini. Buat atau unggah file .sql di tab Repositories.
                </p>
              )}

              {/* Execution feedback */}
              {execResult && (
                <div
                  className={`p-3 rounded-lg border text-xs space-y-2 ${
                    execResult.status === 'success'
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                      : 'bg-red-950/40 border-red-800 text-red-200'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span>{execResult.message}</span>
                    <button onClick={() => setExecResult(null)} className="text-slate-400 hover:text-white">
                      ✕
                    </button>
                  </div>
                  {execResult.columns && execResult.rows && execResult.rows.length > 0 && (
                    <div className="max-h-40 overflow-auto rounded bg-slate-950 p-2 border border-slate-800 font-mono text-[11px]">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400">
                            {execResult.columns.map((c: string) => (
                              <th key={c} className="p-1">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {execResult.rows.map((row: any, i: number) => (
                            <tr key={i} className="border-b border-slate-900">
                              {execResult.columns.map((c: string) => (
                                <td key={c} className="p-1 text-slate-200">
                                  {String(row[c] ?? '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Top Tables Chart & Table */}
          {d.tables && d.tables.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className={card}>
                <p className="mb-2 text-sm font-semibold text-slate-200">Ukuran Tabel Terbesar (MB)</p>
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart
                      data={d.tables.map((x: any) => ({
                        name: x.name,
                        mb: +x.total_mb
                      }))}
                    >
                      <XAxis dataKey="name" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="mb" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className={card + ' overflow-x-auto'}>
                <p className="mb-2 text-sm font-semibold text-slate-200">Daftar Tabel di Database</p>
                <table className="w-full text-left text-xs font-mono">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 pr-3">Tabel</th>
                      <th className="py-2 pr-3 text-right">Baris</th>
                      <th className="py-2 pr-3 text-right">Data</th>
                      <th className="py-2 pr-3 text-right">Index</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {d.tables.map((t: any) => (
                      <tr key={t.name} className="hover:bg-slate-800/30">
                        <td className="py-2 pr-3 text-emerald-400 font-semibold">{t.name}</td>
                        <td className="py-2 pr-3 text-right text-slate-300">
                          {Number(t.row_estimate).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-400">{t.table_mb} MB</td>
                        <td className="py-2 pr-3 text-right text-slate-400">{t.index_mb} MB</td>
                        <td className="py-2 pr-3 text-right text-white font-semibold">{t.total_mb} MB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Active Queries on this DB */}
          <div className={card + ' overflow-x-auto'}>
            <p className="mb-2 text-sm font-semibold text-slate-200">Koneksi & Query Aktif (pg_stat_activity)</p>
            {d.active_queries && d.active_queries.length > 0 ? (
              <table className="w-full text-left text-xs font-mono">
                <thead className="text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-3">PID</th>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3">State</th>
                    <th className="py-2 pr-3">Durasi</th>
                    <th className="py-2 pr-3">Query</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {d.active_queries.map((q: any) => (
                    <tr key={q.pid} className="hover:bg-slate-800/30">
                      <td className="py-2 pr-3 text-slate-400">{q.pid}</td>
                      <td className="py-2 pr-3 text-slate-300">{q.usename}</td>
                      <td className="py-2 pr-3 text-slate-400">{q.client_addr || 'local'}</td>
                      <td className="py-2 pr-3 text-emerald-400">{q.state}</td>
                      <td className="py-2 pr-3 text-slate-300">{q.duration_seconds}s</td>
                      <td className="py-2 pr-3 text-slate-200 truncate max-w-xs">{q.query}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-slate-500 py-2">Tidak ada query aktif yang sedang berjalan saat ini.</p>
            )}
          </div>

          {/* Recent Operations */}
          <Table
            title="Riwayat Operasi Database Proyek Ini"
            rows={d.recent_ops || []}
            cols={['created_at', 'operation', 'status']}
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. SERVER GLOBAL MONITORING MODE (DEFAULT)                                */}
      {/* ========================================================================= */}
      {d.mode === 'global' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stat('PostgreSQL', d.postgres.up ? `UP · v${d.postgres.version}` : 'DOWN')}
            {stat('Host:Port', d.postgres.up ? `${d.postgres.host}:${d.postgres.port}` : '-')}
            {stat('Proyek Terdaftar', d.projects)}
            {stat('Total Koneksi Server', d.postgres.connections)}
            {stat('CPU Server', d.system.cpu_percent + '%', `Load avg: ${d.system.load1}`)}
            {stat('RAM Server', `${gb(d.system.ram_used)} / ${gb(d.system.ram_total)}`)}
            {stat('Disk Bebas', gb(d.system.disk_free))}
            {stat('Tailscale IP', d.system.tailscale_ip ?? 'tidak aktif')}
          </div>

          {d.postgres.up && (
            <div className={card}>
              <p className="mb-2 text-sm font-semibold text-slate-200">Ukuran Database di Server (MB)</p>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart
                    data={d.postgres.databases.map((x: any) => ({
                      name: x.name,
                      mb: +(x.size / 1048576).toFixed(1)
                    }))}
                  >
                    <XAxis dataKey="name" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip />
                    <Bar dataKey="mb" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <Table
            title="Aktivitas Terbaru Seluruh Server"
            rows={d.recent_ops}
            cols={['created_at', 'action', 'subject', 'status']}
          />
        </div>
      )}
    </div>
  )
}

// =========================================================================
// PROJECTS MANAGER WITH LINKED REPOSITORIES
// =========================================================================
function Projects({
  onSelectProjectForDashboard,
  onOpenRepo
}: {
  onSelectProjectForDashboard: (id: number) => void
  onOpenRepo: (repo: string) => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [openWizard, setOpenWizard] = useState(false)
  const [q, setQ] = useState('')
  const [linkRepoModal, setLinkRepoModal] = useState<any | null>(null)
  const [execModal, setExecModal] = useState<any | null>(null)
  const [repos, setRepos] = useState<any[]>([])
  const [availableScripts, setAvailableScripts] = useState<any[]>([])
  const [selectedScript, setSelectedScript] = useState('')
  const [execResult, setExecResult] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api('/projects?search=' + encodeURIComponent(q)).then(setRows)

  useEffect(() => {
    load()
    api('/repositories').then(setRepos).catch(() => {})
  }, [q])

  const openLinkRepo = (project: any) => {
    setLinkRepoModal({ project, repo: project.repository || '' })
  }

  const submitLinkRepo = async (e: FormEvent) => {
    e.preventDefault()
    if (!linkRepoModal) return
    try {
      setBusy(true)
      await api(`/projects/${linkRepoModal.project.id}/link-repo`, 'POST', {
        repository: linkRepoModal.repo || null
      })
      setLinkRepoModal(null)
      load()
    } catch (err: any) {
      alert(err.message || 'Gagal menghubungkan repository.')
    } finally {
      setBusy(false)
    }
  }

  const openExecuteModal = async (project: any) => {
    setExecModal(project)
    setExecResult(null)
    setSelectedScript('')
    setAvailableScripts([])
    if (project.repository) {
      const list = await api(`/repositories/${encodeURIComponent(project.repository)}/sql-scripts`).catch(() => [])
      setAvailableScripts(list)
      if (list.length > 0) setSelectedScript(list[0].path)
    }
  }

  const runScriptOnProject = async (e: FormEvent) => {
    e.preventDefault()
    if (!execModal || !selectedScript) return
    try {
      setBusy(true)
      setExecResult(null)
      const res = await api(`/projects/${execModal.id}/execute-script`, 'POST', {
        repository: execModal.repository,
        path: selectedScript
      })
      setExecResult(res)
    } catch (err: any) {
      setExecResult({ status: 'error', message: err.message || 'Eksekusi gagal.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className={inp + ' max-w-md'}
          placeholder="Cari proyek berdasarkan nama atau slug…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button className={btn} onClick={() => setOpenWizard(true)}>
          + Buat Proyek Baru
        </button>
      </div>

      {/* Projects Table */}
      <div className={card + ' overflow-x-auto'}>
        <p className="mb-3 text-sm font-semibold text-slate-200">Daftar Proyek Database & Repository Terhubung</p>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">Belum ada proyek database. Klik "+ Buat Proyek Baru".</p>
        ) : (
          <table className="w-full text-left text-xs font-mono">
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 pr-4">Nama Proyek</th>
                <th className="py-2.5 pr-4">Database</th>
                <th className="py-2.5 pr-4">User DB</th>
                <th className="py-2.5 pr-4">Repository Git</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4 text-right">Aksi Ekosistem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-800/30">
                  <td className="py-3 pr-4">
                    <p className="font-sans font-bold text-slate-200">{r.name}</p>
                    <p className="text-[11px] text-slate-500">{r.slug}</p>
                  </td>
                  <td className="py-3 pr-4 text-emerald-400 font-semibold">{r.db_name}</td>
                  <td className="py-3 pr-4 text-slate-300">{r.db_user}</td>
                  <td className="py-3 pr-4">
                    {r.repository ? (
                      <button
                        onClick={() => onOpenRepo(r.repository)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-950/80 text-blue-300 border border-blue-800 hover:underline"
                        title="Buka repository di tab Repositories"
                      >
                        <BookOpen className="w-3 h-3" />
                        <span>{r.repository}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => openLinkRepo(r)}
                        className="text-[11px] text-slate-500 hover:text-slate-300 hover:underline"
                      >
                        + Hubungkan Repo
                      </button>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300">
                      {r.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <div className="flex items-center justify-end gap-2 font-sans">
                      <button
                        onClick={() => onSelectProjectForDashboard(r.id)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-emerald-400 font-medium"
                      >
                        Pantau DB
                      </button>

                      {r.repository && (
                        <button
                          onClick={() => openExecuteModal(r)}
                          className="px-2.5 py-1 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-xs text-emerald-300 font-medium"
                        >
                          Jalankan Skrip
                        </button>
                      )}

                      <button
                        onClick={() => openLinkRepo(r)}
                        className="px-2 py-1 text-xs text-slate-400 hover:text-white"
                        title="Ubah Repository"
                      >
                        Repo
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Link Repository */}
      {linkRepoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <form
            onSubmit={submitLinkRepo}
            className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4 shadow-2xl"
          >
            <h3 className="font-semibold text-sm text-white">
              Hubungkan Repository ke Proyek: <span className="text-emerald-400">{linkRepoModal.project.name}</span>
            </h3>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Pilih Repository</label>
              <select
                value={linkRepoModal.repo}
                onChange={e => setLinkRepoModal({ ...linkRepoModal, repo: e.target.value })}
                className={inp}
              >
                <option value="">(Tidak terhubung / Tanpa Repo)</option>
                {repos.map(r => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setLinkRepoModal(null)}
                className="px-4 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Batal
              </button>
              <button disabled={busy} className={btn + ' text-xs'}>
                {busy ? 'Menyimpan...' : 'Simpan Koneksi Repo'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Execute Script on Project DB */}
      {execModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <h3 className="font-semibold text-sm text-white">
              Jalankan Skrip Repository ke Database:{' '}
              <span className="text-emerald-400 font-mono">{execModal.db_name}</span>
            </h3>
            <p className="text-xs text-slate-400">
              Repository: <strong className="text-white font-mono">{execModal.repository}</strong>
            </p>

            <form onSubmit={runScriptOnProject} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Pilih File Skrip SQL</label>
                <select
                  value={selectedScript}
                  onChange={e => setSelectedScript(e.target.value)}
                  className={inp + ' font-mono text-xs'}
                  required
                >
                  {availableScripts.map(s => (
                    <option key={s.path} value={s.path}>
                      {s.path} ({formatBytes(s.size)})
                    </option>
                  ))}
                </select>
              </div>

              {execResult && (
                <div
                  className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                    execResult.status === 'success'
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                      : 'bg-red-950/40 border-red-800 text-red-200'
                  }`}
                >
                  <p className="font-semibold">{execResult.message}</p>
                  {execResult.rows_affected !== undefined && (
                    <p className="text-[11px] text-slate-300">Baris terpengaruh / hasil: {execResult.rows_affected}</p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setExecModal(null)}
                  className="px-4 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Tutup
                </button>
                <button disabled={busy || !selectedScript} className={btn + ' text-xs'}>
                  {busy ? 'Mengeksekusi...' : 'Jalankan Skrip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {openWizard && (
        <Wizard
          repos={repos}
          onClose={() => {
            setOpenWizard(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function Wizard({ repos, onClose }: { repos: any[]; onClose: () => void }) {
  const [tpls, setTpls] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [res, setRes] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState('')
  const [repoScripts, setRepoScripts] = useState<any[]>([])
  const [selectedScript, setSelectedScript] = useState('')

  useEffect(() => {
    api('/templates').then(setTpls)
  }, [])

  useEffect(() => {
    if (selectedRepo) {
      api(`/repositories/${encodeURIComponent(selectedRepo)}/sql-scripts`)
        .then(list => {
          setRepoScripts(list)
          if (list.length > 0) setSelectedScript(list[0].path)
        })
        .catch(() => setRepoScripts([]))
    } else {
      setRepoScripts([])
      setSelectedScript('')
    }
  }, [selectedRepo])

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget))
    setBusy(true)
    setErr('')
    try {
      setRes(
        await api('/projects', 'POST', {
          ...f,
          template_id: +(f.template_id as string),
          repository: selectedRepo || null,
          init_sql_path: selectedScript || null
        })
      )
    } catch (x: any) {
      setErr(x.message + (x.errors ? ' ' + JSON.stringify(x.errors) : ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className={card + ' max-h-[90vh] w-full max-w-lg overflow-auto shadow-2xl'}>
        {res ? (
          <div className="space-y-3 text-sm">
            <h2 className="font-semibold text-emerald-400">Proyek dibuat</h2>
            <p className="text-amber-400 text-xs">Simpan password ini sekarang — tidak akan ditampilkan lagi.</p>
            <pre className="rounded bg-slate-950 p-3 text-xs font-mono">{`host: ${res.host}:${res.port}\ndb: ${res.db_name}\nuser: ${res.db_user}\npassword: ${res.password}`}</pre>
            <ul className="list-disc pl-5 text-slate-400 text-xs">
              {res.steps.map((s: string) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <button className={btn} onClick={onClose}>
              Selesai
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="font-semibold text-white">Proyek Baru (Ekosistem DB & Git)</h2>
            <input name="name" placeholder="Nama proyek" className={inp} required />
            <input name="slug" placeholder="slug (huruf kecil, angka, -)" className={inp} required />
            <input name="description" placeholder="Deskripsi" className={inp} />
            <input name="db_name" placeholder="nama database (a-z0-9_)" className={inp} required />
            <input name="db_user" placeholder="user PostgreSQL" className={inp} required />

            <div className="grid grid-cols-2 gap-2">
              <select name="encoding" className={inp}>
                <option>UTF8</option>
              </select>
              <select name="locale" className={inp}>
                <option>C.UTF-8</option>
                <option>en_US.UTF-8</option>
                <option>C</option>
              </select>
            </div>

            <select name="template_id" className={inp}>
              {tpls.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            {/* Hubungkan ke Repository */}
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/80 space-y-2">
              <label className="block text-xs font-semibold text-emerald-400">
                Hubungkan ke Repository Git (1 Ekosistem):
              </label>
              <select
                value={selectedRepo}
                onChange={e => setSelectedRepo(e.target.value)}
                className={inp + ' text-xs'}
              >
                <option value="">(Tanpa Repository Terhubung)</option>
                {repos.map(r => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>

              {selectedRepo && repoScripts.length > 0 && (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Inisialisasi Skrip dari Repo ke Database:
                  </label>
                  <select
                    value={selectedScript}
                    onChange={e => setSelectedScript(e.target.value)}
                    className={inp + ' text-xs font-mono'}
                  >
                    <option value="">(Jangan jalankan skrip awal)</option>
                    {repoScripts.map(s => (
                      <option key={s.path} value={s.path}>
                        {s.path}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <select name="backup_policy" className={inp}>
              <option value="none">Backup: manual</option>
              <option value="daily">Harian</option>
              <option value="weekly">Mingguan</option>
            </select>

            <p className="text-xs text-slate-500">
              Password dibuat otomatis (32 hex) dan dienkripsi di master DB.
            </p>

            {err && <p className="text-sm text-red-400">{err}</p>}

            <div className="flex gap-2 pt-2">
              <button className={btn} disabled={busy}>
                {busy ? 'Memproses…' : 'Buat proyek'}
              </button>
              <button type="button" className="px-3 text-sm text-slate-400 hover:text-white" onClick={onClose}>
                Batal
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<string | null | undefined>(undefined)
  const [tab, setTab] = useState('repos')
  const [audit, setAudit] = useState<any[]>([])
  const [dashboardTargetProjectId, setDashboardTargetProjectId] = useState<string | null>(null)
  const [targetRepoName, setTargetRepoName] = useState<string | null>(null)

  const boot = () =>
    api('/csrf')
      .then(() => api('/me'))
      .then((m: any) => setUser(m.email))
      .catch(() => setUser(null))

  useEffect(() => {
    boot()
  }, [])

  useEffect(() => {
    if (tab === 'audit') api('/audit').then(setAudit)
  }, [tab])

  if (user === undefined) return null
  if (!user) return <Login onOk={boot} />

  const navItem = (k: string, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => setTab(k)}
      className={`flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
        tab === k
          ? 'bg-slate-800 text-emerald-400 border border-slate-700/80 shadow-sm'
          : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )

  const handleSelectProjectForDashboard = (projId: number) => {
    setDashboardTargetProjectId(String(projId))
    setTab('dash')
  }

  const handleOpenRepoFromProject = (repoName: string) => {
    setTargetRepoName(repoName)
    setTab('repos')
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-56 shrink-0 flex flex-col justify-between border-r border-slate-800/80 bg-slate-950 p-4">
        <div className="space-y-4">
          <div className="px-1">
            <h1 className="font-extrabold text-sm tracking-wider text-white">POSTGRES MANAGER</h1>
            <p className="text-[10px] uppercase font-mono text-emerald-400">Git & Database Hub</p>
          </div>
          <nav className="space-y-1">
            {navItem('repos', 'Repositories', <BookOpen className="w-4 h-4" />)}
            {navItem('dash', 'Dashboard', <LayoutDashboard className="w-4 h-4" />)}
            {navItem('proj', 'Proyek DB', <Database className="w-4 h-4" />)}
            {navItem('audit', 'Audit Log', <ScrollText className="w-4 h-4" />)}
          </nav>
        </div>

        <div className="pt-4 border-t border-slate-800/60">
          <div className="px-2 pb-2">
            <p className="text-[11px] text-slate-500 truncate">Logged in as:</p>
            <p className="text-xs font-mono text-slate-300 truncate" title={user}>
              {user}
            </p>
          </div>
          <button
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs text-red-400 hover:bg-red-950/40 hover:text-red-300 transition"
            onClick={async () => {
              await api('/logout', 'POST')
              setUser(null)
            }}
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        {tab === 'repos' && (
          <GitHubRepoManager
            api={api}
            xsrf={xsrf}
            initialRepo={targetRepoName}
            onOpenProjectDashboard={projId => {
              setDashboardTargetProjectId(String(projId))
              setTab('dash')
            }}
          />
        )}
        {tab === 'dash' && (
          <Dashboard
            targetProjectId={dashboardTargetProjectId}
            onNavigateTab={(targetTab, repo) => {
              if (repo) setTargetRepoName(repo)
              setTab(targetTab)
            }}
          />
        )}
        {tab === 'proj' && (
          <Projects
            onSelectProjectForDashboard={handleSelectProjectForDashboard}
            onOpenRepo={handleOpenRepoFromProject}
          />
        )}
        {tab === 'audit' && (
          <Table
            title="Audit Log Aktivitas"
            rows={audit}
            cols={['created_at', 'user_id', 'action', 'subject', 'status', 'ip']}
          />
        )}
      </main>
    </div>
  )
}
