<?php
return [
    'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', 5433),
    'admin_user' => env('PGM_ADMIN_USER'),
    'admin_password' => env('PGM_ADMIN_PASSWORD'),
    'root' => env('PGM_ROOT'),
    'admin_email' => env('PGM_ADMIN_EMAIL'),
    'reserved' => ['postgres','template0','template1','postgres_master','pgm_app','pgm_provisioner'],
];
