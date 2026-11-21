<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, Hash};
use Illuminate\Support\Str;

class UserController extends Controller
{
    public static function getUserFolder(User $user): string
    {
        $base = Str::slug($user->name ?: explode('@', $user->email)[0]);
        if (empty($base)) {
            $base = "user_{$user->id}";
        }
        return $base;
    }

    public static function ensureUserSubfolder(User $user): string
    {
        $root = config('pgmanager.root') ?: base_path('../../');
        $folderName = self::getUserFolder($user);
        $userDir = rtrim($root, '/') . '/projects/' . $folderName;
        if (!is_dir($userDir)) {
            @mkdir($userDir, 0775, true);
            @file_put_contents($userDir . '/.gitkeep', '');
        }
        return $folderName;
    }

    public function index()
    {
        $users = User::select('id', 'name', 'email', 'role', 'created_at')
            ->orderBy('id')
            ->get()
            ->map(function ($u) {
                $folder = self::ensureUserSubfolder($u);
                $root = config('pgmanager.root') ?: base_path('../../');
                $userDir = rtrim($root, '/') . '/projects/' . $folder;
                $projectCount = DB::table('projects')->where('created_by', $u->id)->count();

                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'role' => $u->role,
                    'is_super_admin' => $u->isSuperAdmin(),
                    'subfolder' => 'projects/' . $folder,
                    'subfolder_exists' => is_dir($userDir),
                    'project_count' => $projectCount,
                    'created_at' => $u->created_at?->format('Y-m-d H:i'),
                ];
            });

        return response()->json($users);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'name' => 'required|string|max:100',
            'email' => 'required|email|max:150|unique:users,email',
            'password' => 'required|string|min:8',
            'role' => 'required|in:user,admin',
        ]);

        $user = User::create([
            'name' => $d['name'],
            'email' => $d['email'],
            'password' => Hash::make($d['password']),
            'role' => $d['role'],
        ]);

        $folder = self::ensureUserSubfolder($user);

        Audit::log('user.create', $user->email, 'ok', [
            'role' => $user->role,
            'subfolder' => 'projects/' . $folder
        ]);

        return response()->json([
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'is_super_admin' => $user->isSuperAdmin(),
            'subfolder' => 'projects/' . $folder,
            'message' => 'Pengguna baru berhasil didaftarkan dan subfolder workspace berhasil dibuat.',
        ], 201);
    }

    public function destroy(int $id)
    {
        $currentUser = auth()->user();
        if ($currentUser && $currentUser->id === $id) {
            return response()->json(['message' => 'Tidak dapat menghapus akun Anda sendiri.'], 422);
        }

        $target = User::find($id);
        if (!$target) {
            abort(404, 'Pengguna tidak ditemukan.');
        }

        if ($target->email === 'nnaufalasyam7@gmail.com') {
            abort(403, 'Akun Super Admin utama tidak dapat dihapus.');
        }

        $email = $target->email;
        $target->delete();

        Audit::log('user.delete', $email, 'ok');

        return response()->json(['message' => "Pengguna '{$email}' berhasil dihapus."]);
    }
}
