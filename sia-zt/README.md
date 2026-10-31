# SIA-ZT

Sistem Informasi Akademik Zero Trust adalah aplikasi demo keamanan akademik yang mengimplementasikan autentikasi, otorisasi, policy enforcement, audit log, dan sinkronisasi transkrip antar layanan.

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

Contoh akun demo:

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

## Matriks akses role

| Role | Hak akses |
| --- | --- |
| Mahasiswa | Melihat nilai dan transkrip miliknya sendiri |
| Dosen | Melihat, mengubah, dan memfinalisasi nilai pada kelas yang diajarnya |
| Admin | Melihat transkrip seluruh mahasiswa |

Perubahan nilai dan finalisasi hanya dapat dilakukan dosen pemilik kelas, selama jendela akses dibuka dan nilai belum difinalisasi.
Default jendela akses adalah pukul 07.00–21.00 WIB (termasuk batas awal dan akhir). Rentang dan zona waktu dapat diatur melalui `ACCESS_WINDOW_START`, `ACCESS_WINDOW_END`, dan `ACCESS_WINDOW_TZ` pada `.env`; perubahan konfigurasi berlaku setelah service dimulai ulang.

## Contoh request

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Device-ID: device-mhs-01' \
  -d '{"username":"mahasiswa01","password":"mahasiswa123"}'
```

```bash
curl http://localhost:3000/nilai \
  -H 'Authorization: Bearer <access-token>' \
  -H 'X-Device-ID: device-mhs-01'
```

```bash
curl http://localhost:3000/transkrip?studentId=4 \
  -H 'Authorization: Bearer <access-token>' \
  -H 'X-Device-ID: device-admin-01'
```

## Sinkronisasi transkrip

```bash
curl -X POST http://localhost:3000/auth/service \
  -H 'Content-Type: application/json' \
  -d '{"clientId":"grading-service","clientSecret":"replace-service-secret"}'
```

Lalu gunakan token hasil dari endpoint tersebut untuk memanggil service transkrip secara resmi melalui gateway saat finalisasi kelas.

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
