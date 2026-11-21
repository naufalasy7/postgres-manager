<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ProvisioningService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, Crypt};

class DashboardController extends Controller
{
    public function __invoke(Request $r, ProvisioningService $p)
    {
        // Always load all projects for the selector dropdown
        $projectsList = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->select('projects.id', 'projects.name', 'projects.slug', 'projects.repository', 'd.db_name', 'd.db_user')
            ->orderBy('projects.name')
            ->get();

        $selectedProjectId = $r->query('project_id');

        // =====================================================================
        // 1. PER-PROJECT DB MONITORING
        // =====================================================================
        if ($selectedProjectId && $selectedProjectId !== 'all') {
            $project = DB::table('projects')
                ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
                ->join('database_connections as c', 'c.project_id', '=', 'projects.id')
                ->where('projects.id', $selectedProjectId)
                ->select(
                    'projects.id',
                    'projects.name',
                    'projects.slug',
                    'projects.description',
                    'projects.status',
                    'projects.repository',
                    'projects.created_at',
                    'd.db_name',
                    'd.db_user',
                    'c.host',
                    'c.port',
                    'c.password_encrypted'
                )
                ->first();

            if (!$project) {
                abort(404, 'Proyek database tidak ditemukan.');
            }

            $dbName = $project->db_name;
            $dbUser = $project->db_user;
            $password = Crypt::decryptString($project->password_encrypted);

            $dbStats = [
                'up' => false,
                'db_name' => $dbName,
                'db_user' => $dbUser,
                'size_bytes' => 0,
                'table_count' => 0,
                'connections' => 0,
                'cache_ratio' => '100.00',
                'commits' => 0,
                'rollbacks' => 0,
                'deadlocks' => 0,
            ];
            $tables = [];
            $activeQueries = [];

            try {
                // Connect as project database user (owner)
                $pdo = new \PDO(
                    "pgsql:host={$project->host};port={$project->port};dbname={$dbName}",
                    $dbUser,
                    $password,
                    [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]
                );
                $dbStats['up'] = true;

                // 1. Database Size
                $sizeQ = $pdo->prepare("SELECT pg_database_size(?)");
                $sizeQ->execute([$dbName]);
                $dbStats['size_bytes'] = (int)$sizeQ->fetchColumn();

                // 2. Table Count
                $tblQ = $pdo->query("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'");
                $dbStats['table_count'] = (int)$tblQ->fetchColumn();

                // 3. Active Connections to this database
                $connQ = $pdo->prepare("SELECT count(*) FROM pg_stat_activity WHERE datname = ?");
                $connQ->execute([$dbName]);
                $dbStats['connections'] = (int)$connQ->fetchColumn();

                // 4. Cache Hit Ratio
                $cacheQ = $pdo->prepare("SELECT ROUND(sum(blks_hit) * 100.0 / NULLIF(sum(blks_hit + blks_read), 0), 2) FROM pg_stat_database WHERE datname = ?");
                $cacheQ->execute([$dbName]);
                $ratio = $cacheQ->fetchColumn();
                $dbStats['cache_ratio'] = $ratio !== false && $ratio !== null ? $ratio : '100.00';

                // 5. Transactions info
                $txQ = $pdo->prepare("SELECT xact_commit, xact_rollback, deadlocks FROM pg_stat_database WHERE datname = ?");
                $txQ->execute([$dbName]);
                $tx = $txQ->fetch(\PDO::FETCH_ASSOC);
                if ($tx) {
                    $dbStats['commits'] = (int)($tx['xact_commit'] ?? 0);
                    $dbStats['rollbacks'] = (int)($tx['xact_rollback'] ?? 0);
                    $dbStats['deadlocks'] = (int)($tx['deadlocks'] ?? 0);
                }

                // 6. Top Tables by Size
                $tblSizeSql = "
                    SELECT
                        c.relname AS name,
                        COALESCE(s.n_live_tup, 0) AS row_estimate,
                        pg_total_relation_size(c.oid) AS total_bytes,
                        ROUND((pg_total_relation_size(c.oid) / 1048576.0)::numeric, 3) AS total_mb,
                        ROUND((pg_relation_size(c.oid) / 1048576.0)::numeric, 3) AS table_mb,
                        ROUND((pg_indexes_size(c.oid) / 1048576.0)::numeric, 3) AS index_mb
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
                    WHERE n.nspname = 'public' AND c.relkind = 'r'
                    ORDER BY total_bytes DESC
                    LIMIT 15
                ";
                $tables = $pdo->query($tblSizeSql)->fetchAll(\PDO::FETCH_ASSOC);

                // 7. Active queries running on this database
                $actQ = $pdo->prepare("
                    SELECT
                        pid,
                        usename,
                        client_addr,
                        state,
                        COALESCE(EXTRACT(EPOCH FROM (now() - query_start)), 0)::numeric(10,2) AS duration_seconds,
                        query
                    FROM pg_stat_activity
                    WHERE datname = ? AND state != 'idle'
                    ORDER BY query_start ASC
                    LIMIT 10
                ");
                $actQ->execute([$dbName]);
                $activeQueries = $actQ->fetchAll(\PDO::FETCH_ASSOC);
            } catch (\Throwable $e) {
                $dbStats['error'] = 'Koneksi database proyek gagal: ' . $e->getMessage();
            }

            // Available scripts from linked repository if any
            $repoScripts = [];
            if ($project->repository) {
                $root = config('pgmanager.root') ?: base_path('../../');
                $repoDir = rtrim($root, '/') . '/repositories/' . trim($project->repository, '/');
                if (is_dir($repoDir)) {
                    $iterator = new \RecursiveIteratorIterator(
                        new \RecursiveDirectoryIterator($repoDir, \FilesystemIterator::SKIP_DOTS)
                    );
                    foreach ($iterator as $file) {
                        if ($file->isFile() && in_array(strtolower($file->getExtension()), ['sql', 'pgsql'])) {
                            $sub = ltrim(substr($file->getPathname(), strlen($repoDir)), '/');
                            if (!str_starts_with($sub, '.git')) {
                                $repoScripts[] = [
                                    'name' => $file->getFilename(),
                                    'path' => $sub,
                                    'size' => $file->getSize(),
                                ];
                            }
                        }
                    }
                    usort($repoScripts, fn($a, $b) => strcasecmp($a['path'], $b['path']));
                }
            }

            $recentOps = DB::table('database_operations')
                ->where('project_id', $project->id)
                ->orderByDesc('id')
                ->limit(8)
                ->get();

            return response()->json([
                'mode' => 'project',
                'project' => $project,
                'db_stats' => $dbStats,
                'tables' => $tables,
                'active_queries' => $activeQueries,
                'recent_ops' => $recentOps,
                'repo_scripts' => $repoScripts,
                'projects_list' => $projectsList,
                'deployment' => app(\App\Services\DeploymentService::class)->getStatus($project->id),
            ]);
        }

        // =====================================================================
        // 2. SERVER GLOBAL MONITORING (DEFAULT)
        // =====================================================================
        $pg = ['up' => false];
        try {
            $pdo = $p->admin();
            $pg = [
                'up' => true,
                'version' => $pdo->query('SHOW server_version')->fetchColumn(),
                'host' => config('pgmanager.host'),
                'port' => (int)config('pgmanager.port'),
                'connections' => (int)$pdo->query('SELECT count(*) FROM pg_stat_activity')->fetchColumn(),
                'databases' => $pdo->query("
                    SELECT datname AS name,
                           CASE WHEN has_database_privilege(datname, 'CONNECT') THEN pg_database_size(datname) END AS size
                    FROM pg_database
                    WHERE NOT datistemplate
                    ORDER BY 2 DESC NULLS LAST
                ")->fetchAll(\PDO::FETCH_ASSOC),
            ];
        } catch (\Throwable $e) {
            $pg['error'] = 'Tidak dapat terhubung ke PostgreSQL: ' . $e->getMessage();
        }

        $mem = [];
        foreach (@file('/proc/meminfo') ?: [] as $l) {
            if (preg_match('/^(MemTotal|MemAvailable):\s+(\d+)/', $l, $m)) {
                $mem[$m[1]] = $m[2] * 1024;
            }
        }
        $cores = max(1, substr_count((string)@file_get_contents('/proc/cpuinfo'), 'processor'));
        $load = sys_getloadavg()[0] ?? 0;
        $ts = trim((string)@shell_exec('tailscale ip -4 2>/dev/null'));

        return response()->json([
            'mode' => 'global',
            'postgres' => $pg,
            'projects' => DB::table('projects')->count(),
            'projects_list' => $projectsList,
            'deployments' => app(\App\Services\DeploymentService::class)->getAllDeployments(),
            'system_ips' => app(\App\Services\DeploymentService::class)->getSystemIps(),
            'system' => [
                'cpu_percent' => min(100, round($load / $cores * 100, 1)),
                'load1' => $load,
                'ram_total' => $mem['MemTotal'] ?? null,
                'ram_used' => isset($mem['MemTotal'], $mem['MemAvailable']) ? $mem['MemTotal'] - $mem['MemAvailable'] : null,
                'disk_total' => disk_total_space('/'),
                'disk_free' => disk_free_space('/'),
                'tailscale_ip' => $ts ?: null,
            ],
            'recent_ops' => DB::table('audit_logs')->orderByDesc('id')->limit(8)->get(),
            'recent_backups' => DB::table('database_backups')->orderByDesc('id')->limit(5)->get(),
        ]);
    }
}
