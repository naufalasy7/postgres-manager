import React, { useState, useEffect, useRef } from 'react'
import {
  Radio,
  Wifi,
  Cpu,
  RefreshCw,
  Plus,
  Play,
  Square,
  Trash2,
  Edit,
  ExternalLink,
  Copy,
  Check,
  Activity,
  AlertCircle,
  CheckCircle2,
  Terminal,
  Database,
  Lock,
  ArrowUpDown,
  Key,
  Globe,
  Share2,
  HelpCircle,
  Eye,
  EyeOff,
  Sparkles,
  Code,
  FileCode,
  ShieldCheck
} from 'lucide-react'

interface Props {
  api: <T = any>(path: string, method?: string, body?: any) => Promise<T>
  xsrf: () => string
  currentUser?: {
    id: number
    name: string
    email: string
    role: string
    is_super_admin: boolean
  } | null
  projects?: any[]
  initialProjectId?: number | null
  onOpenDatabaseExplorer?: (projectId: number, tableName?: string) => void
}

interface IntegrationItem {
  id: number
  project_id: number
  project_name: string
  project_slug: string
  db_name: string
  platform: 'blynk' | 'zenoh' | 'mqtt'
  name: string
  url: string
  token?: string | null
  token_hash?: string | null
  username?: string | null
  topic_or_key?: string | null
  target_table: string
  config: any
  status: 'stopped' | 'running' | 'connected' | 'error'
  worker_pid?: number | null
  webhook_token: string
  last_sync_at?: string | null
  packets_count: number
  last_error?: string | null
  is_owner?: boolean
  can_manage?: boolean
  creator_name?: string
  creator_email?: string
  snippets?: {
    device_id: string
    token: string
    token_hash: string
    webhook_url: string
    zenoh_locator: string
    cpp_config: string
    python_script: string
    curl_command: string
  }
}

export default function PlatformIntegrations({ api, xsrf, currentUser, projects = [], initialProjectId, onOpenDatabaseExplorer }: Props) {
  const [projectList, setProjectList] = useState<any[]>(projects || [])
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filterPlatform, setFilterPlatform] = useState<string>('all')
  const [filterProject, setFilterProject] = useState<string>(initialProjectId ? String(initialProjectId) : 'all')
  const [copiedTokenId, setCopiedTokenId] = useState<number | null>(null)
  const [copiedWebhookId, setCopiedWebhookId] = useState<number | null>(null)

  // Modal State
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<IntegrationItem | null>(null)
  const [modalForm, setModalForm] = useState({
    project_id: initialProjectId ? String(initialProjectId) : (projects[0]?.id ? String(projects[0].id) : ''),
    platform: 'blynk' as 'blynk' | 'zenoh' | 'mqtt',
    name: '',
    url: 'https://blynk.cloud/external/api',
    token: '',
    username: '',
    topic_or_key: 'V0, V1',
    target_table: 'iot_telemetry',
    interval_seconds: 10,
  })
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message: string; details?: any } | null>(null)
  const [saving, setSaving] = useState(false)
  const [initTableLoading, setInitTableLoading] = useState(false)
  const [initTableSuccess, setInitTableSuccess] = useState<string | null>(null)
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)

  // Logs Modal
  const [logsItem, setLogsItem] = useState<IntegrationItem | null>(null)
  const [logsContent, setLogsContent] = useState<string>('')
  const [logsLoading, setLogsLoading] = useState(false)
  const logsIntervalRef = useRef<any>(null)

  // Setup & Token Modal (Smartroom Model)
  const [setupModalItem, setSetupModalItem] = useState<IntegrationItem | null>(null)
  const [setupTab, setSetupTab] = useState<'cpp' | 'python' | 'curl' | 'keys'>('cpp')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [regenLoading, setRegenLoading] = useState(false)

  const isOperator = currentUser?.role === 'user'

  const generateBlynkToken = () => {
    const chars = '0123456789abcdef'
    let tok = 'sr_tok_'
    for (let i = 0; i < 24; i++) {
      tok += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return tok
  }

  const handleRegenerateToken = async (id: number) => {
    if (!window.confirm('Generate Auth Token baru? Token lama tidak akan bisa dipakai lagi oleh perangkat.')) return
    try {
      setRegenLoading(true)
      const updated = await api<IntegrationItem>(`/integrations/${id}/regenerate-token`, 'POST')
      setIntegrations(prev => prev.map(item => item.id === id ? { ...item, ...updated } : item))
      if (setupModalItem && setupModalItem.id === id) {
        setSetupModalItem({ ...setupModalItem, ...updated })
      }
    } catch (e: any) {
      alert(`Gagal generate token baru: ${e.message}`)
    } finally {
      setRegenLoading(false)
    }
  }

  const copySnippet = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(keyName)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const loadIntegrations = async () => {
    try {
      setLoading(true)
      const [data, projData] = await Promise.all([
        api<IntegrationItem[]>('/integrations'),
        api<any[]>('/projects').catch(() => [])
      ])
      setIntegrations(data || [])
      if (projData && projData.length > 0) {
        setProjectList(projData)
      }
    } catch (e: any) {
      console.error('Failed to load integrations', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadIntegrations()
  }, [])

  // Auto-refresh logs when log modal is open
  useEffect(() => {
    if (logsItem) {
      fetchLogs(logsItem.id)
      logsIntervalRef.current = setInterval(() => {
        fetchLogs(logsItem.id)
      }, 3000)
    } else {
      if (logsIntervalRef.current) clearInterval(logsIntervalRef.current)
    }
    return () => {
      if (logsIntervalRef.current) clearInterval(logsIntervalRef.current)
    }
  }, [logsItem])

  const fetchLogs = async (id: number) => {
    try {
      setLogsLoading(true)
      const res = await api<{ content: string }>(`/integrations/${id}/logs?lines=150`)
      setLogsContent(res.content || 'Belum ada log aktivitas.')
    } catch (e: any) {
      setLogsContent(`Gagal memuat log: ${e.message}`)
    } finally {
      setLogsLoading(false)
    }
  }

  const handleTestConnection = async () => {
    try {
      setTestResult({ status: 'testing', message: 'Sedang menguji koneksi & token ke platform...' })
      const res = await api<any>('/integrations/test', 'POST', {
        platform: modalForm.platform,
        url: modalForm.url,
        token: modalForm.token,
        username: modalForm.username,
        topic_or_key: modalForm.topic_or_key,
      })
      if (res.status === 'success') {
        setTestResult({ status: 'success', message: res.message, details: res.details })
      } else {
        setTestResult({ status: 'error', message: res.message || 'Koneksi gagal atau ditolak server.', details: res.details })
      }
    } catch (e: any) {
      setTestResult({ status: 'error', message: e.message || 'Gagal menghubungi server backend.' })
    }
  }

  const handleInitTable = async () => {
    if (!modalForm.project_id) return
    try {
      setInitTableLoading(true)
      setInitTableSuccess(null)
      const res = await api<any>(`/projects/${modalForm.project_id}/init-iot-table`, 'POST', {
        table: modalForm.target_table || 'iot_telemetry',
      })
      setInitTableSuccess(res.message || 'Tabel IoT berhasil dibuat di database proyek.')
    } catch (e: any) {
      alert(`Gagal inisialisasi tabel: ${e.message}`)
    } finally {
      setInitTableLoading(false)
    }
  }

  const openCreateModal = () => {
    setEditingItem(null)
    setTestResult(null)
    setInitTableSuccess(null)
    setShowAdvancedSettings(false)
    const defaultPid = initialProjectId ? String(initialProjectId) : (projectList[0]?.id ? String(projectList[0].id) : '')
    const selectedProj = projectList.find(p => String(p.id) === String(defaultPid))
    const isSmartroom = selectedProj?.slug?.toLowerCase().includes('smartroom') || selectedProj?.name?.toLowerCase().includes('smartroom')

    setModalForm({
      project_id: defaultPid,
      platform: 'zenoh',
      name: isSmartroom ? 'ESP32 Smartroom' : 'ESP32 Device',
      url: `tcp://${window.location.hostname || '127.0.0.1'}:7447`,
      token: generateBlynkToken(),
      username: '',
      topic_or_key: 'smartroom/data',
      target_table: isSmartroom ? 'readings' : 'iot_telemetry',
      interval_seconds: 10,
    })
    setShowTokenInput(true)
    setShowModal(true)
  }

  const openEditModal = (item: IntegrationItem) => {
    setEditingItem(item)
    setTestResult(null)
    setInitTableSuccess(null)
    setShowAdvancedSettings(true)
    setModalForm({
      project_id: String(item.project_id),
      platform: item.platform,
      name: item.name,
      url: item.url,
      token: item.token || '',
      username: item.username || '',
      topic_or_key: item.topic_or_key || '',
      target_table: item.target_table || 'iot_telemetry',
      interval_seconds: item.config?.interval_seconds || 10,
    })
    setShowModal(true)
  }

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setSaving(true)
      const payload: any = {
        project_id: Number(modalForm.project_id),
        platform: modalForm.platform,
        name: modalForm.name,
        url: modalForm.url,
        token: modalForm.token,
        username: modalForm.username,
        topic_or_key: modalForm.topic_or_key,
        target_table: modalForm.target_table || 'iot_telemetry',
        config: {
          interval_seconds: Number(modalForm.interval_seconds) || 10,
        },
      }

      let created: any = null
      if (editingItem) {
        await api(`/integrations/${editingItem.id}`, 'PUT', payload)
      } else {
        created = await api('/integrations', 'POST', payload)
      }
      setShowModal(false)
      await loadIntegrations()
      if (created && created.id) {
        setSetupModalItem(created)
      }
    } catch (e: any) {
      alert(`Gagal menyimpan integrasi: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleWorker = async (item: IntegrationItem) => {
    try {
      if (item.status === 'running') {
        await api(`/integrations/${item.id}/stop`, 'POST')
      } else {
        await api(`/integrations/${item.id}/start`, 'POST')
      }
      loadIntegrations()
    } catch (e: any) {
      alert(`Aksi gagal: ${e.message}`)
    }
  }

  const handleSyncNow = async (item: IntegrationItem) => {
    try {
      const res = await api<any>(`/integrations/${item.id}/sync`, 'POST')
      alert(res.message || 'Sinkronisasi berhasil!')
      loadIntegrations()
    } catch (e: any) {
      alert(`Gagal sinkronisasi data: ${e.message}`)
    }
  }

  const handleDelete = async (item: IntegrationItem) => {
    if (!confirm(`Hapus integrasi "${item.name}"? Worker background (jika ada) akan dihentikan.`)) return
    try {
      await api(`/integrations/${item.id}`, 'DELETE')
      loadIntegrations()
    } catch (e: any) {
      alert(`Gagal menghapus: ${e.message}`)
    }
  }

  const copyToClipboard = (text: string, type: 'token' | 'webhook', id: number) => {
    navigator.clipboard.writeText(text)
    if (type === 'token') {
      setCopiedTokenId(id)
      setTimeout(() => setCopiedTokenId(null), 2000)
    } else {
      setCopiedWebhookId(id)
      setTimeout(() => setCopiedWebhookId(null), 2000)
    }
  }

  const getPlatformInfo = (platform: string) => {
    switch (platform) {
      case 'blynk':
        return {
          title: 'Blynk IoT',
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          dotClass: 'bg-emerald-400',
          defaultUrl: 'https://blynk.cloud/external/api',
          hint: 'Token perangkat dari Blynk Console, URL cloud/lokal, dan Virtual Pins (mis. V0, V1).',
        }
      case 'zenoh':
        return {
          title: 'Zenoh / Zenoh-Pico',
          badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
          dotClass: 'bg-purple-400',
          defaultUrl: 'http://127.0.0.1:8000',
          hint: 'Zenoh Router REST endpoint atau TCP router (port 7447) & Key Expression (mis. sensors/**).',
        }
      case 'mqtt':
        return {
          title: 'MQTT Broker',
          badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
          dotClass: 'bg-blue-400',
          defaultUrl: 'tcp://broker.emqx.io:1883',
          hint: 'Broker URL (EMQX, Mosquitto, HiveMQ) dan Topic filter (mis. sensors/+/telemetry).',
        }
      default:
        return {
          title: platform.toUpperCase(),
          badgeClass: 'bg-slate-700 text-slate-300 border-slate-600',
          dotClass: 'bg-slate-400',
          defaultUrl: '',
          hint: '',
        }
    }
  }

  const filteredIntegrations = integrations.filter(item => {
    if (filterPlatform !== 'all' && item.platform !== filterPlatform) return false
    if (filterProject !== 'all' && String(item.project_id) !== filterProject) return false
    return true
  })

  const getWebhookFullUrl = (token: string) => {
    const origin = window.location.origin
    return `${origin}/api/integrations/webhook/${token}`
  }

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Platform & IoT Connectors</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                Blynk • Zenoh-Pico • MQTT
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Hubungkan database PostgreSQL Anda secara langsung dengan token dan URL ke Blynk Cloud, Zenoh/Zenoh-Pico, dan MQTT Broker.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={loadIntegrations}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 font-medium transition"
            title="Refresh status konektor"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {!isOperator && (
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-950/40 transition"
            >
              <Plus className="w-4 h-4" />
              <span>+ Tambah Perangkat (Ala Blynk)</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick IoT Banner (Ala Blynk) */}
      <div className="rounded-xl border border-emerald-900/50 bg-gradient-to-r from-emerald-950/40 via-slate-900/40 to-cyan-950/30 p-3.5 text-xs text-slate-300 flex items-start gap-3">
        <div className="p-2 rounded-lg bg-emerald-900/40 border border-emerald-800 text-emerald-400 shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="space-y-1">
          <p className="font-bold text-white text-xs flex items-center gap-2">
            <span>Koneksi Cepat ESP32 Zenoh-Pico & Blynk (Model Plug & Play)</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-900/60 text-emerald-300 border border-emerald-700">Tinggal Salin Token / Config</span>
          </p>
          <p className="text-slate-300 text-[11px] leading-relaxed">
            Perangkat IoT tidak perlu disetel rumit: Cukup klik <strong className="text-emerald-400">+ Tambah Perangkat</strong>, pilih proyek Smartroom, lalu salin cuplikan file <span className="font-mono text-cyan-300">firmware/src/config.h</span> ke kode ESP32 Anda. Data sensor otomatis tersimpan ke PostgreSQL dan tampil di dashboard web!
          </p>
        </div>
      </div>

      {/* Role Alert / Notice */}
      {isOperator && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900/80 border border-amber-900/40 text-amber-300 text-xs">
          <Lock className="w-4 h-4 shrink-0 text-amber-400" />
          <span>
            <strong>Mode Monitoring Operator:</strong> Anda hanya memiliki izin memantau metrik data yang masuk dan log bridge. Pembuatan, pengeditan, atau pengontrolan worker hanya dapat dilakukan oleh Admin Terbatas dan Super Admin.
          </span>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">Filter Platform:</span>
          <div className="flex items-center gap-1">
            {['all', 'blynk', 'zenoh', 'mqtt'].map(p => (
              <button
                key={p}
                onClick={() => setFilterPlatform(p)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold capitalize transition ${
                  filterPlatform === p
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
              >
                {p === 'all' ? 'Semua Platform' : p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">Proyek DB:</span>
          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">Semua Database Proyek</option>
            {projectList.map(p => (
              <option key={p.id} value={String(p.id)}>
                {p.name} ({p.db_name})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Connector Cards Grid */}
      {loading && integrations.length === 0 ? (
        <div className="p-12 text-center text-slate-500 text-sm">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-500" />
          <span>Memuat daftar integrasi...</span>
        </div>
      ) : filteredIntegrations.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/30 border border-dashed border-slate-800">
          <Radio className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-300">Belum Ada Konektor Platform</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
            Sambungkan database PostgreSQL ini ke Blynk IoT, Zenoh-Pico, atau MQTT Broker untuk menyerap telemetri sensor secara langsung.
          </p>
          {!isOperator && (
            <button
              onClick={openCreateModal}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
            >
              + Hubungkan Platform Pertama
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredIntegrations.map(item => {
            const pInfo = getPlatformInfo(item.platform)
            const isRunning = item.status === 'running'
            const hasError = item.status === 'error' || Boolean(item.last_error)

            return (
              <div
                key={item.id}
                className="flex flex-col justify-between p-4 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 shadow-lg transition"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${pInfo.badgeClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${pInfo.dotClass}`} />
                          {pInfo.title}
                        </span>
                        {item.creator_email && currentUser?.is_super_admin && (
                          <span className="text-[10px] font-mono text-slate-500 truncate" title={item.creator_email}>
                            by {item.creator_email.split('@')[0]}
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-sm text-white truncate" title={item.name}>
                        {item.name}
                      </h3>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0">
                      {isRunning ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                          Worker Aktif
                        </span>
                      ) : hasError ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-950 text-red-300 border border-red-800">
                          <AlertCircle className="w-2.5 h-2.5" />
                          Error
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400">
                          Stopped
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Target DB & Table */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-1.5 my-3 text-xs">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="flex items-center gap-1 text-[11px]">
                        <Database className="w-3 h-3 text-emerald-400" />
                        <span>Database:</span>
                      </span>
                      <span className="font-mono text-emerald-300 font-semibold truncate">
                        {item.db_name}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-[11px]">Tabel Tujuan:</span>
                      <span className="font-mono text-slate-200 bg-slate-900 px-1.5 py-0.5 rounded text-[11px]">
                        {item.target_table}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-[11px]">Target / Key / Pin:</span>
                      <span className="font-mono text-amber-300 truncate max-w-[150px]" title={item.topic_or_key || ''}>
                        {item.topic_or_key || '—'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-[11px]">Total Paket Data:</span>
                      <span className="font-semibold text-white">
                        {item.packets_count.toLocaleString()} rows
                      </span>
                    </div>
                  </div>

                  {/* Server URL & Token summary */}
                  <div className="space-y-1 text-xs">
                    <p className="text-[11px] font-mono text-slate-400 truncate" title={item.url}>
                      <Globe className="w-3 h-3 inline mr-1 text-slate-500" />
                      {item.url}
                    </p>

                    {item.token && (
                      <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1 text-slate-500">
                          <Key className="w-3 h-3" />
                          <span>Token:</span>
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-slate-400">
                            {item.token.substring(0, 6)}••••••••
                          </span>
                          <button
                            onClick={() => copyToClipboard(item.token || '', 'token', item.id)}
                            className="p-1 hover:text-white transition"
                            title="Salin Token"
                          >
                            {copiedTokenId === item.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Webhook Ingestion URL */}
                    <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                      <span className="text-slate-500">Webhook:</span>
                      <button
                        onClick={() => copyToClipboard(getWebhookFullUrl(item.webhook_token), 'webhook', item.id)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 transition"
                        title="Salin endpoint Webhook untuk Blynk/External HTTP"
                      >
                        {copiedWebhookId === item.id ? (
                          <>
                            <Check className="w-2.5 h-2.5 text-emerald-400" />
                            <span className="text-emerald-400">Disalin!</span>
                          </>
                        ) : (
                          <>
                            <Share2 className="w-2.5 h-2.5 text-slate-400" />
                            <span>Salin Webhook URL</span>
                          </>
                        )}
                      </button>
                    </div>

                    {item.last_sync_at && (
                      <p className="text-[10px] text-slate-500 pt-1">
                        Sinkronisasi terakhir: {new Date(item.last_sync_at).toLocaleTimeString()}
                      </p>
                    )}

                    {item.last_error && (
                      <p className="text-[10px] text-red-400 font-mono truncate" title={item.last_error}>
                        Error: {item.last_error}
                      </p>
                    )}

                    {/* Setup & Auth Token Strip (Smartroom model) */}
                    <div className="pt-2 flex items-center justify-between gap-1.5 border-t border-slate-800/60">
                      <button
                        onClick={() => {
                          setSetupModalItem(item)
                          setSetupTab('cpp')
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-950 to-blue-950 hover:from-cyan-900 hover:to-blue-900 border border-cyan-800 text-[11px] font-bold text-cyan-300 shadow-sm transition"
                        title="Lihat Auth Token, SHA-256 Hash, dan Cuplikan Kode C++ ESP32 ala Smartroom"
                      >
                        <Key className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Setup & Auth Token</span>
                      </button>

                      {onOpenDatabaseExplorer && (
                        <button
                          onClick={() => onOpenDatabaseExplorer(item.project_id, item.target_table)}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-300 font-medium transition"
                          title={`Buka tabel ${item.target_table} di Database Explorer`}
                        >
                          <Database className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="font-mono text-emerald-300">{item.target_table}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    {/* Start / Stop Worker */}
                    {item.can_manage && !isOperator ? (
                      <button
                        onClick={() => handleToggleWorker(item)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                          isRunning
                            ? 'bg-amber-950/80 hover:bg-amber-900 border border-amber-800 text-amber-300'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                        }`}
                        title={isRunning ? 'Hentikan background worker' : 'Jalankan background worker terus menerus'}
                      >
                        {isRunning ? (
                          <>
                            <Square className="w-3 h-3 fill-current" />
                            <span>Stop</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current" />
                            <span>Start Worker</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-500 italic">Read-only</span>
                    )}

                    {/* Manual Sync Now */}
                    {item.can_manage && !isOperator && (
                      <button
                        onClick={() => handleSyncNow(item)}
                        className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition"
                        title="Tarik data sekarang (1-time sync)"
                      >
                        Sync Now
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Logs Button */}
                    <button
                      onClick={() => setLogsItem(item)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                      title="Lihat Log Stream Telemetri"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                    </button>

                    {/* Edit Button */}
                    {item.can_manage && !isOperator && (
                      <button
                        onClick={() => openEditModal(item)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                        title="Edit Konfigurasi"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Delete Button */}
                    {item.can_manage && !isOperator && (
                      <button
                        onClick={() => handleDelete(item)}
                        className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-900/40 transition"
                        title="Hapus Konektor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL: Tambah / Edit Integrasi Platform */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl my-8">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Radio className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="font-bold text-base text-white">
                    {editingItem ? 'Edit Koneksi Perangkat IoT' : 'Hubungkan Perangkat IoT Baru (Ala Blynk)'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Cukup pilih proyek dan nama perangkat. Token dan cuplikan config.h ESP32 otomatis disiapkan.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-4">
              {/* Select Project DB */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Database Proyek Tujuan *
                </label>
                <select
                  disabled={Boolean(editingItem)}
                  value={modalForm.project_id}
                  onChange={e => {
                    const pid = e.target.value
                    const proj = projectList.find(p => String(p.id) === String(pid))
                    const isSr = proj?.slug?.toLowerCase().includes('smartroom') || proj?.name?.toLowerCase().includes('smartroom')
                    setModalForm({
                      ...modalForm,
                      project_id: pid,
                      platform: isSr ? 'zenoh' : modalForm.platform,
                      target_table: isSr ? 'readings' : modalForm.target_table,
                      topic_or_key: isSr ? 'smartroom/data' : modalForm.topic_or_key,
                      url: isSr ? `tcp://${window.location.hostname || '127.0.0.1'}:7447` : modalForm.url,
                    })
                  }}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {projectList.map(p => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} ({p.db_name})
                    </option>
                  ))}
                </select>
              </div>

              {/* Platform Selector Cards */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Pilih Platform IoT *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'zenoh', name: 'Zenoh-Pico (ESP32)', desc: 'Router TCP:7447 • smartroom/data', defUrl: `tcp://${window.location.hostname || '127.0.0.1'}:7447`, defKey: 'smartroom/data', defTable: 'readings' },
                    { id: 'blynk', name: 'Blynk IoT', desc: 'Token Auth & Webhooks', defUrl: 'https://blynk.cloud/external/api', defKey: 'V0, V1', defTable: 'iot_telemetry' },
                    { id: 'mqtt', name: 'MQTT Broker', desc: 'EMQX, HiveMQ, Mosquitto', defUrl: 'tcp://broker.emqx.io:1883', defKey: 'devices/+/telemetry', defTable: 'iot_telemetry' },
                  ].map(p => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() =>
                        setModalForm({
                          ...modalForm,
                          platform: p.id as any,
                          url: p.defUrl,
                          topic_or_key: p.defKey,
                          target_table: p.defTable,
                        })
                      }
                      className={`p-3 rounded-xl border text-left transition ${
                        modalForm.platform === p.id
                          ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <p className="font-bold text-xs text-white">{p.name}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{p.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nama Perangkat / Konektor *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Mis. ESP32 Sensor Kamar, ESP32 Ruang Tamu"
                  value={modalForm.name}
                  onChange={e => setModalForm({ ...modalForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Auth Token Perangkat Ala Blynk */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300">
                    Auth Token Perangkat (Ala Blynk)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const tok = generateBlynkToken()
                        setModalForm(prev => ({ ...prev, token: tok }))
                        setShowTokenInput(true)
                      }}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold"
                      title="Buat Auth Token unik acak ala Blynk / Smartroom"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Generate Token Baru</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTokenInput(!showTokenInput)}
                      className="text-slate-500 hover:text-slate-300 text-[11px]"
                    >
                      {showTokenInput ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
                <input
                  type={showTokenInput ? 'text' : 'password'}
                  placeholder="misal: sr_tok_xxxxxxxxxxxxxxxx"
                  value={modalForm.token}
                  onChange={e => setModalForm({ ...modalForm, token: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Format ala Blynk (<span className="font-mono text-cyan-400">sr_tok_...</span>) untuk identifikasi dan keamanan perangkat ESP32 Anda.
                </p>
              </div>

              {/* Accordion Pengaturan Lanjutan */}
              <div className="pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-400 transition"
                >
                  <span>{showAdvancedSettings ? '▾ Sembunyikan' : '▸ Buka'} Pengaturan Teknis Lanjutan (URL Broker, Key/Topic, Tabel Target)</span>
                </button>

                {showAdvancedSettings && (
                  <div className="mt-3 space-y-3.5 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
                    {/* Server / Broker URL */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-300">
                          URL Server / Broker *
                        </label>
                        <div className="flex items-center gap-1 text-[10px]">
                          <span className="text-slate-500">Preset:</span>
                          {modalForm.platform === 'blynk' && (
                            <button
                              type="button"
                              onClick={() => setModalForm({ ...modalForm, url: 'https://blynk.cloud/external/api' })}
                              className="text-emerald-400 hover:underline"
                            >
                              blynk.cloud
                            </button>
                          )}
                          {modalForm.platform === 'zenoh' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setModalForm({ ...modalForm, url: `tcp://${window.location.hostname || '127.0.0.1'}:7447` })}
                                className="text-emerald-400 hover:underline"
                              >
                                TCP:7447
                              </button>
                              <span>•</span>
                              <button
                                type="button"
                                onClick={() => setModalForm({ ...modalForm, url: 'http://127.0.0.1:8000' })}
                                className="text-emerald-400 hover:underline"
                              >
                                REST:8000
                              </button>
                            </>
                          )}
                          {modalForm.platform === 'mqtt' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setModalForm({ ...modalForm, url: 'tcp://broker.emqx.io:1883' })}
                                className="text-emerald-400 hover:underline"
                              >
                                EMQX
                              </button>
                              <span>•</span>
                              <button
                                type="button"
                                onClick={() => setModalForm({ ...modalForm, url: 'tcp://127.0.0.1:1883' })}
                                className="text-emerald-400 hover:underline"
                              >
                                Local:1883
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <input
                        type="text"
                        required
                        placeholder="tcp/127.0.0.1:7447"
                        value={modalForm.url}
                        onChange={e => setModalForm({ ...modalForm, url: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    {/* Username & Topic/Key Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Username / Client ID (Opsional)
                        </label>
                        <input
                          type="text"
                          placeholder="Client ID"
                          value={modalForm.username}
                          onChange={e => setModalForm({ ...modalForm, username: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          {modalForm.platform === 'blynk'
                            ? 'Virtual Pins (koma)'
                            : modalForm.platform === 'zenoh'
                            ? 'Topik Data Zenoh'
                            : 'Topic MQTT Filter'}
                        </label>
                        <input
                          type="text"
                          placeholder="smartroom/data"
                          value={modalForm.topic_or_key}
                          onChange={e => setModalForm({ ...modalForm, topic_or_key: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Target Table & Polling Interval */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Nama Tabel Database Tujuan
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            placeholder="readings / iot_telemetry"
                            value={modalForm.target_table}
                            onChange={e => setModalForm({ ...modalForm, target_table: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={handleInitTable}
                            disabled={initTableLoading}
                            className="shrink-0 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-emerald-400 font-semibold border border-slate-700 transition"
                            title="Buat tabel ini otomatis di database proyek jika belum ada"
                          >
                            {initTableLoading ? '...' : '+ Buat Tabel'}
                          </button>
                        </div>
                        {initTableSuccess && (
                          <p className="text-[10px] text-emerald-400 mt-1 font-medium">{initTableSuccess}</p>
                        )}
                      </div>

                      {(modalForm.platform === 'blynk' || modalForm.platform === 'zenoh') && (
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">
                            Interval Polling Worker (detik)
                          </label>
                          <input
                            type="number"
                            min={2}
                            max={3600}
                            value={modalForm.interval_seconds}
                            onChange={e => setModalForm({ ...modalForm, interval_seconds: Number(e.target.value) })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Test Connection Result Box */}
              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs space-y-1 ${
                    testResult.status === 'testing'
                      ? 'bg-slate-950 border-slate-800 text-slate-300'
                      : testResult.status === 'success'
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-red-950/40 border-red-900 text-red-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    {testResult.status === 'testing' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    {testResult.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                    {testResult.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                    <span>Hasil Uji Koneksi:</span>
                  </div>
                  <p>{testResult.message}</p>
                  {testResult.details && (
                    <pre className="text-[10px] font-mono bg-black/40 p-2 rounded overflow-x-auto text-slate-300 mt-1">
                      {JSON.stringify(testResult.details, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {/* Form Action Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testResult?.status === 'testing'}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
                >
                  Tes Koneksi (Ping)
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-950/40 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{saving ? 'Menyimpan...' : editingItem ? 'Perbarui Perangkat' : 'Simpan & Dapatkan Token / Kode ESP32'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Live Logs Stream Drawer */}
      {logsItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[75vh]">
            <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <div>
                  <h3 className="font-bold text-sm text-white">
                    Log Aktivitas Bridge: {logsItem.name}
                  </h3>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Platform: {logsItem.platform.toUpperCase()} • DB: {logsItem.db_name} • Tabel: {logsItem.target_table}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchLogs(logsItem.id)}
                  disabled={logsLoading}
                  className="px-2.5 py-1 rounded bg-slate-800 text-xs text-slate-300 hover:text-white"
                >
                  {logsLoading ? '...' : 'Refresh'}
                </button>
                <button
                  onClick={() => setLogsItem(null)}
                  className="text-slate-400 hover:text-white text-base font-bold px-2"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-slate-300 bg-black/80 whitespace-pre-wrap leading-relaxed">
              {logsContent}
            </div>

            <div className="px-5 py-2.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span>Auto-refresh setiap 3 detik.</span>
              <button
                onClick={() => setLogsItem(null)}
                className="px-3 py-1 rounded bg-slate-800 text-white hover:bg-slate-700 text-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SETUP & AUTH TOKEN (MODEL SMARTROOM) */}
      {setupModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl flex flex-col">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-cyan-950/30 to-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">Setup & Auth Token Perangkat</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800">
                      Model Smartroom
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Konektor: <strong className="text-white">{setupModalItem.name}</strong> • Database: <span className="font-mono text-cyan-300">{setupModalItem.db_name}</span> • Tabel: <span className="font-mono text-emerald-300">{setupModalItem.target_table}</span>
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSetupModalItem(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4">
              {/* Credentials Grid (Blynk / Smartroom Style) */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Kredensial Keamanan IoT</span>
                  </span>
                  {setupModalItem.can_manage && !isOperator && (
                    <button
                      onClick={() => handleRegenerateToken(setupModalItem.id)}
                      disabled={regenLoading}
                      className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold"
                      title="Buat Auth Token baru jika token lama bocor"
                    >
                      <RefreshCw className={`w-3 h-3 ${regenLoading ? 'animate-spin' : ''}`} />
                      <span>{regenLoading ? 'Regenerasi...' : 'Generate Token Baru'}</span>
                    </button>
                  )}
                </div>

                {/* Auth Token */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-medium">Auth Token Unik (ala Blynk):</span>
                    <button
                      onClick={() => copySnippet(setupModalItem.token || '', 'token')}
                      className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-[10px]"
                    >
                      {copiedKey === 'token' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'token' ? 'Tersalin!' : 'Salin Token'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={setupModalItem.token || 'Tidak ada token'}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-emerald-400 focus:outline-none"
                  />
                </div>

                {/* Token SHA-256 Hash */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-medium">Token Hash (SHA-256):</span>
                    <button
                      onClick={() => copySnippet(setupModalItem.token_hash || '', 'hash')}
                      className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-[10px]"
                    >
                      {copiedKey === 'hash' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'hash' ? 'Tersalin!' : 'Salin Hash'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={setupModalItem.token_hash || 'Otomatis dihitung dari token'}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-slate-400 focus:outline-none"
                  />
                </div>

                {/* Device ID / Slug & Locator Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Device ID / Slug:</span>
                      <button
                        onClick={() => copySnippet(setupModalItem.project_slug || '', 'devid')}
                        className="text-slate-400 hover:text-white"
                      >
                        {copiedKey === 'devid' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                    <input
                      type="text"
                      readOnly
                      value={setupModalItem.project_slug || ''}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-slate-300 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Server / Locator:</span>
                      <button
                        onClick={() => copySnippet(setupModalItem.url || '', 'url')}
                        className="text-slate-400 hover:text-white"
                      >
                        {copiedKey === 'url' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                    <input
                      type="text"
                      readOnly
                      value={setupModalItem.url || ''}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-slate-300 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Code Snippets Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Code className="w-4 h-4 text-cyan-400" />
                    <span>Cuplikan Kode Siap Salin (Plug & Play)</span>
                  </span>

                  {/* Tabs */}
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSetupTab('cpp')}
                      className={`px-2.5 py-1 rounded font-semibold transition ${
                        setupTab === 'cpp' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      C++ (ESP32)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSetupTab('python')}
                      className={`px-2.5 py-1 rounded font-semibold transition ${
                        setupTab === 'python' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Python
                    </button>
                    <button
                      type="button"
                      onClick={() => setSetupTab('curl')}
                      className={`px-2.5 py-1 rounded font-semibold transition ${
                        setupTab === 'curl' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      cURL
                    </button>
                  </div>
                </div>

                {/* Code Block Container */}
                <div className="relative rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400">
                    <span className="font-mono">
                      {setupTab === 'cpp' ? 'firmware/src/config.h' : setupTab === 'python' ? 'telemetry_sender.py' : 'bash terminal'}
                    </span>
                    <button
                      onClick={() => {
                        const snippetText = setupTab === 'cpp'
                          ? (setupModalItem.snippets?.cpp_config || '')
                          : setupTab === 'python'
                          ? (setupModalItem.snippets?.python_script || '')
                          : (setupModalItem.snippets?.curl_command || '')
                        copySnippet(snippetText, 'code')
                      }}
                      className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-semibold text-[10px]"
                    >
                      {copiedKey === 'code' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedKey === 'code' ? 'Kode Disalin!' : 'Salin Seluruh Kode'}</span>
                    </button>
                  </div>

                  <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed max-h-60">
                    {setupTab === 'cpp'
                      ? setupModalItem.snippets?.cpp_config
                      : setupTab === 'python'
                      ? setupModalItem.snippets?.python_script
                      : setupModalItem.snippets?.curl_command}
                  </pre>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-900 flex items-center justify-between">
              {onOpenDatabaseExplorer ? (
                <button
                  type="button"
                  onClick={() => {
                    const pid = setupModalItem.project_id
                    const tName = setupModalItem.target_table
                    setSetupModalItem(null)
                    onOpenDatabaseExplorer(pid, tName)
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-sm transition"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Buka Tabel Database ({setupModalItem.target_table})</span>
                </button>
              ) : <div />}

              <button
                type="button"
                onClick={() => setSetupModalItem(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 hover:text-white"
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
