<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, Crypt};
use PDO;

class TableController extends Controller
{
    /**
     * Data types that may be used from the visual table builder.
     */
    protected array $validTypes = [
        'SERIAL', 'BIGSERIAL', 'SMALLINT', 'INTEGER', 'BIGINT',
        'NUMERIC', 'DECIMAL', 'DOUBLE PRECISION', 'REAL', 'MONEY',
        'VARCHAR', 'TEXT', 'CHAR', 'BOOLEAN', 'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ',
        'JSON', 'JSONB', 'UUID', 'BYTEA', 'TIMETZ',
    ];

    protected function getProjectPdo(int $projectId, User $user): array
    {
        $project = DB::table('projects')
            ->join('database_connections as c', 'c.project_id', '=', 'projects.id')
            ->join('project_databases as d', 'd.project_id', '=', 'projects.id')
            ->where('projects.id', $projectId)
            ->select('projects.*', 'c.host', 'c.port', 'c.username', 'c.password_encrypted', 'd.db_name', 'd.db_user')
            ->first();

        if (!$project) {
            abort(404, 'Proyek database tidak ditemukan.');
        }

        if (!$user->isSuperAdmin() && $project->created_by != $user->id) {
            abort(403, 'Akses ditolak: Proyek bukan milik Anda.');
        }

        $password = Crypt::decryptString($project->password_encrypted);
        $pdo = new PDO(
            "pgsql:host={$project->host};port={$project->port};dbname={$project->db_name}",
            $project->username,
            $password,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_TIMEOUT => 5,
            ]
        );

        return [$project, $pdo];
    }

    /**
     * Operators (role "user") may only browse and export data.
     */
    protected function assertCanManage(User $user, string $action = 'mengubah'): void
    {
        if (!$user->isSuperAdmin() && $user->role === 'user') {
            abort(403, "Role Operator tidak diizinkan {$action} struktur maupun data tabel. Mode hanya-baca.");
        }
    }

    protected function assertTableName(string $table): string
    {
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) {
            abort(400, 'Nama tabel tidak valid.');
        }
        return $table;
    }

    /**
     * Fetch real column metadata for a table.
     */
    protected function tableColumns(PDO $pdo, string $table): array
    {
        $stmt = $pdo->prepare("
            SELECT column_name, data_type, udt_name, is_nullable, column_default,
                   is_identity, is_generated, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
            ORDER BY ordinal_position ASC
        ");
        $stmt->execute([$table]);
        return $stmt->fetchAll();
    }

    protected function tablePrimaryKey(PDO $pdo, string $table): array
    {
        $stmt = $pdo->prepare("
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = tc.constraint_name
             AND kcu.table_schema = tc.table_schema
             AND kcu.table_name = tc.table_name
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = ?
            ORDER BY kcu.ordinal_position
        ");
        $stmt->execute([$table]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    protected function sanitizeType(string $type): ?string
    {
        $type = strtoupper(trim(preg_replace('/\s+/', ' ', $type)));

        // Normalize SQL-standard names returned by information_schema.columns.
        $type = preg_replace('/^CHARACTER VARYING/', 'VARCHAR', $type);
        $type = preg_replace('/^CHARACTER(?! VARYING)/', 'CHAR', $type);
        $type = preg_replace('/^TIMESTAMP WITHOUT TIME ZONE/', 'TIMESTAMP', $type);
        $type = preg_replace('/^TIMESTAMP WITH TIME ZONE/', 'TIMESTAMPTZ', $type);
        $type = preg_replace('/^TIME WITHOUT TIME ZONE/', 'TIME', $type);
        $type = preg_replace('/^TIME WITH TIME ZONE/', 'TIMETZ', $type);

        if (!preg_match('/^(DOUBLE PRECISION|[A-Z]+)(\(\d+(,\s?\d+)?\))?$/', $type)) {
            return null;
        }

        $base = preg_replace('/\(.*?\)/', '', $type);
        if (!in_array(trim($base), $this->validTypes, true)) {
            return null;
        }

        return $type;
    }

    protected function defaultSql(PDO $pdo, string $default): string
    {
        $default = trim($default);
        $upper = strtoupper($default);

        if (in_array($upper, ['NOW()', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'TRUE', 'FALSE', 'NULL', 'GEN_RANDOM_UUID()'], true) || is_numeric($default)) {
            return $default;
        }

        // Preserve sequence defaults from SERIAL / BIGSERIAL columns.
        if (preg_match("/^nextval\\('[a-zA-Z0-9_.]+'::regclass\\)$/i", $default)) {
            return $default;
        }

        return $pdo->quote($default);
    }

    protected function columnDefinition(PDO $pdo, array $c, array &$pks): ?string
    {
        $cName = strtolower(trim((string)($c['name'] ?? '')));
        if (!preg_match('/^[a-z][a-z0-9_]{0,62}$/', $cName)) {
            abort(422, "Nama kolom '{$cName}' tidak valid. Gunakan huruf kecil, angka, atau underscore dan diawali huruf.");
        }

        $type = $this->sanitizeType((string)($c['type'] ?? 'VARCHAR(255)'));
        if ($type === null) {
            abort(422, "Tipe data '" . ($c['type'] ?? '') . "' tidak didukung.");
        }

        $def = "\"{$cName}\" {$type}";

        if (!empty($c['primary_key'])) {
            $pks[] = "\"{$cName}\"";
        }
        if (!empty($c['not_null']) && empty($c['primary_key'])) {
            $def .= ' NOT NULL';
        }
        if (!empty($c['unique']) && empty($c['primary_key'])) {
            $def .= ' UNIQUE';
        }
        if (isset($c['default']) && strlen(trim((string)$c['default'])) > 0) {
            $def .= ' DEFAULT ' . $this->defaultSql($pdo, (string)$c['default']);
        }

        return $def;
    }

    /**
     * List all tables in a project database with statistics, columns and primary keys.
     */
    public function index(Request $r, int $id)
    {
        [$project, $pdo] = $this->getProjectPdo($id, $r->user());

        $sql = "
            SELECT
                t.table_name AS name,
                COALESCE(s.n_live_tup, 0) AS row_estimate,
                pg_total_relation_size(c.oid) AS total_bytes,
                ROUND((pg_total_relation_size(c.oid) / 1048576.0)::numeric, 3) AS total_mb,
                ROUND((pg_relation_size(c.oid) / 1048576.0)::numeric, 3) AS table_mb,
                ROUND((pg_indexes_size(c.oid) / 1048576.0)::numeric, 3) AS index_mb
            FROM information_schema.tables t
            JOIN pg_namespace n ON n.nspname = t.table_schema
            JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
            LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
            WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
            ORDER BY t.table_name ASC
        ";

        $tables = $pdo->query($sql)->fetchAll();

        foreach ($tables as &$tbl) {
            $tbl['columns'] = $this->tableColumns($pdo, $tbl['name']);
            $tbl['primary_key'] = $this->tablePrimaryKey($pdo, $tbl['name']);

            try {
                $cntQ = $pdo->query("SELECT count(*) FROM \"{$tbl['name']}\"");
                $tbl['rows_count'] = (int)$cntQ->fetchColumn();
            } catch (\Throwable) {
                $tbl['rows_count'] = (int)$tbl['row_estimate'];
            }
        }

        return response()->json([
            'project_id' => $id,
            'db_name' => $project->db_name,
            'tables' => $tables,
        ]);
    }

    /**
     * Browse rows from a specific table (Firebase / Supabase style grid viewer).
     */
    public function browse(Request $r, int $id, string $table)
    {
        [$project, $pdo] = $this->getProjectPdo($id, $r->user());
        $table = $this->assertTableName($table);

        $limit = max(5, min(200, (int)$r->query('limit', 50)));
        $page = max(1, (int)$r->query('page', 1));
        $offset = ($page - 1) * $limit;
        $sortCol = $r->query('sort');
        $sortDir = strtolower((string)$r->query('dir', 'desc')) === 'asc' ? 'ASC' : 'DESC';

        $columns = $this->tableColumns($pdo, $table);
        if (empty($columns)) {
            abort(404, "Tabel '{$table}' tidak ditemukan.");
        }
        $primaryKey = $this->tablePrimaryKey($pdo, $table);

        $cntStmt = $pdo->query("SELECT count(*) FROM \"{$table}\"");
        $totalRows = (int)$cntStmt->fetchColumn();

        $orderBy = '';
        if ($sortCol && preg_match('/^[a-zA-Z0-9_]+$/', $sortCol)) {
            $validCols = array_column($columns, 'column_name');
            if (in_array($sortCol, $validCols, true)) {
                $orderBy = "ORDER BY \"{$sortCol}\" {$sortDir} NULLS LAST";
            }
        }
        if ($orderBy === '') {
            if (!empty($primaryKey)) {
                $orderBy = 'ORDER BY "' . $primaryKey[0] . '" ' . $sortDir;
            } else {
                $orderBy = 'ORDER BY ctid ' . $sortDir;
            }
        }

        // ctid is included so rows can be edited even when the table has no primary key.
        $dataStmt = $pdo->query("SELECT ctid AS \"_ctid\", * FROM \"{$table}\" {$orderBy} LIMIT {$limit} OFFSET {$offset}");
        $rows = $dataStmt->fetchAll();

        return response()->json([
            'table' => $table,
            'columns' => $columns,
            'primary_key' => $primaryKey,
            'rows' => $rows,
            'total' => $totalRows,
            'page' => $page,
            'limit' => $limit,
            'total_pages' => (int)ceil($totalRows / $limit),
        ]);
    }

    /**
     * Visual Interactive Table Generator ("Tinggal Klik-Klik Gitu").
     */
    public function store(Request $r, int $id)
    {
        $user = $r->user();
        $this->assertCanManage($user, 'membuat');
        [$project, $pdo] = $this->getProjectPdo($id, $user);

        $tableName = trim(strtolower((string)$r->input('table_name', '')));
        if (!preg_match('/^[a-z][a-z0-9_]{1,60}$/', $tableName)) {
            return response()->json(['message' => 'Nama tabel harus berupa huruf kecil, angka, atau underscore, diawali huruf (2-60 karakter).'], 422);
        }

        $columns = $r->input('columns', []);
        if (empty($columns) || !is_array($columns)) {
            return response()->json(['message' => 'Minimal harus menyertakan 1 kolom pada tabel.'], 422);
        }

        try {
            $colDefs = [];
            $pks = [];
            foreach ($columns as $c) {
                $def = $this->columnDefinition($pdo, $c, $pks);
                if ($def !== null) $colDefs[] = $def;
            }
            if (!empty($pks)) {
                $colDefs[] = 'PRIMARY KEY (' . implode(', ', $pks) . ')';
            }

            $sql = "CREATE TABLE \"{$tableName}\" (\n  " . implode(",\n  ", $colDefs) . "\n);";
            $pdo->exec($sql);
            Audit::log('table.create', "{$project->slug}.{$tableName}", 'ok');

            return response()->json([
                'status' => 'success',
                'table' => $tableName,
                'message' => "Tabel '{$tableName}' berhasil digenerate di database {$project->db_name}!",
                'sql' => $sql,
            ], 201);
        } catch (\Throwable $e) {
            return response()->json([
                'status' => 'error',
                'message' => 'Gagal membuat tabel: ' . $e->getMessage(),
                'sql' => $sql ?? null,
            ], 422);
        }
    }

    /**
     * Edit table structure: add / drop / rename / alter columns and rename table.
     */
    public function update(Request $r, int $id, string $table)
    {
        $user = $r->user();
        $this->assertCanManage($user, 'mengubah');
        [$project, $pdo] = $this->getProjectPdo($id, $user);
        $currentTable = $this->assertTableName($table);

        $ops = $r->input('operations', []);
        if (!is_array($ops) || empty($ops)) {
            return response()->json(['message' => 'Tidak ada operasi perubahan struktur yang dikirim.'], 422);
        }

        $executed = [];
        try {
            $pdo->beginTransaction();

            foreach ($ops as $op) {
                $action = strtolower((string)($op['action'] ?? ''));
                $t = '"' . $currentTable . '"';

                switch ($action) {
                    case 'add_column':
                        $pks = [];
                        $def = $this->columnDefinition($pdo, $op, $pks);
                        if ($def === null) {
                            throw new \RuntimeException('Definisi kolom baru tidak valid.');
                        }
                        $sql = "ALTER TABLE {$t} ADD COLUMN {$def}";
                        $pdo->exec($sql);
                        $executed[] = $sql;
                        if (!empty($pks)) {
                            $pkSql = 'ALTER TABLE ' . $t . ' ADD PRIMARY KEY (' . implode(', ', $pks) . ')';
                            $pdo->exec($pkSql);
                            $executed[] = $pkSql;
                        }
                        break;

                    case 'drop_column':
                        $name = strtolower(trim((string)($op['name'] ?? '')));
                        if (!preg_match('/^[a-z][a-z0-9_]{0,62}$/', $name)) {
                            throw new \RuntimeException("Nama kolom '{$name}' tidak valid.");
                        }
                        $sql = "ALTER TABLE {$t} DROP COLUMN \"{$name}\"";
                        $pdo->exec($sql);
                        $executed[] = $sql;
                        break;

                    case 'rename_column':
                        $from = strtolower(trim((string)($op['from'] ?? '')));
                        $to = strtolower(trim((string)($op['to'] ?? '')));
                        if (!preg_match('/^[a-z][a-z0-9_]{0,62}$/', $from) || !preg_match('/^[a-z][a-z0-9_]{0,62}$/', $to)) {
                            throw new \RuntimeException('Nama kolom asal/tujuan tidak valid.');
                        }
                        $sql = "ALTER TABLE {$t} RENAME COLUMN \"{$from}\" TO \"{$to}\"";
                        $pdo->exec($sql);
                        $executed[] = $sql;
                        break;

                    case 'alter_column':
                        $name = strtolower(trim((string)($op['name'] ?? '')));
                        if (!preg_match('/^[a-z][a-z0-9_]{0,62}$/', $name)) {
                            throw new \RuntimeException("Nama kolom '{$name}' tidak valid.");
                        }
                        if (!empty($op['type'])) {
                            $type = $this->sanitizeType((string)$op['type']);
                            if ($type === null) {
                                throw new \RuntimeException("Tipe data '" . $op['type'] . "' tidak didukung.");
                            }
                            $sql = "ALTER TABLE {$t} ALTER COLUMN \"{$name}\" TYPE {$type} USING \"{$name}\"::{$type}";
                            $pdo->exec($sql);
                            $executed[] = $sql;
                        }
                        if (array_key_exists('not_null', $op)) {
                            $sql = "ALTER TABLE {$t} ALTER COLUMN \"{$name}\" " . (!empty($op['not_null']) ? 'SET' : 'DROP') . ' NOT NULL';
                            $pdo->exec($sql);
                            $executed[] = $sql;
                        }
                        if (array_key_exists('default', $op)) {
                            $default = trim((string)$op['default']);
                            if ($default === '') {
                                $sql = "ALTER TABLE {$t} ALTER COLUMN \"{$name}\" DROP DEFAULT";
                            } else {
                                $sql = "ALTER TABLE {$t} ALTER COLUMN \"{$name}\" SET DEFAULT " . $this->defaultSql($pdo, $default);
                            }
                            $pdo->exec($sql);
                            $executed[] = $sql;
                        }
                        break;

                    case 'rename_table':
                        $newName = strtolower(trim((string)($op['to'] ?? $r->input('new_table_name', ''))));
                        if (!preg_match('/^[a-z][a-z0-9_]{1,60}$/', $newName)) {
                            throw new \RuntimeException('Nama tabel baru tidak valid.');
                        }
                        $pdo->exec("ALTER TABLE {$t} RENAME TO \"{$newName}\"");
                        $executed[] = "ALTER TABLE {$t} RENAME TO \"{$newName}\"";
                        $currentTable = $newName;
                        break;

                    default:
                        throw new \RuntimeException("Operasi '{$action}' tidak dikenal.");
                }
            }

            $pdo->commit();
            Audit::log('table.alter', "{$project->slug}.{$table}", 'ok', ['operations' => $executed]);

            return response()->json([
                'status' => 'success',
                'table' => $currentTable,
                'message' => 'Struktur tabel berhasil diperbarui.',
                'sql' => $executed,
            ]);
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            return response()->json([
                'status' => 'error',
                'message' => 'Gagal mengubah struktur tabel: ' . $e->getMessage(),
                'sql' => $executed,
            ], 422);
        }
    }

    /**
     * Drop a table from the database.
     */
    public function destroy(Request $r, int $id, string $table)
    {
        $user = $r->user();
        $this->assertCanManage($user, 'menghapus');
        [$project, $pdo] = $this->getProjectPdo($id, $user);
        $table = $this->assertTableName($table);

        try {
            $pdo->exec("DROP TABLE \"{$table}\" CASCADE;");
            Audit::log('table.drop', "{$project->slug}.{$table}", 'ok');

            return response()->json(['message' => "Tabel '{$table}' berhasil dihapus dari database."]);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Gagal menghapus tabel: ' . $e->getMessage()], 422);
        }
    }

    /**
     * Build a safe WHERE clause from the primary key or ctid.
     */
    protected function buildRowKeyWhere(PDO $pdo, string $table, array $rowKey, array $columns, array $primaryKey): array
    {
        $validCols = array_column($columns, 'column_name');

        if (isset($rowKey['_ctid']) && preg_match('/^\(\d+,\d+\)$/', (string)$rowKey['_ctid'])) {
            return ['where' => 'ctid = ?::tid', 'params' => [(string)$rowKey['_ctid']]];
        }

        if (empty($primaryKey)) {
            abort(422, 'Tabel ini tidak memiliki primary key. Sertakan _ctid untuk mengubah baris.');
        }

        $wheres = [];
        $params = [];
        foreach ($primaryKey as $pk) {
            if (!array_key_exists($pk, $rowKey)) {
                abort(422, "Nilai primary key '{$pk}' wajib disertakan.");
            }
            $wheres[] = "\"{$pk}\" = ?";
            $params[] = $rowKey[$pk];
        }

        return ['where' => implode(' AND ', $wheres), 'params' => $params];
    }

    /**
     * Normalize a value before binding to PDO.
     */
    protected function normalizeValue(mixed $value): mixed
    {
        if (is_array($value) || is_object($value)) {
            return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        return $value;
    }

    /**
     * Insert a row into a table.
     */
    public function insertRow(Request $r, int $id, string $table)
    {
        $user = $r->user();
        $this->assertCanManage($user, 'menambah data');
        [$project, $pdo] = $this->getProjectPdo($id, $user);
        $table = $this->assertTableName($table);

        $columns = $this->tableColumns($pdo, $table);
        if (empty($columns)) abort(404, "Tabel '{$table}' tidak ditemukan.");

        $values = $r->input('values', []);
        if (!is_array($values)) $values = [];

        $writable = [];
        foreach ($columns as $col) {
            $name = $col['column_name'];
            if ($col['is_generated'] === 'ALWAYS') continue;
            if ($col['is_identity'] === 'YES') continue;
            $writable[$name] = true;
        }

        $cols = [];
        $placeholders = [];
        $params = [];
        foreach ($values as $name => $value) {
            if (!isset($writable[$name])) continue;
            $cols[] = '"' . $name . '"';
            $placeholders[] = '?';
            $params[] = $this->normalizeValue($value);
        }

        try {
            if (empty($cols)) {
                $sql = "INSERT INTO \"{$table}\" DEFAULT VALUES RETURNING *";
                $stmt = $pdo->prepare($sql);
                $stmt->execute();
            } else {
                $sql = "INSERT INTO \"{$table}\" (" . implode(', ', $cols) . ') VALUES (' . implode(', ', $placeholders) . ') RETURNING *';
                $stmt = $pdo->prepare($sql);
                $stmt->execute($params);
            }

            $row = $stmt->fetch();
            Audit::log('table.row_insert', "{$project->slug}.{$table}", 'ok');

            return response()->json([
                'status' => 'success',
                'message' => 'Baris data berhasil ditambahkan.',
                'row' => $row,
            ], 201);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Gagal menambah baris: ' . $e->getMessage()], 422);
        }
    }

    /**
     * Update a row in a table.
     */
    public function updateRow(Request $r, int $id, string $table)
    {
        $user = $r->user();
        $this->assertCanManage($user, 'mengubah data');
        [$project, $pdo] = $this->getProjectPdo($id, $user);
        $table = $this->assertTableName($table);

        $columns = $this->tableColumns($pdo, $table);
        if (empty($columns)) abort(404, "Tabel '{$table}' tidak ditemukan.");
        $primaryKey = $this->tablePrimaryKey($pdo, $table);

        $values = $r->input('values', []);
        $rowKey = $r->input('row_key', []);
        if (!is_array($values) || empty($values)) {
            return response()->json(['message' => 'Tidak ada nilai yang diubah.'], 422);
        }
        if (!is_array($rowKey) || empty($rowKey)) {
            return response()->json(['message' => 'Kunci baris (row_key) wajib disertakan.'], 422);
        }

        $validCols = array_column($columns, 'column_name');
        $sets = [];
        $params = [];
        foreach ($values as $name => $value) {
            if (!in_array($name, $validCols, true)) continue;
            $sets[] = "\"{$name}\" = ?";
            $params[] = $this->normalizeValue($value);
        }
        if (empty($sets)) {
            return response()->json(['message' => 'Tidak ada kolom valid yang dapat diubah.'], 422);
        }

        $key = $this->buildRowKeyWhere($pdo, $table, $rowKey, $columns, $primaryKey);
        $sql = "UPDATE \"{$table}\" SET " . implode(', ', $sets) . ' WHERE ' . $key['where'] . ' RETURNING *';

        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute(array_merge($params, $key['params']));
            $row = $stmt->fetch();
            if (!$row) {
                return response()->json(['message' => 'Baris tidak ditemukan atau sudah berubah.'], 404);
            }
            Audit::log('table.row_update', "{$project->slug}.{$table}", 'ok');

            return response()->json([
                'status' => 'success',
                'message' => 'Baris data berhasil diperbarui.',
                'row' => $row,
            ]);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Gagal memperbarui baris: ' . $e->getMessage()], 422);
        }
    }

    /**
     * Delete a row from a table.
     */
    public function deleteRow(Request $r, int $id, string $table)
    {
        $user = $r->user();
        $this->assertCanManage($user, 'menghapus data');
        [$project, $pdo] = $this->getProjectPdo($id, $user);
        $table = $this->assertTableName($table);

        $columns = $this->tableColumns($pdo, $table);
        if (empty($columns)) abort(404, "Tabel '{$table}' tidak ditemukan.");
        $primaryKey = $this->tablePrimaryKey($pdo, $table);

        $rowKey = $r->input('row_key', []);
        if (!is_array($rowKey) || empty($rowKey)) {
            return response()->json(['message' => 'Kunci baris (row_key) wajib disertakan.'], 422);
        }

        $key = $this->buildRowKeyWhere($pdo, $table, $rowKey, $columns, $primaryKey);
        $sql = "DELETE FROM \"{$table}\" WHERE " . $key['where'];

        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($key['params']);
            if ($stmt->rowCount() === 0) {
                return response()->json(['message' => 'Baris tidak ditemukan atau sudah dihapus.'], 404);
            }
            Audit::log('table.row_delete', "{$project->slug}.{$table}", 'ok');

            return response()->json(['status' => 'success', 'message' => 'Baris data berhasil dihapus.']);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Gagal menghapus baris: ' . $e->getMessage()], 422);
        }
    }

    /**
     * Download table data directly as CSV.
     */
    public function downloadCsv(Request $r, int $id, string $table)
    {
        [$project, $pdo] = $this->getProjectPdo($id, $r->user());
        $table = $this->assertTableName($table);

        $filename = "{$project->slug}_{$table}_" . date('Ymd_His') . ".csv";

        return response()->streamDownload(function () use ($pdo, $table) {
            $handle = fopen('php://output', 'w');
            fprintf($handle, chr(0xEF) . chr(0xBB) . chr(0xBF));

            $stmt = $pdo->query("SELECT * FROM \"{$table}\"");
            $first = true;
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                if ($first) {
                    fputcsv($handle, array_keys($row));
                    $first = false;
                }
                $csvRow = array_map(function ($val) {
                    if (is_array($val) || is_object($val)) {
                        return json_encode($val, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                    }
                    return $val;
                }, $row);
                fputcsv($handle, $csvRow);
            }
            fclose($handle);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    /**
     * Download entire database (all tables) packaged in a ZIP archive of CSV files.
     */
    public function downloadDatabaseZip(Request $r, int $id)
    {
        [$project, $pdo] = $this->getProjectPdo($id, $r->user());

        $tablesStmt = $pdo->query("
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name ASC
        ");
        $tables = $tablesStmt->fetchAll(PDO::FETCH_COLUMN);

        if (empty($tables)) {
            abort(404, 'Tidak ada tabel pada database ini untuk diekspor.');
        }

        $zipFile = tempnam(sys_get_temp_dir(), 'db_export_') . '.zip';
        $zip = new \ZipArchive();
        if ($zip->open($zipFile, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            abort(500, 'Gagal membuat arsip ZIP.');
        }

        foreach ($tables as $t) {
            $temp = fopen('php://temp', 'r+');
            fprintf($temp, chr(0xEF) . chr(0xBB) . chr(0xBF));

            $stmt = $pdo->query("SELECT * FROM \"{$t}\"");
            $first = true;
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                if ($first) {
                    fputcsv($temp, array_keys($row));
                    $first = false;
                }
                $csvRow = array_map(function ($val) {
                    if (is_array($val) || is_object($val)) {
                        return json_encode($val, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                    }
                    return $val;
                }, $row);
                fputcsv($temp, $csvRow);
            }
            rewind($temp);
            $csvContent = stream_get_contents($temp);
            fclose($temp);

            $zip->addFromString("{$t}.csv", $csvContent);
        }

        $zip->close();
        $downloadName = "{$project->slug}_full_database_" . date('Ymd_His') . ".zip";

        Audit::log('database.export_csv_zip', $project->slug, 'ok');

        return response()->download($zipFile, $downloadName)->deleteFileAfterSend(true);
    }
}
