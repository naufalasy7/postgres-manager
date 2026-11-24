<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\{Audit, ProvisioningService};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, Crypt};
use Illuminate\Validation\Rule;

class ProjectController extends Controller
{
    public function index(Request $r)
    {
        $q = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->leftJoin('users as u', 'u.id', '=', 'projects.created_by')
            ->select(
                'projects.id',
                'projects.name',
                'projects.slug',
                'projects.description',
                'projects.status',
                'projects.repository',
                'projects.deploy_port',
                'projects.deploy_status',
                'projects.deploy_type',
                'projects.auto_deploy',
                'projects.directory',
                'projects.created_at',
                'projects.created_by',
                'u.name as creator_name',
                'u.email as creator_email',
                'd.db_name',
                'd.db_user'
            )
            ->orderByDesc('projects.id');

        if ($s = $r->query('search')) {
            $q->where(fn($w) => $w->where('projects.name', 'ilike', "%$s%")->orWhere('projects.slug', 'ilike', "%$s%"));
        }
        if ($st = $r->query('status')) {
            $q->where('projects.status', $st);
        }

        $user = auth()->user();
        $isSuper = $user?->isSuperAdmin() ?? false;
        $currentUserId = $user?->id;

        // STRICT PRIVACY & PROTECTION:
        // Non-superadmin users CANNOT see Super Admin's projects or other users' projects!
        // Each user only sees their own projects, eliminating any risk of tampering.
        if (!$isSuper) {
            $q->where('projects.created_by', $currentUserId);
        }

        $results = $q->get()->map(function ($proj) use ($isSuper, $currentUserId, $user) {
            $isOwner = ($currentUserId && $proj->created_by == $currentUserId);
            $isOperator = ($user?->role === 'user');
            // Super Admin and Admin Terbatas (owner) can edit/deploy/backup; Operator is restricted
            $proj->can_edit = ($isSuper || $isOwner) && !$isOperator;
            $proj->is_owner = $isOwner;
            $proj->is_operator = $isOperator;
            return $proj;
        });

        return response()->json($results);
    }

    public function store(Request $r, ProvisioningService $svc)
    {
        $user = $r->user();
        if ($user && $user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak diizinkan membuat database/proyek baru. Fitur ini khusus untuk Admin Terbatas dan Super Admin.'], 403);
        }

        $res = config('pgmanager.reserved');
        $d = $r->validate([
            'name' => 'required|string|max:100',
            'slug' => ['required', 'regex:/^[a-z][a-z0-9-]{2,40}$/', 'unique:projects,slug'],
            'description' => 'nullable|string|max:500',
            'db_name' => ['required', 'regex:/^[a-z][a-z0-9_]{2,40}$/', Rule::notIn($res)],
            'db_user' => ['required', 'regex:/^[a-z][a-z0-9_]{2,40}$/', Rule::notIn($res)],
            'encoding' => 'required|in:UTF8',
            'locale' => 'required|in:C,C.UTF-8,en_US.UTF-8',
            'template_id' => 'required|exists:database_templates,id',
            'backup_policy' => 'required|in:none,daily,weekly',
            'repository' => ['nullable', 'string', 'max:100', 'regex:/^[A-Za-z0-9_.\-]+$/'],
            'init_sql_path' => 'nullable|string|max:255',
            'auto_schema' => 'nullable|boolean',
        ]);

        // Bila tidak memilih file SQL tertentu, otomatis deteksi skema dari repo.
        $d['auto_schema'] = array_key_exists('auto_schema', $d)
            ? (bool)$d['auto_schema']
            : empty($d['init_sql_path']);

        try {
            return response()->json($svc->create($d), 201);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    public function archive(int $id)
    {
        $user = auth()->user();
        $project = DB::table('projects')->where('id', $id)->first();
        if (!$project) abort(404, 'Proyek tidak ditemukan.');

        if (!$user->isSuperAdmin() && $project->created_by != $user->id) {
            abort(403, 'Akses ditolak: Hanya pemilik proyek atau Super Admin yang dapat mengarsipkan proyek ini.');
        }

        if ($user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak memiliki izin menghapus atau mengarsipkan database.'], 403);
        }

        DB::table('projects')->where('id', $id)->update(['status' => 'archived', 'updated_at' => now()]);
        Audit::log('project.archive', (string)$id);
        return response()->noContent();
    }

    public function linkRepo(Request $r, int $id)
    {
        $d = $r->validate([
            'repository' => ['nullable', 'string', 'max:100', 'regex:/^[A-Za-z0-9_.\-]+$/'],
        ]);

        $user = auth()->user();
        $project = DB::table('projects')->where('id', $id)->first();
        if (!$project) abort(404, 'Proyek tidak ditemukan.');

        if (!$user->isSuperAdmin() && $project->created_by != $user->id) {
            abort(403, 'Akses ditolak: Hanya pemilik proyek atau Super Admin yang dapat menghubungkan repository pada proyek ini.');
        }

        if ($user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak diizinkan mengubah repository terhubung proyek.'], 403);
        }

        DB::table('projects')->where('id', $id)->update([
            'repository' => $d['repository'] ?: null,
            'updated_at' => now(),
        ]);

        $syncedFiles = [];
        if (!empty($d['repository'])) {
            $conn = DB::table('database_connections')->where('project_id', $id)->first();
            if ($conn) {
                try {
                    $dbPassword = Crypt::decryptString($conn->password_encrypted);
                    $syncedFiles = app(\App\Services\RepoEnvSyncService::class)->sync($d['repository'], [
                        'host' => $conn->host,
                        'port' => $conn->port,
                        'db_name' => $conn->db_name,
                        'db_user' => $conn->username,
                        'password' => $dbPassword,
                    ]);
                } catch (\Throwable $e) {}
            }
        }

        Audit::log('project.link_repo', $project->slug, 'ok', ['repo' => $d['repository'], 'synced_files' => $syncedFiles]);
        return response()->json([
            'message' => 'Repository berhasil dihubungkan ke proyek.' . (!empty($syncedFiles) ? ' File .env di repository otomatis disinkronkan.' : ''),
            'repository' => $d['repository'] ?: null,
            'env_synced' => !empty($syncedFiles),
            'synced_files' => $syncedFiles,
        ]);
    }

    public function executeScript(Request $r, int $id, ProvisioningService $svc)
    {
        $d = $r->validate([
            'repository' => 'nullable|string|max:100',
            'path' => 'nullable|string|max:255',
            'sql' => 'nullable|string',
        ]);

        $user = auth()->user();
        $project = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->join('database_connections as c', 'c.project_id', '=', 'projects.id')
            ->where('projects.id', $id)
            ->select('projects.*', 'd.db_name', 'd.db_user', 'c.host', 'c.port', 'c.password_encrypted')
            ->first();

        if (!$project) {
            abort(404, 'Proyek database tidak ditemukan.');
        }

        if (!$user->isSuperAdmin() && $project->created_by != $user->id) {
            abort(403, 'Akses ditolak: Hanya pemilik proyek atau Super Admin yang dapat mengeksekusi skrip pada proyek ini.');
        }

        if ($user->role === 'user') {
            return response()->json(['message' => 'Role Operator tidak diizinkan mengeksekusi skrip SQL langsung pada database.'], 403);
        }

        $sql = '';
        $sourceDesc = 'custom query';

        if (!empty($d['repository']) && !empty($d['path'])) {
            $root = config('pgmanager.root') ?: base_path('../../');
            $cleanPath = trim(str_replace('\\', '/', $d['path']), '/');
            if (str_contains($cleanPath, '..')) {
                abort(400, 'Invalid path');
            }
            $filePath = rtrim($root, '/') . '/repositories/' . trim($d['repository'], '/') . '/' . $cleanPath;
            if (!file_exists($filePath)) {
                return response()->json(['message' => "File SQL tidak ditemukan di '{$d['repository']}/{$d['path']}'."], 404);
            }
            $sql = file_get_contents($filePath);
            $sourceDesc = "{$d['repository']}/{$d['path']}";
        } elseif (!empty($d['sql'])) {
            $sql = $d['sql'];
        }

        if (empty(trim($sql))) {
            return response()->json(['message' => 'Tidak ada skrip SQL yang dieksekusi.'], 422);
        }

        $password = Crypt::decryptString($project->password_encrypted);

        $start = microtime(true);
        try {
            $pdo = new \PDO(
                "pgsql:host={$project->host};port={$project->port};dbname={$project->db_name}",
                $project->db_user,
                $password,
                [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]
            );

            // Execute script or query
            $isSelect = preg_match('/^\s*(SELECT|WITH|SHOW|EXPLAIN)\b/i', trim($sql));
            $rows = [];
            $columns = [];
            $affected = 0;

            if ($isSelect) {
                $stmt = $pdo->query($sql);
                $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);
                if (!empty($rows)) {
                    $columns = array_keys($rows[0]);
                }
                $affected = count($rows);
            } else {
                $affected = $pdo->exec($sql);
            }

            $durationMs = round((microtime(true) - $start) * 1000, 2);

            DB::table('database_operations')->insert([
                'project_id' => $id,
                'operation' => 'script_exec',
                'status' => 'ok',
                'details' => json_encode([
                    'source' => $sourceDesc,
                    'duration_ms' => $durationMs,
                    'affected' => $affected,
                ]),
                'user_id' => auth()->id(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            Audit::log('project.execute_script', $project->slug, 'ok', [
                'source' => $sourceDesc,
                'duration_ms' => $durationMs,
            ]);

            return response()->json([
                'status' => 'success',
                'message' => "Skrip '{$sourceDesc}' berhasil dieksekusi dalam {$durationMs} ms.",
                'duration_ms' => $durationMs,
                'rows_affected' => $affected,
                'is_query' => (bool)$isSelect,
                'columns' => $columns,
                'rows' => array_slice($rows, 0, 50),
            ]);
        } catch (\Throwable $e) {
            $durationMs = round((microtime(true) - $start) * 1000, 2);
            DB::table('database_operations')->insert([
                'project_id' => $id,
                'operation' => 'script_exec',
                'status' => 'failed',
                'details' => json_encode([
                    'source' => $sourceDesc,
                    'error' => $e->getMessage(),
                    'duration_ms' => $durationMs,
                ]),
                'user_id' => auth()->id(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Gagal mengeksekusi skrip: ' . $e->getMessage(),
                'duration_ms' => $durationMs,
            ], 422);
        }
    }

    public function templates()
    {
        return response()->json(DB::table('database_templates')->select('id', 'name', 'description')->get());
    }

    public function audit()
    {
        $user = auth()->user();
        if (!$user || !$user->isSuperAdmin()) {
            abort(403, 'Akses ditolak: Hanya Super Admin yang dapat melihat semua riwayat database.');
        }

        return response()->json(DB::table('audit_logs')->orderByDesc('id')->limit(200)->get());
    }
}
