# POSTGRES MANAGER — Centralized PostgreSQL Project Management

Dashboard web (Laravel 11 + React/TypeScript/Vite/Tailwind) untuk mengelola banyak database PostgreSQL proyek di Raspberry Pi 4, tanpa konfigurasi manual lewat SSH.

## 1. Status fitur (jujur)

| Modul | Status |
|---|---|
| Login admin (session, CSRF, rate limit 5/menit, logout, audit login) | ✅ Ada |
| Master DB + 11 tabel (migrations) + 4 template bawaan | ✅ Ada |
| Dashboard: versi/host/port PG, koneksi, ukuran DB, CPU, RAM, disk, Tailscale | ✅ Ada (data nyata) |
| Project manager: daftar, cari, buat, arsip (API) | ✅ Ada |
| Provisioning wizard (role, DB, privilege, template, direktori, .env 0600, registrasi, audit, rollback kompensasi) | ✅ Ada |
| Backup per-database (pg_dump -Fc, sha256, riwayat, download aman) | ✅ Ada di API; tombol UI belum |
| Full backup (`pg_dumpall`) | ✅ Skrip + cron |
| Audit log | ✅ Ada |
| Edit proyek, hapus proyek dengan safeguard | ⏳ Belum |
| Database Explorer + SQL editor | ⏳ Belum |
| Konfigurasi PostgreSQL (ALTER SYSTEM) | ⏳ Belum |
| Manajemen user/role DB | ⏳ Belum |
| Restore, verifikasi integritas, backup terjadwal otomatis | ⏳ Belum |
| Template kustom, tema terang, monitoring lanjutan, ganti password | ⏳ Belum |

**Belum diuji di Raspberry Pi sungguhan.** Kode ditulis tanpa akses ke server Anda. Jalankan `discover.sh` dulu, lalu kirim error pemasangan agar bisa diperbaiki per batch.

## 2. Struktur

```
postgres-manager/
├── app/backend-overlay/   # kode Laravel (di-overlay ke skeleton hasil composer)
├── app/frontend/          # React + TS + Vite + Tailwind
├── run.sh                 # installer satu perintah
├── deployment/{nginx,scripts}
├── projects/  storage/  security/  master/
```
`app/backend/` dibuat oleh `run.sh` (composer create-project) lalu ditimpa overlay.

## 3. Cara pakai (satu perintah)

Prasyarat: Raspberry Pi OS 64-bit dengan PostgreSQL yang sudah berjalan (default port 5433), internet aktif, user biasa yang punya `sudo`.

```bash
mkdir -p ~/Database && cd ~/Database
unzip ~/postgres-manager.zip && cd postgres-manager
bash run.sh
```

`run.sh` mengerjakan semuanya otomatis dan aman diulang:
1. Memasang paket (nginx, php-fpm, php-pgsql, composer, node, acl, dll.)
2. Membuat skeleton Laravel + menimpa dengan kode aplikasi
3. Membuat `.env` dengan password acak (APP_KEY, DB, provisioner)
4. Membuat role `pgm_app`, `pgm_provisioner` dan database `postgres_master` (database lain, termasuk SmartRoom, tidak disentuh)
5. Migrasi master DB + membuat admin `nnaufalasyam7@gmail.com` dengan **password acak yang ditampilkan sekali di akhir**
6. Build frontend React
7. Konfigurasi Nginx di port 8080 + reload
8. Mengatur izin `www-data`, lalu health check

Pertama kali bisa 10-20 menit di Pi (composer + npm). Setelah selesai, buka alamat yang dicetak di akhir (LAN atau Tailscale).

Perintah lain: `bash run.sh status`, `bash run.sh reset-admin` (password admin baru), `./deployment/scripts/update.sh` (git pull + run.sh).

Ingin aman walau terminal ditutup/logout? Jalankan `bash run.sh bg`. Instalasi berjalan di latar belakang; log tersimpan di `logs/install-*.log` (tautan terbaru: `logs/latest.log`). Pantau dari terminal lain dengan `tail -f logs/latest.log`, lalu cek `bash run.sh status`.
Opsi: `PGPORT=5433 WEB_PORT=8080 ADMIN_PASSWORD=... bash run.sh`.

Jika login peer `postgres` tidak tersedia, script menanyakan superuser PostgreSQL sekali (tidak disimpan). Jika koneksi password ke 127.0.0.1 ditolak, tambahkan di `pg_hba.conf`: `host all all 127.0.0.1/32 scram-sha-256`, reload PostgreSQL, ulangi `bash run.sh`.

## 4. Discovery manual (opsional, hanya baca)
```bash
PGUSER=smartroom PGPASSWORD='...' ./deployment/scripts/discover.sh
```

## 5. Nginx
Dibuat otomatis oleh `run.sh` (`/etc/nginx/sites-available/postgres-manager`). Batasi akses bila perlu: `sudo ufw allow in on tailscale0 to any port 8080`.

## 6. Pemakaian singkat
1. Login → Dashboard menampilkan metrik server nyata.
2. **Proyek → + Proyek** → isi wizard → password proyek tampil **sekali**; tersimpan terenkripsi (APP_KEY) di master DB dan di `projects/<slug>/config/.env` (0600).
3. Backup: `POST /api/projects/{id}/backups`; file di `projects/<slug>/backups/`.
4. Full backup terjadwal: `0 2 * * * PGUSER=postgres PGPASSWORD=... /home/pi/Database/postgres-manager/deployment/scripts/backup-all.sh`
5. Update: `./deployment/scripts/update.sh`

## 7. Pengembangan lokal
```bash
cd app/backend && php artisan serve      # :8000
cd app/frontend && npm run dev           # :5173, proxy /api → :8000
```

## 8. Roadmap
Explorer read-only → SQL editor (default read-only) → config PostgreSQL → role/user → restore + verifikasi → backup terjadwal → hapus proyek bersafeguard.

Lihat `SECURITY.md` dan `TROUBLESHOOTING.md`.
