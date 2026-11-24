<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Audit;
use App\Services\ProvisioningService;
use App\Services\RepoEnvSyncService;
use App\Services\RepoSchemaInspector;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

class RepositoryController extends Controller
{
    protected function getReposDir(): string
    {
        $root = config('pgmanager.root');
        if (!$root || !is_dir($root)) {
            $root = realpath(base_path('../../')) ?: base_path();
        }
        $dir = rtrim($root, '/') . '/repositories';
        if (!is_dir($dir)) {
            File::makeDirectory($dir, 0775, true, true);
        }
        $defaultRepo = $dir . '/postgres-scripts';
        if (!is_dir($defaultRepo)) {
            @mkdir($defaultRepo, 0775, true);
            @mkdir($defaultRepo . '/queries', 0775, true);
            @mkdir($defaultRepo . '/migrations', 0775, true);
            file_put_contents($defaultRepo . '/README.md', "# PostgreSQL Scripts Repository\n\nCentralized repository for PostgreSQL scripts, migrations, and queries.\n\n## Features\n- Drag & Drop Upload\n- In-browser Code Editing\n- Download Files & Repositories\n");
            file_put_contents($defaultRepo . '/queries/monitoring.sql', "-- Active connections & state\nSELECT pid, usename, datname, client_addr, state, query_start\nFROM pg_stat_activity\nWHERE state != 'idle'\nORDER BY query_start DESC;\n");
            file_put_contents($defaultRepo . '/migrations/001_init.sql', "-- Sample initial schema\nCREATE TABLE IF NOT EXISTS system_metrics (\n    id SERIAL PRIMARY KEY,\n    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),\n    cpu_usage NUMERIC(5,2),\n    memory_usage NUMERIC(5,2)\n);\n");
            try {
                $this->runGit($defaultRepo, ['init', '-b', 'main']);
                $this->runGit($defaultRepo, ['add', '.']);
                $this->runGit($defaultRepo, ['commit', '-m', 'Initial commit: PostgreSQL scripts and monitoring queries']);
            } catch (\Throwable $e) {}
        }
        return $dir;
    }

    public function getRepoOwner(string $repoPath): string
    {
        $ownerFile = $repoPath . '/.pgm_owner';
        if (file_exists($ownerFile)) {
            $owner = trim((string)file_get_contents($ownerFile));
            if (!empty($owner)) {
                return $owner;
            }
        }
        return 'nnaufalasyam7@gmail.com';
    }

    public function setRepoOwner(string $repoPath, string $ownerEmail): void
    {
        @file_put_contents($repoPath . '/.pgm_owner', trim($ownerEmail));
    }

    protected function checkRepoAccess(string $repoPath, bool $writeAccess = false): void
    {
        $user = auth()->user();
        if (!$user) {
            abort(401, 'Unauthenticated');
        }

        // Super Admin has full unrestricted access
        if ($user->isSuperAdmin()) {
            return;
        }

        $owner = $this->getRepoOwner($repoPath);

        // Strict Isolation: Users (Admin / Operator) CANNOT access other users' repositories!
        if ($owner !== $user->email) {
            abort(403, 'Akses ditolak: Repositori ini milik pengguna lain dan dilindungi.');
        }

        // Operator role is strictly read-only on repositories (no editing/uploading/deleting)
        if ($writeAccess && $user->role === 'user') {
            abort(403, 'Akses ditolak: Role Operator hanya memiliki izin membaca repositori.');
        }
    }

    protected function resolveRepoPath(string $repo, bool $writeAccess = false): string
    {
        if (!preg_match('/^[a-zA-Z0-9_\-\.]+$/', $repo)) {
            abort(400, 'Invalid repository name format.');
        }
        $base = $this->getReposDir();
        $repoPath = $base . '/' . $repo;
        if (!is_dir($repoPath)) {
            abort(404, "Repository '{$repo}' not found.");
        }
        $this->checkRepoAccess($repoPath, $writeAccess);
        return $repoPath;
    }

    protected function safePath(string $repoPath, ?string $subpath): string
    {
        $subpath = trim((string)$subpath, '/');
        // Prevent directory traversal
        $parts = explode('/', str_replace('\\', '/', $subpath));
        $clean = [];
        foreach ($parts as $p) {
            if ($p === '' || $p === '.') continue;
            if ($p === '..') {
                abort(400, 'Directory traversal is forbidden.');
            }
            if ($p === '.git') {
                abort(403, 'Access to .git directory is forbidden.');
            }
            $clean[] = $p;
        }

        $rel = implode('/', $clean);
        $full = empty($rel) ? $repoPath : ($repoPath . '/' . $rel);

        // Double check realpath or prefix
        $realRepo = realpath($repoPath) ?: $repoPath;
        if (file_exists($full)) {
            $realFull = realpath($full);
            if ($realFull === false || !str_starts_with($realFull, $realRepo)) {
                abort(403, 'Path is outside repository.');
            }
        }
        return $full;
    }

    protected function runGit(string $repoPath, array $args, ?string $userEmail = null): string
    {
        $gitArgs = ['git', '-C', $repoPath];
        if ($userEmail) {
            $name = explode('@', $userEmail)[0] ?: 'Admin';
            $gitArgs[] = '-c';
            $gitArgs[] = "user.name={$name}";
            $gitArgs[] = '-c';
            $gitArgs[] = "user.email={$userEmail}";
        }
        $cmd = array_merge($gitArgs, $args);
        $process = new Process($cmd);
        $process->setTimeout(60);
        $process->run();

        if (!$process->isSuccessful()) {
            $err = trim($process->getErrorOutput()) ?: trim($process->getOutput());
            throw new \RuntimeException($err ?: 'Git command failed.');
        }
        return $process->getOutput();
    }

    public function index()
    {
        $base = $this->getReposDir();
        $dirs = File::directories($base);
        $repos = [];

        $user = auth()->user();
        $isSuper = $user?->isSuperAdmin() ?? false;
        $userEmail = $user?->email;

        foreach ($dirs as $dir) {
            $name = basename($dir);
            $repoOwner = $this->getRepoOwner($dir);

            // STRICT PRIVACY & ISOLATION:
            // Non-superadmin users CANNOT see repositories belonging to Super Admin or other users!
            if (!$isSuper && $repoOwner !== $userEmail) {
                continue;
            }

            $isGit = is_dir($dir . '/.git');
            $branch = 'main';
            $commitCount = 0;
            $lastCommit = null;

            if ($isGit) {
                try {
                    $branchOut = trim($this->runGit($dir, ['branch', '--show-current']));
                    if ($branchOut) $branch = $branchOut;
                } catch (\Throwable $e) {}

                try {
                    $cnt = trim($this->runGit($dir, ['rev-list', '--count', 'HEAD']));
                    $commitCount = (int)$cnt;
                } catch (\Throwable $e) {}

                try {
                    $log = trim($this->runGit($dir, ['log', '-1', '--format=%h|%an|%ar|%s|%aI']));
                    if ($log) {
                        $parts = explode('|', $log, 5);
                        $lastCommit = [
                            'hash' => $parts[0] ?? '',
                            'author' => $parts[1] ?? '',
                            'time_ago' => $parts[2] ?? '',
                            'message' => $parts[3] ?? '',
                            'date' => $parts[4] ?? '',
                        ];
                    }
                } catch (\Throwable $e) {}
            }

            // Description from README or .git/description
            $desc = '';
            if (file_exists($dir . '/README.md')) {
                $lines = file($dir . '/README.md', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                foreach ($lines as $line) {
                    $line = trim($line);
                    if ($line && !str_starts_with($line, '#')) {
                        $desc = $line;
                        break;
                    }
                }
            }
            if (!$desc && file_exists($dir . '/.git/description')) {
                $d = trim(file_get_contents($dir . '/.git/description'));
                if (!str_contains($d, 'Unnamed repository')) {
                    $desc = $d;
                }
            }

            $linkedProject = DB::table('projects as p')
                ->join('project_databases as d', 'd.project_id', '=', 'p.id')
                ->where('p.repository', $name)
                ->where('p.status', '!=', 'archived')
                ->select('p.id', 'p.name', 'p.slug', 'd.db_name')
                ->first();

            $repos[] = [
                'name' => $name,
                'description' => $desc ?: 'PostgreSQL scripts & configuration repository',
                'branch' => $branch,
                'commits_count' => $commitCount,
                'last_commit' => $lastCommit,
                'owner' => $repoOwner,
                'is_owner' => ($repoOwner === $userEmail),
                'can_edit' => ($isSuper || ($repoOwner === $userEmail && $user?->role !== 'user')),
                'linked_project' => $linkedProject ? [
                    'id' => $linkedProject->id,
                    'name' => $linkedProject->name,
                    'slug' => $linkedProject->slug,
                    'db_name' => $linkedProject->db_name,
                ] : null,
                'updated_at' => date('Y-m-d H:i:s', filemtime($dir)),
            ];
        }

        return response()->json($repos);
    }

    public function store(Request $r)
    {
        $user = $r->user();
        if ($user && $user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak diizinkan membuat repositori baru. Fitur ini hanya untuk Admin Terbatas dan Super Admin.'], 403);
        }

        $d = $r->validate([
            'name' => ['required', 'string', 'max:60', 'regex:/^[a-zA-Z0-9_\-\.]+$/'],
            'description' => 'nullable|string|max:500',
            'init_readme' => 'nullable|boolean',
        ]);

        $base = $this->getReposDir();
        $repoPath = $base . '/' . $d['name'];
        if (is_dir($repoPath)) {
            return response()->json(['message' => "Repository '{$d['name']}' already exists."], 422);
        }

        File::makeDirectory($repoPath, 0775, true, true);

        $userEmail = $user?->email ?? 'admin@localhost';
        try {
            $this->runGit($repoPath, ['init', '-b', 'main'], $userEmail);

            $desc = $d['description'] ?? 'Repository created via Postgres Manager';
            $readmeContent = "# {$d['name']}\n\n{$desc}\n";
            file_put_contents($repoPath . '/README.md', $readmeContent);

            $this->runGit($repoPath, ['add', 'README.md'], $userEmail);
            $this->runGit($repoPath, ['commit', '-m', 'Initial commit'], $userEmail);

            // Record repository owner
            $this->setRepoOwner($repoPath, $userEmail);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Failed to initialize git repository: ' . $e->getMessage()], 500);
        }

        Audit::log('repository.create', $d['name'], 'ok', ['owner' => $userEmail]);
        return response()->json([
            'name' => $d['name'],
            'description' => $d['description'] ?? '',
            'branch' => 'main',
            'owner' => $userEmail,
            'is_owner' => true,
            'can_edit' => true,
            'message' => 'Repository created successfully.',
        ], 201);
    }

    public function tree(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo);
        $subpath = trim((string)$r->query('path', ''), '/');
        $targetDir = $this->safePath($repoPath, $subpath);

        if (!is_dir($targetDir)) {
            abort(404, 'Directory not found.');
        }

        // Get branch and HEAD info
        $branch = 'main';
        try {
            $b = trim($this->runGit($repoPath, ['branch', '--show-current']));
            if ($b) $branch = $b;
        } catch (\Throwable $e) {}

        $lastRepoCommit = null;
        try {
            $log = trim($this->runGit($repoPath, ['log', '-1', '--format=%h|%an|%ar|%s|%aI']));
            if ($log) {
                $p = explode('|', $log, 5);
                $lastRepoCommit = [
                    'hash' => $p[0] ?? '',
                    'author' => $p[1] ?? '',
                    'time_ago' => $p[2] ?? '',
                    'message' => $p[3] ?? '',
                    'date' => $p[4] ?? '',
                ];
            }
        } catch (\Throwable $e) {}

        // Read entries
        $items = scandir($targetDir);
        $folders = [];
        $files = [];
        $readmeContent = null;

        foreach ($items as $item) {
            if ($item === '.' || $item === '..' || $item === '.git' || $item === '.pgm_owner') continue;

            $full = $targetDir . '/' . $item;
            $rel = ltrim(($subpath ? ($subpath . '/' . $item) : $item), '/');
            $isDir = is_dir($full);

            // Last commit for this item
            $commitInfo = null;
            try {
                $itemLog = trim($this->runGit($repoPath, ['log', '-1', '--format=%h|%an|%ar|%s', '--', $rel]));
                if ($itemLog) {
                    $parts = explode('|', $itemLog, 4);
                    $commitInfo = [
                        'hash' => $parts[0] ?? '',
                        'author' => $parts[1] ?? '',
                        'time_ago' => $parts[2] ?? '',
                        'message' => $parts[3] ?? '',
                    ];
                }
            } catch (\Throwable $e) {}

            $entry = [
                'name' => $item,
                'path' => $rel,
                'type' => $isDir ? 'dir' : 'file',
                'size' => $isDir ? null : filesize($full),
                'commit' => $commitInfo,
                'modified_at' => date('Y-m-d H:i:s', filemtime($full)),
            ];

            if ($isDir) {
                $folders[] = $entry;
            } else {
                $files[] = $entry;
                if (strtolower($item) === 'readme.md') {
                    $readmeContent = @file_get_contents($full);
                }
            }
        }

        // Sort alphabetically
        usort($folders, fn($a, $b) => strcasecmp($a['name'], $b['name']));
        usort($files, fn($a, $b) => strcasecmp($a['name'], $b['name']));

        $parentPath = null;
        if ($subpath !== '') {
            $parts = explode('/', $subpath);
            array_pop($parts);
            $parentPath = implode('/', $parts);
        }

        return response()->json([
            'repo' => $repo,
            'branch' => $branch,
            'path' => $subpath,
            'parent_path' => $parentPath,
            'last_commit' => $lastRepoCommit,
            'entries' => array_merge($folders, $files),
            'readme' => $readmeContent,
        ]);
    }

    public function blob(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo);
        $subpath = trim((string)$r->query('path', ''), '/');
        if (empty($subpath)) {
            abort(400, 'File path is required.');
        }

        $fullPath = $this->safePath($repoPath, $subpath);
        if (!is_file($fullPath)) {
            abort(404, 'File not found.');
        }

        $size = filesize($fullPath);
        $mime = mime_content_type($fullPath) ?: 'text/plain';
        $isBinary = false;

        // Check binary if mime is binary or contains null bytes
        if (str_starts_with($mime, 'image/') || str_starts_with($mime, 'video/') || str_starts_with($mime, 'audio/') || str_contains($mime, 'octet-stream') || str_contains($mime, 'pdf') || str_contains($mime, 'zip')) {
            $isBinary = true;
        } else {
            $head = @file_get_contents($fullPath, false, null, 0, 8192);
            if ($head !== false && str_contains($head, "\0")) {
                $isBinary = true;
            }
        }

        $content = null;
        $lines = 0;
        if (!$isBinary) {
            // Read up to 4MB for editor/viewer
            if ($size <= 4 * 1024 * 1024) {
                $content = @file_get_contents($fullPath) ?: '';
                $lines = substr_count($content, "\n") + (strlen($content) > 0 ? 1 : 0);
            }
        }

        $commitInfo = null;
        try {
            $itemLog = trim($this->runGit($repoPath, ['log', '-1', '--format=%h|%an|%ar|%s|%aI', '--', $subpath]));
            if ($itemLog) {
                $parts = explode('|', $itemLog, 5);
                $commitInfo = [
                    'hash' => $parts[0] ?? '',
                    'author' => $parts[1] ?? '',
                    'time_ago' => $parts[2] ?? '',
                    'message' => $parts[3] ?? '',
                    'date' => $parts[4] ?? '',
                ];
            }
        } catch (\Throwable $e) {}

        return response()->json([
            'repo' => $repo,
            'name' => basename($fullPath),
            'path' => $subpath,
            'size' => $size,
            'lines' => $lines,
            'mime' => $mime,
            'is_binary' => $isBinary,
            'content' => $content,
            'commit' => $commitInfo,
        ]);
    }

    public function raw(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo);
        $subpath = trim((string)$r->query('path', ''), '/');
        $fullPath = $this->safePath($repoPath, $subpath);

        if (!is_file($fullPath)) {
            abort(404, 'File not found.');
        }

        $filename = basename($fullPath);
        $mime = mime_content_type($fullPath) ?: 'application/octet-stream';
        $download = $r->boolean('download', false);

        $headers = [
            'Content-Type' => $mime,
            'Content-Length' => filesize($fullPath),
        ];
        if ($download) {
            $headers['Content-Disposition'] = 'attachment; filename="' . $filename . '"';
        } else {
            $headers['Content-Disposition'] = 'inline; filename="' . $filename . '"';
        }

        return response()->file($fullPath, $headers);
    }

    public function zip(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo);
        $branch = $r->query('branch', 'HEAD');

        $tmpZip = tempnam(sys_get_temp_dir(), 'repo_zip_');
        try {
            $this->runGit($repoPath, ['archive', '--format=zip', "--prefix={$repo}/", $branch, '-o', $tmpZip]);
        } catch (\Throwable $e) {
            @unlink($tmpZip);
            return response()->json(['message' => 'Failed to create zip: ' . $e->getMessage()], 500);
        }

        return response()->download($tmpZip, "{$repo}.zip")->deleteFileAfterSend(true);
    }

    public function upload(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo, true);
        $subpath = trim((string)$r->input('path', ''), '/');
        $targetDir = $this->safePath($repoPath, $subpath);

        if (!is_dir($targetDir)) {
            File::makeDirectory($targetDir, 0775, true, true);
        }

        $files = $r->file('files');
        if (!$files) {
            $single = $r->file('file');
            if ($single) {
                $files = [$single];
            }
        }

        if (empty($files) || !is_array($files)) {
            return response()->json(['message' => 'No files uploaded.'], 422);
        }

        // Support folder upload with preserved relative paths
        $relativePaths = $r->input('relative_paths');
        if (is_string($relativePaths)) {
            $relativePaths = json_decode($relativePaths, true) ?: [];
        }
        if (!is_array($relativePaths)) {
            $relativePaths = [];
        }

        $commitMsg = trim((string)$r->input('commit_message', ''));
        if (empty($commitMsg)) {
            $count = count($files);
            $commitMsg = $count === 1 ? 'Add file via upload' : "Add {$count} files via upload";
        }

        $userEmail = $r->user()?->email ?? 'admin@localhost';
        $savedFiles = [];

        foreach ($files as $idx => $file) {
            if (!$file->isValid()) continue;

            $relGiven = $relativePaths[$idx] ?? $file->getClientOriginalName();
            $relGiven = trim(str_replace('\\', '/', $relGiven), '/');

            // Sanitize parts to prevent directory traversal
            $parts = array_values(array_filter(explode('/', $relGiven), function ($p) {
                return $p !== '' && $p !== '.' && $p !== '..' && $p !== '.git';
            }));

            if (empty($parts)) continue;

            $safeRelPath = implode('/', $parts);
            $fullRel = ltrim(($subpath ? ($subpath . '/' . $safeRelPath) : $safeRelPath), '/');
            $destFile = $repoPath . '/' . $fullRel;
            $destDir = dirname($destFile);

            if (!is_dir($destDir)) {
                File::makeDirectory($destDir, 0775, true, true);
            }

            $file->move($destDir, basename($destFile));
            $savedFiles[] = $fullRel;

            try {
                $this->runGit($repoPath, ['add', $fullRel], $userEmail);
            } catch (\Throwable $e) {}
        }

        if (empty($savedFiles)) {
            return response()->json(['message' => 'No valid files were saved.'], 422);
        }

        try {
            $this->runGit($repoPath, ['commit', '-m', $commitMsg], $userEmail);
        } catch (\Throwable $e) {
            // Commit might fail if nothing changed
        }

        Audit::log('repository.upload', "{$repo}: " . implode(', ', array_slice($savedFiles, 0, 10)) . (count($savedFiles) > 10 ? '...' : ''));
        $this->triggerAutoDeploy($repo);
        return response()->json([
            'message' => 'Files and folders uploaded and committed successfully.',
            'files' => $savedFiles,
        ]);
    }

    public function saveFile(Request $r, string $repo)
    {
        $d = $r->validate([
            'path' => 'required|string',
            'content' => 'present|string',
            'commit_message' => 'nullable|string|max:255',
        ]);

        $repoPath = $this->resolveRepoPath($repo, true);
        $subpath = trim($d['path'], '/');
        $fullPath = $this->safePath($repoPath, $subpath);

        $dir = dirname($fullPath);
        if (!is_dir($dir)) {
            File::makeDirectory($dir, 0775, true, true);
        }

        $isNew = !file_exists($fullPath);
        file_put_contents($fullPath, $d['content']);

        $filename = basename($fullPath);
        $commitMsg = trim((string)($d['commit_message'] ?? ''));
        if (empty($commitMsg)) {
            $commitMsg = $isNew ? "Create {$filename}" : "Update {$filename}";
        }

        $userEmail = $r->user()?->email ?? 'admin@localhost';
        try {
            $this->runGit($repoPath, ['add', $subpath], $userEmail);
            $this->runGit($repoPath, ['commit', '-m', $commitMsg], $userEmail);
        } catch (\Throwable $e) {
            // If commit has nothing changed, it's ok
        }

        Audit::log($isNew ? 'repository.file_create' : 'repository.file_edit', "{$repo}/{$subpath}");
        $this->triggerAutoDeploy($repo);
        return response()->json([
            'message' => 'File saved and committed successfully.',
            'path' => $subpath,
        ]);
    }

    public function deleteFile(Request $r, string $repo)
    {
        $d = $r->validate([
            'path' => 'required|string',
            'commit_message' => 'nullable|string|max:255',
        ]);

        $repoPath = $this->resolveRepoPath($repo, true);
        $subpath = trim($d['path'], '/');
        $fullPath = $this->safePath($repoPath, $subpath);

        if (!file_exists($fullPath)) {
            abort(404, 'File not found.');
        }

        $filename = basename($fullPath);
        $commitMsg = trim((string)($d['commit_message'] ?? ''));
        if (empty($commitMsg)) {
            $commitMsg = "Delete {$filename}";
        }

        $userEmail = $r->user()?->email ?? 'admin@localhost';
        try {
            $this->runGit($repoPath, ['rm', '-f', $subpath], $userEmail);
            $this->runGit($repoPath, ['commit', '-m', $commitMsg], $userEmail);
        } catch (\Throwable $e) {
            @unlink($fullPath);
        }

        Audit::log('repository.file_delete', "{$repo}/{$subpath}");
        $this->triggerAutoDeploy($repo);
        return response()->json(['message' => "File {$filename} deleted."]);
    }

    public function commits(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo);
        $subpath = trim((string)$r->query('path', ''), '/');

        $args = ['log', '-n', '50', '--format=%H|%h|%an|%ae|%ar|%s|%aI'];
        if ($subpath) {
            $this->safePath($repoPath, $subpath);
            $args[] = '--';
            $args[] = $subpath;
        }

        $commits = [];
        try {
            $out = trim($this->runGit($repoPath, $args));
            if ($out) {
                $lines = explode("\n", $out);
                foreach ($lines as $line) {
                    $p = explode('|', trim($line), 7);
                    if (count($p) >= 6) {
                        $commits[] = [
                            'hash' => $p[0],
                            'short_hash' => $p[1],
                            'author' => $p[2],
                            'email' => $p[3],
                            'time_ago' => $p[4],
                            'message' => $p[5],
                            'date' => $p[6] ?? '',
                        ];
                    }
                }
            }
        } catch (\Throwable $e) {}

        return response()->json($commits);
    }

    public function sqlScripts(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo);
        $scripts = [];

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($repoPath, \FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if ($file->isFile() && in_array(strtolower($file->getExtension()), ['sql', 'pgsql'])) {
                $sub = ltrim(substr($file->getPathname(), strlen($repoPath)), '/');
                if (str_starts_with($sub, '.git')) continue;

                $scripts[] = [
                    'name' => $file->getFilename(),
                    'path' => $sub,
                    'size' => $file->getSize(),
                ];
            }
        }

        usort($scripts, fn($a, $b) => strcasecmp($a['path'], $b['path']));
        return response()->json($scripts);
    }

    /**
     * Deteksi otomatis skema database yang diminta program di dalam repository.
     * Contoh: file .sql, atau SQL inline di main.py (gaya Smartroom).
     */
    public function schemaPreview(Request $r, string $repo)
    {
        $this->resolveRepoPath($repo);

        try {
            $preview = (new RepoSchemaInspector())->preview($repo);
            return response()->json($preview);
        } catch (\Throwable $e) {
            return response()->json([
                'repo' => $repo,
                'sources' => [],
                'tables' => [],
                'has_schema' => false,
                'message' => 'Gagal memindai skema repository: ' . $e->getMessage(),
            ]);
        }
    }

    protected function triggerAutoDeploy(string $repo): void
    {
        try {
            $projects = \Illuminate\Support\Facades\DB::table('projects')
                ->where('repository', $repo)
                ->where('auto_deploy', true)
                ->get();
            foreach ($projects as $p) {
                app(\App\Services\DeploymentService::class)->deploy($p->id);
            }
        } catch (\Throwable $e) {}
    }

    /**
     * Inisiasi dan buat database baru otomatis khusus untuk repository ini.
     */
    public function initDatabase(Request $r, string $repo, ProvisioningService $svc)
    {
        $repoPath = $this->resolveRepoPath($repo, true);
        $user = $r->user();
        if ($user && $user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak diizinkan membuat database.'], 403);
        }

        // Check if repo already has an active project
        $existing = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->where('projects.repository', $repo)
            ->where('projects.status', 'active')
            ->select('projects.id', 'projects.name', 'projects.slug', 'd.db_name')
            ->first();

        if ($existing) {
            return response()->json([
                'message' => "Repository '{$repo}' sudah terhubung ke proyek database '{$existing->name}' ({$existing->db_name}).",
                'project' => $existing,
            ], 409);
        }

        $defaultSlug = Str::slug($repo) ?: 'repo';
        if (strlen($defaultSlug) < 3) $defaultSlug .= '-db';
        $defaultDbName = preg_replace('/[^a-z0-9_]/', '_', strtolower($repo)) . '_db';
        $defaultDbName = ltrim($defaultDbName, '0123456789_') ?: 'db_' . $defaultSlug;
        $defaultDbName = substr($defaultDbName, 0, 30);
        $defaultDbUser = substr(preg_replace('/[^a-z0-9_]/', '_', strtolower($repo)) . '_user', 0, 30);
        $defaultDbUser = ltrim($defaultDbUser, '0123456789_') ?: 'u_' . $defaultSlug;

        $d = $r->validate([
            'name' => 'nullable|string|max:100',
            'slug' => 'nullable|string|regex:/^[a-z][a-z0-9-]{2,40}$/|unique:projects,slug',
            'db_name' => 'nullable|string|regex:/^[a-z][a-z0-9_]{2,40}$/',
            'db_user' => 'nullable|string|regex:/^[a-z][a-z0-9_]{2,40}$/',
            'description' => 'nullable|string|max:500',
            'template_id' => 'nullable|integer|exists:database_templates,id',
            'init_sql_path' => 'nullable|string|max:255',
            'auto_schema' => 'nullable|boolean',
        ]);

        $name = !empty($d['name']) ? trim($d['name']) : ($repo . ' Database');
        $slug = !empty($d['slug']) ? trim($d['slug']) : ($defaultSlug . '-' . substr(bin2hex(random_bytes(3)), 0, 4));
        $dbName = !empty($d['db_name']) ? trim($d['db_name']) : ($defaultDbName . '_' . substr(bin2hex(random_bytes(2)), 0, 4));
        $dbUser = !empty($d['db_user']) ? trim($d['db_user']) : ($defaultDbUser . '_' . substr(bin2hex(random_bytes(2)), 0, 4));
        $templateId = !empty($d['template_id']) ? (int)$d['template_id'] : 1;

        // Default: bila tidak memilih file SQL tertentu, deteksi & terapkan skema repo otomatis.
        $autoSchema = array_key_exists('auto_schema', $d)
            ? (bool)$d['auto_schema']
            : empty($d['init_sql_path']);

        $provisionData = [
            'name' => $name,
            'slug' => $slug,
            'description' => $d['description'] ?? "Database otomatis terhubung untuk repositori {$repo}",
            'db_name' => $dbName,
            'db_user' => $dbUser,
            'encoding' => 'UTF8',
            'locale' => 'C.UTF-8',
            'template_id' => $templateId,
            'backup_policy' => 'none',
            'repository' => $repo,
            'init_sql_path' => $d['init_sql_path'] ?? null,
            'auto_schema' => $autoSchema,
        ];

        try {
            $result = $svc->create($provisionData);
            Audit::log('repository.init_db', "{$repo} -> {$dbName}", 'ok', ['project_slug' => $slug]);
            $result['repository'] = $repo;
            $result['env_synced'] = true;
            return response()->json($result, 201);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    /**
     * Terapkan skema yang terdeteksi dari repository ke database proyek yang sudah terhubung.
     * Berguna saat repo dihubungkan ke database lama, atau saat program menambah tabel baru.
     */
    public function applySchema(Request $r, string $repo, ProvisioningService $svc)
    {
        $this->resolveRepoPath($repo, true);
        $user = $r->user();
        if ($user && $user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak diizinkan mengubah skema database.'], 403);
        }

        $project = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->join('database_connections as c', 'c.project_id', '=', 'projects.id')
            ->where('projects.repository', $repo)
            ->where('projects.status', 'active')
            ->select(
                'projects.id',
                'projects.name',
                'projects.slug',
                'projects.created_by',
                'd.db_name',
                'd.db_user',
                'c.password_encrypted'
            )
            ->first();

        if (!$project) {
            return response()->json([
                'message' => "Repository '{$repo}' belum terhubung ke database manapun. Buat atau hubungkan database terlebih dahulu.",
            ], 422);
        }

        if (!$user->isSuperAdmin() && $project->created_by != $user->id) {
            abort(403, 'Akses ditolak: Anda hanya dapat mengubah skema database milik Anda.');
        }

        $discovery = (new RepoSchemaInspector())->discover($repo);
        if (!$discovery['has_schema']) {
            return response()->json([
                'message' => "Tidak ada skema database yang terdeteksi di repository '{$repo}'.",
                'sources' => [],
                'tables' => [],
            ], 422);
        }

        $report = [
            'project' => ['id' => $project->id, 'name' => $project->name, 'db_name' => $project->db_name],
            'applied' => [],
            'tables' => [],
            'warnings' => [],
            'sources' => array_map(
                fn(array $s) => ['path' => $s['path'], 'kind' => $s['kind'], 'tables' => $s['tables']],
                $discovery['sources']
            ),
        ];

        try {
            $password = Crypt::decryptString($project->password_encrypted);
            $pdo = $svc->admin($project->db_name, $project->db_user, $password);

            foreach ($discovery['sources'] as $src) {
                // Pengaman: jangan jalankan perintah destruktif pada database yang sudah berisi data.
                $destructive = (bool) preg_match(
                    '/\b(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE\s+(TABLE\s+)?\w+|DELETE\s+FROM|ALTER\s+TABLE[\s\S]{0,200}?DROP\s+(COLUMN|CONSTRAINT))\b/i',
                    $src['sql']
                );
                if ($destructive) {
                    $report['warnings'][] = "{$src['path']}: dilewati karena mengandung perintah destruktif (DROP/TRUNCATE/DELETE). Jalankan manual bila memang disengaja.";
                    continue;
                }

                try {
                    $pdo->exec($src['sql']);
                    $report['applied'][] = $src['path'];
                    foreach ($src['tables'] as $tbl) {
                        if (!in_array($tbl, $report['tables'], true)) {
                            $report['tables'][] = $tbl;
                        }
                    }
                } catch (\Throwable $se) {
                    $report['warnings'][] = "{$src['path']}: " . $se->getMessage();
                }
            }
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Gagal menerapkan skema: ' . $e->getMessage()], 422);
        }

        Audit::log('repository.apply_schema', "{$repo} -> {$project->db_name}", 'ok', [
            'project_id' => $project->id,
            'applied' => $report['applied'],
            'tables' => $report['tables'],
            'warnings' => $report['warnings'],
        ]);

        $message = !empty($report['applied'])
            ? "Skema repository '{$repo}' berhasil diterapkan ke database '{$project->db_name}'."
            : "Tidak ada skema yang berhasil diterapkan. Periksa peringatan di bawah.";

        return response()->json(['message' => $message] + $report);
    }

    /**
     * Hubungkan repository ke database yang sudah ada.
     */
    public function linkDatabase(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo, true);
        $user = $r->user();
        if ($user && $user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak diizinkan mengubah hubungan database.'], 403);
        }

        $d = $r->validate([
            'project_id' => 'required|integer|exists:projects,id',
        ]);

        $project = DB::table('projects')->where('id', $d['project_id'])->first();
        if (!$project) abort(404, 'Proyek database tidak ditemukan.');

        if (!$user->isSuperAdmin() && $project->created_by != $user->id) {
            abort(403, 'Akses ditolak: Anda hanya dapat menghubungkan proyek database milik Anda.');
        }

        // Link project to this repo
        DB::table('projects')->where('id', $project->id)->update([
            'repository' => $repo,
            'updated_at' => now(),
        ]);

        // Auto-Sync .env ke folder repository
        $syncedFiles = [];
        $conn = DB::table('database_connections')->where('project_id', $project->id)->first();
        if ($conn) {
            try {
                $dbPassword = Crypt::decryptString($conn->password_encrypted);
                $syncedFiles = app(RepoEnvSyncService::class)->sync($repo, [
                    'host' => $conn->host,
                    'port' => $conn->port,
                    'db_name' => $conn->db_name,
                    'db_user' => $conn->username,
                    'password' => $dbPassword,
                ]);
            } catch (\Throwable $e) {}
        }

        Audit::log('repository.link_db', "{$repo} <-> {$project->name}", 'ok', [
            'project_id' => $project->id,
            'synced_files' => $syncedFiles,
        ]);

        return response()->json([
            'message' => "Repository '{$repo}' berhasil dihubungkan ke proyek database '{$project->name}'." . (!empty($syncedFiles) ? ' File .env di repository otomatis disinkronkan.' : ''),
            'project_id' => $project->id,
            'repository' => $repo,
            'env_synced' => !empty($syncedFiles),
            'synced_files' => $syncedFiles,
        ]);
    }

    /**
     * Putus hubungan repository dari proyek database.
     */
    public function unlinkDatabase(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo, true);
        $user = $r->user();
        if ($user && $user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak diizinkan mengubah hubungan database.'], 403);
        }

        DB::table('projects')->where('repository', $repo)->update([
            'repository' => null,
            'updated_at' => now(),
        ]);

        Audit::log('repository.unlink_db', $repo, 'ok');

        return response()->json([
            'message' => "Hubungan database pada repository '{$repo}' berhasil diputus.",
        ]);
    }

    /**
     * Manual / trigger sinkronisasi file .env di repository sesuai konfigurasi database terhubung.
     */
    public function syncEnv(Request $r, string $repo)
    {
        $repoPath = $this->resolveRepoPath($repo, true);
        $user = $r->user();
        if ($user && $user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak diizinkan mengubah file repository.'], 403);
        }

        $project = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->join('database_connections as c', 'c.project_id', '=', 'projects.id')
            ->where('projects.repository', $repo)
            ->where('projects.status', 'active')
            ->select('projects.id', 'projects.name', 'd.db_name', 'd.db_user', 'c.host', 'c.port', 'c.password_encrypted')
            ->first();

        if (!$project) {
            return response()->json([
                'message' => "Repository '{$repo}' belum terhubung ke database manapun. Hubungkan atau buat database terlebih dahulu.",
            ], 422);
        }

        $dbPassword = Crypt::decryptString($project->password_encrypted);
        $syncedFiles = app(RepoEnvSyncService::class)->sync($repo, [
            'host' => $project->host,
            'port' => $project->port,
            'db_name' => $project->db_name,
            'db_user' => $project->db_user,
            'password' => $dbPassword,
        ]);

        Audit::log('repository.sync_env', "{$repo} (.env synced from {$project->db_name})");

        return response()->json([
            'message' => "File .env di repository '{$repo}' berhasil disinkronkan dengan database '{$project->db_name}'.",
            'synced_files' => $syncedFiles,
            'project' => [
                'id' => $project->id,
                'name' => $project->name,
                'db_name' => $project->db_name,
            ],
        ]);
    }
}
