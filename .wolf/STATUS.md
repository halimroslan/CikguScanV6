---
description: session handoff, regenerate with /handoff when a quest finishes
budget_tokens: 1000
---
# STATUS — CikguScan (OMR Smart Sheet Scanner PWA)

> Single source of truth: `PROJECT_FLOW.md` dan `ROADMAP.md`
> Live PWA: https://cikguscan.vercel.app/
> GitHub: https://github.com/halimroslan/CikguScanV6
> Last updated: 2026-11-01

---

## ✅ Done

### Fasa 1: Enjin Pengesanan & Pembetulan Homografi (v1.0 - v3.0)
- Pengesanan 4 bucu kertas A4 automatik dengan pengiraan matriks homografi `warpPerspective`.
- Pensuisan kamera hadapan/belakang dan sokongan lampu suluh (*torch*).

### Fasa 2: Penjana Borang OMR & Cetakan Auto A4 (v4.0)
- Borang OMR A4 adaptif: ≤20 soalan (Mod Potret) dan 21–40 soalan (Mod Landskap).
- Ruang nama murid, kad pengenalan, dan bubble jawapan A, B, C, D.

### Fasa 3: Multi-Thresholding & Erasure Detection (v5.0)
- Pengecaman tanda lorekan pensel 2B vs tanda padam getah (*erasure detection*).
- Caching keratan nama murid di IndexedDB tempatan.

### Fasa 4: AI Chatbot Terapung & Carta Interaktif SVG (v6.0 - v6.2)
- Butang terapung `#btn-floating-ai` di sudut kanan bawah skrin.
- Penjanaan carta SVG dinamik (Bar / Line / Dotted) daripada blok kod ` ```chart ` tanpa pustaka luaran berat.
- Pengesahan dwisemakan Gemini Vision (`gemini-2.5-flash`).

### Fasa 5: Eksport Laporan Rasmi & Analisis Item (v6.3)
- Pemasangan pustaka SheetJS (`xlsx`) client-side tanpa backend.
- Butang `#btn-eksport-excel` memuat turun fail `.xlsx` multi-lembaran (`Markah Individu`, `Analisis Item & Distraktor`, `Ringkasan & Taburan Kelas`).
- Pengiraan Indeks Kesukaran ($p$) dan Indeks Diskriminasi ($d$) berserta peratusan pemilih distraktor pilihan jawapan (A, B, C, D, Batal/Kosong).
- Peningkatan laporan cetakan PDF A4 rasmi: Kad metrik KPI kelas (Purata, Kelulusan %, Cemerlang, Intervensi), senarai murid cemerlang & intervensi, analisis item lengkap, dan ruangan tandatangan pentadbir.
- Sandaran penuh kod sumber diselaraskan ke `/Users/halimroslan/NEW CIDS SUITES PRO/CikguScan_Pre_Phase5_Backup_20261101/`.

---

## 🚀 Next phase (Fasa 6: Migrasi Supabase & Realtime Cloud Sync)

**Goal:** Menghubungkan CikguScan ke pangkalan data Supabase PostgreSQL dengan saluran masa nyata (Realtime Channel) untuk penyegerakan merentas peranti guru seperti seni bina Scan-HW.

### Acceptance criteria
1. Pangkalan data Supabase dikonfigurasikan dengan jadual `rekod_omr`, `pentaksiran`, dan `kelas`.
2. Modul `src/supabase.ts` menyediakan fallback luar talian automatik (IndexedDB -> Supabase sync apabila talian internet pulih).
3. Langganan masa nyata (*realtime subscription*) memaparkan kemas kini rekod imbasan secara serentak pada pelbagai peranti.

### Files to create / edit
| Type | File | Content |
|---|---|---|
| new | `src/supabase.ts` | Konfigurasi klien Supabase, skema jadual, dan pembantu CRUD. |
| edit | `src/main.ts` | Mengintegrasikan penyegerakan dwi-arah IndexedDB <-> Supabase. |
| edit | `.env.local` | Menambah `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`. |

### Closed decisions
- PWA kekal Offline-First. Ketiadaan capaian internet tidak boleh menghalang guru daripada mengimbas, menganalisis, mencetak PDF, atau memuat turun Excel.

### Open decisions
- Menyelaraskan skema pangkalan data Supabase sama ada mengikut format JSONB penuh atau pecahan jadual ternormal.

---

## 📁 Active architecture

- **Stack:** Vite 6, TypeScript 5.8, Tailwind CSS v4, vite-plugin-pwa, Firebase Auth/Firestore, SheetJS (`xlsx`), Google Gemini API (`@google/genai`).
- **Golden Invariants:**
  1. *4-Corner Marker Invariant*: Homografi hanya berjalan bila 4 sudut dikesan.
  2. *A4 Print Layout Invariant*: ≤20 soalan Portrait, 21-40 soalan Landscape.
  3. *Dual-Check Verification*: Heuristik pantas + Gemini Vision sekunder.
  4. *Interactive SVG Invariant*: Blok ` ```chart ` automatik dijana sebagai SVG.
  5. *Mandatory Backup Rule*: Sandaran wajib ke `/Users/halimroslan/NEW CIDS SUITES PRO/`.

---

## ⚠️ External blockers (don't block coding)

- Kunci akses Supabase untuk projek pementasan / produksi.

---

## 🔧 Useful commands

```bash
npm run dev      # Mulakan server pembangunan tempatan (port 3000)
npm run build    # Kompilasi pengeluaran Vite & PWA Service Worker
openwolf scan    # Imbas semula anatomi projek
graft map        # Peta repo dan pemantauan token
```

---

## 📚 References (read IF needed)

- `.wolf/cerebrum.md` — Pilihan pemaju, peraturan do-not-repeat & rekod keputusan
- `PROJECT_FLOW.md` — Aliran sistem dan golden invariants
- `ROADMAP.md` — Garis masa fasa pembangunan CikguScan
