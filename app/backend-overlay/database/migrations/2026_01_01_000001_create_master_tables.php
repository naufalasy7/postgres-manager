<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\{Schema, DB};

return new class extends Migration {
    public function up(): void {
        Schema::table('users', fn(Blueprint $t) => $t->string('role')->default('admin'));
        Schema::create('database_templates', function (Blueprint $t) {
            $t->id(); $t->string('name')->unique(); $t->text('description')->nullable();
            $t->text('sql_init')->nullable(); $t->boolean('is_builtin')->default(false); $t->timestamps();
        });
        Schema::create('projects', function (Blueprint $t) {
            $t->id(); $t->string('name'); $t->string('slug')->unique(); $t->text('description')->nullable();
            $t->string('status')->default('active'); $t->foreignId('template_id')->nullable()->constrained('database_templates')->nullOnDelete();
            $t->string('directory'); $t->string('backup_policy')->default('none');
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete(); $t->timestamps();
        });
        Schema::create('project_databases', function (Blueprint $t) {
            $t->id(); $t->foreignId('project_id')->constrained()->cascadeOnDelete();
            $t->string('db_name')->unique(); $t->string('db_user')->unique();
            $t->string('encoding'); $t->string('locale'); $t->timestamps();
        });
        Schema::create('project_configurations', function (Blueprint $t) {
            $t->id(); $t->foreignId('project_id')->constrained()->cascadeOnDelete();
            $t->string('key'); $t->text('value')->nullable(); $t->timestamps(); $t->unique(['project_id','key']);
        });
        Schema::create('database_connections', function (Blueprint $t) {
            $t->id(); $t->foreignId('project_id')->constrained()->cascadeOnDelete();
            $t->string('host'); $t->unsignedInteger('port'); $t->string('db_name'); $t->string('username');
            $t->text('password_encrypted'); $t->timestamps();
        });
        Schema::create('database_backups', function (Blueprint $t) {
            $t->id(); $t->foreignId('project_id')->nullable()->constrained()->nullOnDelete();
            $t->string('type')->default('manual'); $t->string('file_path'); $t->unsignedBigInteger('size_bytes')->default(0);
            $t->string('sha256')->nullable(); $t->string('status'); $t->text('error')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete(); $t->timestamps();
        });
        Schema::create('database_operations', function (Blueprint $t) {
            $t->id(); $t->foreignId('project_id')->nullable()->constrained()->nullOnDelete();
            $t->string('operation'); $t->string('status'); $t->jsonb('details')->nullable();
            $t->foreignId('user_id')->nullable()->constrained()->nullOnDelete(); $t->timestamps();
        });
        Schema::create('audit_logs', function (Blueprint $t) {
            $t->id(); $t->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $t->string('action'); $t->string('subject')->nullable(); $t->string('status')->default('ok');
            $t->string('ip', 45)->nullable(); $t->jsonb('meta')->nullable(); $t->timestamp('created_at')->useCurrent();
        });
        Schema::create('system_settings', function (Blueprint $t) { $t->string('key')->primary(); $t->text('value')->nullable(); $t->timestamps(); });
        Schema::create('project_members', function (Blueprint $t) {
            $t->id(); $t->foreignId('project_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete(); $t->string('role')->default('viewer'); $t->timestamps();
            $t->unique(['project_id','user_id']);
        });

        $now = now();
        $tpl = [
            ['Empty PostgreSQL', 'Database kosong', ''],
            ['IoT Starter', 'Tabel devices + sensor_readings', "CREATE TABLE devices(id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text, created_at timestamptz DEFAULT now());\nCREATE TABLE sensor_readings(id bigserial PRIMARY KEY, device_id int REFERENCES devices(id), metric text NOT NULL, value double precision NOT NULL, ts timestamptz DEFAULT now());\nCREATE INDEX ON sensor_readings(device_id, ts DESC);"],
            ['SmartRoom Starter', 'Skema dasar SmartRoom (room, reading)', "CREATE TABLE rooms(id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text);\nCREATE TABLE room_readings(id bigserial PRIMARY KEY, room_id int REFERENCES rooms(id), temperature real, humidity real, ts timestamptz DEFAULT now());\nCREATE INDEX ON room_readings(room_id, ts DESC);"],
            ['REST API Starter', 'app_users + api_tokens', "CREATE TABLE app_users(id serial PRIMARY KEY, email text UNIQUE NOT NULL, created_at timestamptz DEFAULT now());\nCREATE TABLE api_tokens(id serial PRIMARY KEY, user_id int REFERENCES app_users(id) ON DELETE CASCADE, token_hash text NOT NULL, created_at timestamptz DEFAULT now());"],
        ];
        foreach ($tpl as [$n,$d,$s]) DB::table('database_templates')->insert(['name'=>$n,'description'=>$d,'sql_init'=>$s,'is_builtin'=>true,'created_at'=>$now,'updated_at'=>$now]);
    }
    public function down(): void {
        foreach (['project_members','system_settings','audit_logs','database_operations','database_backups','database_connections','project_configurations','project_databases','projects','database_templates'] as $t) Schema::dropIfExists($t);
        Schema::table('users', fn(Blueprint $t) => $t->dropColumn('role'));
    }
};
