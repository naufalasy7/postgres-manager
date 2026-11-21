#!/usr/bin/env bash
# POSTGRES MANAGER — satu perintah:  bash run.sh
# Aman dijalankan berulang (idempotent). Perintah lain:
#   bash run.sh status        cek layanan
#   bash run.sh reset-admin   buat password admin baru (acak)
# Opsi (env): PGPORT=5433 WEB_PORT=8080 ADMIN_EMAIL=... ADMIN_PASSWORD=... PGSUPER_USER=... PGSUPER_PASSWORD=...
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$ROOT"
PGPORT="${PGPORT:-5433}"; WEB_PORT="${WEB_PORT:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-nnaufalasyam7@gmail.com}"
BACK="$ROOT/app/backend"; FRONT="$ROOT/app/frontend"; ENVF="$BACK/.env"
CMD="${1:-install}"
if [ "$CMD" = "tunnel" ]; then
  shift || true
  exec bash "$ROOT/tunnel.sh" "$@"
fi
log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { trap - ERR; printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; exit 1; }
trap 'die "Gagal di baris $LINENO: $BASH_COMMAND — perbaiki penyebabnya lalu jalankan ulang: bash run.sh (aman diulang)"' ERR
[ "$EUID" -ne 0 ] || die "Jalankan sebagai user biasa (tanpa sudo). Script memanggil sudo sendiri bila perlu."
command -v sudo >/dev/null || die "sudo tidak tersedia"
envget() { grep -E "^$1=" "$ENVF" 2>/dev/null | head -1 | cut -d= -f2- || true; }
envset() {
  local key="$1" val="$2" tmp
  [ -e "$ENVF" ] || : > "$ENVF" 2>/dev/null || die "Tidak bisa membuat $ENVF"
  tmp="$(mktemp "${ENVF}.XXXXXX" 2>/dev/null)" || die "Tidak bisa menulis ke $ENVF (cek izin/pemilik file)"
  awk -v k="$key" -v v="$val" '
    index($0, k "=") == 1 { print k "=" v; found=1; next }
    { print }
    END { if (!found) print k "=" v }
  ' "$ENVF" > "$tmp" || { rm -f "$tmp"; die "Gagal memperbarui $key di $ENVF"; }
  cat "$tmp" > "$ENVF" || { rm -f "$tmp"; die "Gagal menulis $ENVF"; }
  rm -f "$tmp"
}
# Ingat port terakhir yang dipakai agar `bash run.sh` dan `status` konsisten.
[ -n "$WEB_PORT" ] || WEB_PORT="$(envget WEB_PORT)"
WEB_PORT="${WEB_PORT:-8080}"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
TS_IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"

# Mode latar belakang: tetap jalan walau terminal ditutup/logout, log tersimpan.
if [ "$CMD" = bg ]; then
  mkdir -p "$ROOT/logs"
  LOG="$ROOT/logs/install-$(date +%Y%m%d-%H%M%S).log"
  ln -sfn "$LOG" "$ROOT/logs/latest.log"
  setsid bash -c 'bash "$1" install; rc=$?; printf "\n[selesai] kode keluar: %s\n" "$rc" >>"$2"; exit "$rc"' _ "$ROOT/run.sh" "$LOG" >"$LOG" 2>&1 </dev/null &
  PID=$!
  printf '\n\033[1;32m==> Instalasi berjalan di latar belakang (PID %s)\033[0m\n' "$PID"
  echo " Log    : $LOG"
  echo " Pantau : tail -f \"$ROOT/logs/latest.log\""
  echo " Status : bash run.sh status"
  exit 0
fi

if [ "$CMD" = status ]; then
  systemctl is-active nginx || true
  curl -s -o /dev/null -w "web :$WEB_PORT -> HTTP %{http_code}\n" "http://127.0.0.1:$WEB_PORT/api/csrf" || true
  exit 0
fi

# ---------------------------------------------------------------- 1. paket
log "1/9 Paket sistem"
PKGS=(nginx php-fpm php-cli php-pgsql php-mbstring php-xml php-curl php-zip composer postgresql-client unzip git acl openssl curl)
MISSING=(); for p in "${PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p"); done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Memasang: ${MISSING[*]}"; sudo apt-get update -y
  if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${MISSING[@]}"; then
    warn "apt gagal. Mencoba memperbaiki paket rusak (dpkg --configure -a + apt-get -f install)..."
    sudo dpkg --configure -a || true
    sudo DEBIAN_FRONTEND=noninteractive apt-get -f install -y || true
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${MISSING[@]}" \
      || die "apt masih gagal. Jalankan manual: sudo dpkg --configure -a && sudo apt-get -f install && sudo apt-get install -y ${MISSING[*]}"
  fi
fi
# Node.js sengaja TIDAK lewat apt Debian: paket npm Debian bergantung pada
# nodejs versi Debian dan bentrok dengan NodeSource yang sudah terpasang.
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  warn "Node.js/npm belum lengkap — memasang Node 22 dari NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
command -v npm >/dev/null 2>&1 || die "npm tidak ditemukan setelah instalasi Node.js"
php -r 'exit(PHP_VERSION_ID>=80200?0:1);' || die "Butuh PHP >= 8.2 (terpasang: $(php -r 'echo PHP_VERSION;'))"
php -m | grep -qi pdo_pgsql || die "Ekstensi php-pgsql tidak aktif"
NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 18 ] || die "Butuh Node >= 18 (terpasang: $(node -v)). Pasang Node 18/20 dari NodeSource lalu ulangi."
PHPV="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')"
SOCK="/run/php/php${PHPV}-fpm.sock"
sudo systemctl enable --now "php${PHPV}-fpm" nginx >/dev/null 2>&1 || true
sudo git config --system --add safe.directory "*" 2>/dev/null || true

# ---------------------------------------------------------------- 2. backend
log "2/9 Backend Laravel"
export COMPOSER_MEMORY_LIMIT=-1
if [ ! -f "$BACK/artisan" ]; then
  composer create-project laravel/laravel:^11.0 "$BACK" --no-interaction --prefer-dist
fi
cp -a "$ROOT/app/backend-overlay/." "$BACK/"
grep -q "pgm.php" "$BACK/routes/web.php" || echo "require __DIR__.'/pgm.php';" >> "$BACK/routes/web.php"

# ---------------------------------------------------------------- 3. .env
log "3/9 Konfigurasi (.env)"
if ! grep -q '^PGM_ADMIN_USER=' "$ENVF" 2>/dev/null; then cp "$BACK/.env.example" "$ENVF"; fi
chmod 600 "$ENVF"
envset DB_HOST 127.0.0.1; envset DB_PORT "$PGPORT"; envset PGM_ROOT "$ROOT"; envset WEB_PORT "$WEB_PORT"
envset PGM_ADMIN_EMAIL "$ADMIN_EMAIL"; envset APP_URL "http://${LAN_IP:-localhost}:$WEB_PORT"
[ -n "$(envget DB_PASSWORD)" ]        || envset DB_PASSWORD "$(openssl rand -hex 16)"
[ -n "$(envget PGM_ADMIN_PASSWORD)" ] || envset PGM_ADMIN_PASSWORD "$(openssl rand -hex 16)"
[ -n "$(envget APP_KEY)" ]            || (cd "$BACK" && php artisan key:generate --force >/dev/null)
APP_PW="$(envget DB_PASSWORD)"; PROV_PW="$(envget PGM_ADMIN_PASSWORD)"

# ---------------------------------------------------------------- 4. PostgreSQL
log "4/9 PostgreSQL (port $PGPORT) — database lain tidak disentuh"
ss -ltn | grep -q ":$PGPORT " || die "Tidak ada PostgreSQL di port $PGPORT. Jalankan: PGPORT=<port> bash run.sh"
SUMODE=""; PEER_HOST=""
# Cluster milik user (mis. dijalankan manual) kadang memakai socket di /tmp,
# bukan /var/run/postgresql. Coba keduanya sebelum menyerah.
for h in "" /tmp; do
  hargs=(); [ -n "$h" ] && hargs=(-h "$h")
  if (cd /tmp && sudo -n -u postgres psql -X "${hargs[@]}" -p "$PGPORT" -d postgres -Atc 'select 1' >/dev/null 2>&1); then
    SUMODE=peer; PEER_HOST="$h"; break
  fi
done
if [ "$SUMODE" != peer ]; then
  if [ -n "${PGSUPER_USER:-}" ]; then SUMODE=pass
  elif [ -t 0 ]; then
    warn "Login peer 'postgres' tidak tersedia. Masukkan superuser PostgreSQL (hanya untuk setup awal, tidak disimpan)."
    read -rp "Superuser: " PGSUPER_USER; read -rsp "Password: " PGSUPER_PASSWORD; echo; SUMODE=pass
  else die "Tidak bisa login superuser PostgreSQL. Set PGSUPER_USER dan PGSUPER_PASSWORD."; fi
fi
psu() {
  if [ "$SUMODE" = peer ]; then
    hargs=(); [ -n "$PEER_HOST" ] && hargs=(-h "$PEER_HOST")
    (cd /tmp && sudo -n -u postgres psql -X -q "${hargs[@]}" -p "$PGPORT" -d postgres -v ON_ERROR_STOP=1 "$@")
  else PGPASSWORD="${PGSUPER_PASSWORD:-}" psql -X -q -h 127.0.0.1 -p "$PGPORT" -U "$PGSUPER_USER" -d postgres -v ON_ERROR_STOP=1 "$@"; fi
}
[ "$(psu -Atc 'select rolsuper from pg_roles where rolname=current_user')" = t ] || die "User tersebut bukan superuser PostgreSQL"
{
  echo "\\set app_pw '$APP_PW'"; echo "\\set prov_pw '$PROV_PW'"
  cat <<'SQL'
SELECT 'CREATE ROLE pgm_app LOGIN NOSUPERUSER' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='pgm_app') \gexec
SELECT 'CREATE ROLE pgm_provisioner LOGIN NOSUPERUSER CREATEDB CREATEROLE' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='pgm_provisioner') \gexec
ALTER ROLE pgm_app PASSWORD :'app_pw';
ALTER ROLE pgm_provisioner PASSWORD :'prov_pw';
SELECT 'CREATE DATABASE postgres_master OWNER pgm_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='postgres_master') \gexec
REVOKE ALL ON DATABASE postgres_master FROM PUBLIC;
SQL
} | psu
PGPASSWORD="$APP_PW" psql -X -h 127.0.0.1 -p "$PGPORT" -U pgm_app -d postgres_master -Atc 'select 1' >/dev/null 2>&1 \
  || die "Login password ke 127.0.0.1:$PGPORT ditolak. Tambahkan di pg_hba.conf: 'host all all 127.0.0.1/32 scram-sha-256' lalu reload PostgreSQL."
PGPASSWORD="$PROV_PW" psql -X -h 127.0.0.1 -p "$PGPORT" -U pgm_provisioner -d postgres -Atc 'select 1' >/dev/null
echo "Master DB + role siap."

# ---------------------------------------------------------------- 5. migrasi + admin
log "5/9 Migrasi master DB & akun admin"
cd "$BACK"
composer install --no-dev --optimize-autoloader --no-interaction
php artisan config:clear >/dev/null
php artisan migrate --force
ADMIN_PW="${ADMIN_PASSWORD:-$(openssl rand -hex 10)}"; FLAG="--if-missing"; [ "$CMD" = reset-admin ] && FLAG=""
rc=0; PGM_INITIAL_PASSWORD="$ADMIN_PW" php artisan pgm:create-admin $FLAG || rc=$?
case $rc in 0) SHOW_PW=1;; 2) SHOW_PW=0;; *) die "Gagal membuat admin";; esac
php artisan config:cache >/dev/null     # (route:cache sengaja tidak dipakai: ada route closure)
cd "$ROOT"

# ---------------------------------------------------------------- 6. frontend
log "6/9 Frontend (React build) — pertama kali bisa beberapa menit di Pi"
cd "$FRONT"
[ -d node_modules ] || npm install --no-audit --no-fund
if [ ! -f dist/index.html ] || [ -n "$(find src package.json index.html -newer dist/index.html -print -quit)" ]; then npm run build; fi
cd "$ROOT"

# ---------------------------------------------------------------- 7. nginx
log "7/9 Nginx (port $WEB_PORT)"
if sudo ss -ltnp | grep ":$WEB_PORT " | grep -qv nginx; then die "Port $WEB_PORT dipakai proses lain. Ulangi dengan WEB_PORT=<port lain> bash run.sh"; fi
sed -e "s#/home/pi/Database/postgres-manager#$ROOT#g" -e "s#php8.2-fpm.sock#php${PHPV}-fpm.sock#" -e "s#listen 8080#listen $WEB_PORT#" \
  deployment/nginx/postgres-manager.conf | sudo tee /etc/nginx/sites-available/postgres-manager >/dev/null
sudo ln -sf /etc/nginx/sites-available/postgres-manager /etc/nginx/sites-enabled/postgres-manager
sudo nginx -t
sudo systemctl reload nginx

# ---------------------------------------------------------------- 8. izin
log "8/9 Izin file untuk www-data"
d="$ROOT"; while [ "$d" != "/" ]; do sudo setfacl -m u:www-data:--x "$d" || warn "setfacl gagal di $d"; d="$(dirname "$d")"; done
sudo setfacl -R -m u:www-data:rX "$FRONT/dist"
sudo setfacl -m u:www-data:r "$ENVF"
for p in "$BACK/storage" "$BACK/bootstrap/cache" "$ROOT/projects" "$ROOT/storage" "$ROOT/repositories"; do
  sudo setfacl -R -m "u:www-data:rwX,u:$USER:rwX" "$p"; sudo setfacl -R -d -m "u:www-data:rwX,u:$USER:rwX" "$p"
done
sudo systemctl reload "php${PHPV}-fpm"

# ---------------------------------------------------------------- 9. cek
log "9/9 Pemeriksaan akhir"
sleep 1
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/api/csrf" || true)"
[ "$code" = 204 ] || warn "API belum sehat (HTTP $code). Lihat: tail -n 50 $BACK/storage/logs/laravel-*.log /var/log/nginx/error.log"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/" || true)" = 200 ] || warn "Frontend belum 200"

printf '\n\033[1;32m=========================================\n POSTGRES MANAGER SIAP\n=========================================\033[0m\n'
echo " LAN       : http://${LAN_IP:-IP_PI}:$WEB_PORT"
[ -n "$TS_IP" ] && echo " Tailscale : http://$TS_IP:$WEB_PORT"
echo " Login     : $ADMIN_EMAIL"
if [ "$SHOW_PW" = 1 ]; then echo " Password  : $ADMIN_PW   (CATAT SEKARANG, tidak ditampilkan lagi)"
else echo " Password  : (admin sudah ada; reset dengan: bash run.sh reset-admin)"; fi
echo " Rahasia DB tersimpan di $ENVF (chmod 600). Backup file itu, terutama APP_KEY."
