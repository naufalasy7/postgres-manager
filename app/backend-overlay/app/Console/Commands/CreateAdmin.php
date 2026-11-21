<?php
namespace App\Console\Commands;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;

class CreateAdmin extends Command {
    protected $signature = 'pgm:create-admin {--if-missing : lewati (exit 2) jika admin sudah ada}';
    protected $description = 'Buat/reset akun admin (password dari env PGM_INITIAL_PASSWORD atau prompt)';
    public function handle(): int {
        $email = config('pgmanager.admin_email') ?: env('PGM_ADMIN_EMAIL');
        if ($this->option('if-missing') && User::where('email', $email)->exists()) { $this->info('Admin sudah ada, dilewati.'); return 2; }
        $pw = env('PGM_INITIAL_PASSWORD') ?: $this->secret('Password admin (min 12 karakter)');
        if (strlen((string)$pw) < 6) { $this->error('Password minimal 6 karakter'); return 1; }
        $u = User::firstOrNew(['email' => $email]);
        $u->forceFill(['name' => 'Administrator', 'password' => Hash::make($pw), 'role' => 'super_admin'])->save();
        $this->info("Admin siap: $email");
        return 0;
    }
}
