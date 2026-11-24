<?php
namespace App\Services;

use App\Models\User;
use App\Services\Audit;
use Illuminate\Support\Facades\{DB, Crypt, Schema};
use Illuminate\Support\Str;
use PDO;

class IntegrationService
{
    protected string $root;

    public function __construct()
    {
        $this->root = rtrim(config('pgmanager.root') ?: base_path('../../'), '/');
        $this->ensureTableExists();
    }

    /**
     * Ensure project_integrations table exists even if artisan migrate hasn't run yet.
     */
    public function ensureTableExists(): void
    {
        try {
            if (!Schema::hasTable('project_integrations')) {
                Schema::create('project_integrations', function ($t) {
                    $t->id();
                    $t->foreignId('project_id')->constrained('projects')->cascadeOnDelete();
                    $t->string('platform');
                    $t->string('name');
                    $t->text('url');
                    $t->text('token')->nullable();
                    $t->string('token_hash', 128)->nullable();
                    $t->string('username')->nullable();
                    $t->string('topic_or_key')->nullable();
                    $t->string('target_table')->default('iot_telemetry');
                    $t->jsonb('config')->nullable();
                    $t->string('status')->default('stopped');
                    $t->unsignedInteger('worker_pid')->nullable();
                    $t->string('webhook_token', 64)->unique();
                    $t->timestamp('last_sync_at')->nullable();
                    $t->unsignedBigInteger('packets_count')->default(0);
                    $t->text('last_error')->nullable();
                    $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                    $t->timestamps();
                });
            } else {
                if (!Schema::hasColumn('project_integrations', 'token_hash')) {
                    Schema::table('project_integrations', function ($t) {
                        $t->string('token_hash', 128)->nullable()->after('token');
                    });
                }
            }
        } catch (\Throwable $e) {
            // Ignore if already created
        }
    }

    /**
     * Get PDO connection for a specific project's database.
     */
    public function getProjectPdo(int $projectId): PDO
    {
        $conn = DB::table('database_connections')->where('project_id', $projectId)->first();
        if (!$conn) {
            throw new \RuntimeException('Koneksi database proyek tidak ditemukan.');
        }

        $password = Crypt::decryptString($conn->password_encrypted);
        return new PDO(
            "pgsql:host={$conn->host};port={$conn->port};dbname={$conn->db_name}",
            $conn->username,
            $password,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_TIMEOUT => 5,
            ]
        );
    }

    /**
     * Get integration log file path.
     */
    public function getLogFile(object $integration, object $project): string
    {
        $projectDir = !empty($project->directory) ? $project->directory : "{$this->root}/projects/{$project->slug}";
        $logDir = "{$projectDir}/logs";
        if (!is_dir($logDir)) {
            @mkdir($logDir, 0755, true);
        }
        return "{$logDir}/integration_{$integration->id}.log";
    }

    public function appendLog(object $integration, object $project, string $message): void
    {
        $logFile = $this->getLogFile($integration, $project);
        $time = date('Y-m-d H:i:s');
        @file_put_contents($logFile, "[{$time}] {$message}\n", FILE_APPEND);
    }

    /**
     * List integrations with role filtering.
     */
    public function listIntegrations(User $user): array
    {
        $isSuper = $user->isSuperAdmin();

        $query = DB::table('project_integrations as pi')
            ->join('projects as p', 'p.id', '=', 'pi.project_id')
            ->join('project_databases as d', 'd.project_id', '=', 'p.id')
            ->leftJoin('users as u', 'u.id', '=', 'pi.created_by')
            ->select(
                'pi.*',
                'p.name as project_name',
                'p.slug as project_slug',
                'p.created_by as project_owner_id',
                'd.db_name',
                'u.name as creator_name',
                'u.email as creator_email'
            )
            ->orderByDesc('pi.id');

        if (!$isSuper) {
            $query->where('p.created_by', $user->id);
        }

        $records = $query->get();

        return $records->map(function ($row) use ($isSuper, $user) {
            $isOwner = ($row->project_owner_id == $user->id);
            $row->is_owner = $isOwner;
            $row->can_manage = ($isSuper || $isOwner) && $user->role !== 'user';
            $row->config = is_string($row->config) ? json_decode($row->config, true) : ($row->config ?: []);

            // Check if worker process is still alive
            if ($row->status === 'running' && $row->worker_pid) {
                if (!app(DeploymentService::class)->isProcessAlive((int)$row->worker_pid)) {
                    $row->status = 'stopped';
                    DB::table('project_integrations')->where('id', $row->id)->update([
                        'status' => 'stopped',
                        'worker_pid' => null,
                        'updated_at' => now(),
                    ]);
                }
            }

            $row->token_hash = $row->token_hash ?: (!empty($row->token) ? hash('sha256', $row->token) : null);
            $row->snippets = $this->buildCodeSnippets($row);

            return $row;
        })->all();
    }

    /**
     * Build copyable code snippets for IoT devices (ESP32, Python, cURL).
     */
    public function buildCodeSnippets(object $integration): array
    {
        $token = $integration->token ?? '';
        $tokenHash = $integration->token_hash ?? (!empty($token) ? hash('sha256', $token) : '');
        $deviceId = !empty($integration->project_slug) ? $integration->project_slug : ('device-' . $integration->id);
        $webhookToken = $integration->webhook_token ?? '';
        $requestOrigin = request()?->getSchemeAndHttpHost() ?: 'http://100.94.76.81:8000';
        $webhookFullUrl = "{$requestOrigin}/api/integrations/webhook/{$webhookToken}";
        $hostIp = request()?->getHost() ?: '100.94.76.81';
        $topicData = !empty($integration->topic_or_key) ? $integration->topic_or_key : 'smartroom/data';
        $topicCmd = str_contains($topicData, 'data') ? str_replace('data', 'cmd', $topicData) : 'smartroom/cmd';

        $platform = strtolower($integration->platform ?? 'zenoh');

        if ($platform === 'zenoh') {
            $cpp = <<<CPP
#pragma once

// =====================================================================
//  Konfigurasi Koneksi ESP32 (Zenoh-Pico & Postgres Manager Smartroom)
//  Salin kode ini langsung ke: firmware/src/config.h pada program ESP32
// =====================================================================

// 1. Konfigurasi Wi-Fi
#define WIFI_SSID     "ISI_NAMA_WIFI"
#define WIFI_PASS     "ISI_PASSWORD_WIFI"

// 2. Zenoh Router Locator (Raspberry Pi Port 7447)
#define ZENOH_LOCATOR "tcp/{$hostIp}:7447"

// 3. Topic Zenoh (ESP32 <-> Smartroom)
#define TOPIC_DATA    "{$topicData}"
#define TOPIC_CMD     "{$topicCmd}"

// 4. Token & Identitas Perangkat (Ala Blynk)
#define AUTH_TOKEN    "{$token}"
#define DEVICE_ID     "{$deviceId}"
#define TOKEN_HASH    "{$tokenHash}"
CPP;
        } elseif ($platform === 'blynk') {
            $cpp = <<<CPP
#pragma once

// =====================================================================
//  Konfigurasi ESP32 Konektor Blynk IoT
//  Salin kode ini ke file konfigurasi program ESP32 Anda.
// =====================================================================
#define BLYNK_TEMPLATE_ID   "TMPL_PGM_IOT"
#define BLYNK_TEMPLATE_NAME "Postgres IoT"
#define BLYNK_AUTH_TOKEN    "{$token}"

#define WIFI_SSID           "ISI_NAMA_WIFI"
#define WIFI_PASS           "ISI_PASSWORD_WIFI"
#define DEVICE_ID           "{$deviceId}"
CPP;
        } else {
            $cpp = <<<CPP
#pragma once

// =====================================================================
//  Konfigurasi ESP32 Konektor MQTT Broker
//  Salin kode ini ke file konfigurasi program ESP32 Anda.
// =====================================================================
#define WIFI_SSID     "ISI_NAMA_WIFI"
#define WIFI_PASS     "ISI_PASSWORD_WIFI"

#define MQTT_BROKER   "{$hostIp}"
#define MQTT_PORT     1883
#define MQTT_TOPIC    "{$topicData}"
#define AUTH_TOKEN    "{$token}"
#define DEVICE_ID     "{$deviceId}"
CPP;
        }

        $python = <<<PYTHON
# =====================================================================
#  Pengirim Data Telemetri Python (Postgres Manager IoT Connector)
# =====================================================================
import requests
import json
import time

WEBHOOK_URL = "{$webhookFullUrl}"
AUTH_TOKEN = "{$token}"
DEVICE_ID = "{$deviceId}"

payload = {
    "device_id": DEVICE_ID,
    "token": AUTH_TOKEN,
    "temperature": 27.8,
    "humidity": 62.4,
    "gas": 450,
    "status": "online"
}

headers = {"Content-Type": "application/json"}

try:
    response = requests.post(WEBHOOK_URL, json=payload, headers=headers, timeout=5)
    print("Respon Server:", response.status_code, response.text)
except Exception as e:
    print("Gagal mengirim data:", e)
PYTHON;

        $curl = <<<BASH
# Kirim Telemetri IoT Langsung via cURL Terminal:
curl -X POST "{$webhookFullUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "device_id": "{$deviceId}",
    "token": "{$token}",
    "temperature": 28.5,
    "humidity": 65.0,
    "gas": 320,
    "status": "active"
  }'
BASH;

        return [
            'device_id' => $deviceId,
            'token' => $token,
            'token_hash' => $tokenHash,
            'webhook_url' => $webhookFullUrl,
            'zenoh_locator' => "tcp/{$hostIp}:7447",
            'cpp_config' => $cpp,
            'python_script' => $python,
            'curl_command' => $curl,
        ];
    }

    /**
     * Get single integration with access check.
     */
    public function getIntegration(int $id, User $user): object
    {
        $integration = DB::table('project_integrations as pi')
            ->join('projects as p', 'p.id', '=', 'pi.project_id')
            ->join('project_databases as d', 'd.project_id', '=', 'p.id')
            ->where('pi.id', $id)
            ->select('pi.*', 'p.name as project_name', 'p.slug as project_slug', 'p.directory as project_directory', 'p.created_by as project_owner_id', 'd.db_name')
            ->first();

        if (!$integration) {
            abort(404, 'Integrasi platform tidak ditemukan.');
        }

        if (!$user->isSuperAdmin() && $integration->project_owner_id != $user->id) {
            abort(403, 'Akses ditolak: Integrasi ini bukan milik proyek Anda.');
        }

        $integration->config = is_string($integration->config) ? json_decode($integration->config, true) : ($integration->config ?: []);
        $integration->token_hash = $integration->token_hash ?: (!empty($integration->token) ? hash('sha256', $integration->token) : null);
        $integration->snippets = $this->buildCodeSnippets($integration);
        return $integration;
    }

    /**
     * Create new integration.
     */
    public function createIntegration(array $d, User $user): array
    {
        if ($user->role === 'user') {
            abort(403, 'Role Operator tidak diizinkan membuat integrasi platform.');
        }

        $project = DB::table('projects')->where('id', $d['project_id'])->first();
        if (!$project) {
            abort(404, 'Proyek tidak ditemukan.');
        }

        if (!$user->isSuperAdmin() && $project->created_by != $user->id) {
            abort(403, 'Akses ditolak: Anda hanya dapat menambahkan integrasi pada proyek Anda sendiri.');
        }

        $webhookToken = Str::random(40);
        $config = $d['config'] ?? [];

        // Auto generate Blynk-style token if not explicitly provided
        $token = !empty($d['token']) ? trim($d['token']) : ('sr_tok_' . bin2hex(random_bytes(12)));
        $tokenHash = hash('sha256', $token);

        $id = DB::table('project_integrations')->insertGetId([
            'project_id' => $d['project_id'],
            'platform' => strtolower($d['platform']),
            'name' => trim($d['name']),
            'url' => trim($d['url']),
            'token' => $token,
            'token_hash' => $tokenHash,
            'username' => isset($d['username']) ? trim($d['username']) : null,
            'topic_or_key' => isset($d['topic_or_key']) ? trim($d['topic_or_key']) : null,
            'target_table' => !empty($d['target_table']) ? trim($d['target_table']) : 'iot_telemetry',
            'config' => json_encode($config),
            'status' => 'stopped',
            'webhook_token' => $webhookToken,
            'created_by' => $user->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Auto initialize target table in project database
        try {
            $this->initIotTable($d['project_id'], !empty($d['target_table']) ? trim($d['target_table']) : 'iot_telemetry');
        } catch (\Throwable $e) {}

        Audit::log('integration.create', "{$d['platform']}: {$d['name']}", 'ok', [
            'project_id' => $d['project_id'],
            'url' => $d['url'],
        ]);

        return (array)$this->getIntegration($id, $user);
    }

    /**
     * Update existing integration.
     */
    public function updateIntegration(int $id, array $d, User $user): array
    {
        if ($user->role === 'user') {
            abort(403, 'Role Operator tidak diizinkan mengubah konfigurasi integrasi platform.');
        }

        $current = $this->getIntegration($id, $user);

        $updates = [
            'name' => trim($d['name'] ?? $current->name),
            'url' => trim($d['url'] ?? $current->url),
            'target_table' => !empty($d['target_table']) ? trim($d['target_table']) : $current->target_table,
            'updated_at' => now(),
        ];

        if (array_key_exists('token', $d)) {
            $tokenVal = $d['token'] ? trim($d['token']) : null;
            $updates['token'] = $tokenVal;
            $updates['token_hash'] = !empty($tokenVal) ? hash('sha256', $tokenVal) : null;
        }
        if (array_key_exists('username', $d)) {
            $updates['username'] = $d['username'] ? trim($d['username']) : null;
        }
        if (array_key_exists('topic_or_key', $d)) {
            $updates['topic_or_key'] = $d['topic_or_key'] ? trim($d['topic_or_key']) : null;
        }
        if (array_key_exists('config', $d)) {
            $updates['config'] = json_encode($d['config']);
        }

        DB::table('project_integrations')->where('id', $id)->update($updates);

        Audit::log('integration.update', "{$current->platform}: {$updates['name']}", 'ok', ['id' => $id]);

        return (array)$this->getIntegration($id, $user);
    }

    /**
     * Regenerate token and hash for an integration.
     */
    public function regenerateToken(int $id, User $user): array
    {
        if ($user->role === 'user') {
            abort(403, 'Role Operator tidak diizinkan mengubah token integrasi.');
        }

        $current = $this->getIntegration($id, $user);
        $newToken = 'sr_tok_' . bin2hex(random_bytes(12));
        $newTokenHash = hash('sha256', $newToken);

        DB::table('project_integrations')->where('id', $id)->update([
            'token' => $newToken,
            'token_hash' => $newTokenHash,
            'updated_at' => now(),
        ]);

        Audit::log('integration.regenerate_token', "{$current->platform}: {$current->name}", 'ok', ['id' => $id]);

        return (array)$this->getIntegration($id, $user);
    }

    /**
     * Delete integration.
     */
    public function deleteIntegration(int $id, User $user): void
    {
        if ($user->role === 'user') {
            abort(403, 'Role Operator tidak diizinkan menghapus integrasi.');
        }

        $current = $this->getIntegration($id, $user);

        // Stop worker if running
        if ($current->status === 'running' && $current->worker_pid) {
            $this->stopWorker($id, $user);
        }

        DB::table('project_integrations')->where('id', $id)->delete();
        Audit::log('integration.delete', "{$current->platform}: {$current->name}", 'ok', ['id' => $id]);
    }

    /**
     * Test connection & credentials to platform.
     */
    public function testConnection(array $d): array
    {
        $platform = strtolower($d['platform'] ?? '');
        $url = trim($d['url'] ?? '');
        $token = trim($d['token'] ?? '');
        $username = trim($d['username'] ?? '');
        $topicOrKey = trim($d['topic_or_key'] ?? '');

        if (empty($url)) {
            return ['status' => 'error', 'message' => 'URL platform wajib diisi.'];
        }

        switch ($platform) {
            case 'blynk':
                return $this->testBlynk($url, $token, $topicOrKey);
            case 'zenoh':
                return $this->testZenoh($url, $token, $topicOrKey);
            case 'mqtt':
                return $this->testMqtt($url, $username, $token, $topicOrKey);
            default:
                return ['status' => 'error', 'message' => "Platform '{$platform}' tidak didukung."];
        }
    }

    /**
     * Test Blynk Cloud / Local Server connection.
     */
    protected function testBlynk(string $url, string $token, string $pins): array
    {
        if (empty($token)) {
            return ['status' => 'error', 'message' => 'Auth Token Blynk wajib diisi untuk melakukan pengujian.'];
        }

        $url = rtrim($url, '/');
        // If user entered base blynk domain, append /external/api if missing
        if (!str_contains($url, '/external/api')) {
            $url .= '/external/api';
        }

        $testPin = 'V0';
        if (!empty($pins)) {
            $pinList = explode(',', $pins);
            $testPin = trim($pinList[0]);
        }

        // Test 1: Check hardware connection status
        $testUrl1 = "{$url}/isHardwareConnected?token=" . urlencode($token);
        $ch = curl_init($testUrl1);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $res1 = curl_exec($ch);
        $httpCode1 = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err1 = curl_error($ch);
        curl_close($ch);

        if ($err1) {
            return [
                'status' => 'error',
                'message' => "Gagal menghubungi server Blynk ({$url}): {$err1}",
            ];
        }

        if ($httpCode1 === 400 || $httpCode1 === 401 || $httpCode1 === 404) {
            return [
                'status' => 'error',
                'message' => "Server Blynk merespons HTTP {$httpCode1}: Token tidak valid atau format permintaan salah.",
                'raw' => $res1,
            ];
        }

        $isHardwareConnected = trim(strtolower((string)$res1)) === 'true';

        // Test 2: Read sample pin
        $testUrl2 = "{$url}/get?token=" . urlencode($token) . "&pin=" . urlencode($testPin);
        $ch2 = curl_init($testUrl2);
        curl_setopt_array($ch2, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $res2 = curl_exec($ch2);
        $httpCode2 = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        curl_close($ch2);

        return [
            'status' => 'success',
            'message' => 'Berhasil terhubung ke Blynk Server! Token valid.',
            'details' => [
                'server_url' => $url,
                'hardware_connected' => $isHardwareConnected,
                'tested_pin' => $testPin,
                'pin_value' => $httpCode2 === 200 ? trim((string)$res2) : 'N/A',
                'http_code' => $httpCode1,
            ],
        ];
    }

    /**
     * Test Zenoh / Zenoh-Pico connection.
     */
    protected function testZenoh(string $url, string $token, string $keyExpr): array
    {
        $url = rtrim($url, '/');

        // Check if TCP URL (e.g. tcp/127.0.0.1:7447 or tcp://127.0.0.1:7447)
        if (str_starts_with($url, 'tcp/')) {
            $parts = explode('/', substr($url, 4));
            $hostPort = explode(':', $parts[0]);
            $host = $hostPort[0] ?? '127.0.0.1';
            $port = (int)($hostPort[1] ?? 7447);

            $fp = @fsockopen($host, $port, $errno, $errstr, 4);
            if (!$fp) {
                return [
                    'status' => 'error',
                    'message' => "Gagal terhubung ke Zenoh Router via TCP ({$host}:{$port}): {$errstr} ({$errno})",
                ];
            }
            fclose($fp);

            return [
                'status' => 'success',
                'message' => "Berhasil terhubung ke Zenoh TCP Endpoint di {$host}:{$port}!",
                'details' => [
                    'protocol' => 'Zenoh TCP',
                    'endpoint' => "{$host}:{$port}",
                ],
            ];
        }

        // HTTP / REST Zenoh Endpoint (e.g. http://127.0.0.1:8000)
        $testPath = !empty($keyExpr) ? trim($keyExpr, '/') : 'demo/example/**';
        $fullUrl = "{$url}/{$testPath}";

        $headers = ['Accept: application/json'];
        if (!empty($token)) {
            $headers[] = "Authorization: Bearer {$token}";
        }

        $ch = curl_init($fullUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $res = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($err) {
            return [
                'status' => 'error',
                'message' => "Gagal menghubungi Zenoh REST API ({$fullUrl}): {$err}",
            ];
        }

        return [
            'status' => 'success',
            'message' => "Berhasil terhubung ke Zenoh REST Router! (HTTP {$httpCode})",
            'details' => [
                'endpoint' => $fullUrl,
                'http_code' => $httpCode,
                'response_preview' => substr((string)$res, 0, 200),
            ],
        ];
    }

    /**
     * Test MQTT Broker connection & authentication.
     */
    protected function testMqtt(string $url, string $username, string $password, string $topic): array
    {
        // Parse host and port
        $clean = preg_replace('#^mqtt(s)?://#', '', $url);
        $clean = preg_replace('#^tcp://#', '', $clean);
        $parts = explode(':', $clean);
        $host = $parts[0] ?? '127.0.0.1';
        $port = isset($parts[1]) ? (int)$parts[1] : 1883;

        $clientId = 'pgm_test_' . Str::random(8);

        try {
            $start = microtime(true);
            $socket = @fsockopen($host, $port, $errno, $errstr, 5);
            if (!$socket) {
                return [
                    'status' => 'error',
                    'message' => "Gagal membuka koneksi TCP ke MQTT Broker {$host}:{$port} — {$errstr} ({$errno})",
                ];
            }
            stream_set_timeout($socket, 4);

            // Send MQTT 3.1.1 CONNECT packet
            $connectPacket = $this->buildMqttConnectPacket($clientId, $username, $password, 30);
            fwrite($socket, $connectPacket);

            // Read CONNACK (4 bytes)
            $response = fread($socket, 4);
            fclose($socket);

            $latency = round((microtime(true) - $start) * 1000, 1);

            if (strlen($response) < 4 || ord($response[0]) !== 0x20) {
                return [
                    'status' => 'error',
                    'message' => "Respons dari broker tidak sesuai protokol MQTT 3.1.1.",
                ];
            }

            $returnCode = ord($response[3]);
            if ($returnCode === 0) {
                return [
                    'status' => 'success',
                    'message' => "Berhasil terhubung dan terotentikasi ke MQTT Broker {$host}:{$port}!",
                    'details' => [
                        'host' => $host,
                        'port' => $port,
                        'client_id' => $clientId,
                        'latency_ms' => $latency,
                        'connack_code' => 0,
                    ],
                ];
            }

            $errors = [
                1 => 'Protokol MQTT tidak dapat diterima',
                2 => 'Client ID ditolak oleh broker',
                3 => 'Server broker MQTT tidak tersedia',
                4 => 'Username atau Password / Token salah',
                5 => 'Tidak memiliki izin otorisasi (Akses Ditolak)',
            ];
            $msg = $errors[$returnCode] ?? "Koneksi ditolak dengan kode {$returnCode}";

            return [
                'status' => 'error',
                'message' => "Gagal otentikasi MQTT: {$msg}",
            ];
        } catch (\Throwable $e) {
            return [
                'status' => 'error',
                'message' => "Kesalahan uji MQTT: " . $e->getMessage(),
            ];
        }
    }

    /**
     * Build MQTT 3.1.1 CONNECT packet (pure binary).
     */
    protected function buildMqttConnectPacket(string $clientId, string $username = '', string $password = '', int $keepAlive = 30): string
    {
        $protoName = "MQTT";
        $protoLevel = 4; // 3.1.1
        $flags = 0x02; // Clean session

        if (!empty($username)) $flags |= 0x80;
        if (!empty($password)) $flags |= 0x40;

        // Variable header
        $varHeader = pack('n', strlen($protoName)) . $protoName . chr($protoLevel) . chr($flags) . pack('n', $keepAlive);

        // Payload
        $payload = pack('n', strlen($clientId)) . $clientId;
        if (!empty($username)) {
            $payload .= pack('n', strlen($username)) . $username;
        }
        if (!empty($password)) {
            $payload .= pack('n', strlen($password)) . $password;
        }

        $remainingLength = strlen($varHeader) + strlen($payload);
        return chr(0x10) . $this->encodeMqttLength($remainingLength) . $varHeader . $payload;
    }

    protected function encodeMqttLength(int $length): string
    {
        $string = "";
        do {
            $digit = $length % 128;
            $length = (int)($length / 128);
            if ($length > 0) {
                $digit |= 0x80;
            }
            $string .= chr($digit);
        } while ($length > 0);
        return $string;
    }

    /**
     * Initialize standard IoT telemetry table in project database.
     */
    public function initIotTable(int $projectId, string $tableName = 'iot_telemetry'): array
    {
        $pdo = $this->getProjectPdo($projectId);
        $safeTable = preg_replace('/[^a-zA-Z0-9_]/', '', $tableName) ?: 'iot_telemetry';

        $sql = "
            CREATE TABLE IF NOT EXISTS {$safeTable} (
                id BIGSERIAL PRIMARY KEY,
                platform VARCHAR(50) NOT NULL,
                topic_or_pin VARCHAR(255) NOT NULL,
                payload JSONB,
                val_numeric DOUBLE PRECISION,
                val_text TEXT,
                source_ip VARCHAR(60),
                received_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_{$safeTable}_platform ON {$safeTable}(platform);
            CREATE INDEX IF NOT EXISTS idx_{$safeTable}_topic ON {$safeTable}(topic_or_pin);
            CREATE INDEX IF NOT EXISTS idx_{$safeTable}_received ON {$safeTable}(received_at DESC);
        ";

        $pdo->exec($sql);

        Audit::log('integration.init_table', "Table {$safeTable} in project {$projectId}", 'ok');

        return [
            'status' => 'success',
            'table' => $safeTable,
            'message' => "Tabel '{$safeTable}' dan indeks IoT berhasil diinisialisasi pada database proyek.",
        ];
    }

    /**
     * Insert a telemetry record directly into project database.
     */
    public function insertTelemetryRecord(
        int $projectId,
        string $tableName,
        string $platform,
        string $topicOrPin,
        mixed $payload,
        ?string $sourceIp = null
    ): int {
        $pdo = $this->getProjectPdo($projectId);
        $safeTable = preg_replace('/[^a-zA-Z0-9_]/', '', $tableName) ?: 'iot_telemetry';

        $jsonPayload = null;
        $valNumeric = null;
        $valText = null;

        if (is_array($payload) || is_object($payload)) {
            $jsonPayload = json_encode($payload);
            // Detect common numeric keys
            $arr = (array)$payload;
            foreach (['value', 'val', 'temp', 'temperature', 'reading', 'v'] as $k) {
                if (isset($arr[$k]) && is_numeric($arr[$k])) {
                    $valNumeric = (float)$arr[$k];
                    break;
                }
            }
        } elseif (is_numeric($payload)) {
            $valNumeric = (float)$payload;
            $valText = (string)$payload;
            $jsonPayload = json_encode(['value' => $valNumeric]);
        } else {
            $valText = (string)$payload;
            $jsonPayload = json_encode(['raw' => $valText]);
        }

        $stmt = $pdo->prepare("
            INSERT INTO {$safeTable} (platform, topic_or_pin, payload, val_numeric, val_text, source_ip, received_at)
            VALUES (?, ?, ?::jsonb, ?, ?, ?, NOW())
            RETURNING id
        ");
        $stmt->execute([
            $platform,
            $topicOrPin,
            $jsonPayload,
            $valNumeric,
            $valText,
            $sourceIp,
        ]);

        return (int)$stmt->fetchColumn();
    }

    /**
     * Trigger immediate one-time data sync.
     */
    public function syncNow(int $id, User $user): array
    {
        $integration = $this->getIntegration($id, $user);
        $project = DB::table('projects')->where('id', $integration->project_id)->first();

        $platform = $integration->platform;
        $insertedCount = 0;
        $details = [];

        try {
            if ($platform === 'blynk') {
                $url = rtrim($integration->url, '/');
                if (!str_contains($url, '/external/api')) $url .= '/external/api';
                $token = $integration->token;
                $pins = explode(',', $integration->topic_or_key ?: 'V0');

                foreach ($pins as $p) {
                    $pin = trim($p);
                    if (empty($pin)) continue;

                    $apiUrl = "{$url}/get?token=" . urlencode($token) . "&pin=" . urlencode($pin);
                    $ch = curl_init($apiUrl);
                    curl_setopt_array($ch, [
                        CURLOPT_RETURNTRANSFER => true,
                        CURLOPT_TIMEOUT => 6,
                        CURLOPT_SSL_VERIFYPEER => false,
                    ]);
                    $val = curl_exec($ch);
                    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                    curl_close($ch);

                    if ($code === 200 && $val !== false && strlen($val) > 0) {
                        $parsed = is_numeric(trim($val)) ? (float)trim($val) : trim($val);
                        $this->insertTelemetryRecord(
                            $integration->project_id,
                            $integration->target_table,
                            'blynk',
                            $pin,
                            ['pin' => $pin, 'value' => $parsed, 'synced_via' => 'manual_sync'],
                            'manual_sync'
                        );
                        $insertedCount++;
                        $details[] = "Pin {$pin} = {$val}";
                    }
                }
            } elseif ($platform === 'zenoh') {
                $url = rtrim($integration->url, '/');
                $key = !empty($integration->topic_or_key) ? trim($integration->topic_or_key, '/') : 'demo/example/**';
                $fullUrl = "{$url}/{$key}";

                $ch = curl_init($fullUrl);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT => 6,
                    CURLOPT_SSL_VERIFYPEER => false,
                ]);
                $res = curl_exec($ch);
                $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);

                if ($code === 200 && $res) {
                    $json = json_decode($res, true);
                    $this->insertTelemetryRecord(
                        $integration->project_id,
                        $integration->target_table,
                        'zenoh',
                        $key,
                        $json ?: ['raw' => $res],
                        'manual_sync'
                    );
                    $insertedCount++;
                    $details[] = "Data diterima dari {$key}";
                }
            } elseif ($platform === 'mqtt') {
                // Test ping and insert heartbeat record
                $this->insertTelemetryRecord(
                    $integration->project_id,
                    $integration->target_table,
                    'mqtt',
                    $integration->topic_or_key ?: 'test/sync',
                    ['status' => 'manual_ping', 'note' => 'MQTT sync heartbeat'],
                    'manual_sync'
                );
                $insertedCount++;
                $details[] = "Terkirim sinyal heartbeat sync ke tabel {$integration->target_table}";
            }

            // Update stats
            DB::table('project_integrations')->where('id', $id)->update([
                'last_sync_at' => now(),
                'packets_count' => DB::raw("packets_count + {$insertedCount}"),
                'last_error' => null,
                'updated_at' => now(),
            ]);

            $this->appendLog($integration, $project, "Sync manual berhasil: {$insertedCount} baris data dimasukkan ke tabel {$integration->target_table}.");

            return [
                'status' => 'success',
                'inserted' => $insertedCount,
                'details' => $details,
                'message' => "Sinkronisasi berhasil! {$insertedCount} data dicatat ke database.",
            ];
        } catch (\Throwable $e) {
            $msg = $e->getMessage();
            DB::table('project_integrations')->where('id', $id)->update([
                'last_error' => $msg,
                'updated_at' => now(),
            ]);
            $this->appendLog($integration, $project, "Sync gagal: {$msg}");
            return [
                'status' => 'error',
                'message' => "Gagal sinkronisasi data: {$msg}",
            ];
        }
    }

    /**
     * Start background bridge worker process.
     */
    public function startWorker(int $id, User $user): array
    {
        if ($user->role === 'user') {
            abort(403, 'Role Operator tidak diizinkan menjalankan worker integrasi.');
        }

        $integration = $this->getIntegration($id, $user);
        $project = DB::table('projects')->where('id', $integration->project_id)->first();

        // Stop any old worker
        if ($integration->worker_pid) {
            $this->stopWorker($id, $user);
        }

        $runnerScript = "{$this->root}/app/backend/deploy-runners/iot_bridge_runner.php";
        if (!file_exists($runnerScript)) {
            $runnerScript = "{$this->root}/app/backend-overlay/deploy-runners/iot_bridge_runner.php";
        }

        $logFile = $this->getLogFile($integration, $project);
        $cmd = "setsid nohup php " . escapeshellarg($runnerScript) . " --id={$id} >> " . escapeshellarg($logFile) . " 2>&1 & echo $!";
        $pid = (int)trim((string)@shell_exec($cmd));

        usleep(800000); // 0.8s

        $isAlive = app(DeploymentService::class)->isProcessAlive($pid);
        $status = $isAlive ? 'running' : 'error';
        $error = $isAlive ? null : 'Worker keluar lebih awal. Periksa log.';

        DB::table('project_integrations')->where('id', $id)->update([
            'status' => $status,
            'worker_pid' => $isAlive ? $pid : null,
            'last_error' => $error,
            'updated_at' => now(),
        ]);

        $this->appendLog($integration, $project, "Worker {$integration->platform} dimulai (PID: {$pid}, status: {$status}).");
        Audit::log('integration.start', "{$integration->platform}: {$integration->name}", $status, ['pid' => $pid]);

        return (array)$this->getIntegration($id, $user);
    }

    /**
     * Stop background bridge worker process.
     */
    public function stopWorker(int $id, User $user): array
    {
        if ($user->role === 'user') {
            abort(403, 'Role Operator tidak diizinkan menghentikan worker.');
        }

        $integration = $this->getIntegration($id, $user);
        $project = DB::table('projects')->where('id', $integration->project_id)->first();

        $pid = (int)($integration->worker_pid ?: 0);
        if ($pid > 0) {
            @shell_exec("kill -15 {$pid} 2>/dev/null");
            usleep(200000);
            if (app(DeploymentService::class)->isProcessAlive($pid)) {
                @shell_exec("kill -9 {$pid} 2>/dev/null");
            }
        }

        DB::table('project_integrations')->where('id', $id)->update([
            'status' => 'stopped',
            'worker_pid' => null,
            'updated_at' => now(),
        ]);

        $this->appendLog($integration, $project, "Worker {$integration->platform} dihentikan.");
        Audit::log('integration.stop', "{$integration->platform}: {$integration->name}", 'ok');

        return (array)$this->getIntegration($id, $user);
    }

    /**
     * Get integration live logs.
     */
    public function getLogs(int $id, User $user, int $lines = 100): array
    {
        $integration = $this->getIntegration($id, $user);
        $project = DB::table('projects')->where('id', $integration->project_id)->first();
        $logFile = $this->getLogFile($integration, $project);

        if (!file_exists($logFile)) {
            return [
                'integration_id' => $id,
                'lines' => [],
                'content' => 'Belum ada log aktivitas untuk integrasi ini.',
            ];
        }

        $lines = max(10, min(1000, $lines));
        $content = (string)@shell_exec("tail -n {$lines} " . escapeshellarg($logFile));

        return [
            'integration_id' => $id,
            'lines' => explode("\n", trim($content)),
            'content' => $content,
        ];
    }

    /**
     * Handle public incoming webhook from external platform (Blynk / Zenoh / IoT).
     */
    public function handleWebhook(string $token, mixed $payload, ?string $sourceIp = null): array
    {
        $integration = DB::table('project_integrations as pi')
            ->join('projects as p', 'p.id', '=', 'pi.project_id')
            ->where('pi.webhook_token', $token)
            ->select('pi.*', 'p.name as project_name', 'p.slug as project_slug', 'p.directory as project_directory')
            ->first();

        if (!$integration) {
            abort(404, 'Webhook token tidak valid atau integrasi telah dihapus.');
        }

        $topicOrPin = $integration->topic_or_key ?: 'webhook_event';
        if (is_array($payload) && isset($payload['pin'])) {
            $topicOrPin = (string)$payload['pin'];
        } elseif (is_array($payload) && isset($payload['topic'])) {
            $topicOrPin = (string)$payload['topic'];
        }

        $insertedId = $this->insertTelemetryRecord(
            $integration->project_id,
            $integration->target_table,
            $integration->platform,
            $topicOrPin,
            $payload,
            $sourceIp
        );

        DB::table('project_integrations')->where('id', $integration->id)->update([
            'last_sync_at' => now(),
            'packets_count' => DB::raw('packets_count + 1'),
            'updated_at' => now(),
        ]);

        $preview = is_string($payload) ? $payload : json_encode($payload);
        $this->appendLog($integration, $integration, "Webhook [{$sourceIp}] diterima: {$preview} -> ID #{$insertedId}");

        return [
            'status' => 'ok',
            'inserted_id' => $insertedId,
            'platform' => $integration->platform,
            'project' => $integration->project_name,
            'target_table' => $integration->target_table,
            'timestamp' => date('Y-m-d H:i:s'),
        ];
    }
}
