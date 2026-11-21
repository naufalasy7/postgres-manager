<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AuthController extends Controller
{
    public function login(Request $r)
    {
        $c = $r->validate([
            'email' => 'required|email',
            'password' => 'required|string'
        ]);

        if (!Auth::attempt($c)) {
            Audit::log('login', $c['email'], 'failed');
            return response()->json(['message' => 'Kredensial salah'], 422);
        }

        $user = Auth::user();

        // Promote primary admin email to super_admin automatically
        if ($user->email === 'nnaufalasyam7@gmail.com' && $user->role !== 'super_admin') {
            $user->role = 'super_admin';
            $user->save();
        }

        $r->session()->regenerate();
        Audit::log('login', $c['email']);

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'is_super_admin' => $user->isSuperAdmin(),
        ];
    }

    public function logout(Request $r)
    {
        Audit::log('logout');
        Auth::logout();
        $r->session()->invalidate();
        $r->session()->regenerateToken();
        return response()->noContent();
    }

    public function me()
    {
        $user = auth()->user();
        if ($user && $user->email === 'nnaufalasyam7@gmail.com' && $user->role !== 'super_admin') {
            $user->role = 'super_admin';
            $user->save();
        }

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'is_super_admin' => $user->isSuperAdmin(),
        ];
    }
}
