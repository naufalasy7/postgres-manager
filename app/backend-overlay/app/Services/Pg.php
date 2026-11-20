<?php
namespace App\Services;
/** Satu-satunya pintu untuk identifier SQL: whitelist ketat, lalu quote. */
final class Pg {
    public static function id(string $s): string {
        if (!preg_match('/^[a-z][a-z0-9_]{2,40}$/', $s)) throw new \InvalidArgumentException('Identifier tidak valid');
        return '"' . $s . '"';
    }
}
