<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
final class Audit {
    public static function log(string $action, ?string $subject = null, string $status = 'ok', array $meta = []): void {
        $meta = array_filter($meta, fn($k) => !preg_match('/pass|secret|token|key/i', (string)$k), ARRAY_FILTER_USE_KEY);
        DB::table('audit_logs')->insert(['user_id'=>auth()->id(),'action'=>$action,'subject'=>$subject,'status'=>$status,
            'ip'=>request()->ip(),'meta'=>json_encode($meta)]);
    }
}
