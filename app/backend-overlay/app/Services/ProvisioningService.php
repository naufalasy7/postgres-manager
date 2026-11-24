<?php
namespace App\Services;
use PDO;
use Illuminate\Support\Facades\{DB, Crypt};

class ProvisioningService {
    public function admin(string $db = 'postgres', ?string $user = null, ?string $pass = null): PDO {
        $c = config('pgmanager');
        return new PDO("pgsql:host={$c['host']};port={$c['port']};dbname=$db", $user ?? $c['admin_user'], $pass ?? $c['admin_password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    }

    /** Provisioning dengan compensating rollback (CREATE DATABASE tidak bisa di dalam transaksi). */
    public function create(array $d): array {
        $db = $d['db_name']; $user = $d['db_user']; $slug = $d['slug'];
        $made = ['role' => false, 'db' => false, 'dir' => null];
        $pass = bin2hex(random_bytes(16));
        $steps = []; $pdo = null;
        try {
            $pdo = $this->admin();
            $q = $pdo->prepare('SELECT 1 FROM pg_database WHERE datname=?'); $q->execute([$db]);
            if ($q->fetch()) throw new \RuntimeException("Database '$db' sudah ada");
            $q = $pdo->prepare('SELECT 1 FROM pg_roles WHERE rolname=?'); $q->execute([$user]);
            if ($q->fetch()) throw new \RuntimeException("Role '$user' sudah ada");
            $steps[] = 'validasi + cek ketersediaan';

            $pdo->exec('CREATE ROLE '.Pg::id($user).' LOGIN PASSWORD '.$pdo->quote($pass).' NOSUPERUSER NOCREATEDB NOCREATEROLE'); $made['role'] = true;
            try { $pdo->exec('GRANT '.Pg::id($user).' TO CURRENT_USER'); } catch (\Throwable) {} // PG16+: agar rollback bisa DROP
            $steps[] = 'role dibuat';

            $pdo->exec('CREATE DATABASE '.Pg::id($db).' OWNER '.Pg::id($user).' TEMPLATE template0 ENCODING '.$pdo->quote($d['encoding'])
                .' LC_COLLATE '.$pdo->quote($d['locale']).' LC_CTYPE '.$pdo->quote($d['locale'])); $made['db'] = true;
            $pdo->exec('REVOKE ALL ON DATABASE '.Pg::id($db).' FROM PUBLIC');
            $steps[] = 'database dibuat + privilege';

            $tpl = DB::table('database_templates')->find($d['template_id']);
            if ($tpl && trim($tpl->sql_init ?? '') !== '') { $this->admin($db, $user, $pass)->exec($tpl->sql_init); $steps[] = "template '{$tpl->name}' diinisialisasi"; }

            // Inisialisasi skrip SQL dari repository terhubung bila dipilih
            $schemaReport = ['applied' => [], 'tables' => [], 'warnings' => [], 'sources' => []];
            if (!empty($d['repository']) && !empty($d['init_sql_path'])) {
                $root = config('pgmanager.root') ?: base_path('../../');
                $sqlPath = trim($d['init_sql_path'], '/');
                $repoName = trim($d['repository'], '/');
                $repoValid = $repoName !== ''
                    && !str_contains($repoName, '..')
                    && (bool)preg_match('/^[A-Za-z0-9_.\-]+$/', $repoName);
                $sqlFile = $repoValid
                    ? rtrim($root, '/') . '/repositories/' . $repoName . '/' . $sqlPath
                    : null;
                if (str_contains($sqlPath, '..') || !is_file((string)$sqlFile)) {
                    $sqlFile = null;
                }
                if ($sqlFile && file_exists($sqlFile)) {
                    $repoSql = file_get_contents($sqlFile);
                    if ($repoSql) {
                        $this->admin($db, $user, $pass)->exec($repoSql);
                        $steps[] = "skrip '{$d['init_sql_path']}' dari repo '{$d['repository']}' dieksekusi";
                        $inspector = new RepoSchemaInspector();
                        $schemaReport['applied'][] = $d['init_sql_path'];
                        $schemaReport['tables'] = $inspector->extractTables($repoSql);
                    }
                }
            } elseif (!empty($d['repository']) && !empty($d['auto_schema'])) {
                // Auto-deteksi skema yang dibutuhkan program (file .sql, SQL inline Python/JS/PHP).
                // Kegagalan satu sumber tidak membatalkan database; dicatat sebagai warning.
                try {
                    $inspector = new RepoSchemaInspector();
                    $discovery = $inspector->discover($d['repository']);
                    $schemaReport['sources'] = array_map(
                        fn(array $s) => ['path' => $s['path'], 'kind' => $s['kind'], 'tables' => $s['tables']],
                        $discovery['sources']
                    );

                    if (!empty($discovery['sources'])) {
                        $schemaPdo = $this->admin($db, $user, $pass);
                        foreach ($discovery['sources'] as $src) {
                            try {
                                $schemaPdo->exec($src['sql']);
                                $schemaReport['applied'][] = $src['path'];
                                foreach ($src['tables'] as $tbl) {
                                    if (!in_array($tbl, $schemaReport['tables'], true)) {
                                        $schemaReport['tables'][] = $tbl;
                                    }
                                }
                            } catch (\Throwable $se) {
                                $schemaReport['warnings'][] = "{$src['path']}: " . $se->getMessage();
                            }
                        }
                    }

                    if (!empty($schemaReport['applied'])) {
                        $steps[] = 'skema repo otomatis: ' . implode(', ', $schemaReport['applied'])
                            . ' (' . count($schemaReport['tables']) . ' tabel: ' . implode(', ', $schemaReport['tables']) . ')';
                    }
                    if (!empty($schemaReport['warnings'])) {
                        $steps[] = 'peringatan skema: ' . implode('; ', $schemaReport['warnings']);
                    }
                } catch (\Throwable $se) {
                    $schemaReport['warnings'][] = $se->getMessage();
                    $steps[] = 'auto-skema repo gagal: ' . $se->getMessage();
                }
            }

            $currentUser = auth()->user();
            $root = rtrim(config('pgmanager.root') ?: base_path('../../'), '/');
            if ($currentUser && !$currentUser->isSuperAdmin()) {
                $userFolder = \Illuminate\Support\Str::slug($currentUser->name ?: explode('@', $currentUser->email)[0]) ?: "user_{$currentUser->id}";
                $userBaseDir = "$root/projects/$userFolder";
                if (!is_dir($userBaseDir)) {
                    @mkdir($userBaseDir, 0775, true);
                    @file_put_contents("$userBaseDir/.gitkeep", '');
                }
                $dir = "$userBaseDir/$slug";
            } else {
                $dir = "$root/projects/$slug";
            }
            foreach (['config','migrations','backups','exports','logs'] as $s) if (!is_dir("$dir/$s")) mkdir("$dir/$s", 0750, true);
            $made['dir'] = $dir;
            $env = "DB_HOST=".config('pgmanager.host')."\nDB_PORT=".config('pgmanager.port')."\nDB_DATABASE=$db\nDB_USERNAME=$user\nDB_PASSWORD=$pass\n";
            file_put_contents("$dir/config/.env", $env); chmod("$dir/config/.env", 0600);
            $steps[] = 'direktori + .env (0600)';

            // Auto-Sync .env langsung ke folder repository jika terhubung
            if (!empty($d['repository'])) {
                try {
                    $synced = app(\App\Services\RepoEnvSyncService::class)->sync($d['repository'], [
                        'host' => config('pgmanager.host'),
                        'port' => config('pgmanager.port'),
                        'db_name' => $db,
                        'db_user' => $user,
                        'password' => $pass,
                    ]);
                    if (!empty($synced)) {
                        $steps[] = "file .env otomatis disinkronkan ke repo '{$d['repository']}' (" . implode(', ', $synced) . ")";
                    }
                } catch (\Throwable $se) {
                    $steps[] = "sync .env repo: " . $se->getMessage();
                }
            }

            $pid = DB::transaction(function () use ($d, $dir, $pass) {
                $id = DB::table('projects')->insertGetId([
                    'name' => $d['name'],
                    'slug' => $d['slug'],
                    'description' => $d['description'] ?? null,
                    'template_id' => $d['template_id'],
                    'repository' => $d['repository'] ?? null,
                    'directory' => $dir,
                    'backup_policy' => $d['backup_policy'],
                    'created_by' => auth()->id(),
                    'created_at' => now(),
                    'updated_at' => now()
                ]);
                DB::table('project_databases')->insert(['project_id'=>$id,'db_name'=>$d['db_name'],'db_user'=>$d['db_user'],'encoding'=>$d['encoding'],'locale'=>$d['locale'],'created_at'=>now(),'updated_at'=>now()]);
                DB::table('database_connections')->insert(['project_id'=>$id,'host'=>config('pgmanager.host'),'port'=>config('pgmanager.port'),'db_name'=>$d['db_name'],'username'=>$d['db_user'],'password_encrypted'=>Crypt::encryptString($pass),'created_at'=>now(),'updated_at'=>now()]);
                DB::table('database_operations')->insert(['project_id'=>$id,'operation'=>'provision','status'=>'ok','user_id'=>auth()->id(),'created_at'=>now(),'updated_at'=>now()]);
                return $id;
            });
            $steps[] = 'terdaftar di postgres_master';
            Audit::log('project.create', $slug, 'ok', ['db' => $db]);
            $dbUrl = "postgresql://" . rawurlencode($user) . ":" . rawurlencode($pass) . "@" . config('pgmanager.host') . ":" . config('pgmanager.port') . "/{$db}?schema=public&sslmode=disable";
            return [
                'project_id' => $pid,
                'db_name' => $db,
                'db_user' => $user,
                'password' => $pass,
                'host' => config('pgmanager.host'),
                'port' => config('pgmanager.port'),
                'database_url' => $dbUrl,
                'schema' => $schemaReport,
                'steps' => $steps,
            ];
        } catch (\Throwable $e) {
            $report = [];
            try {
                $pdo = $pdo ?? $this->admin();
                if ($made['db']) { $pdo->exec('DROP DATABASE IF EXISTS '.Pg::id($db).' WITH (FORCE)'); $report[] = 'database di-rollback'; }
                if ($made['role']) { $pdo->exec('DROP ROLE IF EXISTS '.Pg::id($user)); $report[] = 'role di-rollback'; }
                if ($made['dir']) { @unlink($made['dir'].'/config/.env'); $report[] = 'direktori dibiarkan utk inspeksi: '.$made['dir']; }
            } catch (\Throwable $r) { $report[] = 'ROLLBACK GAGAL, periksa manual: '.$r->getMessage(); }
            Audit::log('project.create', $slug, 'failed', ['error' => $e->getMessage(), 'rollback' => $report]);
            throw new \RuntimeException($e->getMessage().' | state: '.(implode('; ', $report) ?: 'tidak ada perubahan'));
        }
    }
}
