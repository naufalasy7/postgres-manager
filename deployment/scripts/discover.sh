#!/usr/bin/env bash
# Phase 1 — discovery READ-ONLY. Tidak mengubah apa pun.
PORT="${PGPORT:-5433}"
echo "== OS ==";  head -2 /etc/os-release; uname -m
echo "== PHP ==";  php -v 2>&1 | head -1
echo "== Composer/Node =="; composer --version 2>&1 | head -1; node -v 2>&1
echo "== PostgreSQL =="; psql --version 2>&1; pg_lsclusters 2>&1
echo "== Port $PORT =="; ss -ltnp 2>/dev/null | grep ":$PORT" || echo "tidak ada listener di $PORT"
echo "== Database (PGUSER=${PGUSER:-smartroom}) =="
psql -h 127.0.0.1 -p "$PORT" -U "${PGUSER:-smartroom}" -d postgres -Atc "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE NOT datistemplate" 2>&1
echo "== Nginx / PHP-FPM =="; nginx -v 2>&1; systemctl is-active nginx php8.2-fpm 2>&1
echo "== RAM / Disk =="; free -h | sed -n 1,2p; df -h / | tail -1
echo "== Tailscale =="; tailscale ip -4 2>&1 || echo "tailscale tidak ditemukan"
