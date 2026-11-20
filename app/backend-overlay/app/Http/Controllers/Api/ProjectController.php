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
            ->select(
                'projects.id',
                'projects.name',
                'projects.slug',
                'projects.description',
                'projects.status',
                'projects.repository',
                'projects.directory',
                'projects.created_at',
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
        return response()->json($q->get());
    }

    public function store(Request $r, ProvisioningService $svc)
    {
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
            'repository' => 'nullable|string|max:100',
            'init_sql_path' => 'nullable|string|max:255',
        ]);

        try {
            return response()->json($svc->create($d), 201);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    public function archive(int $id)
    {
        DB::table('projects')->where('id', $id)->update(['status' => 'archived', 'updated_at' => now()]);
        Audit::log('project.archive', (string)$id);
        return response()->noContent();
    }

    public function linkRepo(Request $r, int $id)
    {
        $d = $r->validate([
            'repository' => 'nullable|string|max:100',
        ]);

        $project = DB::table('projects')->where('id', $id)->first();
        if (!$project) abort(404, 'Proyek tidak ditemukan.');

        DB::table('projects')->where('id', $id)->update([
            'repository' => $d['repository'] ?: null,
            'updated_at' => now(),
        ]);

        Audit::log('project.link_repo', $project->slug, 'ok', ['repo' => $d['repository']]);
        return response()->json([
            'message' => 'Repository berhasil dihubungkan ke proyek.',
            'repository' => $d['repository'] ?: null,
        ]);
    }

    public function executeScript(Request $r, int $id, ProvisioningService $svc)
    {
        $d = $r->validate([
            'repository' => 'nullable|string|max:100',
            'path' => 'nullable|string|max:255',
            'sql' => 'nullable|string',
        ]);

        $project = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->join('database_connections as c', 'c.project_id', '=', 'projects.id')
            ->where('projects.id', $id)
            ->select('projects.*', 'd.db_name', 'd.db_user', 'c.host', 'c.port', 'c.password_encrypted')
            ->first();

        if (!$project) {
            abort(404, 'Proyek database tidak ditemukan.');
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
        return response()->json(DB::table('audit_logs')->orderByDesc('id')->limit(200)->get());
    }
}
