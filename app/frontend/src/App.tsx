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
  GitBranch,
  Rocket,
  Square,
  RotateCw,
  Terminal,
  Settings,
  Copy,
  Check,
  Globe,
  Radio,
  Wifi,
  Cpu
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

  // Deployment handlers & state
  const [deployBusy, setDeployBusy] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [deployLogs, setDeployLogs] = useState<string>('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [settingsModal, setSettingsModal] = useState<any | null>(null)

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const handleDeploy = async (projectId: number, options = {}) => {
    try {
      setDeployBusy(true)
      await api(`/projects/${projectId}/deploy`, 'POST', options)
      loadDashboard(selectedProjectId)
    } catch (e: any) {
      alert(e.message || 'Gagal melakukan deployment.')
    } finally {
      setDeployBusy(false)
    }
  }

  const handleStop = async (projectId: number) => {
    try {
      setDeployBusy(true)
      await api(`/projects/${projectId}/deploy/stop`, 'POST')
      loadDashboard(selectedProjectId)
    } catch (e: any) {
      alert(e.message || 'Gagal menghentikan layanan.')
    } finally {
      setDeployBusy(false)
    }
  }

  const handleRestart = async (projectId: number) => {
    try {
      setDeployBusy(true)
      await api(`/projects/${projectId}/deploy/restart`, 'POST')
      loadDashboard(selectedProjectId)
    } catch (e: any) {
      alert(e.message || 'Gagal me-restart layanan.')
    } finally {
      setDeployBusy(false)
    }
  }

  const handleLoadLogs = async (projectId: number) => {
    try {
      const res = await api(`/projects/${projectId}/deploy/logs?lines=100`)
      setDeployLogs(res.content || 'Belum ada log deployment.')
      setShowLogs(true)
    } catch (e: any) {
      alert(e.message || 'Gagal memuat log.')
    }
  }

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault()
    if (!settingsModal) return
    try {
      setDeployBusy(true)
      await api(`/projects/${settingsModal.project_id}/deploy/settings`, 'PUT', {
        deploy_port: settingsModal.port,
        deploy_type: settingsModal.type,
        deploy_command: settingsModal.command,
        deploy_dir: settingsModal.dir,
        auto_deploy: settingsModal.auto_deploy,
      })
      setSettingsModal(null)
      loadDashboard(selectedProjectId)
    } catch (e: any) {
      alert(e.message || 'Gagal menyimpan pengaturan.')
    } finally {
      setDeployBusy(false)
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

          {/* ========================================================================= */}
          {/* AUTO DEPLOY & SERVICE ACCESS (IP:PORT) SECTION                           */}
          {/* ========================================================================= */}
          {d.deployment && (
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-5 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

              {/* Header Bar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800 relative z-10">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2.5 rounded-xl border ${
                      d.deployment.deploy_status === 'running'
                        ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400 shadow-lg shadow-emerald-500/20'
                        : d.deployment.deploy_status === 'failed'
                        ? 'bg-red-950/80 border-red-500/50 text-red-400'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                  >
                    <Rocket className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-base font-bold text-white">Auto Deploy & Akses Layanan</h3>
                      {d.deployment.deploy_status === 'running' ? (
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700 shadow-sm shadow-emerald-900/50">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          ONLINE (:{d.deployment.deploy_port})
                        </span>
                      ) : d.deployment.deploy_status === 'failed' ? (
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-950 text-red-400 border border-red-800">
                          <AlertCircle className="w-3.5 h-3.5" />
                          GAGAL / ERROR
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                          <span className="w-2 h-2 rounded-full bg-slate-500" />
                          OFFLINE / STOPPED
                        </span>
                      )}

                      {d.deployment.auto_deploy && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-blue-950 text-blue-300 border border-blue-800">
                          Auto-Deploy on Push
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Tipe Layanan:{' '}
                      <span className="font-semibold text-slate-200">
                        {d.deployment.deploy_type === 'builtin_api'
                          ? 'Built-in PostgreSQL REST API & Explorer'
                          : d.deployment.deploy_type === 'python_app'
                          ? 'Aplikasi Web Python / FastAPI'
                          : d.deployment.deploy_type === 'script_runner'
                          ? 'Shell Script Runner'
                          : d.deployment.deploy_type || 'Auto Detect'}
                      </span>
                      {d.deployment.uptime && ` • Uptime: ${d.deployment.uptime}`}
                      {d.deployment.memory && ` • RAM: ${d.deployment.memory}`}
                      {d.deployment.deploy_pid && ` • PID: ${d.deployment.deploy_pid}`}
                    </p>
                  </div>
                </div>

                {/* Control Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  {d.deployment.deploy_status === 'running' ? (
                    <>
                      <button
                        disabled={deployBusy}
                        onClick={() => handleRestart(d.project.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition border border-slate-700 disabled:opacity-50"
                        title="Restart Layanan"
                      >
                        <RotateCw className={`w-3.5 h-3.5 ${deployBusy ? 'animate-spin' : ''}`} />
                        <span>Restart</span>
                      </button>
                      <button
                        disabled={deployBusy}
                        onClick={() => handleStop(d.project.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/80 hover:bg-red-900 text-xs font-semibold text-red-300 transition border border-red-800 disabled:opacity-50"
                        title="Hentikan Layanan"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>Stop</span>
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={deployBusy}
                      onClick={() => handleDeploy(d.project.id)}
                      className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-slate-950 transition shadow-lg shadow-emerald-600/30 disabled:opacity-50"
                    >
                      <Rocket className="w-4 h-4" />
                      <span>{deployBusy ? 'Mendeploy...' : 'Auto Deploy Sekarang'}</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleLoadLogs(d.project.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition border border-slate-700"
                    title="Lihat Log Real-time"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Log</span>
                  </button>

                  <button
                    onClick={() =>
                      setSettingsModal({
                        project_id: d.project.id,
                        port: d.deployment.deploy_port || 8200,
                        type: d.deployment.deploy_type || 'auto',
                        command: d.deployment.deploy_command || '',
                        dir: d.deployment.deploy_dir || '',
                        auto_deploy: !!d.deployment.auto_deploy,
                        detected_configs: d.deployment.detected_configs || []
                      })
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition border border-slate-700"
                    title="Pengaturan Deployment"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Pengaturan</span>
                  </button>
                </div>
              </div>

              {/* URL Cards (IP & Port Access) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-4 relative z-10">
                {/* 1. Akses LAN IP */}
                <div
                  className={`p-4 rounded-xl border transition ${
                    d.deployment.deploy_status === 'running'
                      ? 'bg-slate-950/80 border-emerald-600/40 hover:border-emerald-500 shadow-md shadow-emerald-950/20'
                      : 'bg-slate-950/40 border-slate-800/80 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                        Akses Jaringan LAN
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      Wi-Fi / Ethernet
                    </span>
                  </div>

                  <p className="font-mono text-sm font-bold text-emerald-300 break-all select-all py-1">
                    {d.deployment.urls?.lan ||
                      `http://${d.deployment.system_ips?.lan}:${d.deployment.deploy_port || 8200}`}
                  </p>

                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/60">
                    <a
                      href={
                        d.deployment.urls?.lan ||
                        `http://${d.deployment.system_ips?.lan}:${d.deployment.deploy_port || 8200}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-semibold transition ${
                        d.deployment.deploy_status === 'running'
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-600/20'
                          : 'bg-slate-800 text-slate-500 pointer-events-none'
                      }`}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Buka Layanan</span>
                    </a>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          d.deployment.urls?.lan ||
                            `http://${d.deployment.system_ips?.lan}:${d.deployment.deploy_port || 8200}`,
                          'lan'
                        )
                      }
                      className="flex items-center gap-1 py-1.5 px-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                      title="Salin URL LAN"
                    >
                      {copiedKey === 'lan' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedKey === 'lan' ? 'Tersalin' : 'Salin'}</span>
                    </button>
                  </div>
                </div>

                {/* 2. Akses Tailscale IP */}
                <div
                  className={`p-4 rounded-xl border transition ${
                    d.deployment.deploy_status === 'running'
                      ? 'bg-slate-950/80 border-blue-600/40 hover:border-blue-500 shadow-md shadow-blue-950/20'
                      : 'bg-slate-950/40 border-slate-800/80 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                        Akses Tailscale VPN
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-400 border border-blue-900">
                      Remote / Luar
                    </span>
                  </div>

                  {d.deployment.urls?.tailscale ? (
                    <>
                      <p className="font-mono text-sm font-bold text-blue-300 break-all select-all py-1">
                        {d.deployment.urls.tailscale}
                      </p>
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/60">
                        <a
                          href={d.deployment.urls.tailscale}
                          target="_blank"
                          rel="noreferrer"
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-semibold transition ${
                            d.deployment.deploy_status === 'running'
                              ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-600/20'
                              : 'bg-slate-800 text-slate-500 pointer-events-none'
                          }`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Buka Layanan</span>
                        </a>
                        <button
                          onClick={() => copyToClipboard(d.deployment.urls.tailscale, 'ts')}
                          className="flex items-center gap-1 py-1.5 px-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                          title="Salin URL Tailscale"
                        >
                          {copiedKey === 'ts' ? (
                            <Check className="w-3.5 h-3.5 text-blue-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedKey === 'ts' ? 'Tersalin' : 'Salin'}</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="py-3 text-xs text-slate-500 font-mono">
                      Tailscale tidak aktif di server ini.
                    </div>
                  )}
                </div>

                {/* 3. Port & Host Binding Info */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/80 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <Radio className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                          Port & Binding
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-900">
                        0.0.0.0
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl font-bold font-mono text-white">
                        :{d.deployment.deploy_port || 8200}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">TCP HTTP</span>
                    </div>

                    <p className="text-[11px] text-slate-400 mt-1">
                      Terbuka untuk semua antarmuka jaringan server (LAN, Tailscale, Localhost).
                    </p>
                  </div>

                  <div className="pt-2 mt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span>Local: 127.0.0.1:{d.deployment.deploy_port || 8200}</span>
                    <span className={d.deployment.is_listening ? 'text-emerald-400' : 'text-slate-500'}>
                      {d.deployment.is_listening ? '● Listening' : '○ Standby'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Deployment Error Banner if any */}
              {d.deployment.deploy_error && (
                <div className="mt-3 p-3 rounded-lg bg-red-950/50 border border-red-800 text-xs text-red-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">{d.deployment.deploy_error}</p>
                    <button
                      onClick={() => handleLoadLogs(d.project.id)}
                      className="underline text-red-300 hover:text-white mt-0.5"
                    >
                      Buka Log Deployment untuk melihat rincian penyebab error
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

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

          {/* ========================================================================= */}
          {/* GLOBAL DEPLOYED PROJECT SERVICES SECTION                                 */}
          {/* ========================================================================= */}
          {d.deployments && d.deployments.length > 0 && (
            <div className={card + ' space-y-3'}>
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Rocket className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-semibold text-sm text-white">
                    Layanan Proyek Database Ter-Deploy (Active Services & Ports)
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {d.deployments.filter((x: any) => x.deploy_status === 'running').length} Aktif /{' '}
                  {d.deployments.length} Total
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {d.deployments.map((dep: any) => (
                  <div
                    key={dep.project_id}
                    className={`p-4 rounded-xl border flex flex-col justify-between transition ${
                      dep.deploy_status === 'running'
                        ? 'bg-slate-900/90 border-emerald-600/40 shadow-lg shadow-emerald-950/20'
                        : 'bg-slate-900/40 border-slate-800 opacity-75'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-sm text-white truncate">{dep.name}</span>
                        {dep.deploy_status === 'running' ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            :{dep.deploy_port}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400">
                            Offline
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 font-mono">
                        DB: <span className="text-emerald-400">{dep.db_name}</span>
                        {dep.repository ? ` • Repo: ${dep.repository}` : ''}
                      </p>

                      {dep.deploy_status === 'running' && dep.urls?.lan && (
                        <div className="mt-3 p-2 rounded bg-slate-950 border border-slate-800/80 space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-slate-500">LAN:</span>
                            <a
                              href={dep.urls.lan}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-300 hover:underline truncate max-w-[190px]"
                            >
                              {dep.urls.lan}
                            </a>
                          </div>
                          {dep.urls.tailscale && (
                            <div className="flex items-center justify-between text-[11px] font-mono">
                              <span className="text-slate-500">TS:</span>
                              <a
                                href={dep.urls.tailscale}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-300 hover:underline truncate max-w-[190px]"
                              >
                                {dep.urls.tailscale}
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-800">
                      <button
                        onClick={() => setSelectedProjectId(String(dep.project_id))}
                        className="text-xs text-emerald-400 hover:underline font-medium"
                      >
                        Pantau Detail →
                      </button>

                      <div className="flex items-center gap-1.5">
                        {dep.deploy_status === 'running' ? (
                          <>
                            <a
                              href={dep.urls?.lan}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Buka</span>
                            </a>
                            <button
                              onClick={() => handleStop(dep.project_id)}
                              className="p-1 rounded bg-slate-800 hover:bg-red-950 text-slate-400 hover:text-red-300"
                              title="Stop"
                            >
                              <Square className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleDeploy(dep.project_id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-emerald-950 border border-slate-700 hover:border-emerald-700 text-emerald-300 text-xs font-medium"
                          >
                            <Rocket className="w-3 h-3" />
                            <span>Deploy</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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

      {/* ========================================================================= */}
      {/* MODAL: PENGATURAN DEPLOYMENT                                              */}
      {/* ========================================================================= */}
      {settingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveSettings}
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base text-white">Pengaturan Auto Deploy</h3>
              </div>
              <button
                type="button"
                onClick={() => setSettingsModal(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Port Layanan (Binding 0.0.0.0)
                </label>
                <input
                  type="number"
                  min="1024"
                  max="65535"
                  className={inp}
                  value={settingsModal.port}
                  onChange={e => setSettingsModal({ ...settingsModal, port: parseInt(e.target.value) || 8200 })}
                  placeholder="8200"
                  required
                />
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Port HTTP unik untuk proyek ini (misal: 8200, 8201, 8202).
                </p>
              </div>

              {settingsModal.detected_configs && settingsModal.detected_configs.length > 0 && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    Pilih Profil Peluncur (Auto Detected)
                  </label>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {settingsModal.detected_configs.map((cfg: any) => (
                      <div
                        key={cfg.id}
                        onClick={() =>
                          setSettingsModal({
                            ...settingsModal,
                            type: cfg.id,
                            command: cfg.command,
                            dir: cfg.dir
                          })
                        }
                        className={`p-3 rounded-lg border cursor-pointer transition text-left ${
                          settingsModal.type === cfg.id
                            ? 'bg-emerald-950/70 border-emerald-500/80 text-white'
                            : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-xs">{cfg.name}</p>
                          {cfg.recommended && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-900 text-emerald-300 border border-emerald-700">
                              Disarankan
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{cfg.description}</p>
                        <p className="text-[10px] font-mono text-emerald-400/80 mt-1 truncate">
                          {cfg.command}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Perintah Eksekusi (Command)
                </label>
                <input
                  type="text"
                  className={inp + ' font-mono text-xs'}
                  value={settingsModal.command}
                  onChange={e => setSettingsModal({ ...settingsModal, command: e.target.value })}
                  placeholder="Gunakan {PORT} sebagai placeholder port"
                />
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Tersedia variabel env: <code className="text-emerald-400">PORT, HTTP_PORT, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD</code>
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Direktori Kerja (Working Directory)</label>
                <input
                  type="text"
                  className={inp + ' font-mono text-xs'}
                  value={settingsModal.dir}
                  onChange={e => setSettingsModal({ ...settingsModal, dir: e.target.value })}
                  placeholder="Kosongkan untuk direktori proyek default"
                />
              </div>

              <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-200">Auto Deploy Saat Ada Perubahan Repo</p>
                  <p className="text-[11px] text-slate-400">
                    Otomatis me-redeploy aplikasi saat ada file baru di-upload atau di-edit di Git Repository.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settingsModal.auto_deploy}
                  onChange={e => setSettingsModal({ ...settingsModal, auto_deploy: e.target.checked })}
                  className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSettingsModal(null)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                Batal
              </button>
              <button disabled={deployBusy} className={btn + ' text-xs font-semibold'}>
                {deployBusy ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: LOG DEPLOYMENT CONSOLE                                             */}
      {/* ========================================================================= */}
      {showLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">Log Konsol Deployment</h3>
                {d.deployment?.deploy_port && (
                  <span className="font-mono text-xs text-slate-400">(: {d.deployment.deploy_port})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => d?.project?.id && handleLoadLogs(d.project.id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                  title="Refresh Log"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Refresh</span>
                </button>
                <button
                  onClick={() => copyToClipboard(deployLogs, 'logs')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                  title="Salin Log"
                >
                  {copiedKey === 'logs' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'logs' ? 'Tersalin' : 'Salin'}</span>
                </button>
                <button
                  onClick={() => setShowLogs(false)}
                  className="text-slate-400 hover:text-white text-base font-bold px-2"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto rounded-lg bg-black/90 p-4 border border-slate-800/80 font-mono text-xs text-emerald-400 whitespace-pre leading-relaxed select-all">
              {deployLogs || 'Belum ada catatan log.'}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
              <span>Menampilkan output stdout & stderr proses deploy.</span>
              <button
                onClick={() => setShowLogs(false)}
                className="px-3 py-1 rounded bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 font-medium"
              >
                Tutup
              </button>
            </div>
          </div>
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
  const [deployModal, setDeployModal] = useState<any | null>(null)
  const [deployLoading, setDeployLoading] = useState(false)
  const [deployLogs, setDeployLogs] = useState('')
  const [showDeployLogs, setShowDeployLogs] = useState(false)

  const load = () => api('/projects?search=' + encodeURIComponent(q)).then(setRows)

  const openDeployModal = async (project: any) => {
    setDeployLoading(true)
    setDeployModal({ project, data: null })
    setShowDeployLogs(false)
    try {
      const res = await api(`/projects/${project.id}/deploy`)
      setDeployModal({ project, data: res })
    } catch (e: any) {
      alert(e.message || 'Gagal memuat info deployment.')
    } finally {
      setDeployLoading(false)
    }
  }

  const triggerDeployInModal = async (projectId: number, options = {}) => {
    try {
      setDeployLoading(true)
      const res = await api(`/projects/${projectId}/deploy`, 'POST', options)
      setDeployModal((prev: any) => ({ ...prev, data: res }))
      load()
    } catch (e: any) {
      alert(e.message || 'Gagal deploy.')
    } finally {
      setDeployLoading(false)
    }
  }

  const triggerStopInModal = async (projectId: number) => {
    try {
      setDeployLoading(true)
      const res = await api(`/projects/${projectId}/deploy/stop`, 'POST')
      setDeployModal((prev: any) => ({ ...prev, data: res }))
      load()
    } catch (e: any) {
      alert(e.message || 'Gagal stop.')
    } finally {
      setDeployLoading(false)
    }
  }

  const triggerRestartInModal = async (projectId: number) => {
    try {
      setDeployLoading(true)
      const res = await api(`/projects/${projectId}/deploy/restart`, 'POST')
      setDeployModal((prev: any) => ({ ...prev, data: res }))
      load()
    } catch (e: any) {
      alert(e.message || 'Gagal restart.')
    } finally {
      setDeployLoading(false)
    }
  }

  const loadLogsInModal = async (projectId: number) => {
    try {
      const res = await api(`/projects/${projectId}/deploy/logs?lines=100`)
      setDeployLogs(res.content || 'Log kosong.')
      setShowDeployLogs(true)
    } catch (e: any) {
      alert(e.message || 'Gagal memuat log.')
    }
  }

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
                <th className="py-2.5 pr-4">Deploy Service</th>
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
                    {r.deploy_status === 'running' ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        :{r.deploy_port}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400">
                        Offline
                      </span>
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
                        onClick={() => openDeployModal(r)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-emerald-300 font-medium border border-slate-700"
                        title="Kelola Auto Deploy & Port"
                      >
                        <Rocket className="w-3 h-3 text-emerald-400" />
                        <span>Deploy</span>
                      </button>

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

      {/* Modal: Deploy Management on Project */}
      {deployModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Rocket className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-base text-white">
                  Auto Deploy Layanan: <span className="text-emerald-400">{deployModal.project.name}</span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeployModal(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {deployLoading && !deployModal.data ? (
              <p className="text-sm text-slate-400 py-6 text-center">Memproses deployment…</p>
            ) : deployModal.data ? (
              <div className="space-y-4">
                {/* Status Bar */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-400">Status Saat Ini:</span>
                      {deployModal.data.deploy_status === 'running' ? (
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          ONLINE (Port :{deployModal.data.deploy_port})
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400">
                          OFFLINE / STOPPED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      Tipe: <span className="text-slate-200 font-semibold">{deployModal.data.deploy_type}</span>
                      {deployModal.data.uptime && ` • Uptime: ${deployModal.data.uptime}`}
                      {deployModal.data.memory && ` • RAM: ${deployModal.data.memory}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {deployModal.data.deploy_status === 'running' ? (
                      <>
                        <button
                          disabled={deployLoading}
                          onClick={() => triggerRestartInModal(deployModal.project.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                          <span>Restart</span>
                        </button>
                        <button
                          disabled={deployLoading}
                          onClick={() => triggerStopInModal(deployModal.project.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded bg-red-950 hover:bg-red-900 text-xs text-red-300 border border-red-800"
                        >
                          <Square className="w-3.5 h-3.5 fill-current" />
                          <span>Stop</span>
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={deployLoading}
                        onClick={() => triggerDeployInModal(deployModal.project.id)}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-slate-950 shadow-md shadow-emerald-600/30"
                      >
                        <Rocket className="w-4 h-4" />
                        <span>Deploy Sekarang</span>
                      </button>
                    )}
                    <button
                      onClick={() => loadLogsInModal(deployModal.project.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Log</span>
                    </button>
                  </div>
                </div>

                {/* Direct Access URLs */}
                {deployModal.data.deploy_status === 'running' && deployModal.data.urls && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-xl border border-emerald-700/50 bg-slate-950 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                          Akses Jaringan LAN
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">Lokal</span>
                      </div>
                      <p className="font-mono text-xs text-emerald-300 font-bold truncate">
                        {deployModal.data.urls.lan}
                      </p>
                      <a
                        href={deployModal.data.urls.lan}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-center py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs"
                      >
                        Buka Layanan ↗
                      </a>
                    </div>

                    <div className="p-3.5 rounded-xl border border-blue-700/50 bg-slate-950 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-blue-400" />
                          Akses Tailscale VPN
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">Remote</span>
                      </div>
                      <p className="font-mono text-xs text-blue-300 font-bold truncate">
                        {deployModal.data.urls.tailscale || 'Tidak aktif'}
                      </p>
                      {deployModal.data.urls.tailscale && (
                        <a
                          href={deployModal.data.urls.tailscale}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-center py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
                        >
                          Buka Layanan ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Profiles Detection */}
                {deployModal.data.detected_configs && deployModal.data.detected_configs.length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-300">
                      Pilihan Profil Deployment:
                    </label>
                    <div className="space-y-2">
                      {deployModal.data.detected_configs.map((cfg: any) => (
                        <div
                          key={cfg.id}
                          className="p-3 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between gap-3"
                        >
                          <div className="space-y-0.5 truncate">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-bold text-white">{cfg.name}</p>
                              {cfg.recommended && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                                  Disarankan
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 truncate">{cfg.description}</p>
                          </div>
                          <button
                            disabled={deployLoading}
                            onClick={() =>
                              triggerDeployInModal(deployModal.project.id, {
                                deploy_type: cfg.id,
                                deploy_command: cfg.command,
                                deploy_dir: cfg.dir
                              })
                            }
                            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded bg-slate-800 hover:bg-emerald-950 border border-slate-700 hover:border-emerald-700 text-xs text-emerald-300 font-semibold"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Deploy Profil Ini</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Embedded Logs Viewer */}
                {showDeployLogs && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-300">Output Log Deployment:</span>
                      <button
                        onClick={() => setShowDeployLogs(false)}
                        className="text-slate-500 hover:text-white"
                      >
                        Sembunyikan Log
                      </button>
                    </div>
                    <pre className="max-h-48 overflow-y-auto rounded-lg bg-black/90 p-3 border border-slate-800 font-mono text-xs text-emerald-400 leading-relaxed">
                      {deployLogs}
                    </pre>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex justify-between items-center pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  onSelectProjectForDashboard(deployModal.project.id)
                  setDeployModal(null)
                }}
                className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
              >
                <span>Buka Detail di Dashboard</span> →
              </button>

              <button
                type="button"
                onClick={() => setDeployModal(null)}
                className="px-4 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 rounded-lg"
              >
                Tutup
              </button>
            </div>
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
