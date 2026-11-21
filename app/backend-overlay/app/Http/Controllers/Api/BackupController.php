<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Services\Audit;
use Illuminate\Support\Facades\{DB, Crypt};
use Symfony\Component\Process\Process;

class BackupController extends Controller {
    public function index(int $id) { return DB::table('database_backups')->where('project_id', $id)->orderByDesc('id')->get(); }

    public function store(int $id) {
        $user = auth()->user();
        $p = DB::table('projects')->find($id) ?? abort(404);
        if (!$user->isSuperAdmin() && $p->created_by != $user->id) {
            abort(403, 'Akses ditolak: Hanya pemilik proyek atau Super Admin yang dapat membuat backup.');
        }

        $c = DB::table('database_connections')->where('project_id', $id)->first();
        $file = "{$p->directory}/backups/{$c->db_name}_".date('Ymd_His').'.dump';
        // argumen array: tanpa shell, tanpa input mentah dari browser
        $proc = new Process(['pg_dump', '-h', $c->host, '-p', (string)$c->port, '-U', $c->username, '-Fc', '-f', $file, $c->db_name],
            null, ['PGPASSWORD' => Crypt::decryptString($c->password_encrypted)]);
        $proc->setTimeout(1800)->run();
        $ok = $proc->isSuccessful() && is_file($file);
        if ($ok) chmod($file, 0600);
        $bid = DB::table('database_backups')->insertGetId(['project_id' => $id, 'type' => 'manual', 'file_path' => $file,
            'size_bytes' => $ok ? filesize($file) : 0, 'sha256' => $ok ? hash_file('sha256', $file) : null,
            'status' => $ok ? 'ok' : 'failed', 'error' => $ok ? null : substr($proc->getErrorOutput(), 0, 500),
            'created_by' => auth()->id(), 'created_at' => now(), 'updated_at' => now()]);
        Audit::log('backup.create', $p->slug, $ok ? 'ok' : 'failed');
        return response()->json(['id' => $bid, 'status' => $ok ? 'ok' : 'failed'], $ok ? 201 : 500);
    }

    public function download(int $id) {
        $b = DB::table('database_backups')->find($id) ?? abort(404);
        $root = realpath(config('pgmanager.root').'/projects'); $path = realpath($b->file_path);
        abort_unless($path && $root && str_starts_with($path, $root.DIRECTORY_SEPARATOR), 403);
        Audit::log('backup.download', (string)$id);
        return response()->download($path);
    }
}
