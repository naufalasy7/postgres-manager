<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
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

    protected function resolveRepoPath(string $repo): string
    {
        if (!preg_match('/^[a-zA-Z0-9_\-\.]+$/', $repo)) {
            abort(400, 'Invalid repository name format.');
        }
        $base = $this->getReposDir();
        $repoPath = $base . '/' . $repo;
        if (!is_dir($repoPath)) {
            abort(404, "Repository '{$repo}' not found.");
        }
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

        foreach ($dirs as $dir) {
            $name = basename($dir);
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

            $repos[] = [
                'name' => $name,
                'description' => $desc ?: 'PostgreSQL scripts & configuration repository',
                'branch' => $branch,
                'commits_count' => $commitCount,
                'last_commit' => $lastCommit,
                'updated_at' => date('Y-m-d H:i:s', filemtime($dir)),
            ];
        }

        return response()->json($repos);
    }

    public function store(Request $r)
    {
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

        $userEmail = $r->user()?->email ?? 'admin@localhost';
        try {
            $this->runGit($repoPath, ['init', '-b', 'main'], $userEmail);

            $desc = $d['description'] ?? 'Repository created via Postgres Manager';
            $readmeContent = "# {$d['name']}\n\n{$desc}\n";
            file_put_contents($repoPath . '/README.md', $readmeContent);

            $this->runGit($repoPath, ['add', 'README.md'], $userEmail);
            $this->runGit($repoPath, ['commit', '-m', 'Initial commit'], $userEmail);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Failed to initialize git repository: ' . $e->getMessage()], 500);
        }

        Audit::log('repository.create', $d['name']);
        return response()->json([
            'name' => $d['name'],
            'description' => $d['description'] ?? '',
            'branch' => 'main',
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
            if ($item === '.' || $item === '..' || $item === '.git') continue;

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
        $repoPath = $this->resolveRepoPath($repo);
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

        $repoPath = $this->resolveRepoPath($repo);
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

        $repoPath = $this->resolveRepoPath($repo);
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
}
