<?php
namespace App\Services;

use Illuminate\Support\Facades\{DB, Crypt};
use App\Services\Audit;

class DeploymentService
{
    protected string $root;

    public function __construct()
    {
        $this->root = rtrim(config('pgmanager.root') ?: base_path('../../'), '/');
    }

    /**
     * Get system IP addresses (LAN, Tailscale, Localhost).
     */
    public function getSystemIps(): array
    {
        $lan = trim((string)@shell_exec("hostname -I 2>/dev/null | awk '{print $1}'")) ?: '127.0.0.1';
        $tailscale = trim((string)@shell_exec("tailscale ip -4 2>/dev/null | head -1")) ?: null;

        return [
            'lan' => $lan,
            'tailscale' => $tailscale,
            'local' => '127.0.0.1',
        ];
    }

    /**
     * Find an available port, default starting from 8200 up to 8300.
     */
    public function allocatePort(?int $preferredPort = null, ?int $excludeProjectId = null): int
    {
        if ($preferredPort && $preferredPort >= 1024 && $preferredPort <= 65535) {
            if ($this->isPortAvailable($preferredPort, $excludeProjectId)) {
                return $preferredPort;
            }
        }

        for ($p = 8200; $p <= 8300; $p++) {
            if ($this->isPortAvailable($p, $excludeProjectId)) {
                return $p;
            }
        }

        // Fallback
        return rand(8301, 8999);
    }

    /**
     * Check if a port is not in use by DB projects or system processes.
     */
    public function isPortAvailable(int $port, ?int $excludeProjectId = null): bool
    {
        $q = DB::table('projects')->where('deploy_port', $port)->where('deploy_status', 'running');
        if ($excludeProjectId) {
            $q->where('id', '!=', $excludeProjectId);
        }
        if ($q->exists()) {
            return false;
        }

        // Test TCP connection
        $fp = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.2);
        if ($fp) {
            fclose($fp);
            return false; // Port is occupied
        }

        return true;
    }

    /**
     * Check if a process is still alive.
     */
    public function isProcessAlive(?int $pid): bool
    {
        if (!$pid || $pid <= 0) return false;
        if (function_exists('posix_kill')) {
            return @posix_kill($pid, 0);
        }
        $out = trim((string)@shell_exec("kill -0 {$pid} 2>&1"));
        return empty($out);
    }

    /**
     * Check if a port is currently listening.
     */
    public function isPortListening(int $port): bool
    {
        $fp = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.3);
        if ($fp) {
            fclose($fp);
            return true;
        }
        return false;
    }

    /**
     * Detect possible launch configurations for a project.
     */
    public function detectLaunchConfig(object $project): array
    {
        $options = [];
        $repoName = $project->repository ?? null;
        $repoDir = $repoName ? "{$this->root}/repositories/{$repoName}" : null;

        // Option 1: Built-in High Performance Database REST API & Web Explorer
        $builtinScript = "{$this->root}/app/backend/deploy-runners/db_api_server.php";
        if (!file_exists($builtinScript)) {
            $builtinScript = "{$this->root}/app/backend-overlay/deploy-runners/db_api_server.php";
        }
        $options[] = [
            'id' => 'builtin_api',
            'name' => 'Built-in PostgreSQL REST API & Database Explorer',
            'command' => "php -S 0.0.0.0:{PORT} {$builtinScript}",
            'dir' => !empty($project->directory) ? $project->directory : "{$this->root}/projects/{$project->slug}",
            'description' => 'Layanan RESTful API otomatis (GET/POST/PUT/DELETE) dan web browser penjelajah data langsung untuk database ini tanpa konfigurasi tambahan.',
            'recommended' => empty($repoDir) || !is_dir($repoDir),
        ];

        // Inspect Repository if linked
        if ($repoDir && is_dir($repoDir)) {
            // Check for Python / FastAPI / Uvicorn
            $pyFiles = [
                'smartroom-pi/backend/main.py' => 'smartroom-pi/backend',
                'backend/main.py' => 'backend',
                'main.py' => '.',
                'app.py' => '.',
                'server.py' => '.',
            ];

            foreach ($pyFiles as $file => $relDir) {
                if (file_exists("{$repoDir}/{$file}")) {
                    $workDir = "{$repoDir}/{$relDir}";
                    $venvPython = null;
                    // Check venv locations
                    $searchVenvs = [
                        "{$repoDir}/smartroom-pi/smartroom-pi/.venv/bin/uvicorn",
                        "{$repoDir}/smartroom-pi/.venv/bin/uvicorn",
                        "{$repoDir}/.venv/bin/uvicorn",
                        dirname($this->root) . "/Database/tubes_semester5/smartroom-pi/smartroom-pi/.venv/bin/uvicorn",
                        dirname($this->root) . "/.venv/bin/uvicorn",
                    ];
                    foreach ($searchVenvs as $v) {
                        if (file_exists($v)) {
                            $venvPython = $v;
                            break;
                        }
                    }

                    $cmd = $venvPython 
                        ? "{$venvPython} main:app --host 0.0.0.0 --port {PORT}"
                        : "python3 -m uvicorn main:app --host 0.0.0.0 --port {PORT} 2>/dev/null || python3 main.py";

                    $options[] = [
                        'id' => 'python_app',
                        'name' => "Python Web / API App ({$file})",
                        'command' => $cmd,
                        'dir' => $workDir,
                        'description' => "Aplikasi Python / FastAPI yang terdeteksi di {$file}.",
                        'recommended' => true,
                    ];
                    break;
                }
            }

            // Check for bash run.sh
            $shFiles = [
                'smartroom-pi/smartroom-pi/run.sh' => 'smartroom-pi/smartroom-pi',
                'smartroom-pi/run.sh' => 'smartroom-pi',
                'run.sh' => '.',
                'deploy.sh' => '.',
                'start.sh' => '.',
            ];

            foreach ($shFiles as $file => $relDir) {
                if (file_exists("{$repoDir}/{$file}")) {
                    $options[] = [
                        'id' => 'script_runner',
                        'name' => "Shell Script Runner ({$file})",
                        'command' => "bash {$file} start 2>/dev/null || bash {$file}",
                        'dir' => "{$repoDir}/{$relDir}",
                        'description' => "Skrip peluncur otomatis yang terdeteksi di repository: {$file}.",
                        'recommended' => false,
                    ];
                    break;
                }
            }

            // Check for Node.js package.json
            if (file_exists("{$repoDir}/package.json")) {
                $options[] = [
                    'id' => 'node_app',
                    'name' => 'Node.js Web App (package.json)',
                    'command' => 'npm start',
                    'dir' => $repoDir,
                    'description' => 'Aplikasi Node.js / Express yang terdeteksi di repository.',
                    'recommended' => false,
                ];
            }
        }

        return $options;
    }

    /**
     * Get live deployment status and URLs for a project.
     */
    public function getStatus(int $projectId): array
    {
        $project = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->where('projects.id', $projectId)
            ->select('projects.*', 'd.db_name', 'd.db_user')
            ->first();

        if (!$project) {
            abort(404, 'Proyek tidak ditemukan.');
        }

        $port = (int)($project->deploy_port ?: 0);
        $pid = (int)($project->deploy_pid ?: 0);
        $isAlive = $this->isProcessAlive($pid);
        $isListening = $port > 0 ? $this->isPortListening($port) : false;

        $status = $project->deploy_status ?: 'stopped';

        // Reconcile status with real system state
        if ($status === 'running') {
            if (!$isAlive && !$isListening) {
                $status = 'stopped';
                DB::table('projects')->where('id', $projectId)->update([
                    'deploy_status' => 'stopped',
                    'deploy_pid' => null,
                    'updated_at' => now(),
                ]);
            }
        } elseif ($status === 'stopped' && $isListening && $isAlive) {
            $status = 'running';
            DB::table('projects')->where('id', $projectId)->update([
                'deploy_status' => 'running',
                'updated_at' => now(),
            ]);
        }

        $ips = $this->getSystemIps();
        $urls = [];
        if ($port > 0) {
            $urls = [
                'lan' => "http://{$ips['lan']}:{$port}",
                'tailscale' => $ips['tailscale'] ? "http://{$ips['tailscale']}:{$port}" : null,
                'local' => "http://127.0.0.1:{$port}",
            ];
        }

        // Process uptime and memory
        $uptime = null;
        $memory = null;
        if ($isAlive && $pid > 0) {
            $stat = @shell_exec("ps -o etime=,rss= -p {$pid} 2>/dev/null");
            if ($stat) {
                $parts = preg_split('/\s+/', trim($stat));
                $uptime = $parts[0] ?? null;
                if (isset($parts[1])) {
                    $memory = round(((int)$parts[1]) / 1024, 1) . ' MB';
                }
            }
        }

        return [
            'project_id' => $projectId,
            'name' => $project->name,
            'slug' => $project->slug,
            'db_name' => $project->db_name,
            'repository' => $project->repository,
            'deploy_status' => $status,
            'deploy_port' => $port,
            'deploy_type' => $project->deploy_type ?: 'auto',
            'deploy_command' => $project->deploy_command,
            'deploy_dir' => $project->deploy_dir,
            'deploy_pid' => $isAlive ? $pid : null,
            'auto_deploy' => (bool)$project->auto_deploy,
            'deployed_at' => $project->deployed_at,
            'deploy_error' => $project->deploy_error,
            'is_alive' => $isAlive,
            'is_listening' => $isListening,
            'urls' => $urls,
            'system_ips' => $ips,
            'uptime' => $uptime,
            'memory' => $memory,
            'detected_configs' => $this->detectLaunchConfig($project),
        ];
    }

    /**
     * Deploy or Redeploy a database project.
     */
    public function deploy(int $projectId, array $options = []): array
    {
        $project = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->join('database_connections as c', 'c.project_id', '=', 'projects.id')
            ->where('projects.id', $projectId)
            ->select('projects.*', 'd.db_name', 'd.db_user', 'c.host', 'c.port', 'c.password_encrypted')
            ->first();

        if (!$project) {
            abort(404, 'Proyek tidak ditemukan.');
        }

        $slug = $project->slug;
        $projectDir = !empty($project->directory) ? $project->directory : "{$this->root}/projects/{$slug}";
        if (!is_dir($projectDir)) {
            mkdir($projectDir, 0755, true);
        }
        $logDir = "{$projectDir}/logs";
        if (!is_dir($logDir)) {
            mkdir($logDir, 0755, true);
        }
        $logFile = "{$logDir}/deploy.log";

        // Stop any old process
        $this->stop($projectId);

        // Determine Port
        $port = (int)($options['port'] ?? $project->deploy_port ?: 0);
        if ($port <= 0 || !$this->isPortAvailable($port, $projectId)) {
            $port = $this->allocatePort($port ?: null, $projectId);
        }

        // Determine Deploy Type and Command
        $deployType = $options['deploy_type'] ?? $project->deploy_type ?: 'auto';
        $command = trim((string)($options['deploy_command'] ?? $project->deploy_command ?? ''));
        $workDir = trim((string)($options['deploy_dir'] ?? $project->deploy_dir ?? ''));

        // If no explicit command, auto-detect
        if (empty($command) || $deployType === 'auto') {
            $configs = $this->detectLaunchConfig($project);
            $chosen = null;
            foreach ($configs as $cfg) {
                if ($cfg['recommended']) {
                    $chosen = $cfg;
                    break;
                }
            }
            if (!$chosen) {
                $chosen = $configs[0] ?? null;
            }

            if ($chosen) {
                $command = $chosen['command'];
                $workDir = $chosen['dir'];
                $deployType = $chosen['id'];
            }
        }

        // Fallback command: Built-in DB REST API Runner
        if (empty($command)) {
            $builtinScript = "{$this->root}/app/backend/deploy-runners/db_api_server.php";
            if (!file_exists($builtinScript)) {
                $builtinScript = "{$this->root}/app/backend-overlay/deploy-runners/db_api_server.php";
            }
            $command = "php -S 0.0.0.0:{PORT} {$builtinScript}";
            $workDir = $projectDir;
            $deployType = 'builtin_api';
        }

        // Replace {PORT} in command
        $actualCommand = str_replace('{PORT}', (string)$port, $command);

        // Decrypt DB password
        $dbPassword = Crypt::decryptString($project->password_encrypted);

        // Update project .env
        $envContent = "DB_HOST={$project->host}\n"
            . "DB_PORT={$project->port}\n"
            . "DB_DATABASE={$project->db_name}\n"
            . "DB_NAME={$project->db_name}\n"
            . "DB_USERNAME={$project->db_user}\n"
            . "DB_USER={$project->db_user}\n"
            . "DB_PASSWORD={$dbPassword}\n"
            . "PORT={$port}\n"
            . "HTTP_PORT={$port}\n"
            . "HOST=0.0.0.0\n"
            . "PROJECT_NAME=" . escapeshellarg($project->name) . "\n"
            . "PROJECT_SLUG={$slug}\n";

        if (!is_dir("{$projectDir}/config")) {
            mkdir("{$projectDir}/config", 0755, true);
        }
        file_put_contents("{$projectDir}/config/.env", $envContent);
        @chmod("{$projectDir}/config/.env", 0600);

        // Also if repository exists, keep its config in sync if config.env exists
        if ($project->repository) {
            $repoDir = "{$this->root}/repositories/{$project->repository}";
            $repoConfigEnv = "{$repoDir}/smartroom-pi/smartroom-pi/config.env";
            if (file_exists($repoConfigEnv)) {
                // Keep HTTP_PORT and DB details aligned
                $cfg = @file_get_contents($repoConfigEnv);
                if ($cfg) {
                    $cfg = preg_replace('/^HTTP_PORT=.*/m', "HTTP_PORT={$port}", $cfg);
                    $cfg = preg_replace('/^DB_PORT=.*/m', "DB_PORT={$project->port}", $cfg);
                    $cfg = preg_replace('/^DB_NAME=.*/m', "DB_NAME={$project->db_name}", $cfg);
                    $cfg = preg_replace('/^DB_USER=.*/m', "DB_USER={$project->db_user}", $cfg);
                    $cfg = preg_replace('/^DB_PASSWORD=.*/m', "DB_PASSWORD={$dbPassword}", $cfg);
                    @file_put_contents($repoConfigEnv, $cfg);
                }
            }
        }

        // Generate shell launcher script for isolated and safe execution
        $launcherScript = "{$projectDir}/run_deploy.sh";
        $header = "#!/usr/bin/env bash\n"
            . "set -a\n"
            . "source " . escapeshellarg("{$projectDir}/config/.env") . "\n"
            . "set +a\n"
            . "cd " . escapeshellarg($workDir ?: $projectDir) . " || exit 1\n"
            . "exec " . $actualCommand . "\n";

        @unlink($launcherScript);
        file_put_contents($launcherScript, $header);
        @chmod($launcherScript, 0755);

        // Clear or append to log
        $stamp = date('Y-m-d H:i:s');
        $initLog = "=======================================================\n"
            . "[{$stamp}] AUTO DEPLOY: {$project->name} ({$slug})\n"
            . "Port: {$port} | Type: {$deployType}\n"
            . "Directory: {$workDir}\n"
            . "Command: {$actualCommand}\n"
            . "=======================================================\n";
        file_put_contents($logFile, $initLog, FILE_APPEND);

        // Execute background process using setsid & nohup
        $cmd = "setsid nohup bash " . escapeshellarg($launcherScript) . " >> " . escapeshellarg($logFile) . " 2>&1 & echo $!";
        $pid = (int)trim((string)@shell_exec($cmd));

        file_put_contents("{$projectDir}/deploy.pid", (string)$pid);

        // Wait a moment to verify process starts
        usleep(1200000); // 1.2s

        $isAlive = $this->isProcessAlive($pid);
        $isListening = $this->isPortListening($port);

        $status = ($isAlive || $isListening) ? 'running' : 'failed';
        $error = null;
        if ($status === 'failed') {
            $error = 'Proses deploy keluar lebih awal. Silakan periksa tab Log Deployment.';
        }

        DB::table('projects')->where('id', $projectId)->update([
            'deploy_port' => $port,
            'deploy_status' => $status,
            'deploy_type' => $deployType,
            'deploy_command' => $command,
            'deploy_dir' => $workDir,
            'deploy_pid' => $isAlive ? $pid : null,
            'auto_deploy' => isset($options['auto_deploy']) ? (bool)$options['auto_deploy'] : (bool)$project->auto_deploy,
            'deployed_at' => now(),
            'deploy_error' => $error,
            'updated_at' => now(),
        ]);

        DB::table('database_operations')->insert([
            'project_id' => $projectId,
            'operation' => 'deploy',
            'status' => $status === 'running' ? 'ok' : 'failed',
            'details' => json_encode([
                'port' => $port,
                'pid' => $pid,
                'type' => $deployType,
                'command' => $actualCommand,
                'is_listening' => $isListening,
            ]),
            'user_id' => auth()->id(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Audit::log('project.deploy', $slug, $status === 'running' ? 'ok' : 'failed', [
            'port' => $port,
            'type' => $deployType,
        ]);

        return $this->getStatus($projectId);
    }

    /**
     * Stop a running deployment.
     */
    public function stop(int $projectId): array
    {
        $project = DB::table('projects')->where('id', $projectId)->first();
        if (!$project) {
            abort(404, 'Proyek tidak ditemukan.');
        }

        $pid = (int)($project->deploy_pid ?: 0);
        $port = (int)($project->deploy_port ?: 0);

        // Kill process and process group
        if ($pid > 0) {
            @shell_exec("kill -TERM -{$pid} 2>/dev/null || kill -TERM {$pid} 2>/dev/null || kill -9 {$pid} 2>/dev/null");
        }

        // Also check if port is still bound by PID
        if ($port > 0) {
            @shell_exec("fuser -k -9 {$port}/tcp 2>/dev/null");
        }

        // Clean PID file
        $projectDir = !empty($project->directory) ? $project->directory : "{$this->root}/projects/{$project->slug}";
        $pidFile = "{$projectDir}/deploy.pid";
        if (file_exists($pidFile)) {
            @unlink($pidFile);
        }

        DB::table('projects')->where('id', $projectId)->update([
            'deploy_status' => 'stopped',
            'deploy_pid' => null,
            'updated_at' => now(),
        ]);

        DB::table('database_operations')->insert([
            'project_id' => $projectId,
            'operation' => 'deploy_stop',
            'status' => 'ok',
            'details' => json_encode(['port' => $port, 'pid' => $pid]),
            'user_id' => auth()->id(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Audit::log('project.deploy_stop', $project->slug, 'ok', ['port' => $port]);

        return $this->getStatus($projectId);
    }

    /**
     * Restart a deployment.
     */
    public function restart(int $projectId): array
    {
        $this->stop($projectId);
        usleep(500000); // 0.5s
        return $this->deploy($projectId);
    }

    /**
     * Read the last lines from the deployment log.
     */
    public function getLogs(int $projectId, int $lines = 100): array
    {
        $project = DB::table('projects')->where('id', $projectId)->first();
        if (!$project) {
            abort(404, 'Proyek tidak ditemukan.');
        }

        $projectDir = !empty($project->directory) ? $project->directory : "{$this->root}/projects/{$project->slug}";
        $logFile = "{$projectDir}/logs/deploy.log";
        if (!file_exists($logFile)) {
            return [
                'project_id' => $projectId,
                'lines' => [],
                'content' => 'Belum ada log deployment untuk proyek ini.',
            ];
        }

        $lines = max(10, min(1000, $lines));
        $content = (string)@shell_exec("tail -n {$lines} " . escapeshellarg($logFile));

        return [
            'project_id' => $projectId,
            'lines' => explode("\n", trim($content)),
            'content' => $content,
        ];
    }

    /**
     * Update deployment configuration settings.
     */
    public function updateSettings(int $projectId, array $data): array
    {
        $project = DB::table('projects')->where('id', $projectId)->first();
        if (!$project) {
            abort(404, 'Proyek tidak ditemukan.');
        }

        $updates = ['updated_at' => now()];

        if (array_key_exists('deploy_port', $data) && $data['deploy_port']) {
            $p = (int)$data['deploy_port'];
            if ($p >= 1024 && $p <= 65535) {
                $updates['deploy_port'] = $p;
            }
        }

        if (array_key_exists('deploy_type', $data)) {
            $updates['deploy_type'] = $data['deploy_type'];
        }

        if (array_key_exists('deploy_command', $data)) {
            $updates['deploy_command'] = $data['deploy_command'] ? trim($data['deploy_command']) : null;
        }

        if (array_key_exists('deploy_dir', $data)) {
            $updates['deploy_dir'] = $data['deploy_dir'] ? trim($data['deploy_dir']) : null;
        }

        if (array_key_exists('auto_deploy', $data)) {
            $updates['auto_deploy'] = (bool)$data['auto_deploy'];
        }

        DB::table('projects')->where('id', $projectId)->update($updates);

        Audit::log('project.deploy_settings', $project->slug, 'ok', $updates);

        return $this->getStatus($projectId);
    }

    /**
     * Get deployment statuses for all projects across the system.
     */
    public function getAllDeployments(): array
    {
        $projects = DB::table('projects')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->select('projects.id')
            ->orderBy('projects.name')
            ->get();

        $list = [];
        foreach ($projects as $p) {
            $list[] = $this->getStatus($p->id);
        }

        return $list;
    }
}
