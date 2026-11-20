<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Services\ProvisioningService;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller {
    public function __invoke(ProvisioningService $p) {
        $pg = ['up' => false];
        try {
            $pdo = $p->admin();
            $pg = ['up' => true,
                'version' => $pdo->query('SHOW server_version')->fetchColumn(),
                'host' => config('pgmanager.host'), 'port' => (int)config('pgmanager.port'),
                'connections' => (int)$pdo->query('SELECT count(*) FROM pg_stat_activity')->fetchColumn(),
                'databases' => $pdo->query("SELECT datname AS name, CASE WHEN has_database_privilege(datname, 'CONNECT') THEN pg_database_size(datname) END AS size FROM pg_database WHERE NOT datistemplate ORDER BY 2 DESC NULLS LAST")->fetchAll(\PDO::FETCH_ASSOC)];
        } catch (\Throwable $e) { $pg['error'] = 'Tidak dapat terhubung ke PostgreSQL'; }

        $mem = []; foreach (@file('/proc/meminfo') ?: [] as $l) if (preg_match('/^(MemTotal|MemAvailable):\s+(\d+)/', $l, $m)) $mem[$m[1]] = $m[2] * 1024;
        $cores = max(1, substr_count((string)@file_get_contents('/proc/cpuinfo'), 'processor'));
        $load = sys_getloadavg()[0] ?? 0;
        $ts = trim((string)@shell_exec('tailscale ip -4 2>/dev/null')); // perintah tetap, tanpa input pengguna
        return [
            'postgres' => $pg,
            'projects' => DB::table('projects')->count(),
            'system' => ['cpu_percent' => min(100, round($load / $cores * 100, 1)), 'load1' => $load,
                'ram_total' => $mem['MemTotal'] ?? null, 'ram_used' => isset($mem['MemTotal'], $mem['MemAvailable']) ? $mem['MemTotal'] - $mem['MemAvailable'] : null,
                'disk_total' => disk_total_space('/'), 'disk_free' => disk_free_space('/'), 'tailscale_ip' => $ts ?: null],
            'recent_ops' => DB::table('audit_logs')->orderByDesc('id')->limit(8)->get(),
            'recent_backups' => DB::table('database_backups')->orderByDesc('id')->limit(5)->get(),
        ];
    }
}
