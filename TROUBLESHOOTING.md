# Troubleshooting
| Gejala | Penyebab / solusi |
|---|---|
| Dashboard "DOWN" | Cek `PGM_ADMIN_*`, port 5433, dan `pg_hba.conf` untuk `pgm_provisioner` |
| `password authentication failed` | Auth di `pg_hba.conf` harus `scram-sha-256`/`md5` untuk 127.0.0.1 |
| 419 saat login | Cookie XSRF tidak terkirim: akses lewat satu origin (Nginx :8080) |
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
