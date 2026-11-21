<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::table('projects', function (Blueprint $t) {
            $t->unsignedInteger('deploy_port')->nullable()->after('repository');
            $t->string('deploy_status')->default('stopped')->after('deploy_port');
            $t->string('deploy_type')->default('auto')->after('deploy_status');
            $t->text('deploy_command')->nullable()->after('deploy_type');
            $t->string('deploy_dir')->nullable()->after('deploy_command');
            $t->unsignedInteger('deploy_pid')->nullable()->after('deploy_dir');
            $t->boolean('auto_deploy')->default(false)->after('deploy_pid');
            $t->timestamp('deployed_at')->nullable()->after('auto_deploy');
            $t->text('deploy_error')->nullable()->after('deployed_at');
        });
    }

    public function down(): void {
        Schema::table('projects', function (Blueprint $t) {
            $t->dropColumn([
                'deploy_port',
                'deploy_status',
                'deploy_type',
                'deploy_command',
                'deploy_dir',
                'deploy_pid',
                'auto_deploy',
                'deployed_at',
                'deploy_error',
            ]);
        });
    }
};
