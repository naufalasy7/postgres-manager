<?php

namespace App\Services;

/**
 * Mendeteksi skema database yang dibutuhkan sebuah repository secara otomatis.
 *
 * Sumber yang didukung:
 *  - File .sql / .pgsql (schema.sql, init.sql, migrations/*.sql, dump, dsb.)
 *  - SQL inline di dalam kode Python (contoh: SCHEMA = """...""" pada Smartroom)
 *  - SQL inline di dalam template literal JavaScript/TypeScript
 *  - SQL inline di dalam heredoc PHP
 *
 * Tujuannya agar saat database dibuat dari sebuah repo, tabel yang diminta
 * program langsung ada tanpa perlu memilih file SQL secara manual.
 */
class RepoSchemaInspector
{
    /** Folder yang tidak perlu dipindai. */
    protected array $skipDirs = [
        '.git', '.svn', '.hg', 'node_modules', 'vendor', '.venv', 'venv',
        '__pycache__', 'dist', 'build', '.next', '.nuxt', 'coverage',
        'backups', 'exports', 'storage', '.idea', '.vscode',
    ];

    /** Batas ukuran file yang dipindai (1 MB). */
    protected int $maxFileSize = 1048576;

    /** Batas panjang satu blok SQL inline (256 KB). */
    protected int $maxInlineSqlLength = 262144;

    /**
     * Deteksi seluruh sumber skema dan gabungkan SQL-nya.
     *
     * @return array{
     *   repo: string,
     *   sources: array<int, array{path:string,kind:string,tables:array<int,string>,size:int,priority:int,sql:string}>,
     *   tables: array<int,string>,
     *   has_schema: bool,
     *   sql: string
     * }
     */
    public function discover(string $repo): array
    {
        $repo = trim($repo, '/');
        $repoPath = $this->repoPath($repo);

        $result = [
            'repo' => $repo,
            'sources' => [],
            'tables' => [],
            'has_schema' => false,
            'sql' => '',
        ];

        if ($repo === '' || !is_dir($repoPath)) {
            return $result;
        }

        $files = $this->scanFiles($repoPath);

        // 1. File SQL (prioritas utama).
        foreach ($files as $rel => $abs) {
            $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
            if (!in_array($ext, ['sql', 'pgsql'], true)) {
                continue;
            }

            $sql = @file_get_contents($abs);
            if ($sql === false || trim($sql) === '') {
                continue;
            }

            $tables = $this->extractTables($sql);
            $hasDdl = $this->hasDdl($sql);
            $hasData = (bool) preg_match('/\b(INSERT\s+INTO|COPY\s+\S+\s+FROM\s+STDIN|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i', $sql);

            // Lewati file query murni (mis. monitoring.sql berisi SELECT) agar tidak ikut dieksekusi.
            if (!$hasDdl && !$hasData) {
                continue;
            }

            $result['sources'][] = [
                'path' => $rel,
                'kind' => 'sql',
                'tables' => $tables,
                'size' => strlen($sql),
                'priority' => $hasDdl ? $this->sqlPriority($rel) : 90,
                'sql' => $sql,
            ];
        }

        // 2. Skema inline di dalam kode program (gaya Smartroom).
        foreach ($files as $rel => $abs) {
            $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
            if (!in_array($ext, ['py', 'js', 'ts', 'mjs', 'cjs', 'php'], true)) {
                continue;
            }

            $content = @file_get_contents($abs);
            if ($content === false || stripos($content, 'CREATE TABLE') === false) {
                continue;
            }

            $blocks = $this->extractInlineSqlBlocks($content, $ext);
            foreach ($blocks as $i => $block) {
                $tables = $this->extractTables($block);
                if (empty($tables)) {
                    continue;
                }

                $result['sources'][] = [
                    'path' => $rel . ($i > 0 ? '#' . ($i + 1) : ''),
                    'kind' => $ext === 'py' ? 'python-inline' : ($ext === 'php' ? 'php-inline' : 'js-inline'),
                    'tables' => $tables,
                    'size' => strlen($block),
                    'priority' => 40 + $i,
                    'sql' => $block,
                ];
            }
        }

        // Urutkan: schema/init -> migrations -> SQL lain -> inline -> seed/data.
        usort($result['sources'], function (array $a, array $b): int {
            return [$a['priority'], $a['path']] <=> [$b['priority'], $b['path']];
        });

        // Gabungkan daftar tabel tanpa duplikat.
        $tables = [];
        $chunks = [];
        foreach ($result['sources'] as $src) {
            foreach ($src['tables'] as $table) {
                if (!in_array($table, $tables, true)) {
                    $tables[] = $table;
                }
            }
            $chunks[] = "-- ===== Source: {$src['path']} =====\n" . trim($src['sql']);
        }

        $result['tables'] = $tables;
        $result['has_schema'] = count($result['sources']) > 0;
        $result['sql'] = implode("\n\n", $chunks);

        return $result;
    }

    /**
     * Versi ringan untuk UI: tanpa isi SQL penuh.
     */
    public function preview(string $repo): array
    {
        $discovery = $this->discover($repo);

        $sources = [];
        foreach ($discovery['sources'] as $src) {
            $sources[] = [
                'path' => $src['path'],
                'kind' => $src['kind'],
                'tables' => $src['tables'],
                'size' => $src['size'],
                'priority' => $src['priority'],
                'preview' => mb_substr(trim($src['sql']), 0, 700),
            ];
        }

        return [
            'repo' => $discovery['repo'],
            'sources' => $sources,
            'tables' => $discovery['tables'],
            'has_schema' => $discovery['has_schema'],
            'sql_length' => strlen($discovery['sql']),
        ];
    }

    protected function repoPath(string $repo): string
    {
        $repo = trim($repo, '/');

        // Cegah path traversal: hanya nama folder repository yang aman.
        if ($repo === '' || str_contains($repo, '..') || !preg_match('/^[A-Za-z0-9_.\-]+$/', $repo)) {
            return '';
        }

        $root = rtrim(config('pgmanager.root') ?: base_path('../../'), '/');
        return $root . '/repositories/' . $repo;
    }

    /**
     * @return array<string, string> path relatif => path absolut
     */
    protected function scanFiles(string $base): array
    {
        $files = [];

        try {
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveCallbackFilterIterator(
                    new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS),
                    function (\SplFileInfo $current): bool {
                        if ($current->isDir()) {
                            $name = $current->getFilename();
                            return !in_array($name, $this->skipDirs, true)
                                && !str_starts_with($name, '.');
                        }
                        return true;
                    }
                )
            );

            foreach ($iterator as $file) {
                /** @var \SplFileInfo $file */
                if (!$file->isFile() || !$file->isReadable()) {
                    continue;
                }
                if ($file->getSize() > $this->maxFileSize) {
                    continue;
                }

                $abs = $file->getPathname();
                $rel = ltrim(str_replace('\\', '/', substr($abs, strlen($base))), '/');
                if ($rel === '') {
                    continue;
                }
                $files[$rel] = $abs;
            }
        } catch (\Throwable $e) {
            return [];
        }

        ksort($files);
        return $files;
    }

    /**
     * Ekstrak nama tabel dari statement CREATE TABLE.
     *
     * @return array<int, string>
     */
    public function extractTables(string $sql): array
    {
        $pattern = '/CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[A-Za-z_][A-Za-z0-9_$]*"?\.)?"?([A-Za-z_][A-Za-z0-9_$]*)"?/i';

        if (!preg_match_all($pattern, $sql, $matches)) {
            return [];
        }

        return array_values(array_unique($matches[1]));
    }

    protected function hasDdl(string $sql): bool
    {
        return (bool) preg_match(
            '/\b(CREATE|ALTER|DROP)\s+(TABLE|SCHEMA|EXTENSION|TYPE|INDEX|VIEW|MATERIALIZED|FUNCTION|TRIGGER|SEQUENCE|DOMAIN)\b/i',
            $sql
        );
    }

    protected function sqlPriority(string $rel): int
    {
        $lower = strtolower($rel);
        $base = basename($lower);

        if (in_array($base, ['schema.sql', 'init.sql', 'initdb.sql', 'structure.sql', 'database.sql'], true)) {
            return 5;
        }

        if (preg_match('#(^|/)(migrations?|db/migrations?|database/migrations?)/#', $lower)) {
            return 10;
        }

        if (preg_match('/^\d+[_-]/', $base)) {
            return 15;
        }

        return 30;
    }

    /**
     * Ambil blok SQL yang ditulis inline di dalam kode aplikasi.
     *
     * @return array<int, string>
     */
    protected function extractInlineSqlBlocks(string $content, string $ext): array
    {
        $blocks = [];

        if ($ext === 'py') {
            // String triple-quote: """...""" atau '''...'''
            if (preg_match_all('/(?:[rRbBuUfF]{0,2})("""|\'\'\')(.*?)\1/s', $content, $m)) {
                foreach ($m[2] as $block) {
                    $blocks[] = $block;
                }
            }
        } elseif (in_array($ext, ['js', 'ts', 'mjs', 'cjs'], true)) {
            // Template literal: `...`
            if (preg_match_all('/`([^`]*)`/s', $content, $m)) {
                foreach ($m[1] as $block) {
                    $blocks[] = $block;
                }
            }
        } elseif ($ext === 'php') {
            // Heredoc / Nowdoc: <<<SQL ... SQL;
            $pattern = '/<<<\s*[\'"]?([A-Za-z_][A-Za-z0-9_]*)[\'"]?\R(.*?)\R\s*\1;?/s';
            if (preg_match_all($pattern, $content, $m)) {
                foreach ($m[2] as $block) {
                    $blocks[] = $block;
                }
            }
        }

        $out = [];
        foreach ($blocks as $block) {
            if (stripos($block, 'CREATE TABLE') === false) {
                continue;
            }
            // Interpolasi template JS tidak aman dieksekusi sebagai SQL.
            if (str_contains($block, '${')) {
                continue;
            }
            if (strlen($block) > $this->maxInlineSqlLength) {
                continue;
            }
            $out[] = $block;
        }

        return $out;
    }
}
