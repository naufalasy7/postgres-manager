<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\IntegrationService;
use Illuminate\Http\Request;

class IntegrationController extends Controller
{
    public function index(Request $r, IntegrationService $svc)
    {
        $user = $r->user();
        return response()->json($svc->listIntegrations($user));
    }

    public function store(Request $r, IntegrationService $svc)
    {
        $d = $r->validate([
            'project_id' => 'required|integer|exists:projects,id',
            'platform' => 'required|string|in:blynk,zenoh,mqtt',
            'name' => 'required|string|max:100',
            'url' => 'required|string|max:255',
            'token' => 'nullable|string|max:500',
            'username' => 'nullable|string|max:150',
            'topic_or_key' => 'nullable|string|max:255',
            'target_table' => 'nullable|string|max:64|regex:/^[a-zA-Z0-9_]+$/',
            'config' => 'nullable|array',
        ]);

        $created = $svc->createIntegration($d, $r->user());
        return response()->json($created, 201);
    }

    public function show(int $id, IntegrationService $svc)
    {
        return response()->json($svc->getIntegration($id, auth()->user()));
    }

    public function update(Request $r, int $id, IntegrationService $svc)
    {
        $d = $r->validate([
            'name' => 'nullable|string|max:100',
            'url' => 'nullable|string|max:255',
            'token' => 'nullable|string|max:500',
            'username' => 'nullable|string|max:150',
            'topic_or_key' => 'nullable|string|max:255',
            'target_table' => 'nullable|string|max:64|regex:/^[a-zA-Z0-9_]+$/',
            'config' => 'nullable|array',
        ]);

        $updated = $svc->updateIntegration($id, $d, $r->user());
        return response()->json($updated);
    }

    public function destroy(int $id, IntegrationService $svc)
    {
        $svc->deleteIntegration($id, auth()->user());
        return response()->noContent();
    }

    public function testConnection(Request $r, IntegrationService $svc)
    {
        $d = $r->validate([
            'platform' => 'required|string|in:blynk,zenoh,mqtt',
            'url' => 'required|string|max:255',
            'token' => 'nullable|string|max:500',
            'username' => 'nullable|string|max:150',
            'topic_or_key' => 'nullable|string|max:255',
        ]);

        return response()->json($svc->testConnection($d));
    }

    public function syncNow(int $id, IntegrationService $svc)
    {
        return response()->json($svc->syncNow($id, auth()->user()));
    }

    public function start(int $id, IntegrationService $svc)
    {
        return response()->json($svc->startWorker($id, auth()->user()));
    }

    public function stop(int $id, IntegrationService $svc)
    {
        return response()->json($svc->stopWorker($id, auth()->user()));
    }

    public function logs(Request $r, int $id, IntegrationService $svc)
    {
        $lines = (int)$r->query('lines', 100);
        return response()->json($svc->getLogs($id, auth()->user(), $lines));
    }

    public function initIotTable(Request $r, int $id, IntegrationService $svc)
    {
        $user = $r->user();
        $project = \Illuminate\Support\Facades\DB::table('projects')->where('id', $id)->first();
        if (!$project) abort(404, 'Proyek tidak ditemukan.');
        if (!$user->isSuperAdmin() && $project->created_by != $user->id) {
            abort(403, 'Akses ditolak.');
        }

        $tableName = $r->input('table', 'iot_telemetry');
        return response()->json($svc->initIotTable($id, $tableName));
    }

    public function regenerateToken(int $id, IntegrationService $svc)
    {
        return response()->json($svc->regenerateToken($id, auth()->user()));
    }

    /**
     * Public incoming webhook for IoT telemetry (Blynk Webhooks / Zenoh / HTTP IoT).
     */
    public function webhook(Request $r, string $token, IntegrationService $svc)
    {
        $payload = $r->isJson() ? $r->json()->all() : $r->all();
        if (empty($payload)) {
            $raw = $r->getContent();
            $payload = !empty($raw) ? (json_decode($raw, true) ?: $raw) : $r->query();
        }

        $sourceIp = $r->ip();
        $result = $svc->handleWebhook($token, $payload, $sourceIp);

        return response()->json($result);
    }
}
