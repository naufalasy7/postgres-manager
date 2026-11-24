<?php

namespace App\Services;

class RepoEnvSyncService
{
    /**
     * Sinkronisasi kredensial database PostgreSQL ke file .env di dalam folder repository.
     * Mendukung Prisma, Sequelize, TypeORM, Alembic, FastAPI, Django, Express, dll.
     *
     * @param string $repo Nama/folder repository
     * @param array $dbConfig [
     *    'host' => '...',
     *    'port' => '...',
     *    'db_name' => '...',
     *    'db_user' => '...',
     *    'password' => '...',
     * ]
     * @return array Daftar file yang berhasil disinkronkan
     */
    public function sync(string $repo, array $dbConfig): array
    {
        $root = rtrim(config('pgmanager.root') ?: base_path('../../'), '/');
        $repoPath = $root . '/repositories/' . trim($repo, '/');

        if (!is_dir($repoPath)) {
            return [];
        }

        $host = $dbConfig['host'] ?? config('pgmanager.host', '127.0.0.1');
        $port = (string)($dbConfig['port'] ?? config('pgmanager.port', 5433));
        $dbName = $dbConfig['db_name'] ?? '';
        $dbUser = $dbConfig['db_user'] ?? '';
        $dbPass = $dbConfig['password'] ?? '';

        $encodedUser = rawurlencode($dbUser);
        $encodedPass = rawurlencode($dbPass);

        // Standar connection string universal
        $databaseUrl = "postgresql://{$encodedUser}:{$encodedPass}@{$host}:{$port}/{$dbName}?schema=public&sslmode=disable";
        $postgresUrl = "postgresql://{$encodedUser}:{$encodedPass}@{$host}:{$port}/{$dbName}?sslmode=disable";
        $asyncUrl = "postgresql+asyncpg://{$encodedUser}:{$encodedPass}@{$host}:{$port}/{$dbName}";

        $managedVariables = [
            'DB_CONNECTION' => 'pgsql',
            'DB_HOST' => $host,
            'DB_PORT' => $port,
            'DB_DATABASE' => $dbName,
            'DB_NAME' => $dbName,
            'DB_USERNAME' => $dbUser,
            'DB_USER' => $dbUser,
            'DB_PASSWORD' => $dbPass,
            'DB_PASS' => $dbPass,
            'DATABASE_URL' => '"' . $databaseUrl . '"',
            'POSTGRES_URL' => '"' . $postgresUrl . '"',
            'ASYNC_DATABASE_URL' => '"' . $asyncUrl . '"',
        ];

        $syncedFiles = [];

        // 1. Target utama: .env di root repository
        $rootEnv = $repoPath . '/.env';
        $rootExample = $repoPath . '/.env.example';
        if ($this->writeOrUpdateEnv($rootEnv, $managedVariables, $rootExample, $dbName, $host, $port, $dbUser, $dbPass, $databaseUrl, $postgresUrl, $asyncUrl)) {
            $syncedFiles[] = '.env';
        }

        // 2. Target sekunder: subdirektori aplikasi umum (backend, server, api, app, core)
        $subdirs = ['backend', 'server', 'api', 'app', 'src', 'core'];
        foreach ($subdirs as $sub) {
            $subPath = $repoPath . '/' . $sub;
            if (is_dir($subPath)) {
                $subEnv = $subPath . '/.env';
                $subExample = $subPath . '/.env.example';

                // Sinkronkan jika .env sudah ada, atau jika ada .env.example, atau ada file proyek backend
                $hasBackendProject = file_exists($subPath . '/package.json')
                    || file_exists($subPath . '/requirements.txt')
                    || file_exists($subPath . '/pyproject.toml')
                    || file_exists($subPath . '/alembic.ini')
                    || file_exists($subPath . '/composer.json')
                    || is_dir($subPath . '/prisma');

                if (file_exists($subEnv) || file_exists($subExample) || $hasBackendProject) {
                    if ($this->writeOrUpdateEnv($subEnv, $managedVariables, $subExample, $dbName, $host, $port, $dbUser, $dbPass, $databaseUrl, $postgresUrl, $asyncUrl)) {
                        $syncedFiles[] = $sub . '/.env';
                    }
                }
            }
        }

        // 3. Dukungan kompatibilitas backward (seperti config.env pada smartroom)
        $configEnvFiles = [
            $repoPath . '/smartroom-pi/smartroom-pi/config.env',
            $repoPath . '/smartroom-pi/config.env',
            $repoPath . '/config.env',
        ];
        foreach ($configEnvFiles as $cfgPath) {
            if (file_exists($cfgPath)) {
                if ($this->updateConfigEnv($cfgPath, $host, $port, $dbName, $dbUser, $dbPass)) {
                    $rel = ltrim(substr($cfgPath, strlen($repoPath)), '/');
                    $syncedFiles[] = $rel;
                }
            }
        }

        // 4. Perlindungan Git: pastikan .env terdaftar di .gitignore agar password tidak bocor ke git publik
        $this->ensureGitIgnore($repoPath);

        return array_unique($syncedFiles);
    }

    /**
     * Tulis baru atau perbarui file .env dengan menjaga variabel kustom lain yang sudah ada.
     */
    protected function writeOrUpdateEnv(
        string $filePath,
        array $managedVars,
        ?string $examplePath,
        string $dbName,
        string $host,
        string $port,
        string $dbUser,
        string $dbPass,
        string $databaseUrl,
        string $postgresUrl,
        string $asyncUrl
    ): bool {
        $dir = dirname($filePath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $now = date('Y-m-d H:i:s');

        // Jika file belum ada tapi ada .env.example, gunakan .env.example sebagai basis awal
        if (!file_exists($filePath) && $examplePath && file_exists($examplePath)) {
            $baseContent = @file_get_contents($examplePath) ?: '';
        } elseif (file_exists($filePath)) {
            $baseContent = @file_get_contents($filePath) ?: '';
        } else {
            $baseContent = null;
        }

        if ($baseContent !== null && trim($baseContent) !== '') {
            // Perbarui baris yang ada, simpan variabel lainnya
            $lines = explode("\n", $baseContent);
            $newLines = [];
            $replaced = [];

            foreach ($lines as $line) {
                if (preg_match('/^\s*([A-Za-z0-9_]+)\s*=(.*)$/', $line, $matches)) {
                    $key = $matches[1];
                    if (array_key_exists($key, $managedVars)) {
                        $newLines[] = "{$key}={$managedVars[$key]}";
                        $replaced[$key] = true;
                        continue;
                    }
                }
                $newLines[] = $line;
            }

            // Tambahkan kunci database penting yang belum ada di file
            $essential = [
                'DB_CONNECTION' => 'pgsql',
                'DB_HOST' => $host,
                'DB_PORT' => $port,
                'DB_DATABASE' => $dbName,
                'DB_NAME' => $dbName,
                'DB_USERNAME' => $dbUser,
                'DB_USER' => $dbUser,
                'DB_PASSWORD' => $dbPass,
                'DB_PASS' => $dbPass,
                'DATABASE_URL' => '"' . $databaseUrl . '"',
                'POSTGRES_URL' => '"' . $postgresUrl . '"',
                'ASYNC_DATABASE_URL' => '"' . $asyncUrl . '"',
            ];

            $missing = [];
            foreach ($essential as $k => $v) {
                if (!isset($replaced[$k])) {
                    $missing[$k] = $v;
                }
            }

            if (!empty($missing)) {
                $newLines[] = '';
                $newLines[] = '# ==============================================================================';
                $newLines[] = '# Auto-synced PostgreSQL Credentials (Postgres Manager)';
                $newLines[] = '# Compatible with: Prisma, Sequelize, TypeORM, Alembic, FastAPI, Django, etc.';
                $newLines[] = "# Last synced: {$now}";
                $newLines[] = '# ==============================================================================';
                foreach ($missing as $k => $v) {
                    $newLines[] = "{$k}={$v}";
                }
            }

            $content = implode("\n", $newLines);
            if (!str_ends_with($content, "\n")) {
                $content .= "\n";
            }
        } else {
            // Buat file .env baru dari nol dengan template lengkap dan rapi
            $content = <<<ENV
# ==============================================================================
# Auto-generated by Postgres Manager (Auto-Sync .env)
# Target Database: {$dbName}
# Sync Time: {$now}
# ==============================================================================

# Standar Kredensial PostgreSQL (Node.js, Express, Flask, Django, Laravel, dll)
DB_CONNECTION=pgsql
DB_HOST={$host}
DB_PORT={$port}
DB_DATABASE={$dbName}
DB_NAME={$dbName}
DB_USERNAME={$dbUser}
DB_USER={$dbUser}
DB_PASSWORD={$dbPass}

# URL Koneksi untuk ORM & Modern Frameworks
# Kompatibel langsung dengan: Prisma, Sequelize, TypeORM, Alembic, FastAPI, SQLAlchemy
DATABASE_URL="{$databaseUrl}"
POSTGRES_URL="{$postgresUrl}"
ASYNC_DATABASE_URL="{$asyncUrl}"

ENV;
        }

        $res = @file_put_contents($filePath, $content);
        if ($res !== false) {
            @chmod($filePath, 0664);
            return true;
        }
        return false;
    }

    /**
     * Perbarui config.env legacy (seperti pada smartroom-pi).
     * Kunci yang belum ada akan ditambahkan agar program benar-benar terhubung.
     */
    protected function updateConfigEnv(
        string $cfgPath,
        string $host,
        string $port,
        string $dbName,
        string $dbUser,
        string $dbPass
    ): bool {
        $cfg = @file_get_contents($cfgPath);
        if ($cfg === false) return false;

        $values = [
            'DB_HOST' => $host,
            'DB_PORT' => $port,
            'DB_NAME' => $dbName,
            'DB_DATABASE' => $dbName,
            'DB_USER' => $dbUser,
            'DB_USERNAME' => $dbUser,
            'DB_PASSWORD' => $dbPass,
        ];

        $lines = preg_split('/\R/', $cfg) ?: [];
        $seen = [];

        foreach ($lines as &$line) {
            if (preg_match('/^\s*([A-Za-z0-9_]+)\s*=/', $line, $m) && array_key_exists($m[1], $values)) {
                $line = "{$m[1]}={$values[$m[1]]}";
                $seen[$m[1]] = true;
            }
        }
        unset($line);

        $missing = [];
        foreach ($values as $key => $value) {
            if (!isset($seen[$key])) {
                $missing[] = "{$key}={$value}";
            }
        }

        if (!empty($missing)) {
            $lines[] = '';
            $lines[] = '# Auto-synced PostgreSQL credentials (Postgres Manager)';
            foreach ($missing as $line) {
                $lines[] = $line;
            }
        }

        $content = implode("\n", $lines);
        if (!str_ends_with($content, "\n")) {
            $content .= "\n";
        }

        $res = @file_put_contents($cfgPath, $content);
        if ($res !== false) {
            @chmod($cfgPath, 0664);
            return true;
        }
        return false;
    }

    /**
     * Pastikan file .env terlindungi di dalam .gitignore repositori.
     */
    protected function ensureGitIgnore(string $repoPath): void
    {
        $gitignorePath = $repoPath . '/.gitignore';
        if (file_exists($gitignorePath)) {
            $content = @file_get_contents($gitignorePath) ?: '';
            if (!preg_match('/^\.env(\s|$)/m', $content)) {
                $content = rtrim($content) . "\n\n# Postgres Manager Auto-Sync\n.env\n.env.local\n";
                @file_put_contents($gitignorePath, $content);
                @chmod($gitignorePath, 0664);
            }
        } else {
            $content = "# Postgres Manager Auto-Sync\n.env\n.env.local\n";
            @file_put_contents($gitignorePath, $content);
            @chmod($gitignorePath, 0664);
        }
    }
}
