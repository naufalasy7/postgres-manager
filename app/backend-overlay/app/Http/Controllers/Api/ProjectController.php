<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Services\{Audit, ProvisioningService};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ProjectController extends Controller {
    public function index(Request $r) {
        $q = DB::table('projects')->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->select('projects.id','projects.name','projects.slug','projects.status','projects.directory','projects.created_at','d.db_name','d.db_user')
            ->orderByDesc('projects.id');
        if ($s = $r->query('search')) $q->where(fn($w) => $w->where('projects.name', 'ilike', "%$s%")->orWhere('projects.slug', 'ilike', "%$s%"));
        if ($st = $r->query('status')) $q->where('projects.status', $st);
        return $q->get();
    }
    public function store(Request $r, ProvisioningService $svc) {
        $res = config('pgmanager.reserved');
        $d = $r->validate([
            'name' => 'required|string|max:100',
            'slug' => ['required', 'regex:/^[a-z][a-z0-9-]{2,40}$/', 'unique:projects,slug'],
            'description' => 'nullable|string|max:500',
            'db_name' => ['required', 'regex:/^[a-z][a-z0-9_]{2,40}$/', Rule::notIn($res)],
            'db_user' => ['required', 'regex:/^[a-z][a-z0-9_]{2,40}$/', Rule::notIn($res)],
            'encoding' => 'required|in:UTF8', 'locale' => 'required|in:C,C.UTF-8,en_US.UTF-8',
            'template_id' => 'required|exists:database_templates,id', 'backup_policy' => 'required|in:none,daily,weekly',
        ]);
        try { return response()->json($svc->create($d), 201); }
        catch (\RuntimeException $e) { return response()->json(['message' => $e->getMessage()], 422); }
    }
    public function archive(int $id) {
        DB::table('projects')->where('id', $id)->update(['status' => 'archived', 'updated_at' => now()]);
        Audit::log('project.archive', (string)$id); return response()->noContent();
    }
    public function templates() { return DB::table('database_templates')->select('id', 'name', 'description')->get(); }
    public function audit() { return DB::table('audit_logs')->orderByDesc('id')->limit(200)->get(); }
}
