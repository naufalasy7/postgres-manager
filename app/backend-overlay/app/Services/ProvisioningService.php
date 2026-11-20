<?php
namespace App\Services;
use PDO;
use Illuminate\Support\Facades\{DB, Crypt};

class ProvisioningService {
    public function admin(string $db = 'postgres', ?string $user = null, ?string $pass = null): PDO {
        $c = config('pgmanager');
        return new PDO("pgsql:host={$c['host']};port={$c['port']};dbname=$db", $user ?? $c['admin_user'], $pass ?? $c['admin_password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    }

    /** Provisioning dengan compensating rollback (CREATE DATABASE tidak bisa di dalam transaksi). */
    public function create(array $d): array {
        $db = $d['db_name']; $user = $d['db_user']; $slug = $d['slug'];
        $made = ['role' => false, 'db' => false, 'dir' => null];
        $pass = bin2hex(random_bytes(16));
        $steps = []; $pdo = null;
        try {
            $pdo = $this->admin();
            $q = $pdo->prepare('SELECT 1 FROM pg_database WHERE datname=?'); $q->execute([$db]);
            if ($q->fetch()) throw new \RuntimeException("Database '$db' sudah ada");
            $q = $pdo->prepare('SELECT 1 FROM pg_roles WHERE rolname=?'); $q->execute([$user]);
            if ($q->fetch()) throw new \RuntimeException("Role '$user' sudah ada");
            $steps[] = 'validasi + cek ketersediaan';

            $pdo->exec('CREATE ROLE '.Pg::id($user).' LOGIN PASSWORD '.$pdo->quote($pass).' NOSUPERUSER NOCREATEDB NOCREATEROLE'); $made['role'] = true;
            try { $pdo->exec('GRANT '.Pg::id($user).' TO CURRENT_USER'); } catch (\Throwable) {} // PG16+: agar rollback bisa DROP
            $steps[] = 'role dibuat';

            $pdo->exec('CREATE DATABASE '.Pg::id($db).' OWNER '.Pg::id($user).' TEMPLATE template0 ENCODING '.$pdo->quote($d['encoding'])
                .' LC_COLLATE '.$pdo->quote($d['locale']).' LC_CTYPE '.$pdo->quote($d['locale'])); $made['db'] = true;
            $pdo->exec('REVOKE ALL ON DATABASE '.Pg::id($db).' FROM PUBLIC');
            $steps[] = 'database dibuat + privilege';

            $tpl = DB::table('database_templates')->find($d['template_id']);
            if ($tpl && trim($tpl->sql_init ?? '') !== '') { $this->admin($db, $user, $pass)->exec($tpl->sql_init); $steps[] = "template '{$tpl->name}' diinisialisasi"; }

            // Inisialisasi skrip SQL dari repository terhubung bila dipilih
            if (!empty($d['repository']) && !empty($d['init_sql_path'])) {
                $root = config('pgmanager.root') ?: base_path('../../');
                $sqlFile = rtrim($root, '/') . '/repositories/' . trim($d['repository'], '/') . '/' . trim($d['init_sql_path'], '/');
                if (file_exists($sqlFile)) {
                    $repoSql = file_get_contents($sqlFile);
                    if ($repoSql) {
                        $this->admin($db, $user, $pass)->exec($repoSql);
                        $steps[] = "skrip '{$d['init_sql_path']}' dari repo '{$d['repository']}' dieksekusi";
                    }
                }
            }

            $dir = rtrim(config('pgmanager.root'), '/')."/projects/$slug";
            foreach (['config','migrations','backups','exports','logs'] as $s) if (!is_dir("$dir/$s")) mkdir("$dir/$s", 0750, true);
            $made['dir'] = $dir;
            $env = "DB_HOST=".config('pgmanager.host')."\nDB_PORT=".config('pgmanager.port')."\nDB_DATABASE=$db\nDB_USERNAME=$user\nDB_PASSWORD=$pass\n";
            file_put_contents("$dir/config/.env", $env); chmod("$dir/config/.env", 0600);
            $steps[] = 'direktori + .env (0600)';

            $pid = DB::transaction(function () use ($d, $dir, $pass) {
                $id = DB::table('projects')->insertGetId([
                    'name' => $d['name'],
                    'slug' => $d['slug'],
                    'description' => $d['description'] ?? null,
                    'template_id' => $d['template_id'],
                    'repository' => $d['repository'] ?? null,
                    'directory' => $dir,
                    'backup_policy' => $d['backup_policy'],
                    'created_by' => auth()->id(),
                    'created_at' => now(),
                    'updated_at' => now()
                ]);
                DB::table('project_databases')->insert(['project_id'=>$id,'db_name'=>$d['db_name'],'db_user'=>$d['db_user'],'encoding'=>$d['encoding'],'locale'=>$d['locale'],'created_at'=>now(),'updated_at'=>now()]);
                DB::table('database_connections')->insert(['project_id'=>$id,'host'=>config('pgmanager.host'),'port'=>config('pgmanager.port'),'db_name'=>$d['db_name'],'username'=>$d['db_user'],'password_encrypted'=>Crypt::encryptString($pass),'created_at'=>now(),'updated_at'=>now()]);
                DB::table('database_operations')->insert(['project_id'=>$id,'operation'=>'provision','status'=>'ok','user_id'=>auth()->id(),'created_at'=>now(),'updated_at'=>now()]);
                return $id;
            });
            $steps[] = 'terdaftar di postgres_master';
            Audit::log('project.create', $slug, 'ok', ['db' => $db]);
            return ['project_id' => $pid, 'db_name' => $db, 'db_user' => $user, 'password' => $pass, 'host' => config('pgmanager.host'), 'port' => config('pgmanager.port'), 'steps' => $steps];
        } catch (\Throwable $e) {
            $report = [];
            try {
                $pdo = $pdo ?? $this->admin();
                if ($made['db']) { $pdo->exec('DROP DATABASE IF EXISTS '.Pg::id($db).' WITH (FORCE)'); $report[] = 'database di-rollback'; }
                if ($made['role']) { $pdo->exec('DROP ROLE IF EXISTS '.Pg::id($user)); $report[] = 'role di-rollback'; }
                if ($made['dir']) { @unlink($made['dir'].'/config/.env'); $report[] = 'direktori dibiarkan utk inspeksi: '.$made['dir']; }
            } catch (\Throwable $r) { $report[] = 'ROLLBACK GAGAL, periksa manual: '.$r->getMessage(); }
            Audit::log('project.create', $slug, 'failed', ['error' => $e->getMessage(), 'rollback' => $report]);
            throw new \RuntimeException($e->getMessage().' | state: '.(implode('; ', $report) ?: 'tidak ada perubahan'));
        }
    }
}
