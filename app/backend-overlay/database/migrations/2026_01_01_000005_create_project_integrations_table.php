<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('project_integrations')) {
            Schema::create('project_integrations', function (Blueprint $t) {
                $t->id();
                $t->foreignId('project_id')->constrained('projects')->cascadeOnDelete();
                $t->string('platform'); // blynk, zenoh, mqtt
                $t->string('name');
                $t->text('url');
                $t->text('token')->nullable();
                $t->string('username')->nullable();
                $t->string('topic_or_key')->nullable(); // e.g. V0,V1 or sensors/# or sensors/**
                $t->string('target_table')->default('iot_telemetry');
                $t->jsonb('config')->nullable(); // extra options: interval, qos, client_id, mapping
                $t->string('status')->default('stopped'); // stopped, running, connected, error
                $t->unsignedInteger('worker_pid')->nullable();
                $t->string('webhook_token', 64)->unique();
                $t->timestamp('last_sync_at')->nullable();
                $t->unsignedBigInteger('packets_count')->default(0);
                $t->text('last_error')->nullable();
                $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $t->timestamps();
            });
        }
    }

    public function down(): void {
        Schema::dropIfExists('project_integrations');
    }
};
