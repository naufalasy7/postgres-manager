<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        abort_unless($user !== null, 401, 'Silakan login terlebih dahulu.');

        $allowedRoles = ['super_admin', 'admin', 'user'];
        abort_unless(in_array($user->role, $allowedRoles) || $user->isSuperAdmin(), 403, 'Akses ditolak.');

        return $next($request);
    }
}
