<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Services\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AuthController extends Controller {
    public function login(Request $r) {
        $c = $r->validate(['email' => 'required|email', 'password' => 'required|string']);
        if (!Auth::attempt($c) || Auth::user()->role !== 'admin') {
            Auth::logout(); Audit::log('login', $c['email'], 'failed');
            return response()->json(['message' => 'Kredensial salah'], 422);
        }
        $r->session()->regenerate(); Audit::log('login', $c['email']);
        return ['email' => Auth::user()->email];
    }
    public function logout(Request $r) {
        Audit::log('logout'); Auth::logout(); $r->session()->invalidate(); $r->session()->regenerateToken();
        return response()->noContent();
    }
    public function me() { return ['email' => auth()->user()->email]; }
}
