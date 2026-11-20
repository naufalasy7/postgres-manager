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
  ChevronRight,
  Database,
  File as FileIcon
} from 'lucide-react'
import { marked } from 'marked'

interface Props {
  api: <T = any>(path: string, method?: string, body?: unknown) => Promise<T>
  xsrf: () => string
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

export default function GitHubRepoManager({ api, xsrf }: Props) {
  const [repos, setRepos] = useState<RepoItem[]>([])
  const [selectedRepo, setSelectedRepo] = useState<string>('')
  const [currentPath, setCurrentPath] = useState<string>('')
  const [treeData, setTreeData] = useState<TreeData | null>(null)
  const [activeFile, setActiveFile] = useState<BlobData | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [newFilePath, setNewFilePath] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [commits, setCommits] = useState<CommitItem[] | null>(null)
  const [showNewRepoModal, setShowNewRepoModal] = useState(false)
  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoDesc, setNewRepoDesc] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadCommitMsg, setUploadCommitMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load repositories on mount
  const loadRepos = async (defaultSelect?: string) => {
    try {
      setLoading(true)
      const list = await api<RepoItem[]>('/repositories')
      setRepos(list)
      if (list.length > 0) {
        const next = defaultSelect || (list.some(r => r.name === selectedRepo) ? selectedRepo : list[0].name)
        setSelectedRepo(next)
      } else {
        setSelectedRepo('')
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal memuat repositories.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRepos()
  }, [])

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
      const data = await api<TreeData>(`/repositories/${encodeURIComponent(repo)}/tree?path=${encodeURIComponent(path)}`)
      setTreeData(data)
      setCurrentPath(path)
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal memuat direktori.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedRepo) {
      loadTree(selectedRepo, currentPath)
    }
  }, [selectedRepo])

  // Open file (blob)
  const openFile = async (path: string) => {
    if (!selectedRepo) return
    try {
      setLoading(true)
      setErrorMsg('')
      const blob = await api<BlobData>(`/repositories/${encodeURIComponent(selectedRepo)}/blob?path=${encodeURIComponent(path)}`)
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
      const list = await api<CommitItem[]>(`/repositories/${encodeURIComponent(selectedRepo)}/commits?path=${encodeURIComponent(currentPath)}`)
      setCommits(list)
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal memuat riwayat commit.')
    } finally {
      setLoading(false)
    }
  }

  // Handle Drag and Drop
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files)
      setUploadFiles(files)
      setUploadCommitMsg(files.length === 1 ? `Upload ${files[0].name}` : `Upload ${files.length} files`)
      setShowUploadModal(true)
    }
  }

  // Handle file upload submit
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRepo || uploadFiles.length === 0) return
    try {
      setActionBusy(true)
      setErrorMsg('')
      const fd = new FormData()
      fd.append('path', currentPath)
      fd.append('commit_message', uploadCommitMsg || `Add ${uploadFiles.length} files via upload`)
      uploadFiles.forEach(f => fd.append('files[]', f))

      const r = await fetch(`/api/repositories/${encodeURIComponent(selectedRepo)}/upload`, {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
        headers: {
          'Accept': 'application/json',
          'X-XSRF-TOKEN': xsrf()
        }
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: r.statusText }))
        throw new Error(err.message || 'Upload gagal.')
      }

      setShowUploadModal(false)
      setUploadFiles([])
      setUploadCommitMsg('')
      await loadTree(selectedRepo, currentPath)
      await loadRepos(selectedRepo)
    } catch (e: any) {
      setErrorMsg(e.message || 'Gagal mengunggah file.')
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
      await loadRepos(selectedRepo)
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
      await loadRepos(selectedRepo)
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
      await loadRepos(createdName)
      await loadTree(createdName, '')
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

  const currentRepoObj = repos.find(r => r.name === selectedRepo)

  return (
    <div
      className="space-y-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag and Drop Fullscreen / Overlay Feedback */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 border-4 border-dashed border-emerald-500 backdrop-blur-sm pointer-events-none">
          <div className="text-center p-8 bg-slate-900 rounded-2xl border border-emerald-500/50 shadow-2xl">
            <UploadCloud className="w-16 h-16 text-emerald-400 mx-auto animate-bounce mb-3" />
            <h2 className="text-xl font-bold text-white">Lepaskan file di sini</h2>
            <p className="text-sm text-slate-400 mt-1">
              File akan diunggah ke folder: <span className="text-emerald-400 font-mono">/{currentPath || ''}</span>
            </p>
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

      {/* Top Header Bar: Repo Selector, New Repo, Download ZIP, Clone */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-slate-400" />
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">repositories /</span>
            <select
              value={selectedRepo}
              onChange={e => {
                setSelectedRepo(e.target.value)
                setCurrentPath('')
              }}
              className="bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:border-emerald-500"
            >
              {repos.map(r => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
            <span className="text-xs px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800/80 text-slate-400 font-medium">
              Public
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewRepoModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200"
          >
            <Plus className="w-4 h-4" />
            <span>Repo Baru</span>
          </button>

          {selectedRepo && (
            <a
              href={`/api/repositories/${encodeURIComponent(selectedRepo)}/zip`}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium shadow-sm"
              title="Unduh seluruh repository dalam format ZIP"
            >
              <Download className="w-4 h-4" />
              <span>Download ZIP</span>
            </a>
          )}
        </div>
      </div>

      {/* Description & metadata */}
      {currentRepoObj && (
        <p className="text-xs text-slate-400 -mt-2">
          {currentRepoObj.description}
        </p>
      )}

      {/* Sub navigation bar (Branch, Breadcrumbs, Add File, Commits) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Branch badge & Breadcrumbs */}
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

        {/* Right actions: Upload / Create / Commits */}
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
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-300 hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Buat File</span>
              </button>

              <button
                onClick={() => {
                  fileInputRef.current?.click()
                }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-300 hover:bg-slate-800"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Upload File</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={e => {
                  if (e.target.files && e.target.files.length > 0) {
                    const files = Array.from(e.target.files)
                    setUploadFiles(files)
                    setUploadCommitMsg(
                      files.length === 1 ? `Upload ${files[0].name}` : `Upload ${files.length} files`
                    )
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
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between p-3 bg-slate-950/60 border-b border-slate-800">
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
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
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
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
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
                        Folder ini kosong. Tarik file ke sini untuk mengunggah.
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
                          <span className={entry.type === 'dir' ? 'font-semibold text-blue-400 hover:underline' : 'hover:underline'}>
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
            <div className="p-3 bg-slate-950/30 border-t border-slate-800/80 text-center text-xs text-slate-500">
              💡 Tarik dan lepaskan (drag & drop) file apa saja ke tabel ini untuk mengunggah langsung ke repository.
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

      {/* MODAL: UPLOAD FILES */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-emerald-400" />
                <h3 className="font-semibold text-sm">Upload Files ke /{currentPath}</h3>
              </div>
              <button
                onClick={() => {
                  setShowUploadModal(false)
                  setUploadFiles([])
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 rounded-lg bg-slate-950 border border-slate-800">
              {uploadFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-900/60 font-mono">
                  <span className="truncate max-w-xs text-slate-200">{f.name}</span>
                  <span className="text-slate-500">{formatBytes(f.size)}</span>
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
                  placeholder="Add files via upload"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadModal(false)
                    setUploadFiles([])
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
                  {actionBusy ? 'Mengunggah...' : 'Commit changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NEW REPOSITORY */}
      {showNewRepoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
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
    </div>
  )
}
