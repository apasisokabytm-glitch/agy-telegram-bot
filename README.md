# Antigravity Telegram Bot (`agy-telegram-bot`)

Bot Telegram standalone yang menghubungkan Telegram langsung ke **Google Antigravity CLI (`agy`)** secara lokal di server dengan arsitektur **Multi-Tenant (Per-User Isolation)**.

```
Telegram User A ──┐
Telegram User B ──┼──> Node.js (Telegraf) ──> data/users/<userId>/ (Home, Tokens, Workspace, Skills)
Telegram User C ──┘                                      │
                                                         └──> agy CLI (Isolated Execution per User)
```

## ✨ Fitur Lengkap

1. **👥 Multi-Tenant & Per-User Isolation (Aman untuk Publik)**
   - Setiap pengguna Telegram memiliki folder terisolasi di `data/users/<userId>/`.
   - Kuota, token Google OAuth, akun GitHub, akun Vercel, workspace, riwayat chat, dan skills tersimpan terpisah 100%. User A tidak bisa melihat atau memakai kuota/token User B.
   - Siap dipublish ke publik cukup dengan mengosongkan `ALLOWED_USERS` di `.env`.

2. **🔐 Autentikasi Headless OAuth di Telegram (`/login` & `/addaccount`)**
   - Mendukung multi-akun Google Antigravity per pengguna dengan fitur **Auto-Failover / Auto-Rotation**.
   - Jika akun aktif terkena limit kuota, bot secara otomatis beralih ke akun cadangan pengguna dan melanjutkan pengerjaan.

3. **💬 Chat Interaktif & Streaming Respons**
   - Menjalankan prompt interaktif dengan output `stream-json`.
   - Mengupdate pesan secara bertahap (throttled 1.1s) agar respons mengalir halus seperti di terminal.
   - Memunculkan notifikasi saat `agy` menggunakan tool (`🔧 agy memanggil tool: ...`).
   - Mengaktifkan `--dangerously-skip-permissions` agar eksekusi tool otomatis berjalan lancar tanpa macet di background.

3. **⚙️ Kontrol Model, Mode & Reasoning Effort**
   - `/models`: Melihat daftar model Antigravity yang tersedia.
   - `/model <slug>`: Mengganti model aktif untuk sesi chat (default: `gemini-3.8-flash-medium`).
   - `/mode <auto|plan|accept-edits>`: Mengubah mode kerja agent.
   - `/effort <low|medium|high|max>`: Mengatur tingkat reasoning model.
   - `/agent [nama]`: Memilih atau mereset agent aktif.

4. **🧩 Skills, Plugin & MCP Management**
   - `/skills`: Melihat daftar skill bawaan Antigravity.
   - `/skill <nama>`: Membaca dokumentasi `SKILL.md` dari skill terkait.
   - `/plugin list`: Melihat plugin yang terpasang.
   - `/plugin install <target>`: Memasang plugin dari URL git atau marketplace.
   - `/plugin uninstall <nama>`: Menghapus plugin.
   - `/mcp list`: Melihat daftar MCP server.
   - `/mcp add <nama> <commandOrUrl> [args...]`: Menambahkan server MCP baru.
   - `/mcp remove <nama>`: Menghapus server MCP.

5. **📁 Workspace & File Synchronization**
   - Folder workspace otomatis dibuat per chat: `workspace/<chatId>/` dan di-mount ke `agy --add-dir`.
   - **Upload:** Mengunggah file (dokumen, foto, video, audio, voice) langsung disimpan ke workspace chat.
   - Jika file diunggah dengan *caption*, caption langsung dijadikan prompt bagi `agy` untuk memproses/menganalisis file tersebut.
   - **Auto Send:** Jika `agy` membuat berkas baru di workspace, bot otomatis mendeteksi dan mengirimkannya langsung ke Telegram!
   - Perintah file: `/files` / `/ls`, `/get <nama>`, `/cat <nama>`, `/rm <nama>`.

6. **🔒 Keamanan & Whitelist**
   - Whitelist Telegram ID melalui `ALLOWED_USERS` di `.env` (user luar otomatis ditolak).

---

## 🚀 Panduan Instalasi & Menjalankan

### 1. Install CLI Antigravity (jika belum ada)
```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

### 2. Konfigurasi Lingkungan (`.env`)
Salin dari `.env.example` dan sesuaikan nilainya:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
PUBLIC=yes
ALLOWED_USERS=your_telegram_id
AGY_COMMAND=/home/container/.local/bin/agy
WORKSPACE_DIR=./workspace
DATA_DIR=./data
MODEL=gemini-3.8-flash-medium
MODE=auto
EFFORT=medium
```

### 3. Install Dependensi & Jalankan
```bash
npm install
npm start
```

Atau menggunakan **PM2**:
```bash
pm2 start ecosystem.config.js
pm2 logs agy-telegram-bot
```

---

## 📋 Daftar Perintah Telegram

| Perintah | Fungsi |
|---|---|
| `/start` | Memulai bot dan menampilkan ringkasan fitur |
| `/help` | Menampilkan panduan lengkap penggunaan perintah |
| `/status` | Melihat status koneksi, agy binary, kuota, model, persona & workspace |
| `/githubauth <token>` | Menghubungkan akun GitHub (PAT token) |
| `/vercelauth <token>` | Menghubungkan akun Vercel (Access token) |
| `/persona` | Mengatur karakter & gaya bahasa AI (pilihan preset atau custom prompt) |
| `/login` | Memulai proses Google OAuth login via Telegram |
| `/addaccount` | Menambahkan akun Google Antigravity baru (multi-account) |
| `/listaccount` | Melihat daftar akun terdaftar & status limit kuota |
| `/switchaccount <target>` | Beralih akun aktif secara manual |
| `/delaccount <target>` | Menghapus akun tersimpan |
| `/cancel` | Membatalkan sesi login OAuth atau proses yang sedang berjalan |
| `/quota` | Memeriksa kuota pemakaian Antigravity |
| `/models` | Menampilkan daftar model yang didukung |
| `/model <nama>` | Mengganti model aktif untuk percakapan saat ini |
| `/mode <mode>` | Mengganti mode agent (`auto`, `plan`, `accept-edits`) |
| `/effort <level>` | Mengatur tingkat reasoning (`low`, `medium`, `high`, `max`) |
| `/agent [nama]` | Melihat atau mengganti agent aktif |
| `/skills` | Menampilkan daftar skills yang terpasang |
| `/skill <nama>` | Membaca instruksi detail `SKILL.md` dari suatu skill |
| `/addskills <url>` | Memasang skill baru langsung dari repositori GitHub |
| `/rmskill <nama>` | Menghapus skill dari bot |
| `/plugin list` | Melihat daftar plugin yang terpasang |
| `/plugin install <target>` | Memasang plugin |
| `/plugin uninstall <nama>` | Menghapus plugin |
| `/mcp list` | Melihat daftar MCP server |
| `/mcp add ...` | Menambahkan server MCP baru |
| `/mcp remove <nama>` | Menghapus server MCP |
| `/files` atau `/ls` | Melihat berkas yang ada di workspace |
| `/get <nama>` | Mengunduh berkas dari workspace ke Telegram |
| `/cat <nama>` | Membaca berkas teks langsung di Telegram |
| `/rm <nama>` | Menghapus berkas dari workspace |
| `/new` atau `/clear` | Membersihkan memori percakapan / sesi baru |
| `/owner` | Panel kontrol owner (toggle mode public/private) |
| `/broadcast <pesan>` | Menyiarkan pesan ke seluruh pengguna bot |
