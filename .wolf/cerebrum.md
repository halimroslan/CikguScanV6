---
description: learned preferences, project conventions, and Do-Not-Repeat rules
budget_tokens: 2000
---
# Cerebrum — CikguScan (OMR Smart Sheet Scanner)

> OpenWolf's learning memory for CikguScan.
> Updated automatically as the project progresses.
> Last updated: 2026-11-01

## User Preferences

- **Operator / Developer:** Sir Halim Roslan
- **Domain & Sasaran Pengguna:** Guru sekolah rendah & menengah di Malaysia yang memerlukan pemeriksaan kertas OMR pantas di bilik darjah.
- **Reka Bentuk UI:** Apple HIG-inspired modern minimalism (sudut bulat, bayang lembut, kad berkontras, tipografi kemas).
- **Pendekatan Pembangunan:** Offline-First PWA. Enjin OMR, pemarkahan, laporan PDF, dan eksport Excel mesti boleh beroperasi tanpa internet.
- **Piawaian Pentaksiran:** Menggunakan format gred dan analisis item standard KPM (Indeks Kesukaran $p$, Indeks Diskriminasi $d$, Analisis Distraktor).

## Key Learnings

- **Struktur Teras:** Aplikasi berpusat pada `src/main.ts` (4,500+ baris) yang mengendalikan state global pada `window`, pengimbasan kamera masa nyata, IndexedDB untuk caching imej, dan penyegerakan Firestore.
- **Safari Print Compatibility:** Fungsi cetakan memerlukan dwipanggilan `requestAnimationFrame` sebelum `window.print()` bagi mengelakkan antaramuka Safari daripada terbeku (*hang*).
- **Pemisahan Lembaran Cetak:** Kertas jawapan ≤20 soalan wajib Potret, manakala >20 soalan wajib Landskap bagi menjamin ketepatan saiz bubble OMR semasa dicetak.

## Do-Not-Repeat

- `[2026-09-25]` **Mandatory Backup Rule:** Dilarang mengubah kod sumber tanpa membuat sandaran ke `/Users/halimroslan/NEW CIDS SUITES PRO/` terlebih dahulu.
- `[2026-07-28]` **No Heavy External Chart Libraries:** Dilarang memasukkan pustaka visualisasi berat (seperti Chart.js atau D3). Gunakan fungsi penjana SVG asli `processChartBlocks()` untuk memelihara saiz muat turun PWA.
- `[2026-11-01]` **Consistent Naming & Auto Column Sizing:** Eksport Excel mestilah menjana format multi-lembaran kemas dengan penetapan lebar lajur automatik (`!cols`) dan pengekodan nama fail bersih (`Analisis_CikguScan_[Kelas]_[Tarikh].xlsx`).

## Decision Log

- **SheetJS (xlsx):** Dipilih untuk penjanaan fail spreadsheet `.xlsx` terus daripada memori pelayar web (client-side) tanpa memerlukan sebarang endpoint pelayan.
- **Analisis Item Klasik:** Mengira Indeks Kesukaran ($p = \frac{\text{Bil. Betul}}{\text{Jumlah Calon}}$) dan Indeks Diskriminasi ($d = \frac{T - B}{N/2}$) untuk membimbing guru mengenal pasti soalan berkualiti atau bermasalah.
