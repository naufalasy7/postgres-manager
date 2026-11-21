# Panduan Deploy Frontend ke Vercel (Manual)

Proyek ini telah dikonfigurasi secara lengkap untuk dapat di-deploy ke Vercel dengan cepat dan mudah.

---

## Opsi 1: Deploy via Dashboard Vercel (Rekomendasi)

1. Buka [vercel.com](https://vercel.com) dan login ke akun Anda.
2. Klik tombol **Add New...** > **Project**.
3. Pilih repository GitHub: `naufalasy7/postgres-manager`.
4. Pada form konfigurasi proyek:
   * **Framework Preset**: Pilih **Vite** (atau biarkan otomatis).
   * **Root Directory**:
     * Anda dapat memilih folder `app/frontend` (klik *Edit* lalu pilih folder `app/frontend`), ATAU
     * Biarkan `./` (root) karena konfigurasi `vercel.json` di root sudah otomatis mengatur build ke `app/frontend`.
   * **Build and Output Settings** (jika memilih `app/frontend`):
     * Build Command: `npm run build`
     * Output Directory: `dist`
   * **Environment Variables** (Opsional jika backend di-host di luar):
     * Tambahkan `VITE_API_URL`: URL backend server Anda (contoh: `http://10.219.1.244:8081` atau domain publik backend Anda `https://api.yourdomain.com`).
     * *Catatan*: Jika Anda menggunakan reverse proxy / rewrite yang sama, variabel ini bisa dikosongkan.
5. Klik **Deploy**.

---

## Opsi 2: Deploy via Vercel CLI (Terminal)

Jika Anda memiliki `vercel` CLI di komputer lokal:

```bash
# 1. Masuk ke folder frontend
cd app/frontend

# 2. Deploy ke Vercel
vercel

# 3. Untuk deploy ke production
vercel --prod
```

---

## Konfigurasi Backend untuk Vercel (CORS & Cookie)

Jika frontend di Vercel (`https://xxx.vercel.app`) memanggil API backend di server terpisah:

1. Konfigurasi `config/cors.php` sudah disiapkan untuk secara otomatis mengizinkan origin `*.vercel.app` dengan kredensial (`supports_credentials: true`).
2. Pada file `.env` di backend Laravel (`app/backend/.env`), pastikan:
   ```env
   # Jika menggunakan HTTPS di kedua sisi (frontend & backend):
   SESSION_SAME_SITE=none
   SESSION_SECURE_COOKIE=true
   ```
   *Jika backend masih HTTP biasa di IP lokal, disarankan mengakses melalui reverse proxy Nginx dengan domain HTTPS.*
