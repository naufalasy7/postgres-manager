<?php
use App\Http\Controllers\Api\{AuthController, DashboardController, ProjectController, BackupController};
use App\Http\Middleware\EnsureAdmin;
use Illuminate\Support\Facades\Route;

Route::prefix('api')->group(function () {
    Route::get('csrf', fn() => response()->noContent());
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:5,1');
    Route::middleware(['auth', EnsureAdmin::class])->group(function () {
        Route::post('logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);
        Route::get('dashboard', DashboardController::class);
        Route::get('projects', [ProjectController::class, 'index']);
        Route::post('projects', [ProjectController::class, 'store']);
        Route::post('projects/{id}/archive', [ProjectController::class, 'archive']);
        Route::get('templates', [ProjectController::class, 'templates']);
        Route::get('audit', [ProjectController::class, 'audit']);
        Route::get('projects/{id}/backups', [BackupController::class, 'index']);
        Route::post('projects/{id}/backups', [BackupController::class, 'store']);
        Route::get('backups/{id}/download', [BackupController::class, 'download']);
    });
});
