<?php
/**
 * Postgres Manager — Built-in Database REST API & Web Explorer Runner
 * Single-file standalone server powered by PHP built-in web server.
 * Connects directly to the project's PostgreSQL database.
 */

declare(strict_types=1);

$dbHost = getenv('DB_HOST') ?: '127.0.0.1';
$dbPort = getenv('DB_PORT') ?: '5433';
$dbName = getenv('DB_NAME') ?: getenv('DB_DATABASE') ?: 'postgres';
$dbUser = getenv('DB_USER') ?: getenv('DB_USERNAME') ?: 'postgres';
$dbPass = getenv('DB_PASSWORD') ?: '';
$projectName = getenv('PROJECT_NAME') ?: 'Database Project';
$projectSlug = getenv('PROJECT_SLUG') ?: 'project';

// Establish PDO connection
try {
    $pdo = new PDO(
        "pgsql:host={$dbHost};port={$dbPort};dbname={$dbName}",
        $dbUser,
        $dbPass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
        ]
    );
} catch (Throwable $e) {
    if (str_starts_with($_SERVER['REQUEST_URI'] ?? '', '/api/')) {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(500);
        echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
        exit;
    }
    // Web view connection error
    http_response_code(500);
    echo '<!DOCTYPE html><html><body style="background:#090d16;color:#f87171;font-family:sans-serif;padding:2rem;">';
    echo '<h2>Database Connection Error</h2><p>' . htmlspecialchars($e->getMessage()) . '</p></body></html>';
    exit;
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// CORS Headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Helper: send JSON
function sendJson($data, int $code = 200) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($code);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// -----------------------------------------------------------------------------
// REST API ENDPOINTS
// -----------------------------------------------------------------------------

// 1. Health check
if ($uri === '/health' || $uri === '/api/health') {
    sendJson([
        'status' => 'healthy',
        'service' => 'Postgres Manager Project API',
        'project' => $projectName,
        'database' => $dbName,
        'timestamp' => date('c'),
    ]);
}

// Helper: Get list of public tables
function getPublicTables(PDO $pdo): array {
    $stmt = $pdo->query("
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name ASC
    ");
    return $stmt->fetchAll(PDO::FETCH_COLUMN);
}

// Helper: Get table columns
function getTableColumns(PDO $pdo, string $tableName): array {
    $stmt = $pdo->prepare("
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
        ORDER BY ordinal_position ASC
    ");
    $stmt->execute([$tableName]);
    return $stmt->fetchAll();
}

// Helper: Get primary key of table
function getPrimaryKey(PDO $pdo, string $tableName): ?string {
    $stmt = $pdo->prepare("
        SELECT c.column_name
        FROM information_schema.table_constraints tc 
        JOIN information_schema.constraint_column_usage AS ccu USING (constraint_schema, constraint_name) 
        JOIN information_schema.columns AS c ON c.table_schema = tc.constraint_schema
          AND tc.table_name = c.table_name AND ccu.column_name = c.column_name
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = ?
        LIMIT 1
    ");
    $stmt->execute([$tableName]);
    return $stmt->fetchColumn() ?: 'id';
}

// 2. List tables API
if ($uri === '/api/tables' || $uri === '/api') {
    $tables = getPublicTables($pdo);
    $res = [];
    foreach ($tables as $t) {
        $cntStmt = $pdo->query("SELECT count(*) FROM " . '"' . str_replace('"', '""', $t) . '"');
        $cnt = (int)$cntStmt->fetchColumn();
        $cols = getTableColumns($pdo, $t);
        $res[] = [
            'name' => $t,
            'row_count' => $cnt,
            'columns_count' => count($cols),
            'columns' => $cols,
            'endpoint' => "/api/tables/{$t}",
        ];
    }
    sendJson([
        'project' => $projectName,
        'database' => $dbName,
        'tables_count' => count($tables),
        'tables' => $res,
    ]);
}

// 3. Custom Query API (POST /api/query)
if ($uri === '/api/query' && $method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true) ?? [];
    $sql = trim($body['sql'] ?? $body['query'] ?? '');
    if (!$sql) {
        sendJson(['error' => 'Query SQL kosong'], 400);
    }
    try {
        $start = microtime(true);
        $isSelect = preg_match('/^\s*(SELECT|WITH|SHOW|EXPLAIN)\b/i', $sql);
        if ($isSelect) {
            $stmt = $pdo->query($sql);
            $rows = $stmt->fetchAll();
            $duration = round((microtime(true) - $start) * 1000, 2);
            sendJson([
                'success' => true,
                'duration_ms' => $duration,
                'rows_count' => count($rows),
                'data' => $rows,
            ]);
        } else {
            $affected = $pdo->exec($sql);
            $duration = round((microtime(true) - $start) * 1000, 2);
            sendJson([
                'success' => true,
                'duration_ms' => $duration,
                'rows_affected' => $affected,
            ]);
        }
    } catch (Throwable $e) {
        sendJson(['error' => $e->getMessage()], 400);
    }
}

// 4. CRUD for Table: /api/tables/{table} or /api/tables/{table}/{id}
if (preg_match('#^/api/tables/([a-zA-Z0-9_\-]+)(?:/([a-zA-Z0-9_\-]+))?$#', $uri, $matches)) {
    $tableName = $matches[1];
    $recordId = $matches[2] ?? null;

    $tables = getPublicTables($pdo);
    if (!in_array($tableName, $tables, true)) {
        sendJson(['error' => "Tabel '{$tableName}' tidak ditemukan di database."], 404);
    }

    $escapedTable = '"' . str_replace('"', '""', $tableName) . '"';
    $pk = getPrimaryKey($pdo, $tableName) ?: 'id';
    $escapedPk = '"' . str_replace('"', '""', $pk) . '"';

    try {
        if ($method === 'GET') {
            if ($recordId !== null) {
                // Get single record
                $stmt = $pdo->prepare("SELECT * FROM {$escapedTable} WHERE {$escapedPk} = ? LIMIT 1");
                $stmt->execute([$recordId]);
                $row = $stmt->fetch();
                if (!$row) {
                    sendJson(['error' => "Data dengan {$pk} = {$recordId} tidak ditemukan."], 404);
                }
                sendJson(['success' => true, 'data' => $row]);
            } else {
                // List records with pagination, filter, sort
                $limit = max(1, min(500, (int)($_GET['limit'] ?? 50)));
                $offset = max(0, (int)($_GET['offset'] ?? 0));
                $sort = $_GET['sort'] ?? $pk;
                $order = strtoupper($_GET['order'] ?? 'DESC') === 'ASC' ? 'ASC' : 'DESC';

                // Check valid sort column
                $cols = array_column(getTableColumns($pdo, $tableName), 'column_name');
                if (!in_array($sort, $cols, true)) {
                    $sort = $pk;
                }
                $escapedSort = '"' . str_replace('"', '""', $sort) . '"';

                // Search query
                $where = [];
                $params = [];
                if (!empty($_GET['search'])) {
                    $term = '%' . trim($_GET['search']) . '%';
                    $orParts = [];
                    foreach ($cols as $c) {
                        $orParts[] = "CAST(\"" . str_replace('"', '""', $c) . "\" AS TEXT) ILIKE ?";
                        $params[] = $term;
                    }
                    if ($orParts) {
                        $where[] = '(' . implode(' OR ', $orParts) . ')';
                    }
                }

                $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

                // Count total
                $cntStmt = $pdo->prepare("SELECT count(*) FROM {$escapedTable} {$whereClause}");
                $cntStmt->execute($params);
                $total = (int)$cntStmt->fetchColumn();

                // Select data
                $dataStmt = $pdo->prepare("SELECT * FROM {$escapedTable} {$whereClause} ORDER BY {$escapedSort} {$order} LIMIT {$limit} OFFSET {$offset}");
                $dataStmt->execute($params);
                $rows = $dataStmt->fetchAll();

                sendJson([
                    'table' => $tableName,
                    'total' => $total,
                    'limit' => $limit,
                    'offset' => $offset,
                    'count' => count($rows),
                    'data' => $rows,
                ]);
            }
        } elseif ($method === 'POST') {
            // Insert record
            $raw = file_get_contents('php://input');
            $data = json_decode($raw, true);
            if (!is_array($data) || empty($data)) {
                sendJson(['error' => 'Data JSON body tidak valid atau kosong.'], 400);
            }

            $cols = [];
            $placeholders = [];
            $values = [];
            $validCols = array_column(getTableColumns($pdo, $tableName), 'column_name');

            foreach ($data as $k => $v) {
                if (in_array($k, $validCols, true)) {
                    $cols[] = '"' . str_replace('"', '""', $k) . '"';
                    $placeholders[] = '?';
                    $values[] = $v;
                }
            }

            if (empty($cols)) {
                sendJson(['error' => 'Tidak ada kolom yang cocok dengan skema tabel.'], 400);
            }

            $sql = "INSERT INTO {$escapedTable} (" . implode(', ', $cols) . ") VALUES (" . implode(', ', $placeholders) . ") RETURNING *";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($values);
            $inserted = $stmt->fetch();

            sendJson(['success' => true, 'message' => 'Data berhasil ditambahkan.', 'data' => $inserted], 201);
        } elseif ($method === 'PUT' || $method === 'PATCH') {
            // Update record
            if ($recordId === null) {
                sendJson(['error' => 'ID data diperlukan untuk pembaruan.'], 400);
            }
            $raw = file_get_contents('php://input');
            $data = json_decode($raw, true);
            if (!is_array($data) || empty($data)) {
                sendJson(['error' => 'Data JSON body tidak valid atau kosong.'], 400);
            }

            $setParts = [];
            $values = [];
            $validCols = array_column(getTableColumns($pdo, $tableName), 'column_name');

            foreach ($data as $k => $v) {
                if (in_array($k, $validCols, true) && $k !== $pk) {
                    $setParts[] = '"' . str_replace('"', '""', $k) . '" = ?';
                    $values[] = $v;
                }
            }

            if (empty($setParts)) {
                sendJson(['error' => 'Tidak ada kolom yang valid untuk diperbarui.'], 400);
            }

            $values[] = $recordId;
            $sql = "UPDATE {$escapedTable} SET " . implode(', ', $setParts) . " WHERE {$escapedPk} = ? RETURNING *";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($values);
            $updated = $stmt->fetch();

            if (!$updated) {
                sendJson(['error' => "Data dengan {$pk} = {$recordId} tidak ditemukan."], 404);
            }

            sendJson(['success' => true, 'message' => 'Data berhasil diperbarui.', 'data' => $updated]);
        } elseif ($method === 'DELETE') {
            // Delete record
            if ($recordId === null) {
                sendJson(['error' => 'ID data diperlukan untuk menghapus.'], 400);
            }
            $stmt = $pdo->prepare("DELETE FROM {$escapedTable} WHERE {$escapedPk} = ? RETURNING *");
            $stmt->execute([$recordId]);
            $deleted = $stmt->fetch();

            if (!$deleted) {
                sendJson(['error' => "Data dengan {$pk} = {$recordId} tidak ditemukan."], 404);
            }

            sendJson(['success' => true, 'message' => 'Data berhasil dihapus.', 'data' => $deleted]);
        }
    } catch (Throwable $e) {
        sendJson(['error' => $e->getMessage()], 400);
    }
}

// -----------------------------------------------------------------------------
// WEB UI / EXPLORER DASHBOARD (Served on GET /)
// -----------------------------------------------------------------------------

$tables = getPublicTables($pdo);
$hostPort = $_SERVER['HTTP_HOST'] ?? "0.0.0.0:{$dbPort}";
$currentTable = $_GET['tab'] ?? ($tables[0] ?? '');
$tableCols = $currentTable ? getTableColumns($pdo, $currentTable) : [];
$tableData = [];
$totalRows = 0;

if ($currentTable) {
    try {
        $escaped = '"' . str_replace('"', '""', $currentTable) . '"';
        $cntStmt = $pdo->query("SELECT count(*) FROM {$escaped}");
        $totalRows = (int)$cntStmt->fetchColumn();
        $dataStmt = $pdo->query("SELECT * FROM {$escaped} LIMIT 50");
        $tableData = $dataStmt->fetchAll();
    } catch (Throwable $e) {}
}

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($projectName) ?> — Database Service API</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; background: #06090e; }
    code, pre, .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="text-slate-200 min-h-screen flex flex-col">

  <!-- Header -->
  <header class="border-b border-slate-800/80 bg-slate-900/90 backdrop-blur sticky top-0 z-20 px-6 py-4">
    <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center font-bold text-slate-950 shadow-lg shadow-emerald-500/20 text-lg">
          🐘
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-lg font-bold text-white"><?= htmlspecialchars($projectName) ?></h1>
            <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
              ● Online Service
            </span>
          </div>
          <p class="text-xs text-slate-400">
            Database: <span class="font-mono text-emerald-300"><?= htmlspecialchars($dbName) ?></span> • Host: <span class="font-mono text-slate-300"><?= htmlspecialchars($hostPort) ?></span>
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <a href="/api/tables" target="_blank" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition">
          📄 Schema JSON
        </a>
        <a href="/health" target="_blank" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition">
          🩺 Health Check
        </a>
      </div>
    </div>
  </header>

  <!-- Main Container -->
  <main class="max-w-7xl mx-auto w-full p-6 space-y-6 flex-1">

    <!-- Overview Banner -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
        <p class="text-xs text-slate-400 font-medium">Layanan Status</p>
        <p class="text-xl font-bold text-emerald-400 mt-1">Aktif & Siap</p>
        <p class="text-[11px] text-slate-500 mt-0.5">REST API + Web Explorer</p>
      </div>
      <div class="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
        <p class="text-xs text-slate-400 font-medium">Total Tabel</p>
        <p class="text-xl font-bold text-white mt-1"><?= count($tables) ?> Tabel</p>
        <p class="text-[11px] text-slate-500 mt-0.5">Skema public</p>
      </div>
      <div class="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
        <p class="text-xs text-slate-400 font-medium">Endpoint Base API</p>
        <p class="text-sm font-mono font-semibold text-slate-200 mt-1 truncate">/api/tables</p>
        <p class="text-[11px] text-slate-500 mt-0.5">RESTful JSON endpoints</p>
      </div>
      <div class="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
        <p class="text-xs text-slate-400 font-medium">Database Port</p>
        <p class="text-xl font-bold text-slate-200 mt-1 font-mono">:<?= htmlspecialchars((string)$dbPort) ?></p>
        <p class="text-[11px] text-slate-500 mt-0.5">PostgreSQL Local Engine</p>
      </div>
    </div>

    <!-- Layout: Sidebar Tables + Table Data -->
    <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
      
      <!-- Left Sidebar: Tables List -->
      <div class="space-y-3 lg:col-span-1">
        <div class="p-4 rounded-xl border border-slate-800 bg-slate-900/70 space-y-3">
          <div class="flex items-center justify-between pb-2 border-b border-slate-800">
            <h3 class="font-bold text-sm text-white flex items-center gap-2">
              <span>🗄️</span> Daftar Tabel
            </h3>
            <span class="text-xs font-mono text-slate-400"><?= count($tables) ?></span>
          </div>
          
          <?php if (empty($tables)): ?>
            <p class="text-xs text-slate-500 py-3 text-center">Belum ada tabel di database ini. Jalankan skrip DDL atau migrasi dari repository.</p>
          <?php else: ?>
            <div class="space-y-1">
              <?php foreach ($tables as $t): ?>
                <a href="?tab=<?= urlencode($t) ?>" class="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono transition <?= $t === $currentTable ? 'bg-emerald-600 text-white font-bold shadow-md shadow-emerald-600/30' : 'text-slate-300 hover:bg-slate-800' ?>">
                  <span class="truncate"><?= htmlspecialchars($t) ?></span>
                  <span>→</span>
                </a>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
        </div>

        <!-- Quick API Guide -->
        <div class="p-4 rounded-xl border border-slate-800 bg-slate-900/70 space-y-2 text-xs">
          <p class="font-bold text-slate-200">🚀 Panduan REST API</p>
          <div class="font-mono text-[11px] space-y-1 text-slate-400">
            <p><span class="text-emerald-400">GET</span> /api/tables</p>
            <p><span class="text-emerald-400">GET</span> /api/tables/{nama_tabel}</p>
            <p><span class="text-blue-400">POST</span> /api/tables/{nama_tabel}</p>
            <p><span class="text-amber-400">PUT</span> /api/tables/{nama_tabel}/{id}</p>
            <p><span class="text-red-400">DEL</span> /api/tables/{nama_tabel}/{id}</p>
          </div>
        </div>
      </div>

      <!-- Right Main: Table Explorer & API Tester -->
      <div class="lg:col-span-3 space-y-6">
        
        <?php if ($currentTable): ?>
          <div class="p-5 rounded-xl border border-slate-800 bg-slate-900/70 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-base font-bold text-white font-mono"><?= htmlspecialchars($currentTable) ?></h2>
                  <span class="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                    <?= $totalRows ?> baris data
                  </span>
                </div>
                <p class="text-xs text-slate-400 mt-0.5">
                  Endpoint: <code class="text-emerald-400">/api/tables/<?= htmlspecialchars($currentTable) ?></code>
                </p>
              </div>

              <div class="flex items-center gap-2">
                <a href="/api/tables/<?= urlencode($currentTable) ?>" target="_blank" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition flex items-center gap-1.5 shadow-md shadow-emerald-600/20">
                  <span>Lihat JSON API</span> ↗
                </a>
              </div>
            </div>

            <!-- Table Data Viewer -->
            <div class="overflow-x-auto max-h-96 rounded-lg border border-slate-800 bg-slate-950/80">
              <?php if (empty($tableData)): ?>
                <div class="p-8 text-center text-xs text-slate-500">
                  Tabel ini masih kosong (0 baris data).
                </div>
              <?php else: ?>
                <table class="w-full text-left text-xs font-mono">
                  <thead class="bg-slate-900 border-b border-slate-800 text-slate-400 sticky top-0">
                    <tr>
                      <?php foreach (array_keys($tableData[0]) as $col): ?>
                        <th class="px-3 py-2 font-semibold whitespace-nowrap"><?= htmlspecialchars($col) ?></th>
                      <?php endforeach; ?>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800/60">
                    <?php foreach ($tableData as $row): ?>
                      <tr class="hover:bg-slate-900/50 transition">
                        <?php foreach ($row as $val): ?>
                          <td class="px-3 py-2 text-slate-300 whitespace-nowrap max-w-xs truncate">
                            <?= $val === null ? '<span class="text-slate-600 italic">null</span>' : htmlspecialchars((string)$val) ?>
                          </td>
                        <?php endforeach; ?>
                      </tr>
                    <?php endforeach; ?>
                  </tbody>
                </table>
              <?php endif; ?>
            </div>

            <!-- cURL Quick Command -->
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
              <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] font-semibold text-slate-400">Contoh Perintah cURL:</span>
              </div>
              <pre class="font-mono text-xs text-emerald-400 overflow-x-auto p-2 bg-slate-900 rounded">curl -s "http://<?= htmlspecialchars($hostPort) ?>/api/tables/<?= htmlspecialchars($currentTable) ?>?limit=10"</pre>
            </div>
          </div>
        <?php else: ?>
          <div class="p-12 text-center rounded-xl border border-slate-800 bg-slate-900/40 text-slate-400">
            Pilih tabel di sebelah kiri untuk melihat data atau gunakan REST API.
          </div>
        <?php endif; ?>

      </div>

    </div>

  </main>

  <footer class="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500">
    Postgres Manager Built-in Auto Deployment Runner • Akses Langsung via IP & Port
  </footer>

</body>
</html>
