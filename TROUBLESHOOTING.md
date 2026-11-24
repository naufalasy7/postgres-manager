# Troubleshooting
| Gejala | Penyebab / solusi |
|---|---|
| Dashboard "DOWN" | Cek `PGM_ADMIN_*`, port 5433, dan `pg_hba.conf` untuk `pgm_provisioner` |
| `password authentication failed` | Auth di `pg_hba.conf` harus `scram-sha-256`/`md5` untuk 127.0.0.1 |
| 419 saat login | Cookie XSRF tidak terkirim: akses lewat satu origin (Nginx :8080) |
| Login selalu "Kredensial salah" padahal password benar | Cek tabel `users` di master DB: `psql -h 127.0.0.1 -p 5433 -U pgm_app -d postgres_master -c "select email,role from users;"`. Jika kosong, buat ulang dari `app/backend`: `PGM_INITIAL_PASSWORD='<password>' php artisan pgm:create-admin`. Pastikan email utama ber-role `super_admin`. |
| 500 di /api | `tail -f app/backend/storage/logs/laravel-*.log`; `storage/` harus writable oleh www-data |
| 502 Bad Gateway | Nama socket PHP-FPM beda: `ls /run/php/` lalu ubah di Nginx |
| "permission denied to create role/database" | `pgm_provisioner` harus CREATEROLE + CREATEDB |
| Rollback gagal DROP DATABASE (PG16+) | `GRANT "<role>" TO pgm_provisioner WITH INHERIT TRUE;` lalu drop manual |
| `pg_dump: command not found` | `sudo apt install postgresql-client` (versi client ≥ server) |
| Gagal buat direktori proyek | Beri tulis ke `PGM_ROOT/projects` untuk www-data |
| Tailscale "tidak terdeteksi" | `tailscale` harus ada di PATH user www-data |
| `run.sh` berhenti di tengah | Baca pesan XX merah, perbaiki, jalankan `bash run.sh` lagi (idempotent) |
| Terminal putus / logout saat instalasi | Pakai `bash run.sh bg`, lalu pantau `tail -f logs/latest.log` dari terminal lain |
| `apt`: `you have held broken packages` | Script mencoba `dpkg --configure -a` + `apt-get -f install` otomatis. Bila tetap gagal: `sudo dpkg --configure -a && sudo apt-get -f install` |
| Port 8080 dipakai | `WEB_PORT=8081 bash run.sh` |
| `apt` gagal: `unmet dependencies` pada `npm`/`nodejs` | Jangan pasang `npm` dari repo Debian (bentrok dengan NodeSource). Versi `run.sh` terbaru memasang Node 22 hanya bila `node`/`npm` belum ada; jalankan ulang `bash run.sh` |
| 403 pada halaman | `getfacl ~` harus ada `user:www-data:--x`; jalankan ulang `bash run.sh` |
| Tabel tidak muncul setelah "Buat Database" dari repo | Pastikan modal menampilkan **Skema Program Terdeteksi Otomatis**. Bila kosong, tambahkan file `.sql` atau SQL `CREATE TABLE` inline di kode. Setelah database terhubung, klik **Terapkan Skema Repo** di halaman repository dan cek pesan peringatan. |
| `.env` / `config.env` repo tidak berubah | Klik **Sync .env** di banner database repository; pastikan folder `repositories/<repo>` dapat ditulis oleh `www-data`. |
