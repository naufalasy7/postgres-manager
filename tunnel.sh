#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/logs"
PID_FILE="$LOG_DIR/tunnel.pid"
LOG_FILE="$LOG_DIR/tunnel.log"
URL_FILE="$LOG_DIR/tunnel_url.txt"
PORT="${WEB_PORT:-8081}"

mkdir -p "$LOG_DIR"

red()    { printf '\033[1;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[1;36m%s\033[0m\n' "$*"; }

is_running() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

stop_tunnel() {
  local stopped=0
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      yellow "Menghentikan tunnel (PID: $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
      stopped=1
    fi
    rm -f "$PID_FILE"
  fi

  # Bersihkan proses orphaned jika ada
  pkill -f "cloudflared tunnel --url" 2>/dev/null || true
  pkill -f "ngrok http" 2>/dev/null || true
  rm -f "$URL_FILE"

  if [ $stopped -eq 1 ]; then
    green "Tunnel berhasil dihentikan."
  else
    yellow "Tidak ada tunnel yang sedang berjalan."
  fi
}

start_cloudflare() {
  if is_running; then
    yellow "Tunnel sudah berjalan!"
    status_tunnel
    return 0
  fi

  command -v cloudflared >/dev/null 2>&1 || {
    red "cloudflared belum terpasang. Jalankan instalasi terlebih dahulu."
    exit 1
  }

  cyan "==> Memulai Cloudflare Tunnel (HTTPS) ke port $PORT..."
  : > "$LOG_FILE"
  rm -f "$URL_FILE"

  nohup cloudflared tunnel --url "http://127.0.0.1:$PORT" --logfile "$LOG_FILE" </dev/null > /dev/null 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  yellow "Menunggu alokasi domain publik Cloudflare..."
  local url=""
  for i in $(seq 1 15); do
    sleep 1
    if ! kill -0 "$pid" 2>/dev/null; then
      red "Proses cloudflared terhenti mendadak. Cek log di: $LOG_FILE"
      rm -f "$PID_FILE"
      exit 1
    fi
    url="$(grep -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' "$LOG_FILE" | head -n 1 || true)"
    if [ -n "$url" ]; then
      break
    fi
  done

  if [ -n "$url" ]; then
    echo "$url" > "$URL_FILE"
    echo ""
    green "=================================================================="
    green "  CLOUDFLARE HTTPS TUNNEL AKTIF!"
    green "=================================================================="
    cyan  "  Public HTTPS URL : $url"
    cyan  "  Forwarding Ke    : http://127.0.0.1:$PORT"
    cyan  "  PID              : $pid"
    cyan  "  Log File         : $LOG_FILE"
    green "=================================================================="
    echo ""
    yellow "Langkah untuk Vercel:"
    echo "1. Buka dashboard frontend Anda di https://postgres-manager.vercel.app"
    echo "2. Klik 'Pengaturan Server Backend'"
    echo "3. Masukkan URL: $url"
    echo "4. Klik 'Uji Koneksi Server', lalu login dengan skomda2023!"
  else
    yellow "Tunnel berjalan (PID: $pid), namun URL belum terdeteksi otomatis."
    yellow "Silakan cek log: cat $LOG_FILE"
  fi
}

start_ngrok() {
  local token="${1:-}"

  if is_running; then
    yellow "Tunnel sudah berjalan!"
    status_tunnel
    return 0
  fi

  command -v ngrok >/dev/null 2>&1 || {
    red "ngrok belum terpasang."
    exit 1
  }

  if [ -n "$token" ]; then
    cyan "Menyimpan ngrok authtoken..."
    ngrok config add-authtoken "$token"
  fi

  cyan "==> Memulai ngrok Tunnel (HTTPS) ke port $PORT..."
  : > "$LOG_FILE"
  rm -f "$URL_FILE"

  nohup ngrok http "$PORT" --log=stdout </dev/null > "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  yellow "Menunggu ngrok aktif..."
  local url=""
  for i in $(seq 1 10); do
    sleep 1
    if ! kill -0 "$pid" 2>/dev/null; then
      red "Proses ngrok terhenti. Mungkin authtoken belum diset atau salah."
      red "Cek log di: $LOG_FILE"
      rm -f "$PID_FILE"
      exit 1
    fi
    url="$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -o 'https://[a-zA-Z0-9.-]*\.ngrok-free\.app' | head -n 1 || true)"
    if [ -n "$url" ]; then
      break
    fi
  done

  if [ -n "$url" ]; then
    echo "$url" > "$URL_FILE"
    echo ""
    green "=================================================================="
    green "  NGROK HTTPS TUNNEL AKTIF!"
    green "=================================================================="
    cyan  "  Public HTTPS URL : $url"
    cyan  "  Forwarding Ke    : http://127.0.0.1:$PORT"
    cyan  "  PID              : $pid"
    cyan  "  Log File         : $LOG_FILE"
    green "=================================================================="
    echo ""
    yellow "Langkah untuk Vercel:"
    echo "1. Buka dashboard frontend Anda di https://postgres-manager.vercel.app"
    echo "2. Klik 'Pengaturan Server Backend'"
    echo "3. Masukkan URL: $url"
    echo "4. Klik 'Uji Koneksi Server', lalu login dengan skomda2023!"
  else
    yellow "ngrok berjalan (PID: $pid), cek web interface ngrok di http://127.0.0.1:4040"
  fi
}

status_tunnel() {
  if is_running; then
    local pid url
    pid="$(cat "$PID_FILE")"
    url="$(cat "$URL_FILE" 2>/dev/null || echo "Belum tercatat")"
    green "Tunnel SEDANG BERJALAN:"
    echo "  PID  : $pid"
    echo "  URL  : $url"
    echo "  Log  : $LOG_FILE"
  else
    yellow "Tidak ada tunnel yang aktif saat ini."
  fi
}

show_help() {
  echo "Penggunaan: bash tunnel.sh [perintah]"
  echo ""
  echo "Perintah:"
  echo "  cloudflare              Jalankan Cloudflare Quick Tunnel (Gratis, tanpa akun/token)"
  echo "  ngrok [token]           Jalankan ngrok HTTPS Tunnel (bisa sertakan authtoken)"
  echo "  status                  Cek status tunnel yang sedang aktif"
  echo "  stop                    Hentikan tunnel yang sedang berjalan"
  echo "  help                    Tampilkan pesan bantuan ini"
  echo ""
  echo "Contoh:"
  echo "  bash tunnel.sh cloudflare"
  echo "  bash tunnel.sh ngrok 2XxX...tokenAnda"
  echo "  bash tunnel.sh stop"
}

CMD="${1:-help}"
case "$CMD" in
  cloudflare|cf)
    start_cloudflare
    ;;
  ngrok)
    start_ngrok "${2:-}"
    ;;
  status)
    status_tunnel
    ;;
  stop)
    stop_tunnel
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    show_help
    exit 1
    ;;
esac
