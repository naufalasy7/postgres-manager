<?php
use App\Http\Controllers\Api\{
    AuthController,
    DashboardController,
    ProjectController,
    BackupController,
    RepositoryController,
    DeploymentController,
    UserController,
    IntegrationController,
    TableController
};
use App\Http\Middleware\{EnsureAdmin, EnsureSuperAdmin};
use Illuminate\Support\Facades\Route;

Route::prefix('api')->group(function () {
    Route::get('csrf', fn() => response()->noContent());
    Route::get('ping', fn() => response()->json(['status' => 'ok', 'app' => 'Postgres Manager']));
    Route::post('login', [AuthController::class, 'login'])->middleware('throttle:30,1');

    // Public IoT Telemetry Webhook (Blynk Webhooks / Zenoh / HTTP IoT)
    Route::match(['get', 'post'], 'integrations/webhook/{token}', [IntegrationController::class, 'webhook']);
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
        Route::get('repositories/{repo}/schema-preview', [RepositoryController::class, 'schemaPreview']);
        Route::post('repositories/{repo}/init-db', [RepositoryController::class, 'initDatabase']);
        Route::post('repositories/{repo}/link-db', [RepositoryController::class, 'linkDatabase']);
        Route::post('repositories/{repo}/unlink-db', [RepositoryController::class, 'unlinkDatabase']);
        Route::post('repositories/{repo}/sync-env', [RepositoryController::class, 'syncEnv']);
        Route::post('repositories/{repo}/apply-schema', [RepositoryController::class, 'applySchema']);

        // Auto-Deployment & Service Access API
        Route::get('deployments', [DeploymentController::class, 'index']);
        Route::get('projects/{id}/deploy', [DeploymentController::class, 'show']);
        Route::post('projects/{id}/deploy', [DeploymentController::class, 'deploy']);
        Route::post('projects/{id}/deploy/stop', [DeploymentController::class, 'stop']);
        Route::post('projects/{id}/deploy/restart', [DeploymentController::class, 'restart']);
        Route::get('projects/{id}/deploy/logs', [DeploymentController::class, 'logs']);
        Route::put('projects/{id}/deploy/settings', [DeploymentController::class, 'updateSettings']);

        // Platform & IoT Connectors API (Blynk, Zenoh, MQTT)
        Route::get('integrations', [IntegrationController::class, 'index']);
        Route::post('integrations', [IntegrationController::class, 'store']);
        Route::get('integrations/{id}', [IntegrationController::class, 'show']);
        Route::put('integrations/{id}', [IntegrationController::class, 'update']);
        Route::delete('integrations/{id}', [IntegrationController::class, 'destroy']);
        Route::post('integrations/test', [IntegrationController::class, 'testConnection']);
        Route::post('integrations/{id}/sync', [IntegrationController::class, 'syncNow']);
        Route::post('integrations/{id}/start', [IntegrationController::class, 'start']);
        Route::post('integrations/{id}/stop', [IntegrationController::class, 'stop']);
        Route::get('integrations/{id}/logs', [IntegrationController::class, 'logs']);
        Route::post('integrations/{id}/regenerate-token', [IntegrationController::class, 'regenerateToken']);
        Route::post('projects/{id}/init-iot-table', [IntegrationController::class, 'initIotTable']);

        // Database Explorer & Visual Table Builder API
        Route::get('projects/{id}/tables', [TableController::class, 'index']);
        Route::post('projects/{id}/tables', [TableController::class, 'store']);
        Route::get('projects/{id}/tables/{table}/rows', [TableController::class, 'browse']);
        Route::post('projects/{id}/tables/{table}/rows', [TableController::class, 'insertRow']);
        Route::put('projects/{id}/tables/{table}/rows', [TableController::class, 'updateRow']);
        Route::delete('projects/{id}/tables/{table}/rows', [TableController::class, 'deleteRow']);
        Route::put('projects/{id}/tables/{table}', [TableController::class, 'update']);
        Route::delete('projects/{id}/tables/{table}', [TableController::class, 'destroy']);
        Route::get('projects/{id}/tables/{table}/csv', [TableController::class, 'downloadCsv']);
        Route::get('projects/{id}/database/export', [TableController::class, 'downloadDatabaseZip']);

        // Super Admin Only: Full Audit Logs & User Management
        Route::middleware([EnsureSuperAdmin::class])->group(function () {
            Route::get('audit', [ProjectController::class, 'audit']);
            Route::get('users', [UserController::class, 'index']);
            Route::post('users', [UserController::class, 'store']);
            Route::put('users/{id}', [UserController::class, 'update']);
            Route::delete('users/{id}', [UserController::class, 'destroy']);
        });
    });
});
