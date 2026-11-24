# POSTGRES MANAGER — Centralized PostgreSQL Project Management

Dashboard web (Laravel 11 + React/TypeScript/Vite/Tailwind) untuk mengelola banyak database PostgreSQL proyek di Raspberry Pi 4, tanpa konfigurasi manual lewat SSH.

## 1. Status fitur (jujur)

| Modul | Status |
|---|---|
| Login admin (session, CSRF, rate limit 5/menit, logout, audit login) | ✅ Ada |
| Git Repositories (antarmuka mirip GitHub: file explorer, drag & drop upload, online code editor, download raw/zip, riwayat commit) | ✅ Ada |
| Inisiasi database dari repository: auto-deteksi skema (file `.sql` + SQL inline Python/JS/PHP), buat tabel, auto-sync `.env`/`config.env`, auto-connect | ✅ Ada |
| Master DB + 11 tabel (migrations) + 4 template bawaan | ✅ Ada |
| Dashboard: versi/host/port PG, koneksi, ukuran DB, CPU, RAM, disk, Tailscale | ✅ Ada (data nyata) |
| Project manager: daftar, cari, buat, arsip (API) | ✅ Ada |
| Provisioning wizard (role, DB, privilege, template, direktori, .env 0600, registrasi, audit, rollback kompensasi) | ✅ Ada |
| Backup per-database (pg_dump -Fc, sha256, riwayat, download aman) | ✅ Ada di API; tombol UI belum |
| Full backup (`pg_dumpall`) | ✅ Skrip + cron |
| Audit log | ✅ Ada |
| RBAC 3 level: Super Admin, Admin Terbatas (workspace mandiri), Operator (read-only) | ✅ Ada |
| Database Explorer per proyek: lihat tabel & tipe data, generate tabel, edit/rename/hapus kolom, CRUD baris, unduh CSV / ZIP seluruh DB | ✅ Ada |
| Konektor platform IoT: Blynk (token/URL), Zenoh (REST/TCP), MQTT (broker/topic) + webhook telemetri | ✅ Ada |
| Edit proyek, hapus proyek dengan safeguard | ⏳ Belum |
| SQL editor bebas (di luar skrip repo) | ⏳ Belum |
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
2. **Repositories (Mirip GitHub)** → Jelajahi kode dan script SQL:
   - **File Explorer**: Navigasi struktur folder, lihat ukuran dan pesan commit terakhir.
   - **Drag & Drop Upload**: Tarik file langsung ke halaman web untuk mengunggah dan otomatis membuat commit Git.
   - **Online Editor**: Edit file langsung di web dengan riwayat commit dan format diff.
   - **Download Raw / ZIP**: Unduh file satuan atau seluruh repository dalam format .zip.
   - **Multi-Repository**: Buat repository baru langsung dari web.

### Inisiasi Database Langsung dari Repository (Auto-Connect)
1. Buka tab **Repositories** → pilih repository → klik **+ Inisiasi Database Repo**.
2. Aplikasi memindai repo dan menampilkan **skema yang dibutuhkan program secara otomatis**:
   - file `.sql` / `.pgsql` (`schema.sql`, `init.sql`, `migrations/*.sql`, dump, dsb.);
   - SQL inline di kode Python (contoh Smartroom: `SCHEMA = """CREATE TABLE ..."""` di `backend/main.py`);
   - SQL inline di template literal JavaScript/TypeScript dan heredoc PHP.
3. Klik **Buat Database & Hubungkan Langsung**. Dalam satu langkah:
   - role + database PostgreSQL dibuat;
   - tabel/index dari skema yang terdeteksi langsung dieksekusi;
   - `.env` (dan `config.env` legacy seperti Smartroom) di repo diisi kredensial + `DATABASE_URL`;
   - proyek terdaftar dan langsung terhubung ke repo.
4. Buka **Deploy** pada proyek → program berjalan dengan database yang sudah siap.
5. Untuk database yang **sudah ada**, pilih tab **Hubungkan yang Sudah Ada**, lalu klik **Terapkan Skema Repo** bila tabelnya belum ada. Tombol **Sync .env** menyinkronkan ulang kredensial kapan saja.

3. **Proyek → + Proyek** → isi wizard → password proyek tampil **sekali**; tersimpan terenkripsi (APP_KEY) di master DB dan di `projects/<slug>/config/.env` (0600).
4. **Auto Deploy Proyek Database & Akses via IP:Port**:
   - Setiap proyek database dapat langsung di-deploy menjadi layanan web/API aktif.
   - Deteksi profil aplikasi otomatis: Python FastAPI / Uvicorn, Shell Script, atau Built-in PostgreSQL REST API & Database Explorer.
   - Layanan dialokasikan port unik (8200, 8201, dst.) dan dapat diakses langsung via IP LAN (`http://<LAN_IP>:<PORT>`) maupun Tailscale VPN (`http://<TS_IP>:<PORT>`).
   - Status deployment, tombol kontrol (Auto Deploy, Restart, Stop), log konsol real-time, dan tautan akses langsung ditampilkan di Dashboard (per-proyek & global) serta tab Proyek DB.
5. Backup: `POST /api/projects/{id}/backups`; file di `projects/<slug>/backups/`.
6. Full backup terjadwal: `0 2 * * * PGUSER=postgres PGPASSWORD=... /home/pi/Database/postgres-manager/deployment/scripts/backup-all.sh`
7. Update: `./deployment/scripts/update.sh`
8. **Tabel Database (per proyek/repo)**: buka tab **Tabel Database**, pilih proyek, atau klik **Tabel DB** pada baris proyek / **Kelola Tabel DB** di halaman repository yang terhubung ke proyek.
   - **Generate tabel** lewat form klik-klik: nama tabel, kolom, tipe data, primary key, NOT NULL, UNIQUE, dan default.
   - **Edit struktur**: tambah kolom, ubah tipe/default/NOT NULL, rename kolom, rename tabel, hapus kolom/tabel.
   - **Kelola isi**: browse data dengan pagination & sorting, tambah/edit/hapus baris (termasuk kolom JSONB).
   - **Ekspor**: unduh satu tabel sebagai CSV atau seluruh database sebagai ZIP berisi CSV.
   - Operator (`user`) hanya bisa melihat & mengunduh; pembuatan/perubahan dikunci untuk Admin Terbatas & Super Admin.
9. **Platform & IoT**: hubungkan database proyek ke Blynk, Zenoh (Zenoh-Pico/REST), atau MQTT memakai URL/token/topic. Tersedia uji koneksi, sinkronisasi manual, worker background, log real-time, dan webhook publik untuk menerima telemetri.

## 7. Pengembangan lokal
```bash
cd app/backend && php artisan serve      # :8000
cd app/frontend && npm run dev           # :5173, proxy /api → :8000
```

## 8. Roadmap
~~Explorer read-only~~ (✅ Database Explorer + visual table builder) → SQL editor (default read-only) → config PostgreSQL → role/user → restore + verifikasi → backup terjadwal → hapus proyek bersafeguard.

Lihat `SECURITY.md` dan `TROUBLESHOOTING.md`.
