# RANGGA NUGRAHA_247006111036_B

## Arsitektur

- Frontend React + Vite di `apps/frontend`
- API Gateway Express di `apps/gateway`
- Service Nilai Express di `apps/service-nilai`
- Service Transkrip Express di `apps/service-transkrip`
- Database SQLite di `database/sia_zt.db`
- Permintaan data akademik diperiksa dan diteruskan API Gateway ke service terkait; service memverifikasi gateway secret dan JWT.
- Saat finalisasi, Service Nilai meminta token service dari `POST /auth/service`, lalu mengirim sinkronisasi transkrip melalui gateway. Nilai rahasia pada `.env` juga diteruskan ke seluruh service oleh Docker Compose.

## Prasyarat

- Node.js 20+
- npm

## Konfigurasi lingkungan

Salin `.env.example` menjadi `.env` lalu sesuaikan nilai secret.

Akun demo:

- admin01 / admin123
- dosen01 / dosen123
- dosen02 / dosen456
- mahasiswa01 / mahasiswa123
- mahasiswa02 / mahasiswa456
- mahasiswa03 / mahasiswa789

Device ID demo:

- device-admin-01
- device-dosen-01
- device-dosen-02
- device-mhs-01
- device-mhs-02
- device-mhs-03

## Instalasi

```bash
npm install
cp .env.example .env
npm run db:seed
```

## Menjalankan aplikasi

```bash
npm run dev
```

Untuk menjalankan service secara terpisah:

```bash
npm --workspace apps/gateway run dev
npm --workspace apps/service-nilai run dev
npm --workspace apps/service-transkrip run dev
npm --workspace apps/frontend run dev -- --host 0.0.0.0
```

## Endpoint utama

- Gateway: http://localhost:3000
- Service Nilai: http://localhost:3001
- Service Transkrip: http://localhost:3002
- Frontend: http://localhost:5173

## Konfigurasi Jam Ubah Nilai

Atur jadwal perubahan dan finalisasi nilai pada [`config/access-window.json`](./config/access-window.json). Ubah `start` dan `end` dengan format 24 jam `HH:mm`, serta `timeZone` 


## Testing

```bash
npm test
```

## Catatan keamanan

- Access token JWT berlaku 10 menit.
- Refresh token disimpan dalam bentuk hash di SQLite.
- Device ID divalidasi secara server-side.
- Semua permintaan harus melalui gateway.
- Akses ditolak secara default kecuali policy yang eksplisit diizinkan.
- Gateway secret dan JWT harus diverifikasi di setiap service.
