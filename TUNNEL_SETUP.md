# Panduan Konfigurasi HTTPS Tunnel (Cloudflare & ngrok)

Panduan ini menjelaskan cara menghubungkan frontend di **Vercel** (`https://postgres-manager.vercel.app`) ke **Backend Postgres Manager** lokal Anda menggunakan tunnel HTTPS publik (**Cloudflare Tunnel** atau **ngrok**).

Dengan HTTPS Tunnel:
- Frontend di Vercel dapat memanggil API backend tanpa terblokir *Mixed Content* (HTTPS ke HTTP).
- Backend dapat diakses dari mana saja secara aman melalui internet.

---

## 1. Persiapan Binary (Sudah Terpasang di Server)
Di server Anda, kedua tool telah terpasang di `/usr/local/bin`:
- `cloudflared` (Cloudflare Tunnel CLI)
- `ngrok` (ngrok CLI)

Telah disediakan skrip helper otomatis: `tunnel.sh` di root direktori proyek.

---

## 2. Opsi A: Cloudflare Quick Tunnel (Sangat Direkomendasikan - Gratis & Tanpa Akun)

Cloudflare Quick Tunnel memberikan URL HTTPS instan langsung tanpa perlu mendaftar akun atau menyiapkan domain.

### Cara Menjalankan:
Jalankan perintah berikut di terminal:
```bash
bash tunnel.sh cloudflare
```

Skrip akan menampilkan banner seperti ini:
```
==================================================================
  CLOUDFLARE HTTPS TUNNEL AKTIF!
==================================================================
  Public HTTPS URL : https://nama-acak-anda.trycloudflare.com
  Forwarding Ke    : http://127.0.0.1:8081
  PID              : 12345
==================================================================
```

### Cara Pakai di Vercel:
1. Buka [https://postgres-manager.vercel.app](https://postgres-manager.vercel.app)
2. Klik tombol **"Pengaturan Server Backend"** di bawah tombol login.
3. Masukkan Public HTTPS URL dari Cloudflare (misal: `https://nama-acak-anda.trycloudflare.com`).
4. Klik **"Uji Koneksi Server"**.
5. Masukkan kredensial Anda:
   - **Email:** `nnaufalasyam7@gmail.com`
   - **Password:** `skomda2023`
6. Klik **Masuk**.

---

## 3. Opsi B: ngrok Tunnel (Alternatif)

Jika Anda lebih menyukai ngrok atau sudah memiliki akun ngrok:

### 1. Masukkan Authtoken (Hanya sekali):
Dapatkan authtoken gratis di [https://dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken), lalu jalankan:
```bash
bash tunnel.sh ngrok <TOKEN_NGROK_ANDA>
```

### 2. Menjalankan ngrok:
Untuk kali berikutnya, cukup jalankan:
```bash
bash tunnel.sh ngrok
```

Skrip akan menampilkan URL publik: `https://xxxx.ngrok-free.app`. Masukkan URL ini ke halaman login Vercel.

---

## 4. Perintah Tambahan `tunnel.sh`

- **Mengecek Status Tunnel:**
  ```bash
  bash tunnel.sh status
  ```
- **Menghentikan Tunnel:**
  ```bash
  bash tunnel.sh stop
  ```

---

## 5. Opsional: Menjalankan Cloudflare Tunnel Otomatis via systemd (Auto-Start saat Boot)

Jika Anda ingin tunnel berjalan terus di latar belakang bahkan setelah komputer direstart:

Buat file service systemd:
```bash
sudo tee /etc/systemd/system/pgm-tunnel.service > /dev/null <<EOF
[Unit]
Description=Postgres Manager Cloudflare Tunnel
After=network.target nginx.service

[Service]
Type=simple
User=$USER
ExecStart=/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:8081 --logfile /home/gopalzzserver01/Documents/postgres-manager/logs/tunnel.log
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now pgm-tunnel.service
```
Untuk melihat URL yang dialokasikan:
```bash
grep -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' logs/tunnel.log | head -n 1
```
