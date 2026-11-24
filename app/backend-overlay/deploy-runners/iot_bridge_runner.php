<?php
/**
 * Postgres Manager — Standalone IoT Bridge & Telemetry Runner
 * Connects external platforms (Blynk, Zenoh, MQTT) directly to the Project PostgreSQL Database.
 * Runs continuously in background as a daemon.
 */

declare(strict_types=1);

// Parse CLI options
$options = getopt('', ['id:']);
$integrationId = isset($options['id']) ? (int)$options['id'] : 0;

if ($integrationId <= 0) {
    echo "Usage: php iot_bridge_runner.php --id=<integration_id>\n";
    exit(1);
}

// Bootstrap Laravel minimal environment
$baseDir = dirname(__DIR__, 2);
if (file_exists($baseDir . '/app/backend/vendor/autoload.php')) {
    require $baseDir . '/app/backend/vendor/autoload.php';
    $app = require_once $baseDir . '/app/backend/bootstrap/app.php';
} elseif (file_exists(dirname(__DIR__) . '/vendor/autoload.php')) {
    require dirname(__DIR__) . '/vendor/autoload.php';
    $app = require_once dirname(__DIR__) . '/bootstrap/app.php';
} else {
    echo "Failed to load Laravel autoloader.\n";
    exit(1);
}

$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use Illuminate\Support\Facades\{DB, Crypt};

// Load integration record
$integration = DB::table('project_integrations')->where('id', $integrationId)->first();
if (!$integration) {
    echo "Integration #{$integrationId} not found in master database.\n";
    exit(1);
}

$project = DB::table('projects')->where('id', $integration->project_id)->first();
if (!$project) {
    echo "Associated project #{$integration->project_id} not found.\n";
    exit(1);
}

$conn = DB::table('database_connections')->where('project_id', $integration->project_id)->first();
if (!$conn) {
    echo "Database connection credentials not found.\n";
    exit(1);
}

$dbPass = Crypt::decryptString($conn->password_encrypted);

// Establish PDO connection to project database
try {
    $projectPdo = new PDO(
        "pgsql:host={$conn->host};port={$conn->port};dbname={$conn->db_name}",
        $conn->username,
        $dbPass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
        ]
    );
} catch (Throwable $e) {
    echo "Failed to connect to project PostgreSQL database: " . $e->getMessage() . "\n";
    exit(1);
}

$targetTable = preg_replace('/[^a-zA-Z0-9_]/', '', $integration->target_table) ?: 'iot_telemetry';
$platform = strtolower($integration->platform);
$url = trim($integration->url);
$token = trim((string)$integration->token);
$username = trim((string)$integration->username);
$topicOrKey = trim((string)$integration->topic_or_key);
$config = is_string($integration->config) ? json_decode($integration->config, true) : ($integration->config ?: []);

$interval = max(2, (int)($config['interval_seconds'] ?? 10));

echo "[" . date('Y-m-d H:i:s') . "] =======================================================\n";
echo "[" . date('Y-m-d H:i:s') . "] Starting IoT Bridge Runner for: {$integration->name}\n";
echo "[" . date('Y-m-d H:i:s') . "] Platform: " . strtoupper($platform) . " | DB: {$conn->db_name} | Table: {$targetTable}\n";
echo "[" . date('Y-m-d H:i:s') . "] Target URL/Host: {$url}\n";
echo "[" . date('Y-m-d H:i:s') . "] =======================================================\n";

// Ensure target table exists
try {
    $projectPdo->exec("
        CREATE TABLE IF NOT EXISTS {$targetTable} (
            id BIGSERIAL PRIMARY KEY,
            platform VARCHAR(50) NOT NULL,
            topic_or_pin VARCHAR(255) NOT NULL,
            payload JSONB,
            val_numeric DOUBLE PRECISION,
            val_text TEXT,
            source_ip VARCHAR(60),
            received_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_{$targetTable}_platform ON {$targetTable}(platform);
        CREATE INDEX IF NOT EXISTS idx_{$targetTable}_topic ON {$targetTable}(topic_or_pin);
        CREATE INDEX IF NOT EXISTS idx_{$targetTable}_received ON {$targetTable}(received_at DESC);
    ");
} catch (Throwable $e) {
    echo "Warning: error ensuring target table: " . $e->getMessage() . "\n";
}

// Helper to insert telemetry
function recordTelemetry(PDO $pdo, string $table, string $platform, string $topic, mixed $payload): int {
    $json = null;
    $num = null;
    $text = null;

    if (is_array($payload) || is_object($payload)) {
        $json = json_encode($payload);
        $arr = (array)$payload;
        foreach (['value', 'val', 'temp', 'temperature', 'humidity', 'reading', 'v'] as $k) {
            if (isset($arr[$k]) && is_numeric($arr[$k])) {
                $num = (float)$arr[$k];
                break;
            }
        }
    } elseif (is_numeric($payload)) {
        $num = (float)$payload;
        $text = (string)$payload;
        $json = json_encode(['value' => $num]);
    } else {
        $text = (string)$payload;
        $json = json_encode(['raw' => $text]);
    }

    $stmt = $pdo->prepare("
        INSERT INTO {$table} (platform, topic_or_pin, payload, val_numeric, val_text, source_ip, received_at)
        VALUES (?, ?, ?::jsonb, ?, ?, 'bridge_worker', NOW())
        RETURNING id
    ");
    $stmt->execute([$platform, $topic, $json, $num, $text]);
    return (int)$stmt->fetchColumn();
}

// Handle signals
if (function_exists('pcntl_signal')) {
    declare(ticks=1);
    pcntl_signal(SIGTERM, function() {
        echo "[" . date('Y-m-d H:i:s') . "] Bridge worker received SIGTERM, stopping cleanly...\n";
        exit(0);
    });
    pcntl_signal(SIGINT, function() {
        echo "[" . date('Y-m-d H:i:s') . "] Bridge worker interrupted, stopping...\n";
        exit(0);
    });
}

// -----------------------------------------------------------------------------
// RUNNER IMPLEMENTATION PER PLATFORM
// -----------------------------------------------------------------------------

if ($platform === 'blynk') {
    $apiUrl = rtrim($url, '/');
    if (!str_contains($apiUrl, '/external/api')) {
        $apiUrl .= '/external/api';
    }
    $pins = array_filter(array_map('trim', explode(',', $topicOrKey ?: 'V0')));

    echo "[" . date('Y-m-d H:i:s') . "] Blynk Poller loop started. Pins: " . implode(', ', $pins) . " (Interval: {$interval}s)\n";

    while (true) {
        $synced = 0;
        foreach ($pins as $pin) {
            $fetchUrl = "{$apiUrl}/get?token=" . urlencode($token) . "&pin=" . urlencode($pin);
            $ch = curl_init($fetchUrl);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 5,
                CURLOPT_SSL_VERIFYPEER => false,
            ]);
            $val = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($code === 200 && $val !== false && strlen(trim($val)) > 0) {
                $trimmed = trim($val);
                $numericVal = is_numeric($trimmed) ? (float)$trimmed : null;
                $rowId = recordTelemetry($projectPdo, $targetTable, 'blynk', $pin, [
                    'pin' => $pin,
                    'value' => $numericVal !== null ? $numericVal : $trimmed,
                    'synced_at' => date('c'),
                ]);
                $synced++;
                echo "[" . date('Y-m-d H:i:s') . "] [Blynk] {$pin} => {$trimmed} (Inserted DB Row #{$rowId})\n";
            }
        }

        if ($synced > 0) {
            DB::table('project_integrations')->where('id', $integrationId)->update([
                'last_sync_at' => now(),
                'packets_count' => DB::raw("packets_count + {$synced}"),
                'updated_at' => now(),
            ]);
        }

        sleep($interval);
    }
} elseif ($platform === 'zenoh') {
    $key = !empty($topicOrKey) ? trim($topicOrKey, '/') : 'demo/example/**';
    echo "[" . date('Y-m-d H:i:s') . "] Zenoh Poller loop started on key: {$key} (Interval: {$interval}s)\n";

    while (true) {
        $queryUrl = rtrim($url, '/') . '/' . $key;
        $headers = ['Accept: application/json'];
        if (!empty($token)) {
            $headers[] = "Authorization: Bearer {$token}";
        }

        $ch = curl_init($queryUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code === 200 && $res) {
            $data = json_decode($res, true) ?: ['raw' => $res];
            $rowId = recordTelemetry($projectPdo, $targetTable, 'zenoh', $key, $data);
            echo "[" . date('Y-m-d H:i:s') . "] [Zenoh] Telemetry inserted into DB (Row #{$rowId})\n";

            DB::table('project_integrations')->where('id', $integrationId)->update([
                'last_sync_at' => now(),
                'packets_count' => DB::raw('packets_count + 1'),
                'updated_at' => now(),
            ]);
        }

        sleep($interval);
    }
} elseif ($platform === 'mqtt') {
    $clean = preg_replace('#^mqtt(s)?://#', '', $url);
    $clean = preg_replace('#^tcp://#', '', $clean);
    $parts = explode(':', $clean);
    $host = $parts[0] ?? '127.0.0.1';
    $port = isset($parts[1]) ? (int)$parts[1] : 1883;
    $topic = !empty($topicOrKey) ? $topicOrKey : 'devices/+/telemetry';

    echo "[" . date('Y-m-d H:i:s') . "] Starting MQTT Subscriber to {$host}:{$port} on topic '{$topic}'...\n";

    while (true) {
        try {
            $socket = @fsockopen($host, $port, $errno, $errstr, 5);
            if (!$socket) {
                echo "[" . date('Y-m-d H:i:s') . "] [MQTT] Connect failed: {$errstr} ({$errno}), retrying in 5s...\n";
                sleep(5);
                continue;
            }
            stream_set_timeout($socket, 15);

            $clientId = 'pgm_sub_' . bin2hex(random_bytes(4));

            // Build & Send CONNECT packet
            $protoName = "MQTT";
            $protoLevel = 4;
            $flags = 0x02; // clean session
            if (!empty($username)) $flags |= 0x80;
            if (!empty($token)) $flags |= 0x40; // token as password

            $varHeader = pack('n', strlen($protoName)) . $protoName . chr($protoLevel) . chr($flags) . pack('n', 60);
            $payload = pack('n', strlen($clientId)) . $clientId;
            if (!empty($username)) $payload .= pack('n', strlen($username)) . $username;
            if (!empty($token)) $payload .= pack('n', strlen($token)) . $token;

            $len = strlen($varHeader) + strlen($payload);
            $lenEnc = "";
            do {
                $digit = $len % 128;
                $len = (int)($len / 128);
                if ($len > 0) $digit |= 0x80;
                $lenEnc .= chr($digit);
            } while ($len > 0);

            fwrite($socket, chr(0x10) . $lenEnc . $varHeader . $payload);

            // Read CONNACK (4 bytes)
            $connack = fread($socket, 4);
            if (strlen($connack) < 4 || ord($connack[3]) !== 0) {
                echo "[" . date('Y-m-d H:i:s') . "] [MQTT] Broker refused connection, code: " . (strlen($connack) >= 4 ? ord($connack[3]) : 'unknown') . "\n";
                fclose($socket);
                sleep(5);
                continue;
            }

            echo "[" . date('Y-m-d H:i:s') . "] [MQTT] Connected successfully as '{$clientId}'! Subscribing to '{$topic}'...\n";

            // Send SUBSCRIBE packet
            $pktId = 1;
            $subPayload = pack('n', strlen($topic)) . $topic . chr(0); // QoS 0
            $subVar = pack('n', $pktId);
            $subLen = strlen($subVar) + strlen($subPayload);
            fwrite($socket, chr(0x82) . chr($subLen) . $subVar . $subPayload);

            $suback = fread($socket, 5);
            echo "[" . date('Y-m-d H:i:s') . "] [MQTT] Subscribed! Listening for incoming messages...\n";

            $lastPing = time();

            // Message listening loop
            while (!feof($socket)) {
                // Heartbeat ping
                if (time() - $lastPing >= 30) {
                    @fwrite($socket, chr(0xC0) . chr(0x00));
                    $lastPing = time();
                }

                $header = @fread($socket, 1);
                if ($header === false || strlen($header) === 0) {
                    usleep(100000);
                    continue;
                }

                $cmd = ord($header);

                // Read remaining length
                $multiplier = 1;
                $remLength = 0;
                do {
                    $b = @fread($socket, 1);
                    if ($b === false || strlen($b) === 0) break;
                    $digit = ord($b);
                    $remLength += ($digit & 127) * $multiplier;
                    $multiplier *= 128;
                } while (($digit & 128) != 0);

                if ($remLength > 0) {
                    $body = "";
                    $readSoFar = 0;
                    while ($readSoFar < $remLength) {
                        $chunk = @fread($socket, min(4096, $remLength - $readSoFar));
                        if ($chunk === false || strlen($chunk) === 0) break;
                        $body .= $chunk;
                        $readSoFar += strlen($chunk);
                    }

                    // Check if PUBLISH packet (0x30 to 0x3F)
                    if (($cmd & 0xF0) === 0x30) {
                        $topicLen = (ord($body[0]) << 8) + ord($body[1]);
                        $msgTopic = substr($body, 2, $topicLen);
                        $msgPayload = substr($body, 2 + $topicLen);

                        // Parse payload
                        $parsed = json_decode($msgPayload, true);
                        if ($parsed === null) {
                            $parsed = trim($msgPayload);
                        }

                        $rowId = recordTelemetry($projectPdo, $targetTable, 'mqtt', $msgTopic, $parsed);
                        echo "[" . date('Y-m-d H:i:s') . "] [MQTT] Message on '{$msgTopic}' => DB Row #{$rowId}\n";

                        DB::table('project_integrations')->where('id', $integrationId)->update([
                            'last_sync_at' => now(),
                            'packets_count' => DB::raw('packets_count + 1'),
                            'updated_at' => now(),
                        ]);
                    } elseif ($cmd === 0xD0) {
                        // PINGRESP
                    }
                }
            }

            fclose($socket);
            echo "[" . date('Y-m-d H:i:s') . "] [MQTT] Socket disconnected, reconnecting in 3s...\n";
            sleep(3);
        } catch (Throwable $e) {
            echo "[" . date('Y-m-d H:i:s') . "] [MQTT] Error: " . $e->getMessage() . ", reconnecting in 5s...\n";
            sleep(5);
        }
    }
}
