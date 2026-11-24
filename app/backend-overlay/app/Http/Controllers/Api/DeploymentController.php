<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\DeploymentService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DeploymentController extends Controller
{
    protected function authorizeProject(int $id, bool $requireDeployer = true)
    {
        $user = auth()->user();
        $project = DB::table('projects')->where('id', $id)->first();
        if (!$project) abort(404, 'Proyek tidak ditemukan.');
        if (!$user->isSuperAdmin() && $project->created_by != $user->id) {
            abort(403, 'Akses ditolak: Hanya pemilik proyek atau Super Admin yang dapat mengakses service deployment proyek ini.');
        }
        if ($requireDeployer && $user->role === 'user') {
            abort(403, 'Akses ditolak: Role Operator tidak diizinkan mendeploy atau mengontrol background service. Fitur ini khusus untuk Admin Terbatas dan Super Admin.');
        }
    }

    public function index(DeploymentService $svc)
    {
        $user = auth()->user();
        $all = $svc->getAllDeployments();
        if ($user->isSuperAdmin()) {
            return response()->json($all);
        }
        $userProjectIds = DB::table('projects')->where('created_by', $user->id)->pluck('id')->all();
        $filtered = array_values(array_filter($all, fn($item) => in_array($item['project_id'] ?? $item['id'] ?? null, $userProjectIds)));
        return response()->json($filtered);
    }

    public function show(int $id, DeploymentService $svc)
    {
        $this->authorizeProject($id, false);
        return response()->json($svc->getStatus($id));
    }

    public function deploy(Request $r, int $id, DeploymentService $svc)
    {
        $this->authorizeProject($id, true);

        $d = $r->validate([
            'port' => 'nullable|integer|min:1024|max:65535',
            'deploy_type' => 'nullable|string|max:50',
            'deploy_command' => 'nullable|string|max:500',
            'deploy_dir' => 'nullable|string|max:255',
            'auto_deploy' => 'nullable|boolean',
        ]);

        return response()->json($svc->deploy($id, $d));
    }

    public function stop(int $id, DeploymentService $svc)
    {
        $this->authorizeProject($id, true);
        return response()->json($svc->stop($id));
    }

    public function restart(int $id, DeploymentService $svc)
    {
        $this->authorizeProject($id, true);
        return response()->json($svc->restart($id));
    }

    public function logs(Request $r, int $id, DeploymentService $svc)
    {
        $this->authorizeProject($id, false);
        $lines = (int)$r->query('lines', 100);
        return response()->json($svc->getLogs($id, $lines));
    }

    public function updateSettings(Request $r, int $id, DeploymentService $svc)
    {
        $this->authorizeProject($id, true);

        $d = $r->validate([
            'deploy_port' => 'nullable|integer|min:1024|max:65535',
            'deploy_type' => 'nullable|string|max:50',
            'deploy_command' => 'nullable|string|max:500',
            'deploy_dir' => 'nullable|string|max:255',
            'auto_deploy' => 'nullable|boolean',
        ]);

        return response()->json($svc->updateSettings($id, $d));
    }
}
