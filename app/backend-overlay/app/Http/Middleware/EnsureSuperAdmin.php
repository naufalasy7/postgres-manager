<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureSuperAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        abort_unless($user !== null, 401, 'Silakan login terlebih dahulu.');
        abort_unless($user->isSuperAdmin(), 403, 'Hanya Super Admin yang diizinkan mengakses fitur ini.');

        return $next($request);
    }
}
