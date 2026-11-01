# 🧭 PROJECT FLOW & LIVING ARCHITECTURE: CikguScan (OMR Smart Sheet Scanner)

> **Status Semasa:** STABIL & SELESAI FASA 5 (EKSPORT LAPORAN EXCEL / PDF & ANALISIS ITEM)  
> **Tarikh Kemas Kini Terakhir:** 2026-11-01  
> **Sasaran Aplikasi:** Web PWA ([https://cikguscan.vercel.app/](https://cikguscan.vercel.app/))  
> **Repositori Utama:** [https://github.com/halimroslan/CikguScanV6](https://github.com/halimroslan/CikguScanV6)  
> **Fail Rujukan Utama:** `src/main.ts`, `index.html`, `OMRImageProcessor.py`, `vite.config.ts`

---

## 1. 🎯 Ringkasan Eksekutif & Skop Projek
**CikguScan (CikguScanV6)** adalah aplikasi web progresif (PWA) pintar berasaskan kamera telefon dan komputer riba yang direka khas untuk guru di Malaysia menyemak kertas jawapan objektif (OMR) sehingga 40 soalan secara automatik, pantas, dan tepat. Dilengkapi enjin pengesanan 4 bucu, pembetulan perspektif, pengesanan lorekan pensel (*erasure detection*), pengesahan Google Gemini AI, serta pembantu analisis pintar terapung (**Tanya AI CikguScan**) yang mampu menjana carta interaktif secara dinamik.

---

## 2. 📊 Status Fasa & Kemajuan Terkini

| Fasa | Nama Modul / Tugasan | Status | Catatan / Output |
| :---: | :--- | :---: | :--- |
| **Fasa 1** | Enjin Pengimbasan OMR & Pembetulan Perspektif | ✅ Selesai | Mengesan 4 titik hitam bucu kertas, pengiraan matriks homografi, dan penjajaran kanvas automatik. |
| **Fasa 2** | Penjana Borang OMR & Cetakan A4 | ✅ Selesai | Cetakan format A4 automatik: Potret (≤20 soalan) dan Landskap (>20 soalan). |
| **Fasa 3** | Multi-Thresholding & Pengesanan Pemadaman (Erasure Detection) | ✅ Selesai | Ketepatan tinggi dalam membezakan tanda lorekan pensel 2B sebenar daripada kesan padam getah. |
| **Fasa 4** | Integrasi Gemini AI & Chatbot Analisis Pintar | ✅ Selesai | Komit `cc47fb8`: Butang terapung `#btn-floating-ai` (kanan bawah) dan penjanaan carta SVG interaktif (Bar / Line / Dotted). |
| **Fasa 5** | Eksport Laporan Rasmi (PDF / Excel .xlsx) | ✅ Selesai | Penjanaan laporan analisis item, graf taburan markah kelas, dan ringkasan murid perlukan bimbingan serta fail Excel multi-lembaran (`.xlsx`). |
| **Fasa 6** | Pemodenan Pangkalan Data & Penyegerakan Cloud | 🔄 Seterusnya | Naik taraf storan ke Supabase PostgreSQL dengan Realtime Channel (seperti Scan-HW). |

---

## 3. 🏛️ Seni Bina Teknikal & Peraturan Emas (Golden Invariants)

1. **Integriti Pengesanan 4 Titik Bucu OMR (4-Corner Marker Invariant):**
   * Pengimbasan hanya sah apabila 4 titik hitam bucu dikesan serentak dengan nisbah aspek yang tepat sebelum proses *warpPerspective* dijalankan.
2. **Peraturan Orientasi Cetakan Auto (A4 Print Layout Invariant):**
   * Kertas dengan ≤20 soalan **WAJIB** dicetak dalam mod **Portrait** (15mm margin).
   * Kertas dengan 21–40 soalan **WAJIB** dicetak dalam mod **Landscape** (15mm margin).
3. **Penyepaduan Dwi-Pengesahan AI (Dual-Check Verification):**
   * Pengiraan markah awal dibuat secara heuristik pantas (pixel density).
   * Sekiranya terdapat keraguan atau tanda bertindih, Google Gemini Vision API (`gemini-2.5-flash`) digunakan sebagai pengesah sekunder.
4. **Widget Carta Interaktif AI Chat (Interactive SVG Invariant):**
   * Respons AI yang mengandungi blok kod ` ```chart ` mestilah diproses secara automatik oleh `processChartBlocks()` menjadi widget SVG interaktif tanpa bergantung kepada pustaka luaran berat.
5. **Peraturan Sandaran Fail Tempatan (Mandatory Backup Rule):**
   * Sebarang suntingan kod sumber pada `CikguScanV6` **WAJIB** disandarkan ke `/Users/halimroslan/NEW CIDS SUITES PRO/` sebelum pengubahsuaian dibuat.

---

## 4. 📁 Peta Fail & Aset Kritikal
* `src/main.ts`: Nadi aplikasi CikguScan (4,500+ baris) yang mengendalikan kamera, pemprosesan imej OMR, pengiraan markah, pengurusan murid/kelas, dan modul AI Chat terapung.
* `index.html`: Struktur HTML penuh, borang OMR boleh cetak, templat modal analisis, butang `#btn-floating-ai`, dan `#modal-ai-chat`.
* `OMRImageProcessor.py`: Skrip rujukan algoritma pemprosesan OpenCV, pengekstrakan kontur, dan pemanggilan Gemini API.
* `src/firebase.ts`: Konfigurasi pengesahan Firebase Google Sign-In dan Firestore.
* `vite.config.ts`: Konfigurasi *bundler* Vite bersama modul `vite-plugin-pwa` untuk sokongan PWA luar talian.
* `.env.local`: Konfigurasi token Vercel OIDC dan API Key Gemini.

---

## 5. 📝 Log Keputusan Teknikal (Mini-ADRs)
* **2026-07-28 - Integrasi Butang Terapung AI & Carta SVG:** Menempatkan butang `btn-floating-ai` di sudut bawah kanan skrin dengan sokongan peralihan carta interaktif (Bar / Line / Dotted) terus dalam gelembung sembang.
* **2026-07-28 - Pengoptimuman Reka Letak Tindakan Mudah Alih:** Menyusun semula butang tindakan terus di bawah bingkai markah murid untuk mengelakkan pemotongan paparan pada skrin telefon.
* **2026-07-25 - Caching Imej Penuh OMR di IndexedDB:** Menyimpan imej imbasan bersaiz penuh ke dalam IndexedDB tempatan bagi memastikan prestasi pemuatan tidak terjejas dan jimat penggunaan kuota awan.

---

## 6. ⏭️ Tindakan Seterusnya (Next Action Items)
- [x] Bina modul eksport lembaran markah dan analisis item ke fail Excel (`.xlsx`).
- [x] Hasilkan laporan ringkasan analisis kelas format PDF bersedia-cetak (A4) dengan graf prestasi murid dan fokus intervensi.
- [ ] Selaraskan penyegerakan data awan dengan Supabase PostgreSQL mengikut corak `Scan-HW` (Fasa 6).
