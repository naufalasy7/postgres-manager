import React, { useState, useEffect, useRef } from 'react'
import {
  Folder,
  FileText,
  FileCode,
  GitBranch,
  UploadCloud,
  Download,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Check,
  BookOpen,
  History,
  ArrowLeft,
  X,
  ExternalLink,
  Search,
  FolderUp,
  Database,
  File as FileIcon,
  Archive,
  Play
} from 'lucide-react'
import { marked } from 'marked'

interface Props {
  api: <T = any>(path: string, method?: string, body?: unknown) => Promise<T>
  xsrf: () => string
  initialRepo?: string | null
  onOpenProjectDashboard?: (projectId: number) => void
}

interface RepoItem {
  name: string
  description: string
  branch: string
  commits_count: number
  last_commit: {
    hash: string
    author: string
    time_ago: string
    message: string
    date: string
  } | null
  updated_at: string
}

interface TreeEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number | null
  commit: {
    hash: string
    author: string
    time_ago: string
    message: string
  } | null
  modified_at: string
}

interface TreeData {
  repo: string
  branch: string
  path: string
  parent_path: string | null
  last_commit: {
    hash: string
    author: string
    time_ago: string
    message: string
    date: string
  } | null
  entries: TreeEntry[]
  readme: string | null
}

interface BlobData {
  repo: string
  name: string
  path: string
  size: number
  lines: number
  mime: string
  is_binary: boolean
  content: string | null
  commit: {
    hash: string
    author: string
    time_ago: string
    message: string
    date: string
  } | null
}

interface CommitItem {
  hash: string
  short_hash: string
  author: string
  email: string
  time_ago: string
  message: string
  date: string
}

interface UploadFileItem {
  file: File
  relativePath: string
}

// Recursive helper to traverse dropped entries (both files and folders)
async function getFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<UploadFileItem[]> {
  const result: UploadFileItem[] = []

  async function traverseEntry(entry: any, currentPath: string): Promise<void> {
    if (!entry) return

    if (entry.isFile) {
      await new Promise<void>(resolve => {
        entry.file(
          (file: File) => {
            const rel = currentPath ? `${currentPath}/${file.name}` : file.name
            result.push({ file, relativePath: rel })
            resolve()
          },
          () => resolve()
        )
      })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const dirPath = currentPath ? `${currentPath}/${entry.name}` : entry.name

      // readEntries returns results in batches up to 100, read until empty batch
      const readAllEntries = async (): Promise<any[]> => {
        const batch: any[] = []
        let hasMore = true
        while (hasMore) {
          const nextBatch = await new Promise<any[]>(resolve => {
            reader.readEntries((entries: any[]) => resolve(entries || []), () => resolve([]))
          })
          if (nextBatch.length === 0) {
            hasMore = false
          } else {
            batch.push(...nextBatch)
          }
        }
        return batch
      }

      const children = await readAllEntries()
      for (const child of children) {
        await traverseEntry(child, dirPath)
      }
    }
  }

  const items = dataTransfer.items
  if (items && items.length > 0 && items[0].webkitGetAsEntry) {
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry()
      if (entry) {
        await traverseEntry(entry, '')
      }
    }
  } else if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i]
      const rel = (file as any).webkitRelativePath || file.name
      result.push({ file, relativePath: rel })
    }
  }

  return result
}

export default function GitHubRepoManager({ api, xsrf, initialRepo, onOpenProjectDashboard }: Props) {
  // Navigation & Repos
  const [repos, setRepos] = useState<RepoItem[]>([])
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOption, setSortOption] = useState<'updated' | 'name' | 'commits'>('updated')

  // Ecosystem & Projects Integration
  const [projects, setProjects] = useState<any[]>([])
  const [showExecModal, setShowExecModal] = useState(false)
  const [targetProjectId, setTargetProjectId] = useState<string>('')
  const [execResult, setExecResult] = useState<any>(null)
  const [execBusy, setExecBusy] = useState(false)

  // Repository Detail View
  const [currentPath, setCurrentPath] = useState<string>('')
  const [treeData, setTreeData] = useState<TreeData | null>(null)
  const [activeFile, setActiveFile] = useState<BlobData | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [newFilePath, setNewFilePath] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [commits, setCommits] = useState<CommitItem[] | null>(null)

  // Upload state
  const [isDragging, setIsDragging] = useState(false)
  const [uploadItems, setUploadItems] = useState<UploadFileItem[]>([])
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadCommitMsg, setUploadCommitMsg] = useState('')

  // Modals & UI status
  const [showNewRepoModal, setShowNewRepoModal] = useState(false)
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoDesc, setNewRepoDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Load repositories on mount
  const loadRepos = async (keepSelection = true) => {
    try {
      setLoading(true)
      const list = await api<RepoItem[]>('/repositories')
      setRepos(list)
      if (!keepSelection) {
        setSelectedRepo(null)
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal memuat repositories.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRepos()
    api('/projects').then(setProjects).catch(() => {})
  }, [])

  useEffect(() => {
    if (initialRepo) {
      selectRepo(initialRepo)
    }
  }, [initialRepo])

  // Load directory tree
  const loadTree = async (repo: string, path: string) => {
    if (!repo) return
    try {
      setLoading(true)
      setErrorMsg('')
      setActiveFile(null)
      setIsEditing(false)
      setIsCreatingFile(false)
      setCommits(null)
      const data = await api<TreeData>(
        `/repositories/${encodeURIComponent(repo)}/tree?path=${encodeURIComponent(path)}`
      )
      setTreeData(data)
      setCurrentPath(path)
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal memuat direktori.')
    } finally {
      setLoading(false)
    }
  }

  const selectRepo = (repoName: string) => {
    setSelectedRepo(repoName)
    setCurrentPath('')
    loadTree(repoName, '')
  }

  // Open file (blob)
  const openFile = async (path: string) => {
    if (!selectedRepo) return
    try {
      setLoading(true)
      setErrorMsg('')
      const blob = await api<BlobData>(
        `/repositories/${encodeURIComponent(selectedRepo)}/blob?path=${encodeURIComponent(path)}`
      )
      setActiveFile(blob)
      setIsEditing(false)
      setIsCreatingFile(false)
      setCommits(null)
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal membuka file.')
    } finally {
      setLoading(false)
    }
  }

  // Load commits log
  const loadCommits = async () => {
    if (!selectedRepo) return
    try {
      setLoading(true)
      setErrorMsg('')
      const list = await api<CommitItem[]>(
        `/repositories/${encodeURIComponent(selectedRepo)}/commits?path=${encodeURIComponent(currentPath)}`
      )
      setCommits(list)
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal memuat riwayat commit.')
    } finally {
      setLoading(false)
    }
  }

  // Handle Drag & Drop (supports both single files and FULL recursive directories!)
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (!selectedRepo) {
      setErrorMsg('Pilih repository terlebih dahulu sebelum mengunggah file/folder.')
      return
    }

    try {
      setLoading(true)
      const items = await getFilesFromDataTransfer(e.dataTransfer)
      if (items.length > 0) {
        setUploadItems(items)
        const hasFolders = items.some(i => i.relativePath.includes('/'))
        const defaultCommit = hasFolders
          ? `Upload folder structure (${items.length} files)`
          : items.length === 1
          ? `Upload ${items[0].relativePath}`
          : `Upload ${items.length} files`
        setUploadCommitMsg(defaultCommit)
        setShowUploadModal(true)
      }
    } catch (err: any) {
      setErrorMsg('Gagal membaca file atau folder yang ditarik: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // Handle file/folder upload submit
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRepo || uploadItems.length === 0) return

    try {
      setActionBusy(true)
      setErrorMsg('')
      const fd = new FormData()
      fd.append('path', currentPath)
      fd.append('commit_message', uploadCommitMsg || `Upload ${uploadItems.length} items`)

      const relativePaths: string[] = []
      uploadItems.forEach(item => {
        fd.append('files[]', item.file)
        relativePaths.push(item.relativePath)
      })
      fd.append('relative_paths', JSON.stringify(relativePaths))

      const apiBase = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '')
      const r = await fetch(`${apiBase}/api/repositories/${encodeURIComponent(selectedRepo)}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
        headers: {
          Accept: 'application/json',
          'X-XSRF-TOKEN': xsrf()
        }
      })

      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: r.statusText }))
        throw new Error(err.message || 'Upload gagal.')
      }

      setShowUploadModal(false)
      setUploadItems([])
      setUploadCommitMsg('')
      await loadTree(selectedRepo, currentPath)
      await loadRepos()
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal mengunggah file/folder.')
    } finally {
      setActionBusy(false)
    }
  }

  // Save file (edit or create)
  const handleSaveFile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRepo) return
    const path = isCreatingFile ? (currentPath ? `${currentPath}/${newFilePath}` : newFilePath) : activeFile?.path
    if (!path) return

    try {
      setActionBusy(true)
      setErrorMsg('')
      const defaultMsg = isCreatingFile ? `Create ${path.split('/').pop()}` : `Update ${path.split('/').pop()}`
      await api(`/repositories/${encodeURIComponent(selectedRepo)}/save-file`, 'POST', {
        path,
        content: editContent,
        commit_message: commitMsg || defaultMsg
      })

      setIsEditing(false)
      setIsCreatingFile(false)
      setCommitMsg('')
      await openFile(path)
      await loadRepos()
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal menyimpan file.')
    } finally {
      setActionBusy(false)
    }
  }

  // Delete file
  const handleDeleteFile = async () => {
    if (!selectedRepo || !activeFile) return
    const filename = activeFile.name
    if (!confirm(`Hapus file "${filename}" dari repository? Tindakan ini akan dicatat dalam riwayat commit.`)) {
      return
    }

    try {
      setActionBusy(true)
      setErrorMsg('')
      await api(`/repositories/${encodeURIComponent(selectedRepo)}/delete-file`, 'DELETE', {
        path: activeFile.path,
        commit_message: `Delete ${filename}`
      })

      const parent = activeFile.path.includes('/')
        ? activeFile.path.substring(0, activeFile.path.lastIndexOf('/'))
        : ''
      await loadTree(selectedRepo, parent)
      await loadRepos()
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal menghapus file.')
    } finally {
      setActionBusy(false)
    }
  }

  // Create repository
  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRepoName.trim()) return
    try {
      setActionBusy(true)
      setErrorMsg('')
      await api('/repositories', 'POST', {
        name: newRepoName.trim(),
        description: newRepoDesc.trim(),
        init_readme: true
      })
      setShowNewRepoModal(false)
      const createdName = newRepoName.trim()
      setNewRepoName('')
      setNewRepoDesc('')
      await loadRepos()
      selectRepo(createdName)
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal membuat repository.')
    } finally {
      setActionBusy(false)
    }
  }

  const formatBytes = (bytes: number | null) => {
    if (bytes === null || bytes === undefined) return '-'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1048576).toFixed(2) + ' MB'
  }

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase()
    if (['sql', 'pgsql'].includes(ext || '')) return <Database className="w-4 h-4 text-emerald-400" />
    if (['js', 'ts', 'jsx', 'tsx', 'php', 'py', 'sh', 'bash', 'json', 'yaml', 'yml'].includes(ext || ''))
      return <FileCode className="w-4 h-4 text-blue-400" />
    if (['md', 'txt', 'csv'].includes(ext || '')) return <FileText className="w-4 h-4 text-slate-300" />
    return <FileIcon className="w-4 h-4 text-slate-400" />
  }

  // Filter & sort repos
  const filteredRepos = repos
    .filter(
      r =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.description.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortOption === 'name') return a.name.localeCompare(b.name)
      if (sortOption === 'commits') return b.commits_count - a.commits_count
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })

  const currentRepoObj = repos.find(r => r.name === selectedRepo)

  return (
    <div
      className="space-y-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Fullscreen Overlay Feedback */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 border-4 border-dashed border-emerald-500 backdrop-blur-sm pointer-events-none">
          <div className="text-center p-8 bg-slate-900 rounded-2xl border border-emerald-500/50 shadow-2xl max-w-md">
            <UploadCloud className="w-16 h-16 text-emerald-400 mx-auto animate-bounce mb-3" />
            <h2 className="text-xl font-bold text-white">Lepaskan Folder atau File di Sini</h2>
            <p className="text-sm text-slate-300 mt-2">
              Mendukung upload folder utuh beserta subfolder & file di dalamnya.
            </p>
            {selectedRepo && (
              <p className="text-xs text-emerald-400 font-mono mt-2 bg-slate-950 py-1 px-3 rounded-full border border-emerald-900 inline-block">
                Target: {selectedRepo}/{currentPath ? currentPath + '/' : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error alert */}
      {errorMsg && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-sm">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="p-1 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. REPOSITORIES CATALOG / LIST VIEW (EXACT GITHUB REPOSITORIES PAGE)      */}
      {/* ========================================================================= */}
      {!selectedRepo && (
        <div className="space-y-5">
          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2.5">
                <BookOpen className="w-6 h-6 text-emerald-400" />
                <h1 className="text-xl font-bold text-white">Repositories</h1>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold">
                  {repos.length}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Katalog repositori Git lokal untuk PostgreSQL scripts, migrations, dan queries.
              </p>
            </div>

            <button
              onClick={() => setShowNewRepoModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Repository</span>
            </button>
          </div>

          {/* Filter & Search Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Find a repository..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-slate-800 bg-slate-900 pl-9 pr-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Sort by:</span>
              <select
                value={sortOption}
                onChange={e => setSortOption(e.target.value as any)}
                className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="updated">Last updated</option>
                <option value="name">Name</option>
                <option value="commits">Most commits</option>
              </select>
            </div>
          </div>

          {/* Repository Cards List (GitHub Style) */}
          <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-900/50">
            {filteredRepos.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <BookOpen className="w-12 h-12 text-slate-600 mx-auto" />
                <h3 className="font-semibold text-slate-300">Tidak ada repository yang cocok</h3>
                <p className="text-xs text-slate-500">
                  {searchQuery ? `Tidak ada repository dengan kata kunci "${searchQuery}"` : 'Belum ada repository.'}
                </p>
                <button
                  onClick={() => setShowNewRepoModal(true)}
                  className="px-4 py-2 rounded-md bg-emerald-600 text-white text-xs font-semibold"
                >
                  Buat Repository Pertama
                </button>
              </div>
            ) : (
              filteredRepos.map(repo => (
                <div
                  key={repo.name}
                  className="p-5 hover:bg-slate-800/40 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <button
                        onClick={() => selectRepo(repo.name)}
                        className="text-base font-bold text-emerald-400 hover:underline flex items-center gap-2"
                      >
                        <BookOpen className="w-4 h-4 text-slate-400" />
                        <span>{repo.name}</span>
                      </button>
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-400 font-medium">
                        Public
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-2">
                      {repo.description || 'Tidak ada deskripsi.'}
                    </p>

                    <div className="flex items-center gap-4 text-xs text-slate-400 font-mono flex-wrap pt-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                        <span className="font-sans text-slate-300">PostgreSQL / SQL</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <GitBranch className="w-3.5 h-3.5 text-slate-500" />
                        <span>{repo.branch}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <History className="w-3.5 h-3.5 text-slate-500" />
                        <span>{repo.commits_count} commits</span>
                      </div>

                      <span className="font-sans text-slate-500">
                        {repo.last_commit ? `Updated ${repo.last_commit.time_ago}` : `Updated ${repo.updated_at}`}
                      </span>
                    </div>
                  </div>

                  {/* Actions on the card */}
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`/api/repositories/${encodeURIComponent(repo.name)}/zip`}
                      download
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
                      title="Unduh seluruh repository (ZIP)"
                    >
                      <Archive className="w-3.5 h-3.5 text-slate-400" />
                      <span>ZIP</span>
                    </a>

                    <button
                      onClick={() => selectRepo(repo.name)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs font-semibold shadow-sm transition"
                    >
                      <span>Buka Repo</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. REPOSITORY DETAIL VIEW (TREE, CODE VIEWER, COMMITS, DRAG & DROP)      */}
      {/* ========================================================================= */}
      {selectedRepo && (
        <div className="space-y-4">
          {/* Top Navigation & Breadcrumbs Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            {/* Left: Back to Repositories & Repo Switcher */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setSelectedRepo(null)
                  setActiveFile(null)
                  setCommits(null)
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs text-slate-300 font-medium transition"
                title="Kembali ke Daftar Semua Repository"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Semua Repo</span>
              </button>

              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-400" />
                <span className="text-slate-500 font-mono text-sm">/</span>
                <select
                  value={selectedRepo}
                  onChange={e => selectRepo(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-md px-3 py-1 text-sm font-bold text-white focus:outline-none focus:border-emerald-500"
                >
                  {repos.map(r => (
                    <option key={r.name} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-400 font-medium">
                  Public
                </span>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNewRepoModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Repo Baru</span>
              </button>

              <a
                href={`/api/repositories/${encodeURIComponent(selectedRepo)}/zip`}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold shadow-sm"
                title="Unduh seluruh repository dalam format ZIP"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download ZIP</span>
              </a>
            </div>
          </div>

          {/* Description */}
          {currentRepoObj && (
            <p className="text-xs text-slate-400 -mt-2">
              {currentRepoObj.description}
            </p>
          )}

          {/* Branch bar, folder path, upload buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left: Branch badge & Folder Breadcrumbs */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300">
                <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                <span>{treeData?.branch || 'main'}</span>
              </div>

              <div className="flex items-center gap-1 text-sm font-mono text-slate-300">
                <button
                  onClick={() => {
                    setCurrentPath('')
                    loadTree(selectedRepo, '')
                  }}
                  className="text-emerald-400 hover:underline font-semibold"
                >
                  {selectedRepo}
                </button>
                {currentPath &&
                  currentPath.split('/').map((seg, idx, arr) => {
                    const sub = arr.slice(0, idx + 1).join('/')
                    return (
                      <React.Fragment key={sub}>
                        <span className="text-slate-600">/</span>
                        <button
                          onClick={() => {
                            setCurrentPath(sub)
                            loadTree(selectedRepo, sub)
                          }}
                          className="hover:underline text-slate-300"
                        >
                          {seg}
                        </button>
                      </React.Fragment>
                    )
                  })}
                {activeFile && (
                  <>
                    <span className="text-slate-600">/</span>
                    <span className="text-white font-medium">{activeFile.name}</span>
                  </>
                )}
              </div>
            </div>

            {/* Right: Actions (Commits, Create File, Upload File, Upload Folder) */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (commits) {
                    setCommits(null)
                  } else {
                    loadCommits()
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md border text-xs font-medium transition ${
                  commits
                    ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Riwayat Commit</span>
              </button>

              {!activeFile && !commits && (
                <>
                  <button
                    onClick={() => {
                      setNewFilePath('')
                      setEditContent('')
                      setCommitMsg('')
                      setIsCreatingFile(true)
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Buat File</span>
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-300 hover:bg-slate-800"
                    title="Upload satu atau beberapa file"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Upload File</span>
                  </button>

                  <button
                    onClick={() => folderInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-300 hover:bg-slate-800"
                    title="Upload satu folder utuh beserta subfolder"
                  >
                    <FolderUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Upload Folder</span>
                  </button>

                  {/* Hidden inputs for file & folder picking */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => {
                      if (e.target.files && e.target.files.length > 0) {
                        const items: UploadFileItem[] = Array.from(e.target.files).map(f => ({
                          file: f,
                          relativePath: f.name
                        }))
                        setUploadItems(items)
                        setUploadCommitMsg(
                          items.length === 1 ? `Upload ${items[0].relativePath}` : `Upload ${items.length} files`
                        )
                        setShowUploadModal(true)
                      }
                    }}
                  />

                  <input
                    ref={folderInputRef}
                    type="file"
                    // @ts-ignore
                    webkitdirectory=""
                    directory=""
                    multiple
                    className="hidden"
                    onChange={e => {
                      if (e.target.files && e.target.files.length > 0) {
                        const items: UploadFileItem[] = Array.from(e.target.files).map(f => ({
                          file: f,
                          relativePath: (f as any).webkitRelativePath || f.name
                        }))
                        setUploadItems(items)
                        setUploadCommitMsg(`Upload folder (${items.length} files)`)
                        setShowUploadModal(true)
                      }
                    }}
                  />
                </>
              )}
            </div>
          </div>

          {/* VIEW: COMMITS LOG */}
          {commits && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-lg">
              <div className="flex items-center justify-between p-3 bg-slate-950/70 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCommits(null)}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="font-semibold text-sm">Riwayat Commit ({commits.length})</span>
                </div>
              </div>
              <div className="divide-y divide-slate-800/70">
                {commits.map(c => (
                  <div key={c.hash} className="p-3.5 hover:bg-slate-800/40 flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-100">{c.message}</p>
                      <p className="text-xs text-slate-400">
                        <span className="text-slate-300 font-medium">{c.author}</span> committed{' '}
                        <span>{c.time_ago}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                        {c.short_hash}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* VIEW: CREATE NEW FILE */}
          {isCreatingFile && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="font-semibold text-sm">Buat File Baru</h2>
                <button
                  onClick={() => setIsCreatingFile(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Batal
                </button>
              </div>
              <form onSubmit={handleSaveFile} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-400 font-mono">
                    {selectedRepo}/{currentPath ? currentPath + '/' : ''}
                  </span>
                  <input
                    type="text"
                    placeholder="nama-file.sql (contoh: queries/analisis.sql)"
                    value={newFilePath}
                    onChange={e => setNewFilePath(e.target.value)}
                    className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-mono text-white focus:border-emerald-500 focus:outline-none"
                    required
                  />
                </div>

                <textarea
                  rows={16}
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  placeholder="Tulis kode atau script di sini..."
                  className="w-full rounded-md border border-slate-700 bg-slate-950 p-3 text-xs font-mono text-slate-200 focus:border-emerald-500 focus:outline-none"
                  required
                />

                <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-300">Commit new file</p>
                  <input
                    type="text"
                    placeholder="Commit message (default: Create <filename>)"
                    value={commitMsg}
                    onChange={e => setCommitMsg(e.target.value)}
                    className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-white"
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      disabled={actionBusy}
                      className="rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {actionBusy ? 'Menyimpan...' : 'Commit new file'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingFile(false)}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* VIEW: FILE VIEWER & IN-BROWSER EDITOR */}
          {activeFile && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-lg">
              {/* File Header Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-950/70 border-b border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const parent = activeFile.path.includes('/')
                        ? activeFile.path.substring(0, activeFile.path.lastIndexOf('/'))
                        : ''
                      loadTree(selectedRepo, parent)
                    }}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                    title="Kembali ke folder"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-slate-200 font-semibold">{activeFile.name}</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-400">
                    {activeFile.lines} baris • {formatBytes(activeFile.size)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(activeFile.content || '')
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Tersalin' : 'Copy'}</span>
                  </button>

                  <a
                    href={`/api/repositories/${encodeURIComponent(selectedRepo)}/raw?path=${encodeURIComponent(
                      activeFile.path
                    )}&download=1`}
                    download
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh</span>
                  </a>

                  <a
                    href={`/api/repositories/${encodeURIComponent(selectedRepo)}/raw?path=${encodeURIComponent(
                      activeFile.path
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Raw</span>
                  </a>

                  {['sql', 'pgsql'].includes(activeFile.name.split('.').pop()?.toLowerCase() || '') && (
                    <button
                      onClick={() => {
                        setExecResult(null)
                        if (projects.length > 0) setTargetProjectId(String(projects[0].id))
                        setShowExecModal(true)
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-900/80 border border-emerald-700 text-emerald-200 hover:bg-emerald-800 font-medium"
                      title="Eksekusi skrip ini langsung ke Database Proyek PostgreSQL"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Jalankan di Database...</span>
                    </button>
                  )}

                  {!isEditing && (
                    <button
                      onClick={() => {
                        setEditContent(activeFile.content || '')
                        setCommitMsg('')
                        setIsEditing(true)
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700"
                    >
                      <Pencil className="w-3.5 h-3.5 text-slate-300" />
                      <span>Edit</span>
                    </button>
                  )}

                  <button
                    onClick={handleDeleteFile}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/40 border border-red-900 text-red-400 hover:bg-red-900/60"
                    title="Hapus file"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Last commit for this file */}
              {activeFile.commit && (
                <div className="px-4 py-2 bg-slate-950/40 border-b border-slate-800/80 text-xs text-slate-400 flex items-center justify-between">
                  <div>
                    <span className="text-slate-200 font-medium">{activeFile.commit.author}</span>{' '}
                    <span className="text-slate-300">{activeFile.commit.message}</span>
                  </div>
                  <span className="text-slate-500">{activeFile.commit.time_ago}</span>
                </div>
              )}

              {/* Content / Editor Area */}
              {isEditing ? (
                <form onSubmit={handleSaveFile} className="p-4 space-y-3">
                  <textarea
                    rows={20}
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 p-3 text-xs font-mono text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-2">
                    <p className="text-xs font-medium text-slate-300">Commit changes</p>
                    <input
                      type="text"
                      placeholder={`Update ${activeFile.name}`}
                      value={commitMsg}
                      onChange={e => setCommitMsg(e.target.value)}
                      className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-white"
                    />
                    <div className="flex gap-2 pt-1">
                      <button
                        disabled={actionBusy}
                        className="rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {actionBusy ? 'Menyimpan...' : 'Commit changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                </form>
              ) : activeFile.is_binary ? (
                <div className="p-8 text-center text-slate-400 space-y-2">
                  <FileIcon className="w-12 h-12 mx-auto text-slate-600" />
                  <p className="text-sm">File biner tidak dapat ditampilkan langsung di browser.</p>
                  <a
                    href={`/api/repositories/${encodeURIComponent(selectedRepo)}/raw?path=${encodeURIComponent(
                      activeFile.path
                    )}&download=1`}
                    download
                    className="inline-block px-4 py-2 rounded-md bg-emerald-600 text-white text-xs font-medium"
                  >
                    Download File ({formatBytes(activeFile.size)})
                  </a>
                </div>
              ) : (
                <div className="flex bg-slate-950 overflow-x-auto text-xs font-mono">
                  {/* Line numbers gutter */}
                  <div className="select-none py-3 px-3 text-right text-slate-600 border-r border-slate-800/80">
                    {Array.from({ length: Math.max(1, activeFile.lines) }).map((_, i) => (
                      <div key={i} className="leading-5">
                        {i + 1}
                      </div>
                    ))}
                  </div>
                  {/* Code lines */}
                  <pre className="py-3 px-4 text-slate-200 leading-5 flex-1 whitespace-pre">
                    {activeFile.content}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* VIEW: FILE EXPLORER / TREE */}
          {!activeFile && !commits && !isCreatingFile && treeData && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-lg">
                {/* Latest Commit Bar (GitHub Style) */}
                {treeData.last_commit && (
                  <div className="flex items-center justify-between p-3 bg-slate-950/70 border-b border-slate-800 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <div className="w-5 h-5 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-[10px]">
                        {treeData.last_commit.author ? treeData.last_commit.author[0].toUpperCase() : 'A'}
                      </div>
                      <span className="font-semibold text-slate-200">{treeData.last_commit.author}</span>
                      <span className="text-slate-400 truncate">{treeData.last_commit.message}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-slate-500 font-mono">
                      <span>{treeData.last_commit.time_ago}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                        {treeData.last_commit.hash}
                      </span>
                    </div>
                  </div>
                )}

                {/* File Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-slate-500 bg-slate-950/40 border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3 font-medium">Nama</th>
                        <th className="py-2 px-3 font-medium">Pesan Terakhir</th>
                        <th className="py-2 px-3 font-medium text-right">Ukuran</th>
                        <th className="py-2 px-3 font-medium text-right">Waktu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                      {/* Parent Directory Link */}
                      {treeData.parent_path !== null && (
                        <tr
                          onClick={() => {
                            const p = treeData.parent_path ?? ''
                            setCurrentPath(p)
                            loadTree(selectedRepo, p)
                          }}
                          className="hover:bg-slate-800/50 cursor-pointer text-slate-400"
                        >
                          <td colSpan={4} className="py-2.5 px-3 flex items-center gap-2">
                            <Folder className="w-4 h-4 text-blue-400" />
                            <span>..</span>
                          </td>
                        </tr>
                      )}

                      {treeData.entries.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-slate-500">
                            Folder ini kosong. Tarik file atau folder ke sini untuk mengunggah.
                          </td>
                        </tr>
                      ) : (
                        treeData.entries.map(entry => (
                          <tr
                            key={entry.path}
                            onClick={() => {
                              if (entry.type === 'dir') {
                                setCurrentPath(entry.path)
                                loadTree(selectedRepo, entry.path)
                              } else {
                                openFile(entry.path)
                              }
                            }}
                            className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                          >
                            <td className="py-2 px-3 flex items-center gap-2 text-slate-200">
                              {entry.type === 'dir' ? (
                                <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                              ) : (
                                getFileIcon(entry.name)
                              )}
                              <span
                                className={
                                  entry.type === 'dir'
                                    ? 'font-semibold text-blue-400 hover:underline'
                                    : 'hover:underline'
                                }
                              >
                                {entry.name}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-400 truncate max-w-xs font-sans">
                              {entry.commit?.message || '-'}
                            </td>
                            <td className="py-2 px-3 text-slate-500 text-right">
                              {formatBytes(entry.size)}
                            </td>
                            <td className="py-2 px-3 text-slate-500 text-right whitespace-nowrap font-sans">
                              {entry.commit?.time_ago || '-'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Drag & Drop Prompt footer */}
                <div className="p-3 bg-slate-950/30 border-t border-slate-800/80 text-center text-xs text-slate-400">
                  📁 Tarik dan lepaskan (<strong className="text-emerald-400">Drag & Drop</strong>) <strong className="text-white">file tunggal ATAU seluruh folder</strong> ke tabel ini untuk mengunggah struktur direktori lengkap.
                </div>
              </div>

              {/* Render README.md at bottom (Exact GitHub style) */}
              {treeData.readme && (
                <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-lg">
                  <div className="flex items-center gap-2 p-3 bg-slate-950/70 border-b border-slate-800 text-xs font-semibold text-slate-200">
                    <BookOpen className="w-4 h-4 text-slate-400" />
                    <span>README.md</span>
                  </div>
                  <div
                    className="p-6 markdown-body"
                    dangerouslySetInnerHTML={{ __html: marked.parse(treeData.readme) as string }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. MODALS: UPLOAD (FILES & FOLDERS) AND NEW REPOSITORY                    */}
      {/* ========================================================================= */}

      {/* MODAL: UPLOAD FILES & FOLDERS */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-emerald-400" />
                <h3 className="font-semibold text-sm">
                  Upload ke <span className="font-mono text-emerald-400">{selectedRepo}/{currentPath ? currentPath + '/' : ''}</span>
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowUploadModal(false)
                  setUploadItems([])
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span>Total: <strong className="text-white">{uploadItems.length}</strong> file/folder</span>
              <span>
                Total Ukuran:{' '}
                <strong className="text-white">
                  {formatBytes(uploadItems.reduce((acc, curr) => acc + curr.file.size, 0))}
                </strong>
              </span>
            </div>

            {/* Tree / preview list of files to be committed */}
            <div className="max-h-56 overflow-y-auto space-y-1 p-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs">
              {uploadItems.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-900/60 transition"
                >
                  <span className="truncate max-w-md text-slate-300" title={item.relativePath}>
                    {item.relativePath.includes('/') ? (
                      <>
                        <span className="text-slate-500">
                          {item.relativePath.substring(0, item.relativePath.lastIndexOf('/') + 1)}
                        </span>
                        <span className="text-emerald-400 font-semibold">
                          {item.relativePath.substring(item.relativePath.lastIndexOf('/') + 1)}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-200">{item.relativePath}</span>
                    )}
                  </span>
                  <span className="text-slate-500 shrink-0">{formatBytes(item.file.size)}</span>
                </div>
              ))}
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Pesan Commit</label>
                <input
                  type="text"
                  value={uploadCommitMsg}
                  onChange={e => setUploadCommitMsg(e.target.value)}
                  placeholder="Upload folder structure via drag & drop"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadModal(false)
                    setUploadItems([])
                  }}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionBusy}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {actionBusy ? 'Mengunggah & Commit...' : 'Commit changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NEW REPOSITORY */}
      {showNewRepoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-400" />
                <h3 className="font-semibold text-sm">Buat Repository Baru</h3>
              </div>
              <button onClick={() => setShowNewRepoModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRepo} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Nama Repository</label>
                <input
                  type="text"
                  placeholder="misal: database-migrations, analytics-queries"
                  value={newRepoName}
                  onChange={e => setNewRepoName(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Deskripsi (Opsional)</label>
                <textarea
                  rows={3}
                  placeholder="Deskripsi singkat isi dan fungsi repository..."
                  value={newRepoDesc}
                  onChange={e => setNewRepoDesc(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="p-2.5 rounded bg-slate-950 text-xs text-slate-400">
                ✓ Otomatis diinisialisasi dengan branch <span className="text-emerald-400 font-mono">main</span> dan file <span className="text-emerald-400 font-mono">README.md</span>.
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewRepoModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionBusy}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {actionBusy ? 'Membuat...' : 'Buat Repository'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EXECUTE SQL SCRIPT ON PROJECT DATABASE */}
      {showExecModal && activeFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-400" />
                <h3 className="font-semibold text-sm">Jalankan Skrip ke Database Proyek</h3>
              </div>
              <button onClick={() => setShowExecModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 rounded bg-slate-950 border border-slate-800 font-mono text-xs space-y-1">
              <p className="text-slate-400">
                Repository: <span className="text-white font-semibold">{selectedRepo}</span>
              </p>
              <p className="text-slate-400">
                Skrip File: <span className="text-emerald-400 font-semibold">{activeFile.path}</span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Pilih Target Database Proyek:
              </label>
              {projects.length === 0 ? (
                <p className="text-xs text-red-400">
                  Belum ada proyek database terdaftar. Buat proyek terlebih dahulu di tab Proyek DB.
                </p>
              ) : (
                <select
                  value={targetProjectId}
                  onChange={e => setTargetProjectId(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.db_name}) {p.repository ? `[Linked: ${p.repository}]` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {execResult && (
              <div
                className={`p-3 rounded-lg border text-xs space-y-2 ${
                  execResult.status === 'success'
                    ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                    : 'bg-red-950/40 border-red-800 text-red-200'
                }`}
              >
                <p className="font-semibold">{execResult.message}</p>
                {execResult.columns && execResult.rows && execResult.rows.length > 0 && (
                  <div className="max-h-36 overflow-auto rounded bg-slate-950 p-2 border border-slate-800 font-mono text-[11px]">
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

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowExecModal(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                Tutup
              </button>
              <button
                type="button"
                disabled={execBusy || !targetProjectId || projects.length === 0}
                onClick={async () => {
                  try {
                    setExecBusy(true)
                    setExecResult(null)
                    const res = await api(`/projects/${targetProjectId}/execute-script`, 'POST', {
                      repository: selectedRepo,
                      path: activeFile.path
                    })
                    setExecResult(res)
                  } catch (err: any) {
                    setExecResult({ status: 'error', message: err.message || 'Eksekusi gagal.' })
                  } finally {
                    setExecBusy(false)
                  }
                }}
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{execBusy ? 'Mengeksekusi...' : 'Eksekusi ke Database'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
