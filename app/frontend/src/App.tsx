import { useEffect, useState, FormEvent } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const xsrf = () => decodeURIComponent(document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='))?.split('=')[1] ?? '')
async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, { method, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': xsrf() } })
  if (!r.ok) throw await r.json().catch(() => ({ message: r.statusText }))
  return (r.status === 204 ? null : await r.json()) as T
}
const gb = (n?: number | null) => n == null ? '-' : (n / 1073741824).toFixed(2) + ' GB'
const card = 'rounded-xl border border-slate-800 bg-slate-900 p-4'
const inp = 'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm'
const btn = 'rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50'

function Login({ onOk }: { onOk: () => void }) {
  const [err, setErr] = useState('')
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget)
    try { await api('/login', 'POST', { email: f.get('email'), password: f.get('password') }); onOk() } catch (x: any) { setErr(x.message) }
  }
  return <div className="grid min-h-screen place-items-center"><form onSubmit={submit} className={card + ' w-80 space-y-3'}>
    <h1 className="text-lg font-bold">POSTGRES MANAGER</h1><p className="text-xs text-slate-400">Centralized PostgreSQL Project Management</p>
    <input name="email" type="email" placeholder="Email" className={inp} required />
    <input name="password" type="password" placeholder="Password" className={inp} required />
    {err && <p className="text-sm text-red-400">{err}</p>}<button className={btn + ' w-full'}>Masuk</button></form></div>
}

function Table({ title, rows, cols }: { title: string; rows: any[]; cols: string[] }) {
  return <div className={card + ' overflow-x-auto'}><p className="mb-2 text-sm font-medium">{title}</p>
    {rows.length === 0 ? <p className="text-sm text-slate-500">Belum ada data.</p> :
      <table className="w-full text-left text-sm"><thead className="text-slate-400"><tr>{cols.map(c => <th key={c} className="py-1 pr-4">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-800">{cols.map(c => <td key={c} className="py-1 pr-4">{String(r[c] ?? '')}</td>)}</tr>)}</tbody></table>}</div>
}

function Dashboard() {
  const [d, setD] = useState<any>(null)
  useEffect(() => { api('/dashboard').then(setD) }, [])
  if (!d) return <p>Memuat…</p>
  const s = d.system, pg = d.postgres
  const stat = (k: string, v: any) => <div className={card}><p className="text-xs text-slate-400">{k}</p><p className="text-xl font-semibold">{v ?? '-'}</p></div>
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {stat('PostgreSQL', pg.up ? `UP · v${pg.version}` : 'DOWN')}{stat('Host:Port', pg.up ? `${pg.host}:${pg.port}` : '-')}
    {stat('Proyek', d.projects)}{stat('Koneksi aktif', pg.connections)}
    {stat('CPU', s.cpu_percent + '%')}{stat('RAM', `${gb(s.ram_used)} / ${gb(s.ram_total)}`)}
    {stat('Disk bebas', gb(s.disk_free))}{stat('Tailscale', s.tailscale_ip ?? 'tidak terdeteksi')}</div>
    {pg.up && <div className={card}><p className="mb-2 text-sm">Ukuran database (MB)</p><div className="h-56"><ResponsiveContainer>
      <BarChart data={pg.databases.map((x: any) => ({ name: x.name, mb: +(x.size / 1048576).toFixed(1) }))}><XAxis dataKey="name" stroke="#94a3b8" /><YAxis stroke="#94a3b8" /><Tooltip /><Bar dataKey="mb" fill="#10b981" /></BarChart></ResponsiveContainer></div></div>}
    <Table title="Aktivitas terbaru" rows={d.recent_ops} cols={['created_at', 'action', 'subject', 'status']} /></div>
}

function Projects() {
  const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState(false); const [q, setQ] = useState('')
  const load = () => api('/projects?search=' + encodeURIComponent(q)).then(setRows)
  useEffect(() => { load() }, [q])
  return <div className="space-y-3"><div className="flex gap-2"><input className={inp} placeholder="Cari proyek…" value={q} onChange={e => setQ(e.target.value)} />
    <button className={btn} onClick={() => setOpen(true)}>+ Proyek</button></div>
    <Table title="Proyek" rows={rows} cols={['name', 'slug', 'db_name', 'db_user', 'status']} />
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
    {res ? <div className="space-y-2 text-sm"><h2 className="font-semibold">Proyek dibuat</h2>
      <p className="text-amber-400">Simpan password ini sekarang — tidak akan ditampilkan lagi.</p>
      <pre className="rounded bg-slate-950 p-3">{`host: ${res.host}:${res.port}\ndb: ${res.db_name}\nuser: ${res.db_user}\npassword: ${res.password}`}</pre>
      <ul className="list-disc pl-5 text-slate-400">{res.steps.map((s: string) => <li key={s}>{s}</li>)}</ul><button className={btn} onClick={onClose}>Selesai</button></div> :
    <form onSubmit={submit} className="space-y-2"><h2 className="font-semibold">Proyek baru</h2>
      <input name="name" placeholder="Nama proyek" className={inp} required /><input name="slug" placeholder="slug (huruf kecil, angka, -)" className={inp} required />
      <input name="description" placeholder="Deskripsi" className={inp} />
      <input name="db_name" placeholder="nama database (a-z0-9_)" className={inp} required /><input name="db_user" placeholder="user PostgreSQL" className={inp} required />
      <div className="grid grid-cols-2 gap-2"><select name="encoding" className={inp}><option>UTF8</option></select>
        <select name="locale" className={inp}><option>C.UTF-8</option><option>en_US.UTF-8</option><option>C</option></select></div>
      <select name="template_id" className={inp}>{tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select name="backup_policy" className={inp}><option value="none">Backup: manual</option><option value="daily">Harian</option><option value="weekly">Mingguan</option></select>
      <p className="text-xs text-slate-500">Password dibuat otomatis (32 hex) dan dienkripsi di master DB.</p>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex gap-2"><button className={btn} disabled={busy}>{busy ? 'Memproses…' : 'Buat proyek'}</button><button type="button" className="px-3 text-sm" onClick={onClose}>Batal</button></div></form>}</div></div>
}

export default function App() {
  const [user, setUser] = useState<string | null | undefined>(undefined); const [tab, setTab] = useState('dash'); const [audit, setAudit] = useState<any[]>([])
  const boot = () => api('/csrf').then(() => api('/me')).then((m: any) => setUser(m.email)).catch(() => setUser(null))
  useEffect(() => { boot() }, [])
  useEffect(() => { if (tab === 'audit') api('/audit').then(setAudit) }, [tab])
  if (user === undefined) return null
  if (!user) return <Login onOk={boot} />
  const nav = (k: string, l: string) => <button onClick={() => setTab(k)} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${tab === k ? 'bg-slate-800' : 'hover:bg-slate-900'}`}>{l}</button>
  return <div className="flex min-h-screen"><aside className="w-48 shrink-0 space-y-1 border-r border-slate-800 p-3">
    <p className="px-3 pb-3 font-bold">POSTGRES MANAGER</p>{nav('dash', 'Dashboard')}{nav('proj', 'Proyek')}{nav('audit', 'Audit log')}
    <button className="block px-3 pt-6 text-xs text-slate-400" onClick={async () => { await api('/logout', 'POST'); setUser(null) }}>Keluar ({user})</button></aside>
    <main className="flex-1 p-5">{tab === 'dash' && <Dashboard />}{tab === 'proj' && <Projects />}
      {tab === 'audit' && <Table title="Audit log" rows={audit} cols={['created_at', 'user_id', 'action', 'subject', 'status', 'ip']} />}</main></div>
}
