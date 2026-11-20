import { useEffect, useState, FormEvent } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { LayoutDashboard, BookOpen, Database, ScrollText, LogOut } from 'lucide-react'
import GitHubRepoManager from './components/GitHubRepoManager'

const xsrf = () => decodeURIComponent(document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='))?.split('=')[1] ?? '')
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
const gb = (n?: number | null) => n == null ? '-' : (n / 1073741824).toFixed(2) + ' GB'
const card = 'rounded-xl border border-slate-800 bg-slate-900 p-4'
const inp = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500'
const btn = 'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50'

function Login({ onOk }: { onOk: () => void }) {
  const [err, setErr] = useState('')
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget)
    try { await api('/login', 'POST', { email: f.get('email'), password: f.get('password') }); onOk() } catch (x: any) { setErr(x.message) }
  }
  return <div className="grid min-h-screen place-items-center bg-slate-950"><form onSubmit={submit} className={card + ' w-84 space-y-4 shadow-2xl'}>
    <div>
      <h1 className="text-xl font-bold text-white tracking-wide">POSTGRES MANAGER</h1>
      <p className="text-xs text-slate-400 mt-0.5">Centralized Database & Repository Management</p>
    </div>
    <div className="space-y-2">
      <input name="email" type="email" placeholder="Email" className={inp} defaultValue="nnaufalasyam7@gmail.com" required />
      <input name="password" type="password" placeholder="Password" className={inp} required />
    </div>
    {err && <p className="text-sm text-red-400 bg-red-950/40 p-2 rounded border border-red-900">{err}</p>}
    <button className={btn + ' w-full'}>Masuk</button></form></div>
}

function Table({ title, rows, cols }: { title: string; rows: any[]; cols: string[] }) {
  return <div className={card + ' overflow-x-auto'}><p className="mb-2 text-sm font-semibold text-slate-200">{title}</p>
    {rows.length === 0 ? <p className="text-sm text-slate-500">Belum ada data.</p> :
      <table className="w-full text-left text-sm"><thead className="text-slate-400 border-b border-slate-800 text-xs"><tr>{cols.map(c => <th key={c} className="py-2 pr-4">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-800/60 hover:bg-slate-800/30 text-xs font-mono">{cols.map(c => <td key={c} className="py-2 pr-4 text-slate-300">{String(r[c] ?? '')}</td>)}</tr>)}</tbody></table>}</div>
}

function Dashboard() {
  const [d, setD] = useState<any>(null)
  useEffect(() => { api('/dashboard').then(setD) }, [])
  if (!d) return <p className="text-slate-400 text-sm">Memuat dashboard…</p>
  const s = d.system, pg = d.postgres
  const stat = (k: string, v: any) => <div className={card}><p className="text-xs text-slate-400">{k}</p><p className="text-xl font-semibold text-white mt-1">{v ?? '-'}</p></div>
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {stat('PostgreSQL', pg.up ? `UP · v${pg.version}` : 'DOWN')}{stat('Host:Port', pg.up ? `${pg.host}:${pg.port}` : '-')}
    {stat('Proyek', d.projects)}{stat('Koneksi aktif', pg.connections)}
    {stat('CPU', s.cpu_percent + '%')}{stat('RAM', `${gb(s.ram_used)} / ${gb(s.ram_total)}`)}
    {stat('Disk bebas', gb(s.disk_free))}{stat('Tailscale', s.tailscale_ip ?? 'tidak terdeteksi')}</div>
    {pg.up && <div className={card}><p className="mb-2 text-sm font-semibold text-slate-200">Ukuran database (MB)</p><div className="h-56"><ResponsiveContainer>
      <BarChart data={pg.databases.map((x: any) => ({ name: x.name, mb: +(x.size / 1048576).toFixed(1) }))}><XAxis dataKey="name" stroke="#94a3b8" /><YAxis stroke="#94a3b8" /><Tooltip /><Bar dataKey="mb" fill="#10b981" /></BarChart></ResponsiveContainer></div></div>}
    <Table title="Aktivitas terbaru" rows={d.recent_ops} cols={['created_at', 'action', 'subject', 'status']} /></div>
}

function Projects() {
  const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState(false); const [q, setQ] = useState('')
  const load = () => api('/projects?search=' + encodeURIComponent(q)).then(setRows)
  useEffect(() => { load() }, [q])
  return <div className="space-y-3"><div className="flex gap-2"><input className={inp} placeholder="Cari proyek…" value={q} onChange={e => setQ(e.target.value)} />
    <button className={btn} onClick={() => setOpen(true)}>+ Proyek</button></div>
    <Table title="Proyek Database" rows={rows} cols={['name', 'slug', 'db_name', 'db_user', 'status']} />
    {open && <Wizard onClose={() => { setOpen(false); load() }} />}</div>
}

function Wizard({ onClose }: { onClose: () => void }) {
  const [tpls, setTpls] = useState<any[]>([]); const [err, setErr] = useState(''); const [res, setRes] = useState<any>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { api('/templates').then(setTpls) }, [])
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); setErr('')
    try { setRes(await api('/projects', 'POST', { ...f, template_id: +(f.template_id as string) })) }
    catch (x: any) { setErr(x.message + (x.errors ? ' ' + JSON.stringify(x.errors) : '')) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 grid place-items-center bg-black/60 p-4"><div className={card + ' max-h-[90vh] w-full max-w-lg overflow-auto'}>
    {res ? <div className="space-y-2 text-sm"><h2 className="font-semibold text-emerald-400">Proyek dibuat</h2>
      <p className="text-amber-400 text-xs">Simpan password ini sekarang — tidak akan ditampilkan lagi.</p>
      <pre className="rounded bg-slate-950 p-3 text-xs font-mono">{`host: ${res.host}:${res.port}\ndb: ${res.db_name}\nuser: ${res.db_user}\npassword: ${res.password}`}</pre>
      <ul className="list-disc pl-5 text-slate-400 text-xs">{res.steps.map((s: string) => <li key={s}>{s}</li>)}</ul><button className={btn} onClick={onClose}>Selesai</button></div> :
    <form onSubmit={submit} className="space-y-2"><h2 className="font-semibold text-white">Proyek baru</h2>
      <input name="name" placeholder="Nama proyek" className={inp} required /><input name="slug" placeholder="slug (huruf kecil, angka, -)" className={inp} required />
      <input name="description" placeholder="Deskripsi" className={inp} />
      <input name="db_name" placeholder="nama database (a-z0-9_)" className={inp} required /><input name="db_user" placeholder="user PostgreSQL" className={inp} required />
      <div className="grid grid-cols-2 gap-2"><select name="encoding" className={inp}><option>UTF8</option></select>
        <select name="locale" className={inp}><option>C.UTF-8</option><option>en_US.UTF-8</option><option>C</option></select></div>
      <select name="template_id" className={inp}>{tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select name="backup_policy" className={inp}><option value="none">Backup: manual</option><option value="daily">Harian</option><option value="weekly">Mingguan</option></select>
      <p className="text-xs text-slate-500">Password dibuat otomatis (32 hex) dan dienkripsi di master DB.</p>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex gap-2 pt-2"><button className={btn} disabled={busy}>{busy ? 'Memproses…' : 'Buat proyek'}</button><button type="button" className="px-3 text-sm text-slate-400 hover:text-white" onClick={onClose}>Batal</button></div></form>}</div></div>
}

export default function App() {
  const [user, setUser] = useState<string | null | undefined>(undefined)
  const [tab, setTab] = useState('repos') // Default to Repositories (GitHub-like view)
  const [audit, setAudit] = useState<any[]>([])

  const boot = () => api('/csrf').then(() => api('/me')).then((m: any) => setUser(m.email)).catch(() => setUser(null))
  useEffect(() => { boot() }, [])
  useEffect(() => { if (tab === 'audit') api('/audit').then(setAudit) }, [tab])

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
            <p className="text-xs font-mono text-slate-300 truncate" title={user}>{user}</p>
          </div>
          <button
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs text-red-400 hover:bg-red-950/40 hover:text-red-300 transition"
            onClick={async () => { await api('/logout', 'POST'); setUser(null) }}
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        {tab === 'repos' && <GitHubRepoManager api={api} xsrf={xsrf} />}
        {tab === 'dash' && <Dashboard />}
        {tab === 'proj' && <Projects />}
        {tab === 'audit' && (
          <Table title="Audit Log Aktivitas" rows={audit} cols={['created_at', 'user_id', 'action', 'subject', 'status', 'ip']} />
        )}
      </main>
    </div>
  )
}
