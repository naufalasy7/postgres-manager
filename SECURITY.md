# Keamanan
- **Identifier SQL**: hanya lewat `Pg::id()` (whitelist regex lalu quote); nilai lewat `PDO::quote`/prepared statement.
- **Kredensial**: password proyek dienkripsi `Crypt` (APP_KEY) di `database_connections`; `.env` proyek mode 0600; audit log menyaring key bertema pass/secret/token.
- **Pemisahan peran**: `pgm_app` hanya memiliki `postgres_master`; `pgm_provisioner` = CREATEDB+CREATEROLE tanpa superuser; role proyek NOSUPERUSER/NOCREATEDB/NOCREATEROLE dan `REVOKE ALL ... FROM PUBLIC` pada DB-nya.
- **Web**: cookie session HttpOnly + SameSite=strict, CSRF (header XSRF), throttle login, hanya role `admin`.
- **Shell**: tidak ada shell dari browser. Proses (`pg_dump`, `tailscale ip`) memakai argumen tetap/array.
- **Download backup**: `realpath` harus berada di bawah `PGM_ROOT/projects`.
- **Jaringan**: PostgreSQL tetap di 127.0.0.1; dashboard hanya LAN/Tailscale. Tailscale mengenkripsi lalu lintas; di LAN, HTTP tidak terenkripsi — pasang TLS bila perlu.
- **APP_KEY**: simpan backup-nya; bila hilang, password terenkripsi tidak bisa dibaca.
- File `.dump` berisi data penuh — jaga izin 0600.
