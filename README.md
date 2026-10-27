# 🤖 AGYVEL — Antigravity Telegram Bot

Bot Telegram penghubung ke **Google Antigravity CLI (`agy`)** dengan arsitektur multi-tenant (tiap user punya workspace dan sesi terisolasi), auto-failover kuota multi-akun, dan panel owner.

* **Creator:** Vellzyy
* **Channel WhatsApp:** [https://whatsapp.com/channel/0029VbDl6c1KmCPJErq9ox3F](https://whatsapp.com/channel/0029VbDl6c1KmCPJErq9ox3F)

---

## ⚡ Fitur Utama

* **Multi-Tenant & Isolated**: Tiap pengguna Telegram punya folder data, sesi chat, token, dan workspace sendiri.
* **Headless Google OAuth**: Login Google Antigravity langsung lewat tombol link di Telegram (`/login`).
* **Multi-Account & Auto-Failover**: Simpan banyak akun Google. Jika akun utama limit kuota, bot otomatis switch ke akun cadangan.
* **Streaming Response**: Jawaban AI mengalir dinamis dengan indikator proses dan tool yang sedang berjalan.
* **Panel Owner & Broadcast**: Toggle mode Public/Private bot secara instan dan broadcast pesan ke seluruh user.
* **Pterodactyl Egg Ready**: Auto-download dan extract binary `agy` via pure Node.js tanpa butuh `curl` atau akses root/sudo.

---

## 🚀 Cara Menjalankan

### 1. Di Panel Pterodactyl (Egg Node.js)
Kalo lu run di panel Pterodactyl egg Node.js, langkahnya sangat simpel:
1. Upload semua file project ke root server panel.
2. Salin/rename `.env.example` menjadi `.env`, lalu isi minimal:
   ```env
   TELEGRAM_BOT_TOKEN=token_bot_kamu
   ALLOWED_USERS=id_telegram_kamu
   ```
3. Pastikan Startup Command diatur ke:
   ```bash
   npm start
   ```
4. Tekan tombol **Start** pada panel. Bot otomatis mengecek dependensi dan mengunduh `agy` binary sendiri saat pertama kali dijalankan!

---

### 2. Di VPS / Server Linux
Kalo lu run di VPS biasa:
1. Clone repositori dan masuk ke foldernya:
   ```bash
   git clone https://github.com/apasisokabytm-glitch/agy-telegram-bot.git
   cd agy-telegram-bot
   ```
2. Buat file `.env` dari contoh template:
   ```bash
   cp .env.example .env
   nano .env
   ```
3. Install dependensi dan jalankan:
   ```bash
   npm install
   npm start
   ```
   Atau jalankan di background menggunakan **PM2**:
   ```bash
   pm2 start ecosystem.config.js
   pm2 logs agy-telegram-bot
   ```

---

## ⚙️ Pengaturan Lingkungan (`.env`)

```env
# Token bot dari @BotFather
TELEGRAM_BOT_TOKEN=8606454248:xxx

# Nama bot yang tampil di banner menu & status
BOT_NAME=AI VELZYY

# Watermark di bagian bawah setiap chat balasan AI (kosongkan jika tidak ingin pakai)
WATERMARK=✨ AI VELZYY

# Mode akses bot: yes (publik), no (khusus whitelist)
PUBLIC=yes

# ID Telegram owner / whitelist (pisahkan dengan koma jika lebih dari satu)
ALLOWED_USERS=7948712917

# Model default AI
MODEL=gemini-3.8-flash-medium
MODE=auto
EFFORT=medium
```

---

## 📋 Daftar Perintah Telegram

| Perintah | Keterangan |
|---|---|
| `/start` / `/menu` | Menampilkan menu utama dan informasi bot |
| `/login` | Login Google OAuth Antigravity via Telegram |
| `/addaccount` | Menambahkan akun Google cadangan |
| `/listaccount` | Daftar akun terhubung & status kuota |
| `/switchaccount` | Beralih akun aktif secara manual |
| `/quota` | Cek sisa kuota Antigravity |
| `/status` | Cek status sistem, workspace, dan model |
| `/owner` | Panel khusus owner (toggle Public/Private & broadcast) |
| `/broadcast <pesan>` | Kirim pesan siaran ke semua pengguna |
| `/model <nama>` | Ganti model AI aktif |
| `/persona` | Atur karakter gaya bicara AI |
| `/cancel` | Batalkan proses atau sesi login yang berjalan |
| `/files` | Melihat file di workspace |
| `/get <nama>` | Unduh file dari workspace ke chat |
| `/new` | Reset riwayat percakapan / sesi baru |
