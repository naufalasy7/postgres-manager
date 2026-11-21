<?php
use App\Http\Controllers\Api\{
    AuthController,
    DashboardController,
    ProjectController,
    BackupController,
    RepositoryController,
    DeploymentController,
    UserController
};
use App\Http\Middleware\{EnsureAdmin, EnsureSuperAdmin};
use Illuminate\Support\Facades\Route;

Route::prefix('api')->group(function () {
    Route::get('csrf', fn() => response()->noContent());
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::middleware(['auth', EnsureAdmin::class])->group(function () {
        Route::post('logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);
        Route::get('dashboard', DashboardController::class);
        Route::get('projects', [ProjectController::class, 'index']);
        Route::post('projects', [ProjectController::class, 'store']);
        Route::post('projects/{id}/archive', [ProjectController::class, 'archive']);
        Route::post('projects/{id}/link-repo', [ProjectController::class, 'linkRepo']);
        Route::post('projects/{id}/execute-script', [ProjectController::class, 'executeScript']);
        Route::get('templates', [ProjectController::class, 'templates']);
        Route::get('projects/{id}/backups', [BackupController::class, 'index']);
        Route::post('projects/{id}/backups', [BackupController::class, 'store']);
        Route::get('backups/{id}/download', [BackupController::class, 'download']);

        // Git-like Repositories API
        Route::get('repositories', [RepositoryController::class, 'index']);
        Route::post('repositories', [RepositoryController::class, 'store']);
        Route::get('repositories/{repo}/tree', [RepositoryController::class, 'tree']);
        Route::get('repositories/{repo}/blob', [RepositoryController::class, 'blob']);
        Route::get('repositories/{repo}/raw', [RepositoryController::class, 'raw']);
        Route::get('repositories/{repo}/zip', [RepositoryController::class, 'zip']);
        Route::get('repositories/{repo}/sql-scripts', [RepositoryController::class, 'sqlScripts']);
        Route::post('repositories/{repo}/upload', [RepositoryController::class, 'upload']);
        Route::post('repositories/{repo}/save-file', [RepositoryController::class, 'saveFile']);
        Route::delete('repositories/{repo}/delete-file', [RepositoryController::class, 'deleteFile']);
        Route::get('repositories/{repo}/commits', [RepositoryController::class, 'commits']);

        // Auto-Deployment & Service Access API
        Route::get('deployments', [DeploymentController::class, 'index']);
        Route::get('projects/{id}/deploy', [DeploymentController::class, 'show']);
        Route::post('projects/{id}/deploy', [DeploymentController::class, 'deploy']);
        Route::post('projects/{id}/deploy/stop', [DeploymentController::class, 'stop']);
        Route::post('projects/{id}/deploy/restart', [DeploymentController::class, 'restart']);
        Route::get('projects/{id}/deploy/logs', [DeploymentController::class, 'logs']);
        Route::put('projects/{id}/deploy/settings', [DeploymentController::class, 'updateSettings']);

        // Super Admin Only: Full Audit Logs & User Management
        Route::middleware([EnsureSuperAdmin::class])->group(function () {
            Route::get('audit', [ProjectController::class, 'audit']);
            Route::get('users', [UserController::class, 'index']);
            Route::post('users', [UserController::class, 'store']);
            Route::delete('users/{id}', [UserController::class, 'destroy']);
        });
    });
});
