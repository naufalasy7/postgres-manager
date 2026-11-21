<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\DeploymentService;
use Illuminate\Http\Request;

class DeploymentController extends Controller
{
    public function index(DeploymentService $svc)
    {
        return response()->json($svc->getAllDeployments());
    }

    public function show(int $id, DeploymentService $svc)
    {
        return response()->json($svc->getStatus($id));
    }

    public function deploy(Request $r, int $id, DeploymentService $svc)
    {
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
        return response()->json($svc->stop($id));
    }

    public function restart(int $id, DeploymentService $svc)
    {
        return response()->json($svc->restart($id));
    }

    public function logs(Request $r, int $id, DeploymentService $svc)
    {
        $lines = (int)$r->query('lines', 100);
        return response()->json($svc->getLogs($id, $lines));
    }

    public function updateSettings(Request $r, int $id, DeploymentService $svc)
    {
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
