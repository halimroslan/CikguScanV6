import './index.css';
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, Timestamp } from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";
import { GoogleGenAI, Type } from "@google/genai";

declare global {
    interface Window {
        currentUser: string | null;
        isLoginMode: boolean;
        trialInterval: any;
        JUMLAH_SOALAN: number;
        PILIHAN: string[];
        skemaJawapan: string[];
        streamKamera: MediaStream | null;
        gelungKamera: number;
        isScanning: boolean;
        autoSnapCounter: number;
        kelasSemasa: string;
        modAnalisisSemasa: string;
        senaraiRekodKelas: any;
        idUntukGanti: string | null;
        idRekodSemasa: string | null;
        mulaImbasSemulaRekod: (id: string) => void;
    }
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// GLOBALS
window.currentUser = null;
window.isLoginMode = true;
window.trialInterval = null;
window.JUMLAH_SOALAN = 40;
window.PILIHAN = ['A', 'B', 'C', 'D'];
window.skemaJawapan = Array(window.JUMLAH_SOALAN).fill(null);
window.streamKamera = null;
window.gelungKamera = null;
window.isScanning = false;
window.autoSnapCounter = 0;
window.kelasSemasa = "Kelas Umum";
window.modAnalisisSemasa = 'individu';
window.senaraiRekodKelas = [];
window.idUntukGanti = null; 
window.idRekodSemasa = null; 

const CONFIG_IMBASAN = {
    // 1. Parameter Kamera & Bingkai
    bingkaiSabar: 30, // Bilangan bingkai yg ditunggu sebelum auto-snap utk elak motion blur.
    
    // 2. Parameter Pengesanan Segi Empat (Marker)
    ambangMarkerHitam: 0.70, // 70% dari nilai kertas putih (paper brightness) sebagai had piksel tu dikira gelap.
    nisbahPikselMarker: 0.23, // Mesti sekurang-kurangnya 23% dari kotak marker wujud piksel hitam/hitam pudar.

    // 3. Parameter Analisis Bulatan Jawapan (OMR)
    radiusImbasan: 0.55, // 55% jejari akan diimbas dari setiap tanda bulat. Lebih besar = makin senang nampak sisa padaman yg luar orbit.
    ambangKosong: 10,     // Beza minimum gelapnya dakwat dengan kertas. Jika takat kegelapan < 10, ia set "KOSONG" (soalan tak dijawab).
    pemaafSisaPadaman: 12 // Kalau ada dua jawapan ditanda tebal, tapi beza kegelapan Jawapan Pertama dan Kedua adalah lebih daripada 12, sistem anggap Jawapan Kedua tu dipadam kurang sempurna dan akan terima Jawapan Pertama sbg valid.
};

const LOGO_TEPI_HTML = `
    <div class="absolute left-0 top-[25%] flex items-center justify-center gap-1 z-10" style="transform: translate(-50%, -50%) rotate(-90deg); transform-origin: center; white-space: nowrap;">
        <svg class="w-[10px] h-[10px] sm:w-[12px] sm:h-[12px] text-black" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6.5" y="5.5" width="11" height="13" rx="3.5" fill="currentColor" fill-opacity="0.2" />
            <path d="M8 4H6.5C5.11929 4 4 5.11929 4 6.5V8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M16 4H17.5C18.8807 4 20 5.11929 20 6.5V8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M8 20H6.5C5.11929 20 4 18.8807 4 17.5V16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M16 20H17.5C18.8807 20 20 18.8807 20 17.5V16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M2 12H22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <span class="text-[11px] sm:text-[13px] font-bold tracking-tight text-black">CikguScan</span>
        <span class="text-[5px] sm:text-[6px] font-medium bg-black text-white px-1 py-[1px] rounded-full">By Sir Halim</span>
    </div>
`;

function startTrialCountdown() {
    if (window.trialInterval) clearInterval(window.trialInterval);
    window.trialInterval = setInterval(() => {
        if (!window.currentUser) {
            clearInterval(window.trialInterval);
            return;
        }
        let proBulan = parseInt(localStorage.getItem('cikguscan_pro_bulan_' + window.currentUser) as string) || 0;
        let isPro = localStorage.getItem('cikguscan_is_pro_' + window.currentUser) === 'true';
        if (proBulan > 0 || isPro) {
            clearInterval(window.trialInterval);
            return;
        }
        
        let start = parseInt(localStorage.getItem('cikguscan_trial_start_' + window.currentUser) as string);
        if (!start) return;

        let now = Date.now();
        let elap = Math.floor((now - start) / 1000);
        let left = 3600 - elap;

        let statusEl = document.getElementById('header-user-status');
        let btnKelas = document.getElementById('btn-pilih-kelas');

        if (left <= 0) {
            clearInterval(window.trialInterval);
            localStorage.setItem('cikguscan_trial_finished_' + window.currentUser, 'true');
            signOut(auth).then(() => {
                paparAlert("Tempoh Cubaan Tamat ⏱️", "Masa 60 minit percubaan Pro telah tamat. Anda dilog keluar secara automatik. Sila log masuk semula untuk meneruskan dengan akaun Percuma.", true);
            });
        } else {
            if (statusEl) {
                let m = Math.floor(left / 60);
                let s = left % 60;
                statusEl.innerText = `CUBAAN PRO (${m}m ${s}s)`;
                statusEl.classList.remove('text-apple-textMuted', 'text-apple-blue');
                statusEl.classList.add('text-orange-500');
                if (btnKelas) btnKelas.parentElement!.classList.remove('hidden');
            }
        }
    }, 1000);
}

async function checkAuthReal(user: any) {
    if (window.trialInterval) {
        clearInterval(window.trialInterval);
        window.trialInterval = null;
    }

    if (user) {
        window.currentUser = user.email;
        
        let developerBtn = document.getElementById('btn-developer');
        if (developerBtn) {
            if (user.email === 'abdulhalimroslan@gmail.com') {
                developerBtn.classList.remove('hidden');
                developerBtn.classList.add('flex');
            } else {
                developerBtn.classList.add('hidden');
                developerBtn.classList.remove('flex');
            }
        }

        // Save/Sync User in Firestore
        try {
            const userRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userRef);
            let isPro = false;
            let proExpireAt = null;

            if (userDoc.exists()) {
                const data = userDoc.data();
                if (data.isPro) {
                    // Check if expired
                    if (data.proExpireAt && data.proExpireAt.toDate().getTime() > Date.now()) {
                        isPro = true;
                        proExpireAt = data.proExpireAt;
                    } else if (data.proExpireAt && data.proExpireAt.toDate().getTime() <= Date.now()) {
                        // Expired
                        await setDoc(userRef, { isPro: false, proExpireAt: null }, { merge: true });
                        isPro = false;
                    } else {
                        // isPro is true but no expiration, let's treat it as lifetime or admin override
                        isPro = true;
                    }
                }
            } else {
                // First time login
                await setDoc(userRef, {
                    email: user.email,
                    isPro: false,
                    lastLogin: Timestamp.now(),
                    trialCompleted: false
                });
            }

            if (user.email === 'abdulhalimroslan@gmail.com') {
                isPro = true;
                await setDoc(userRef, { isPro: true, proExpireAt: null, lastLogin: Timestamp.now() }, { merge: true });
            }

            localStorage.setItem('cikguscan_is_pro_' + window.currentUser, isPro ? 'true' : 'false');
            
            // Calculate remaining trial or pro status
            continueAuthFlow(isPro);

        } catch (error) {
            console.error(error);
            // Fallback for UI if DB fails
            continueAuthFlow(false);
        }

    } else {
        window.currentUser = null;
        document.getElementById('auth-view')!.classList.remove('hidden');
        document.getElementById('auth-view')!.classList.add('flex');
        document.getElementById('main-app-view')!.classList.add('hidden');
        
        let developerBtn = document.getElementById('btn-developer');
        if (developerBtn) {
            developerBtn.classList.add('hidden');
            developerBtn.classList.remove('flex');
        }
    }
}

function continueAuthFlow(isProMode: boolean) {
    document.getElementById('auth-view')!.classList.add('hidden');
    document.getElementById('auth-view')!.classList.remove('flex');
    document.getElementById('main-app-view')!.classList.remove('hidden');
    document.getElementById('header-user-email')!.innerText = window.currentUser || '';

    let proBulan = parseInt(localStorage.getItem('cikguscan_pro_bulan_' + window.currentUser) as any) || 0;
    let trialFinished = localStorage.getItem('cikguscan_trial_finished_' + window.currentUser) === 'true';
    let trialStart = localStorage.getItem('cikguscan_trial_start_' + window.currentUser);
    
    let isTrialActive = false;
    let secondsLeft = 0;

    if (proBulan <= 0 && !isProMode && trialStart) {
        let elapsed = Math.floor((Date.now() - parseInt(trialStart)) / 1000);
        secondsLeft = 3600 - elapsed;

        if (secondsLeft > 0) {
            isTrialActive = true;
            trialFinished = false; 
            localStorage.setItem('cikguscan_trial_finished_' + window.currentUser, 'false');
        } else {
            localStorage.setItem('cikguscan_trial_finished_' + window.currentUser, 'true');
            trialFinished = true;
        }
    }

    let statusEl = document.getElementById('header-user-status');
    let btnKelas = document.getElementById('btn-pilih-kelas');
    
    if (statusEl) {
        if (proBulan > 0 || isProMode) {
            statusEl.innerText = isProMode ? `AKAUN PRO (365 HARI)` : `AKAUN PRO (${proBulan} HARI)`;
            statusEl.classList.remove('text-apple-textMuted', 'text-orange-500');
            statusEl.classList.add('text-apple-blue');
            if (btnKelas) btnKelas.parentElement!.classList.remove('hidden');
        } else if (isTrialActive) {
            let m = Math.floor(secondsLeft / 60);
            let s = secondsLeft % 60;
            statusEl.innerText = `CUBAAN PRO (${m}m ${s}s)`;
            statusEl.classList.remove('text-apple-textMuted', 'text-apple-blue');
            statusEl.classList.add('text-orange-500');
            if (btnKelas) btnKelas.parentElement!.classList.remove('hidden');
            startTrialCountdown();
        } else {
            statusEl.innerText = "AKAUN (PERCUMA)";
            statusEl.classList.remove('text-apple-blue', 'text-orange-500');
            statusEl.classList.add('text-apple-textMuted');
            if (btnKelas) btnKelas.parentElement!.classList.add('hidden');
        }
    }

    initAppContent();
}

function checkAuth(user: any) {
    checkAuthReal(user);
}

onAuthStateChanged(auth, (user) => {
    checkAuth(user);
});

async function handleGoogleAuth() {
    let btn = document.getElementById('auth-google-btn')!;
    let textAsal = btn.innerHTML;
    btn.innerHTML = `<svg class="animate-spin h-5 w-5 text-gray-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Log Masuk...`;
    (btn as HTMLButtonElement).disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');

    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error: any) {
        if (error.code !== 'auth/popup-closed-by-user') {
            paparAlert("Log Masuk Gagal", error.message);
        }
    } finally {
        btn.innerHTML = textAsal;
        (btn as HTMLButtonElement).disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}
document.getElementById('auth-google-btn')!.addEventListener('click', handleGoogleAuth);

document.getElementById('btn-logout')!.addEventListener('click', () => {
    paparConfirm("Log Keluar", "Adakah cikgu pasti mahu log keluar dari sistem CikguScan?", () => {
        signOut(auth);
    });
});

window.addEventListener('afterprint', () => {
    document.body.classList.remove('mode-cetak-analisis', 'mode-cetak-skema');
    updatePageOrientation('omr');
    document.title = "CikguScan OMR";
});

function initAppContent() {
    let savedSoalan = localStorage.getItem('cikguscan_jumlah_' + window.currentUser);
    if(savedSoalan) {
        window.JUMLAH_SOALAN = parseInt(savedSoalan);
        (document.getElementById('input-jumlah-soalan') as HTMLInputElement).value = window.JUMLAH_SOALAN.toString();
    } else {
        window.JUMLAH_SOALAN = 40;
        (document.getElementById('input-jumlah-soalan') as HTMLInputElement).value = '40';
    }

    let savedSkema = localStorage.getItem('cikguscan_skema_' + window.currentUser);
    if (savedSkema) {
        window.skemaJawapan = JSON.parse(savedSkema);
        if(window.skemaJawapan.length !== window.JUMLAH_SOALAN) {
            let temp = Array(window.JUMLAH_SOALAN).fill(null);
            for(let i=0; i < Math.min(window.skemaJawapan.length, window.JUMLAH_SOALAN); i++){ temp[i] = window.skemaJawapan[i]; }
            window.skemaJawapan = temp;
        }
    } else {
        window.skemaJawapan = Array(window.JUMLAH_SOALAN).fill(null);
    }

    muatRekodLokal();
    updatePageOrientation();
    janaBorangSkema();
    janaBorangCetak();
    tukarTab('skema'); 
}

function paparAlert(title: string, msg: string, isProAlert = false) {
    document.getElementById('alert-title')!.innerText = title;
    document.getElementById('alert-msg')!.innerText = msg;
    
    let btnContainer = document.getElementById('alert-btn-container')!;
    if(isProAlert) {
        btnContainer.innerHTML = `
            <button id="btn-tutup-alert-inner" class="w-full bg-apple-text text-white py-3 rounded-[14px] font-medium hover:bg-black transition-all active:scale-[0.98]">Tutup</button>
            <a href="https://forms.gle/JHdycPrpD3MRhqHo6" target="_blank" class="w-full bg-apple-blue text-white py-3 rounded-[14px] font-medium hover:bg-apple-blueHover transition-all active:scale-[0.98] flex items-center justify-center">Langgan Pro</a>
        `;
    } else {
        btnContainer.innerHTML = `
            <button id="btn-tutup-alert-inner" class="w-full bg-apple-blue text-white py-3 rounded-[14px] font-medium hover:bg-apple-blueHover transition-all active:scale-[0.98]">Selesai</button>
        `;
    }
    document.getElementById('btn-tutup-alert-inner')!.addEventListener('click', tutupAlert);

    document.getElementById('modal-alert')!.classList.remove('hidden');
    document.getElementById('modal-alert')!.classList.add('flex');
}

function tutupAlert() {
    document.getElementById('modal-alert')!.classList.add('hidden');
    document.getElementById('modal-alert')!.classList.remove('flex');
}

let confirmCallback: any = null;
function paparConfirm(title: string, msg: string, callback: any) {
    document.getElementById('confirm-title')!.innerText = title;
    document.getElementById('confirm-msg')!.innerText = msg;
    confirmCallback = callback;
    document.getElementById('modal-confirm')!.classList.remove('hidden');
    document.getElementById('modal-confirm')!.classList.add('flex');
}

function tutupConfirm() {
    document.getElementById('modal-confirm')!.classList.add('hidden');
    document.getElementById('modal-confirm')!.classList.remove('flex');
    confirmCallback = null;
}

document.getElementById('btn-confirm-ok')!.addEventListener('click', function() {
    if(confirmCallback) confirmCallback();
    tutupConfirm();
});
document.getElementById('btn-confirm-batal')!.addEventListener('click', tutupConfirm);

function muatRekodLokal() {
    let data = localStorage.getItem('cikguscan_rekod_kelas_' + window.currentUser);
    if (data) {
        try {
            window.senaraiRekodKelas = JSON.parse(data);
        } catch(e) {
            window.senaraiRekodKelas = [];
        }
    } else {
        window.senaraiRekodKelas = [];
    }
    kemaskiniBadgeAnalisis();
}

function simpanRekodLokal() {
    localStorage.setItem('cikguscan_rekod_kelas_' + window.currentUser, JSON.stringify(window.senaraiRekodKelas));
    kemaskiniBadgeAnalisis();
}

function mintaSahkanPadamSemua() {
    paparConfirm("Padam Semua Data", "Cikgu pasti mahu memadam semua rekod imbasan dalam sistem?", () => {
        window.senaraiRekodKelas = [];
        simpanRekodLokal();
        paparAnalisisUI();
    });
}
document.getElementById('btn-padam-semua')!.addEventListener('click', mintaSahkanPadamSemua);

(window as any).mintaSahkanPadamRekod = function(event: any, id: string) {
    event.stopPropagation();
    paparConfirm("Padam Rekod Individu", "Cikgu pasti mahu padam rekod pelajar ini?", () => {
        window.senaraiRekodKelas = window.senaraiRekodKelas.filter((r: any) => r.id !== id);
        simpanRekodLokal();
        paparAnalisisUI();
    });
}

function mintaSahkanPadamSemasa() {
    if (window.idRekodSemasa) {
        paparConfirm("Buang Imbasan Ini", "Data ini akan dibuang dan tidak dimasukkan ke dalam tab Analisis. Teruskan?", () => {
            window.senaraiRekodKelas = window.senaraiRekodKelas.filter((r: any) => r.id !== window.idRekodSemasa);
            simpanRekodLokal();
            window.idRekodSemasa = null;
            tukarTab('imbas');
        });
    }
}
document.getElementById('btn-padam-semasa')!.addEventListener('click', mintaSahkanPadamSemasa);

function kemaskiniBadgeAnalisis() {
    let badge = document.getElementById('badge-analisis');
    if (badge) {
        if (window.senaraiRekodKelas.length > 0) {
            badge.classList.replace('hidden', 'flex');
            badge.innerText = window.senaraiRekodKelas.length.toString();
        } else {
            badge.classList.replace('flex', 'hidden');
        }
    }
}

function bukaModalAI() {
    let input = document.getElementById('input-api-key') as HTMLInputElement;
    input.value = localStorage.getItem('gemini_api_key') || "";
    document.getElementById('modal-ai')!.classList.remove('hidden');
    document.getElementById('modal-ai')!.classList.add('flex');
    setTimeout(() => input.focus(), 100);
}
document.getElementById('btn-tetapan-ai')!.addEventListener('click', bukaModalAI);

function tutupModalAI() {
    document.getElementById('modal-ai')!.classList.add('hidden');
    document.getElementById('modal-ai')!.classList.remove('flex');
}
document.getElementById('btn-batal-ai')!.addEventListener('click', tutupModalAI);

function simpanAI() {
    let val = (document.getElementById('input-api-key') as HTMLInputElement).value.trim();
    if (val !== "") {
        localStorage.setItem('gemini_api_key', val);
        paparAlert("Berjaya", "API Key telah disimpan. AI kini akan digunakan untuk mengesahkan ketepatan imbasan OMR.");
    } else {
        localStorage.removeItem('gemini_api_key');
        paparAlert("AI Dinyahaktif", "API Key telah dibuang. Sistem akan kembali menggunakan pengiraan imbasan biasa secara offline.");
    }
    tutupModalAI();
}
document.getElementById('btn-simpan-ai')!.addEventListener('click', simpanAI);

function bukaModalKelas() {
    let input = document.getElementById('input-nama-kelas') as HTMLInputElement;
    input.value = window.kelasSemasa === "Kelas Umum" ? "" : window.kelasSemasa;
    document.getElementById('modal-kelas')!.classList.remove('hidden');
    document.getElementById('modal-kelas')!.classList.add('flex');
    setTimeout(() => input.focus(), 100);
    
    let tabImbas = document.getElementById('tab-imbas')!;
    if (!tabImbas.classList.contains('hidden')) {
        hentikanKamera();
    }
}
document.getElementById('btn-pilih-kelas')!.addEventListener('click', bukaModalKelas);

function tutupModalKelas() {
    document.getElementById('modal-kelas')!.classList.add('hidden');
    document.getElementById('modal-kelas')!.classList.remove('flex');
    
    let tabImbas = document.getElementById('tab-imbas')!;
    if (!tabImbas.classList.contains('hidden')) {
        if (window.kelasSemasa === "Kelas Umum" || window.kelasSemasa.trim() === "") {
            paparAlert("Kamera Dijeda", "Kamera tidak akan diaktifkan sehingga nama kelas dimasukkan. Sila tekan butang 'Kelas' di atas untuk memasukkan nama kelas.");
        } else {
            setTimeout(() => mulakanKamera(), 100);
        }
    }
}
document.getElementById('btn-batal-kelas')!.addEventListener('click', tutupModalKelas);

function simpanKelas() {
    let val = (document.getElementById('input-nama-kelas') as HTMLInputElement).value.trim();
    if (val !== "") {
        window.kelasSemasa = val;
        document.getElementById('btn-pilih-kelas')!.innerText = "Kelas: " + window.kelasSemasa;
        document.getElementById('modal-kelas')!.classList.add('hidden');
        document.getElementById('modal-kelas')!.classList.remove('flex');
        paparAnalisisUI(); 

        let tabImbas = document.getElementById('tab-imbas')!;
        if (!tabImbas.classList.contains('hidden')) {
            setTimeout(() => mulakanKamera(), 100);
        }
    } else {
        paparAlert("Perhatian", "Sila masukkan nama kelas untuk meneruskan imbasan.");
    }
}
document.getElementById('btn-simpan-kelas')!.addEventListener('click', simpanKelas);

(window as any).bukaModalRekod = function(id: string) {
    (window as any).modalRekodSemasaId = id;
    let rekod = window.senaraiRekodKelas.find((r: any) => r.id === id);
    if(!rekod) return;

    let ikonBetul = '<svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>';
    let ikonSalah = '<svg class="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg>';

    let butiranHtml = rekod.butiran.map((b: any) => {
        let ikon = b.betul ? ikonBetul : ikonSalah;
        let warnaTeks = b.betul ? 'text-green-600' : 'text-red-500';
        return `
            <div class="flex items-center justify-between p-2 bg-white rounded-lg border border-gray-100 text-sm shadow-sm">
                <div class="w-12 font-semibold text-gray-500">No. ${b.soalan}</div>
                <div class="flex-1 text-center font-bold ${warnaTeks}">${b.jawapanPelajar}</div>
                <div class="flex items-center justify-end gap-1 w-20 text-gray-400 font-medium text-xs">
                    Skema: ${b.jawapanSebenar} ${ikon}
                </div>
            </div>
        `;
    }).join('');

    let aiVerifiedHtml = '';
    if (rekod.isAiVerified === true) {
        aiVerifiedHtml = `<div class="absolute top-3 right-3 flex items-center justify-center bg-blue-50 text-blue-600 text-xs font-bold px-2.5 py-1 rounded-full border border-blue-100 shadow-sm gap-1">
             <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
             Disahkan AI
           </div>`;
    } else if (rekod.isAiVerified === 'pending') {
        aiVerifiedHtml = `<div class="absolute top-3 right-3 flex items-center justify-center bg-orange-50 text-orange-600 text-xs font-bold px-2.5 py-1 rounded-full border border-orange-100 shadow-sm gap-1">
             <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
             Disemak AI...
           </div>`;
    } else if (rekod.isAiVerified === 'failed') {
        aiVerifiedHtml = `<div class="absolute top-3 right-3 flex items-center justify-center bg-gray-100 text-gray-500 text-xs font-bold px-2.5 py-1 rounded-full border border-gray-200 shadow-sm gap-1">
             <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
             AI Gagal
           </div>`;
    }
        
    let keratanNamaHtml = rekod.imejNama 
        ? `<div class="mt-4 mb-2 flex justify-center"><img src="${rekod.imejNama}" class="h-12 sm:h-14 object-contain" /></div>` 
        : '';

    document.getElementById('modal-kandungan')!.innerHTML = `
        <div class="mb-6 bg-white p-4 rounded-2xl shadow-sm text-center border border-gray-100 relative">
            <div class="text-xs bg-gray-100 text-gray-500 px-3 py-1 rounded-full absolute top-3 left-3 font-semibold">${rekod.kelas || 'Kelas Umum'}</div>
            ${aiVerifiedHtml}
            ${keratanNamaHtml}
            <div class="text-4xl font-extrabold text-apple-text tracking-tight mb-1 mt-2">${rekod.markah}<span class="text-xl text-gray-400 font-medium">/${rekod.jumlah}</span></div>
            <div class="inline-block bg-apple-bg px-3 py-1 rounded-full text-apple-blue font-bold text-sm">${rekod.peratus}%</div>
        </div>
        
        <div id="bahagian-omr-penuh" class="hidden">
            <h4 class="font-bold text-gray-800 mb-3 px-1">Paparan Imbasan OMR</h4>
            <div class="w-full bg-white p-2 rounded-2xl shadow-sm border border-gray-100 mb-6">
                <img src="${rekod.imejPenuh}" class="w-full h-auto rounded-xl object-contain bg-gray-50" />
            </div>
        </div>
        
        <h4 class="font-bold text-gray-800 mb-3 px-1">Perincian Item</h4>
        <div class="space-y-2 mb-4">
            ${butiranHtml}
        </div>
    `;

    let btnPaparOMR = document.getElementById('btn-modal-omr')!;
    btnPaparOMR.innerText = "Papar OMR";
    btnPaparOMR.onclick = () => {
        let section = document.getElementById('bahagian-omr-penuh')!;
        if (section.classList.contains('hidden')) {
            section.classList.remove('hidden');
            btnPaparOMR.innerText = "Tutup OMR";
        } else {
            section.classList.add('hidden');
            btnPaparOMR.innerText = "Papar OMR";
        }
    };

    document.getElementById('btn-modal-imbas')!.onclick = () => window.mulaImbasSemulaRekod(id);

    let modal = document.getElementById('modal-rekod')!;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    document.getElementById('modal-kandungan')!.scrollTop = 0;
}

function tutupModalRekod() {
    let modal = document.getElementById('modal-rekod')!;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}
document.getElementById('btn-tutup-modal-rekod')!.addEventListener('click', tutupModalRekod);

function binaBarisSoalan10(index: number, skemaJawapanList: any = null) {
    if (index >= window.JUMLAH_SOALAN) return '';
    let htmlBulatan = window.PILIHAN.map(p => {
        let fillCircle = "white", fillText = "#9CA3AF", strokeColor = "#D1D5DB"; 
        if (skemaJawapanList) {
            let isJawapan = (skemaJawapanList[index] === p);
            fillCircle = isJawapan ? "black" : "white";
            fillText = isJawapan ? "white" : "#9CA3AF";
            strokeColor = isJawapan ? "black" : "#D1D5DB";
        }
        return `
        <div class="flex-1 flex items-center justify-center h-full">
            <svg viewBox="0 0 100 100" style="height: 100%; max-width: 100%;">
                <circle cx="50" cy="50" r="45" stroke="${strokeColor}" stroke-width="4.5" fill="${fillCircle}" />
                <text x="50" y="50" dy=".35em" text-anchor="middle" font-size="46" font-family="'Inter', sans-serif" font-weight="600" fill="${fillText}">${p}</text>
            </svg>
        </div>`;
    }).join('');
    return `
    <div class="flex items-center w-[85%] mx-auto" style="height: ${100/window.JUMLAH_SOALAN}%;">
        <div class="w-[20%] text-right pr-3 text-[14px] text-black font-medium">${index + 1}</div>
        <div class="w-[80%] flex justify-between h-[85%]">${htmlBulatan}</div>
    </div>`;
}

function getFormHTMLTemplate10(skemaJawapanList: any = null, isSkema = false) {
    let rows = '';
    for (let i = 0; i < window.JUMLAH_SOALAN; i++) rows += binaBarisSoalan10(i, skemaJawapanList);
    let headerHtml = isSkema ? `
        <div class="h-[30%] flex flex-col">
            <div class="flex-1 flex flex-col mb-2">
                <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Skema Jawapan</div>
                <div class="flex-1 border-[2px] border-black w-[90%]"></div>
            </div><div class="flex-1 flex flex-col"></div>
        </div>` : `
        <div class="h-[30%] flex flex-col">
            <div class="flex-1 flex flex-col mb-2">
                <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Nama</div>
                <div class="flex-1 border-[2px] border-black w-[90%]"></div>
            </div>
            <div class="flex-1 flex flex-col">
                <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Kelas</div>
                <div class="flex-1 border-[2px] border-black w-[90%]"></div>
            </div>
        </div>`;
    return `
    <div class="w-full relative mx-auto border-[2px] border-transparent" style="aspect-ratio: 1 / 1.35; font-family: 'Inter', sans-serif;">
        <div class="marker-corner absolute top-0 left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, -50%);"></div>
        <div class="marker-corner absolute top-[50%] left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, -50%);"></div>
        <div class="marker-corner absolute bottom-0 left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, 50%);"></div>
        <div class="marker-corner absolute top-0 right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, -50%);"></div>
        <div class="marker-corner absolute top-[50%] right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, -50%);"></div>
        <div class="marker-corner absolute bottom-0 right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, 50%);"></div>
        ${LOGO_TEPI_HTML}
        <div class="absolute inset-0 flex flex-col p-[6%]">
            ${headerHtml}
            <div class="h-[5%]"></div>
            <div class="h-[65%] flex flex-col">${rows}</div>
        </div>
    </div>`;
}

function binaBarisSoalan20(index: number, skemaJawapanList: any = null) {
    if (index >= window.JUMLAH_SOALAN) return `<div class="w-full" style="height: 10%;"></div>`;
    let htmlBulatan = window.PILIHAN.map(p => {
        let fillCircle = "white", fillText = "#9CA3AF", strokeColor = "#D1D5DB"; 
        if (skemaJawapanList) {
            let isJawapan = (skemaJawapanList[index] === p);
            fillCircle = isJawapan ? "black" : "white";
            fillText = isJawapan ? "white" : "#9CA3AF";
            strokeColor = isJawapan ? "black" : "#D1D5DB";
        }
        return `
        <div class="flex-1 flex items-center justify-center h-full">
            <svg viewBox="0 0 100 100" style="height: 85%; max-width: 100%;">
                <circle cx="50" cy="50" r="45" stroke="${strokeColor}" stroke-width="4.5" fill="${fillCircle}" />
                <text x="50" y="50" dy=".35em" text-anchor="middle" font-size="46" font-family="'Inter', sans-serif" font-weight="600" fill="${fillText}">${p}</text>
            </svg>
        </div>`;
    }).join('');
    return `
    <div class="flex items-center w-full" style="height: 10%;">
        <div class="w-[22%] text-right pr-1 sm:pr-2 text-[11px] sm:text-[13px] text-black font-medium">${index + 1}</div>
        <div class="w-[78%] flex justify-between h-[85%]">${htmlBulatan}</div>
    </div>`;
}

function getFormHTMLTemplate20(skemaJawapanList: any = null, isSkema = false) {
    let col1 = '', col2 = '';
    for (let i = 0; i < 10; i++) col1 += binaBarisSoalan20(i, skemaJawapanList);
    for (let i = 10; i < 20; i++) col2 += binaBarisSoalan20(i, skemaJawapanList);
    let headerHtml = isSkema ? `
        <div class="h-[30%] flex flex-col">
            <div class="flex-1 flex flex-col mb-2">
                <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Skema Jawapan</div>
                <div class="flex-1 border-[2px] border-black w-[90%]"></div>
            </div><div class="flex-1 flex flex-col"></div>
        </div>` : `
        <div class="h-[30%] flex flex-col">
            <div class="flex-1 flex flex-col mb-2">
                <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Nama</div>
                <div class="flex-1 border-[2px] border-black w-[90%]"></div>
            </div>
            <div class="flex-1 flex flex-col">
                <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Kelas</div>
                <div class="flex-1 border-[2px] border-black w-[90%]"></div>
            </div>
        </div>`;
    return `
    <div class="w-full relative mx-auto border-[2px] border-transparent" style="aspect-ratio: 1 / 1.35; font-family: 'Inter', sans-serif;">
        <div class="marker-corner absolute top-0 left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, -50%);"></div>
        <div class="marker-corner absolute top-[50%] left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, -50%);"></div>
        <div class="marker-corner absolute bottom-0 left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, 50%);"></div>
        <div class="marker-corner absolute top-0 right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, -50%);"></div>
        <div class="marker-corner absolute top-[50%] right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, -50%);"></div>
        <div class="marker-corner absolute bottom-0 right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, 50%);"></div>
        ${LOGO_TEPI_HTML}
        <div class="absolute inset-0 flex flex-col p-[6%]">
            ${headerHtml}
            <div class="h-[5%]"></div>
            <div class="h-[65%] flex justify-between">
                <div class="w-[48%] flex flex-col h-full">${col1}</div>
                <div class="w-[48%] flex flex-col h-full">${col2}</div>
            </div>
        </div>
    </div>`;
}

function binaBarisSoalan30(index: number, skemaJawapanList: any = null) {
    if (index >= window.JUMLAH_SOALAN) return `<div class="w-full" style="height: ${100/15}%;"></div>`;
    let htmlBulatan = window.PILIHAN.map(p => {
        let fillCircle = "white", fillText = "#9CA3AF", strokeColor = "#D1D5DB"; 
        if (skemaJawapanList) {
            let isJawapan = (skemaJawapanList[index] === p);
            fillCircle = isJawapan ? "black" : "white";
            fillText = isJawapan ? "white" : "#9CA3AF";
            strokeColor = isJawapan ? "black" : "#D1D5DB";
        }
        return `
        <div class="flex-1 flex items-center justify-center h-full">
            <svg viewBox="0 0 100 100" style="height: 85%; max-width: 100%;">
                <circle cx="50" cy="50" r="45" stroke="${strokeColor}" stroke-width="4.5" fill="${fillCircle}" />
                <text x="50" y="50" dy=".35em" text-anchor="middle" font-size="46" font-family="'Inter', sans-serif" font-weight="600" fill="${fillText}">${p}</text>
            </svg>
        </div>`;
    }).join('');
    return `
    <div class="flex items-center w-full" style="height: ${100/15}%;">
        <div class="w-[18%] text-right pr-2 text-[11px] sm:text-[13px] text-black font-medium">${index + 1}</div>
        <div class="w-[82%] flex justify-between h-[85%]">${htmlBulatan}</div>
    </div>`;
}

function getFormHTMLTemplate30(skemaJawapanList: any = null, isSkema = false) {
    let col1 = '', col2 = '';
    for (let i = 0; i < 15; i++) col1 += binaBarisSoalan30(i, skemaJawapanList);
    for (let i = 15; i < 30; i++) col2 += binaBarisSoalan30(i, skemaJawapanList);
    let headerHtml = isSkema ? `
        <div class="h-[20%] flex flex-col w-[100%]">
            <div class="flex w-full justify-between items-end h-full pb-2">
                <div class="w-full flex flex-col">
                    <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Skema Jawapan</div>
                    <div class="w-full h-8 border-[2px] border-black"></div>
                </div>
            </div>
        </div>` : `
        <div class="h-[20%] flex flex-col w-[100%]">
            <div class="flex w-full justify-between items-end h-full pb-2">
                <div class="w-[60%] flex flex-col">
                    <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Nama</div>
                    <div class="w-full h-8 border-[2px] border-black"></div>
                </div>
                <div class="w-[35%] flex flex-col">
                    <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Kelas</div>
                    <div class="w-full h-8 border-[2px] border-black"></div>
                </div>
            </div>
        </div>`;
    return `
        <div class="w-full relative mx-auto border-[2px] border-transparent" style="aspect-ratio: 1 / 1.35; font-family: 'Inter', sans-serif;">
            <div class="marker-corner absolute top-0 left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, -50%);"></div>
            <div class="marker-corner absolute top-[50%] left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, -50%);"></div>
            <div class="marker-corner absolute bottom-0 left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, 50%);"></div>
            <div class="marker-corner absolute top-0 right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, -50%);"></div>
            <div class="marker-corner absolute top-[50%] right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, -50%);"></div>
            <div class="marker-corner absolute bottom-0 right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, 50%);"></div>
            ${LOGO_TEPI_HTML}
            <div class="absolute inset-0 flex flex-col p-[5%]">
                ${headerHtml}
                <div class="h-[80%] flex justify-between">
                    <div class="w-[48%] flex flex-col h-full">${col1}</div>
                    <div class="w-[48%] flex flex-col h-full">${col2}</div>
                </div>
            </div>
        </div>`;
}

function binaBarisSoalan40(index: number, totalRowsInBlock: number, skemaJawapanList: any = null) {
    if (index >= window.JUMLAH_SOALAN) return `<div class="w-full" style="height: ${100/totalRowsInBlock}%;"></div>`;
    let htmlBulatan = window.PILIHAN.map(p => {
        let fillCircle = "white", fillText = "#9CA3AF", strokeColor = "#D1D5DB";
        if (skemaJawapanList) {
            let isJawapan = (skemaJawapanList[index] === p);
            fillCircle = isJawapan ? "black" : "white";
            fillText = isJawapan ? "white" : "#9CA3AF";
            strokeColor = isJawapan ? "black" : "#D1D5DB";
        }
        return `
        <div class="flex-1 flex items-center justify-center h-full">
            <svg viewBox="0 0 100 100" style="height: 85%; max-width: 100%;">
                <circle cx="50" cy="50" r="45" stroke="${strokeColor}" stroke-width="4.5" fill="${fillCircle}" />
                <text x="50" y="50" dy=".35em" text-anchor="middle" font-size="46" font-family="'Inter', sans-serif" font-weight="600" fill="${fillText}">${p}</text>
            </svg>
        </div>`;
    }).join('');
    return `
    <div class="flex items-center w-full" style="height: ${100/totalRowsInBlock}%;">
        <div class="w-[18%] text-right pr-1 sm:pr-2 text-[10px] sm:text-[12px] text-black font-medium">${index + 1}</div>
        <div class="w-[82%] flex justify-between h-[85%]">${htmlBulatan}</div>
    </div>`;
}

function getFormHTMLTemplate40(skemaJawapanList: any = null, isSkema = false) {
    let col1Top = '', col1Bot = '', col2Top = '', col2Bot = '', col3Top = '', col3Bot = '';
    for (let i = 0; i < 7; i++) col1Top += binaBarisSoalan40(i, 7, skemaJawapanList);
    for (let i = 7; i < 15; i++) col1Bot += binaBarisSoalan40(i, 8, skemaJawapanList);
    for (let i = 15; i < 22; i++) col2Top += binaBarisSoalan40(i, 7, skemaJawapanList);
    for (let i = 22; i < 30; i++) col2Bot += binaBarisSoalan40(i, 8, skemaJawapanList);
    for (let i = 30; i < 37; i++) col3Top += binaBarisSoalan40(i, 7, skemaJawapanList);
    for (let i = 37; i < 40; i++) col3Bot += binaBarisSoalan40(i, 8, skemaJawapanList);

    let headerHtml = isSkema ? `
        <div class="h-[20%] flex flex-col w-[100%]">
            <div class="flex w-full justify-between items-end h-full pb-2">
                <div class="w-full flex flex-col">
                    <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Skema Jawapan</div>
                    <div class="w-full h-8 border-[2px] border-black"></div>
                </div>
            </div>
        </div>` : `
        <div class="h-[20%] flex flex-col w-[100%]">
            <div class="flex w-full justify-between items-end h-full pb-2">
                <div class="w-[60%] flex flex-col">
                    <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Nama</div>
                    <div class="w-full h-8 border-[2px] border-black"></div>
                </div>
                <div class="w-[35%] flex flex-col">
                    <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Kelas</div>
                    <div class="w-full h-8 border-[2px] border-black"></div>
                </div>
            </div>
        </div>`;

    return `
    <div class="w-full relative mx-auto border-[2px] border-transparent" style="aspect-ratio: 1 / 1.35; font-family: 'Inter', sans-serif;">
        <div class="marker-corner absolute top-0 left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, -50%);"></div>
        <div class="marker-corner absolute top-[50%] left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, -50%);"></div>
        <div class="marker-corner absolute bottom-0 left-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(-50%, 50%);"></div>
        <div class="marker-corner absolute top-0 right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, -50%);"></div>
        <div class="marker-corner absolute top-[50%] right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, -50%);"></div>
        <div class="marker-corner absolute bottom-0 right-0 w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] bg-black z-10" style="transform: translate(50%, 50%);"></div>
        ${LOGO_TEPI_HTML}
        <div class="absolute inset-0 flex flex-col p-[5%]">
            ${headerHtml}
            <div class="h-[80%] flex flex-col w-full">
                <div class="flex w-full justify-between" style="height: 41.17%;">
                    <div class="w-[32%] flex flex-col">${col1Top}</div>
                    <div class="w-[32%] flex flex-col">${col2Top}</div>
                    <div class="w-[32%] flex flex-col">${col3Top}</div>
                </div>
                <div class="w-full" style="height: 11.76%;"></div>
                <div class="flex w-full justify-between" style="height: 47.07%;">
                    <div class="w-[32%] flex flex-col">${col1Bot}</div>
                    <div class="w-[32%] flex flex-col">${col2Bot}</div>
                    <div class="w-[32%] flex flex-col">${col3Bot}</div>
                </div>
            </div>
        </div>
    </div>`;
}

function dapatkanGeometriOMR(cw: number, ch: number): any {
    if (window.JUMLAH_SOALAN <= 10) return dapatkanGeometriOMR10(cw, ch);
    else if (window.JUMLAH_SOALAN <= 20) return dapatkanGeometriOMR20(cw, ch);
    else if (window.JUMLAH_SOALAN <= 30) return dapatkanGeometriOMR30(cw, ch);
    else return dapatkanGeometriOMR40(cw, ch);
}

function dapatkanGeometriOMR10(cw: number, ch: number) {
    let boxW = cw * 0.70, boxH = boxW * 1.35; 
    if (boxH > ch * 0.85) { boxH = ch * 0.85; boxW = boxH / 1.35; }
    const boxX = (cw - boxW) / 2, boxY = (ch - boxH) / 2;
    let paddingY = boxH * 0.06, innerH = boxH * 0.88; 
    let trueQuestionStartY = boxY + paddingY + (innerH * 0.35);
    let trueQuestionAreaH = innerH * 0.65;
    let rowHeight = trueQuestionAreaH / window.JUMLAH_SOALAN; 
    let innerW = boxW * 0.88, rowW = innerW * 0.85; 
    let rowX = boxX + (boxW * 0.06) + ((innerW - rowW) / 2);

    function getPilihanGeometri(soalanIndex: number) {
        let cY = trueQuestionStartY + (soalanIndex * rowHeight) + (rowHeight / 2);
        let bubbleAreaW = rowW * 0.80, bubbleAreaX = rowX + (rowW * 0.20); 
        let posX = [bubbleAreaX + bubbleAreaW * 0.125, bubbleAreaX + bubbleAreaW * 0.375, bubbleAreaX + bubbleAreaW * 0.625, bubbleAreaX + bubbleAreaW * 0.875];
        return { cy: cY, posX: posX };
    }
    return { boxX, boxY, boxW, boxH, rowHeight, getPilihanGeometri, trueQuestionStartY, layout: '10' };
}

function dapatkanGeometriOMR20(cw: number, ch: number) {
    let boxW = cw * 0.70, boxH = boxW * 1.35; 
    if (boxH > ch * 0.85) { boxH = ch * 0.85; boxW = boxH / 1.35; }
    const boxX = (cw - boxW) / 2, boxY = (ch - boxH) / 2;
    let paddingY = boxH * 0.06, innerH = boxH * 0.88; 
    let trueQuestionStartY = boxY + paddingY + (innerH * 0.35);
    let trueQuestionAreaH = innerH * 0.65;
    let rowHeight = trueQuestionAreaH / 10; 
    let innerW = boxW * 0.88, innerX = boxX + (boxW * 0.06), colW = innerW * 0.48; 

    function getPilihanGeometri(soalanIndex: number) {
        let col = Math.floor(soalanIndex / 10), row = soalanIndex % 10;
        let cY = trueQuestionStartY + (row * rowHeight) + (rowHeight / 2);
        let cXOffset = (col === 0) ? 0 : (innerW - colW);
        let colX = innerX + cXOffset;
        let bubbleAreaW = colW * 0.78, bubbleAreaX = colX + (colW * 0.22); 
        let posX = [bubbleAreaX + bubbleAreaW * 0.125, bubbleAreaX + bubbleAreaW * 0.375, bubbleAreaX + bubbleAreaW * 0.625, bubbleAreaX + bubbleAreaW * 0.875];
        return { cy: cY, posX: posX };
    }
    return { boxX, boxY, boxW, boxH, rowHeight, getPilihanGeometri, innerX, innerW, trueQuestionStartY, trueQuestionAreaH, layout: '20' };
}

function dapatkanGeometriOMR30(cw: number, ch: number) {
    let boxW = cw * 0.70, boxH = boxW * 1.35;
    if (boxH > ch * 0.85) { boxH = ch * 0.85; boxW = boxH / 1.35; }
    const boxX = (cw - boxW) / 2, boxY = (ch - boxH) / 2;
    let paddingX = boxW * 0.05, paddingY = boxH * 0.05; 
    let innerW = boxW - (paddingX * 2), innerH = boxH - (paddingY * 2);
    let innerX = boxX + paddingX;
    let trueQuestionStartY = boxY + paddingY + (innerH * 0.20); 
    let trueQuestionAreaH = innerH * 0.80, rowHeight = trueQuestionAreaH / 15;
    let colW = innerW * 0.48; 

    function getPilihanGeometri(soalanIndex: number) {
        let col = Math.floor(soalanIndex / 15), row = soalanIndex % 15;
        let cY = trueQuestionStartY + (row * rowHeight) + (rowHeight / 2);
        let cXOffset = (col === 0) ? 0 : (innerW - colW);
        let colX = innerX + cXOffset;
        let bubbleAreaW = colW * 0.82, bubbleAreaX = colX + (colW * 0.18); 
        let posX = [bubbleAreaX + bubbleAreaW * 0.125, bubbleAreaX + bubbleAreaW * 0.375, bubbleAreaX + bubbleAreaW * 0.625, bubbleAreaX + bubbleAreaW * 0.875];
        return { cy: cY, posX: posX };
    }
    return { boxX, boxY, boxW, boxH, rowHeight, getPilihanGeometri, innerX, innerW, colW, trueQuestionStartY, trueQuestionAreaH, layout: '30' };
}

function dapatkanGeometriOMR40(cw: number, ch: number) {
    let boxW = cw * 0.70, boxH = boxW * 1.35;
    if (boxH > ch * 0.85) { boxH = ch * 0.85; boxW = boxH / 1.35; }
    const boxX = (cw - boxW) / 2, boxY = (ch - boxH) / 2;
    let paddingX = boxW * 0.05, paddingY = boxH * 0.05;
    let innerW = boxW * 0.90, innerH = boxH * 0.90;
    let innerX = boxX + paddingX, innerY = boxY + paddingY;
    let headerH = innerH * 0.20, gridY = innerY + headerH, gridH = innerH * 0.80;
    let rowHeight = gridH / 17, colW = innerW * 0.32;

    function getPilihanGeometri(soalanIndex: number) {
        let col: any, row: any, isTopBlock: any; let n = soalanIndex + 1;
        if (n >= 1 && n <= 7) { col = 0; row = n - 1; isTopBlock = true; }
        else if (n >= 8 && n <= 15) { col = 0; row = n - 8; isTopBlock = false; }
        else if (n >= 16 && n <= 22) { col = 1; row = n - 16; isTopBlock = true; }
        else if (n >= 23 && n <= 30) { col = 1; row = n - 23; isTopBlock = false; }
        else if (n >= 31 && n <= 37) { col = 2; row = n - 31; isTopBlock = true; }
        else if (n >= 38 && n <= 40) { col = 2; row = n - 38; isTopBlock = false; }

        let cXOffset = 0;
        if (col === 1) cXOffset = (innerW - colW) / 2;
        else if (col === 2) cXOffset = innerW - colW;

        let cX = innerX + cXOffset;
        let blockStartY = isTopBlock ? gridY : (gridY + (9 * rowHeight)); 
        let cY = blockStartY + (row * rowHeight) + (rowHeight / 2);
        let bubbleAreaW = colW * 0.82, bubbleAreaX = cX + (colW * 0.18);
        let posX = [bubbleAreaX + bubbleAreaW * 0.125, bubbleAreaX + bubbleAreaW * 0.375, bubbleAreaX + bubbleAreaW * 0.625, bubbleAreaX + bubbleAreaW * 0.875];
        return { cy: cY, posX: posX };
    }
    return { boxX, boxY, boxW, boxH, rowHeight, getPilihanGeometri, innerX, innerY, innerW, innerH, colW, trueQuestionStartY: innerY+headerH, layout: '40' };
}

async function mulakanKamera() {
    const video = document.getElementById('kamera') as HTMLVideoElement;
    const ind = document.getElementById('scan-indicator')!;
    ind.innerText = "Mengimbas OMR...";
    ind.classList.replace('bg-green-500/80', 'bg-black/40');
    
    (window as any).isScanning = false;
    (window as any).autoSnapCounter = 0;

    if ((window as any).streamKamera) {
        video.play().catch(e => console.log(e));
        renderFrameKamera();
        setupFlashButton();
        return;
    }

    try {
        (window as any).streamKamera = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } 
        });
        video.srcObject = (window as any).streamKamera;
        await video.play();
        renderFrameKamera();
        setupFlashButton();
    } catch (err) {
        paparAlert("Kamera Gagal", "Kamera tidak dapat diakses. Sila benarkan tetapan privasi pelayar untuk mengakses kamera.");
    }
}

function setupFlashButton() {
    const track = (window as any).streamKamera?.getVideoTracks()[0];
    const btnFlash = document.getElementById('btn-toggle-flash');
    if (track && track.getCapabilities && btnFlash) {
        const capabilities = track.getCapabilities();
        if (capabilities.torch) {
            btnFlash.classList.remove('hidden');
            let isFlashOn = true;
            
            try {
                track.applyConstraints({
                    advanced: [{ torch: isFlashOn }]
                });
                btnFlash.classList.replace('bg-black/50', 'bg-yellow-500/80');
            } catch (e) {
                console.error("Failed to auto-on flash", e);
                isFlashOn = false;
            }

            btnFlash.onclick = async () => {
                isFlashOn = !isFlashOn;
                try {
                    await track.applyConstraints({
                        advanced: [{ torch: isFlashOn }]
                    });
                    if (isFlashOn) {
                        btnFlash.classList.replace('bg-black/50', 'bg-yellow-500/80');
                    } else {
                        btnFlash.classList.replace('bg-yellow-500/80', 'bg-black/50');
                    }
                } catch (e) {
                    console.error("Failed to toggle flash", e);
                }
            };
        } else {
            btnFlash.classList.add('hidden');
        }
    }
}

function hentikanKamera() {
    (window as any).isScanning = true; 
    if ((window as any).streamKamera) {
        (window as any).streamKamera.getTracks().forEach((track: any) => track.stop());
        (window as any).streamKamera = null;
        (document.getElementById('kamera') as HTMLVideoElement).srcObject = null;
    }
    if ((window as any).gelungKamera) cancelAnimationFrame((window as any).gelungKamera);
    const btnFlash = document.getElementById('btn-toggle-flash');
    if (btnFlash) {
        btnFlash.classList.add('hidden');
        btnFlash.classList.replace('bg-yellow-500/80', 'bg-black/50');
    }
}

function renderFrameKamera() {
    if (!window.streamKamera || window.isScanning) return;

    const video = document.getElementById('kamera') as HTMLVideoElement;
    const cvsVideo = document.getElementById('canvas-video') as HTMLCanvasElement;
    const cvsOverlay = document.getElementById('canvas-overlay') as HTMLCanvasElement;

    if (cvsVideo.width !== cvsVideo.clientWidth) {
        cvsVideo.width = cvsVideo.clientWidth;
        cvsVideo.height = cvsVideo.clientHeight;
        cvsOverlay.width = cvsOverlay.clientWidth;
        cvsOverlay.height = cvsOverlay.clientHeight;
    }

    const cw = cvsVideo.width;
    const ch = cvsVideo.height;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw && vh) {
        const ctxV = cvsVideo.getContext('2d', { willReadFrequently: true })!;
        const ctxO = cvsOverlay.getContext('2d')!;
        
        const scale = Math.max(cw / vw, ch / vh);
        const drawW = vw * scale;
        const drawH = vh * scale;
        const drawX = (cw - drawW) / 2;
        const drawY = (ch - drawH) / 2;
        ctxV.drawImage(video, drawX, drawY, drawW, drawH);

        const geo = dapatkanGeometriOMR(cw, ch);
        lukisPanduan(ctxO, cw, ch, geo);

        (window as any).autoSnapCounter++;
        if ((window as any).autoSnapCounter > CONFIG_IMBASAN.bingkaiSabar) {
            (window as any).autoSnapCounter = 0;
            if (semakAutoSnap(ctxV, geo)) {
                window.isScanning = true; 
                let ind = document.getElementById('scan-indicator')!;
                ind.innerText = "Berjaya!";
                ind.classList.replace('bg-black/40', 'bg-green-500/80');
                if (navigator.vibrate) navigator.vibrate([100, 50, 100]); 
                
                ctxO.fillStyle = 'rgba(255, 255, 255, 0.85)';
                ctxO.fillRect(0, 0, cw, ch);
                setTimeout(() => { tangkapDanTanda(true); }, 200);
                return; 
            }
        }
    }
    if (!window.isScanning) window.gelungKamera = requestAnimationFrame(renderFrameKamera);
}

function lukisPanduan(ctx: any, cw: number, ch: number, geo: any) {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'; ctx.fillRect(0, 0, cw, ch);
    ctx.clearRect(geo.boxX, geo.boxY, geo.boxW, geo.boxH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(geo.boxX, geo.boxY, geo.boxW, geo.boxH);

    let ts = Math.max(16, geo.boxW * 0.035), halfTs = ts / 2;
    ctx.strokeStyle = '#0071e3'; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(0, 113, 227, 0.15)'; 
    
    ctx.fillRect(geo.boxX - halfTs, geo.boxY - halfTs, ts, ts); ctx.strokeRect(geo.boxX - halfTs, geo.boxY - halfTs, ts, ts);
    ctx.fillRect(geo.boxX - halfTs, geo.boxY + (geo.boxH / 2) - halfTs, ts, ts); ctx.strokeRect(geo.boxX - halfTs, geo.boxY + (geo.boxH / 2) - halfTs, ts, ts);
    ctx.fillRect(geo.boxX - halfTs, geo.boxY + geo.boxH - halfTs, ts, ts); ctx.strokeRect(geo.boxX - halfTs, geo.boxY + geo.boxH - halfTs, ts, ts);
    ctx.fillRect(geo.boxX + geo.boxW - halfTs, geo.boxY - halfTs, ts, ts); ctx.strokeRect(geo.boxX + geo.boxW - halfTs, geo.boxY - halfTs, ts, ts);
    ctx.fillRect(geo.boxX + geo.boxW - halfTs, geo.boxY + (geo.boxH / 2) - halfTs, ts, ts); ctx.strokeRect(geo.boxX + geo.boxW - halfTs, geo.boxY + (geo.boxH / 2) - halfTs, ts, ts);
    ctx.fillRect(geo.boxX + geo.boxW - halfTs, geo.boxY + geo.boxH - halfTs, ts, ts); ctx.strokeRect(geo.boxX + geo.boxW - halfTs, geo.boxY + geo.boxH - halfTs, ts, ts);

    const r = geo.rowHeight * 0.40; 
    for (let i = 0; i < window.JUMLAH_SOALAN; i++) {
        let { cy, posX } = geo.getPilihanGeometri(i);
        for (let j = 0; j < 4; j++) {
            ctx.beginPath(); ctx.arc(posX[j], cy, r, 0, 2*Math.PI);
            ctx.strokeStyle = 'rgba(0, 113, 227, 0.2)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
    }
    
    if (geo.layout === '20' || geo.layout === '30') {
        let midX = geo.innerX + (geo.innerW / 2);
        ctx.beginPath(); ctx.moveTo(midX, geo.trueQuestionStartY); ctx.lineTo(midX, geo.trueQuestionStartY + geo.trueQuestionAreaH);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1; ctx.stroke();
    } else if (geo.layout === '40') {
        let col2X = geo.innerX + (geo.innerW - geo.colW) / 2, col3X = geo.innerX + geo.innerW - geo.colW;
        ctx.beginPath(); ctx.moveTo(col2X - geo.innerW*0.01, geo.innerY); ctx.lineTo(col2X - geo.innerW*0.01, geo.innerY + geo.innerH);
        ctx.moveTo(col3X - geo.innerW*0.01, geo.innerY); ctx.lineTo(col3X - geo.innerW*0.01, geo.innerY + geo.innerH);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1; ctx.stroke();
    }
}

function semakAutoSnap(ctx: any, geo: any) {
    let size = Math.max(10, geo.boxW * 0.025), half = size / 2;
    let whitePoints = [ {x: geo.boxX + geo.boxW * 0.15, y: geo.boxY + geo.boxH * 0.05}, {x: geo.boxX + geo.boxW * 0.85, y: geo.boxY + geo.boxH * 0.05} ];
    let highestAvg = 0;
    for(let wp of whitePoints) {
        let sx = Math.max(0, Math.min(ctx.canvas.width - size, wp.x - half)), sy = Math.max(0, Math.min(ctx.canvas.height - size, wp.y - half));
        let cData = ctx.getImageData(sx, sy, size, size), sum = 0;
        for (let i = 0; i < cData.data.length; i+=4) sum += (0.299 * cData.data[i] + 0.587 * cData.data[i+1] + 0.114 * cData.data[i+2]);
        let avg = sum / (cData.data.length / 4);
        if(avg > highestAvg) highestAvg = avg;
    }

    let paperBrightness = highestAvg || 200;
    if (paperBrightness < 90) return false;

    let darkThreshold = paperBrightness * CONFIG_IMBASAN.ambangMarkerHitam, requiredDarkPixelsRatio = CONFIG_IMBASAN.nisbahPikselMarker; 
    let titikUjian = [
        {x: geo.boxX - half, y: geo.boxY - half}, {x: geo.boxX + geo.boxW - half, y: geo.boxY - half}, 
        {x: geo.boxX - half, y: geo.boxY + geo.boxH/2 - half}, {x: geo.boxX + geo.boxW - half, y: geo.boxY + geo.boxH/2 - half}, 
        {x: geo.boxX - half, y: geo.boxY + geo.boxH - half}, {x: geo.boxX + geo.boxW - half, y: geo.boxY + geo.boxH - half} 
    ];

    for (let pt of titikUjian) {
        let ptx = Math.max(0, Math.min(ctx.canvas.width - size, pt.x)), pty = Math.max(0, Math.min(ctx.canvas.height - size, pt.y));
        let imgData = ctx.getImageData(ptx, pty, size, size), pixels = imgData.data, darkCount = 0, totalPixels = pixels.length / 4;
        for (let i = 0; i < pixels.length; i += 4) {
            let brightness = (0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2]);
            if (brightness < darkThreshold) darkCount++;
        }
        if ((darkCount / totalPixels) < requiredDarkPixelsRatio) return false; 
    }
    return true;
}

function tangkapDanTanda(dariAutoSnap = false) {
    if (window.skemaJawapan.includes(null)) {
        paparAlert("Skema Belum Lengkap", "Harap maklum, skema jawapan belum lengkap disetkan. Sila lengkapkan sebelum mengimbas.");
        window.isScanning = false;
        return;
    }
    window.isScanning = true;
    const cvsVideo = document.getElementById('canvas-video') as HTMLCanvasElement;
    if (!cvsVideo.width) return;

    if(window.gelungKamera) cancelAnimationFrame(window.gelungKamera);
    analisisImej(cvsVideo);
}
document.getElementById('btn-tangkap-dan-tanda')!.addEventListener('click', () => tangkapDanTanda(false));

async function verifikasiAI(imejBase64: string, butiranAsal: any[]) : Promise<{markah: number, butiran: any[]} | null> {
    const apiKey = localStorage.getItem('gemini_api_key');
    if(!apiKey) return null;

    try {
        const ai = new GoogleGenAI({ apiKey });
        
        let skemaPrompt = "";
        for(let i=0;i<window.JUMLAH_SOALAN; i++) {
           skemaPrompt += `Soalan ${i+1}: ${window.skemaJawapan[i] || 'Tiada'}\n`;
        }

        const prompt = `Anda adalah sistem pengesahan jawapan OMR (Optical Mark Recognition) bernama CikguScan.
Sistem tempatan telah menganalisis imej OMR ini dan mendapati jawapan berikut (sebagai panduan awal sahaja):
${butiranAsal.map((b: any, i: number) => `S${i+1}: Jawapan indeks ${b.jawapanPelajar === 'KOSONG' ? 'KOSONG' : b.jawapanPelajar} (Status: ${b.status})`).join('\n')}
*Nota Indeks Jawapan: 0=A, 1=B, 2=C, 3=D

Sila semak semula gambar helaian OMR pelajar ini dan berikan ketepatan muktamad.
Terdapat ${window.JUMLAH_SOALAN} soalan semuanya. Kertas ini mungkin mempunyai kecacatan (tersenget dsb). Jika pelajar bulatkan lebih dari satu pilihan, set statusnya sebagai BATAL. Jika tiada jawapan dibulatkan, status KOSONG.

Skema Jawapan Sebenar:
${skemaPrompt}

PENTING:
- Sila bandingkan bulatan pada kertas OMR dengan Skema Jawapan Sebenar.
- 'jawapan_pelajar' mesti diisi dengan huruf A, B, C, atau D. Jika kosong tulis KOSONG, jika batal tulis BATAL.
- 'status' mesti BETUL, SALAH, BATAL atau KOSONG.`;

        const base64Data = imejBase64.split(',')[1];
        const mimeType = imejBase64.split(';')[0].split(':')[1];

        const response = await ai.models.generateContent({
             model: 'gemini-1.5-flash-8b', 
             contents: [
                 {
                     inlineData: {
                         data: base64Data,
                         mimeType: mimeType
                     }
                 },
                 prompt
             ],
             config: {
                 responseMimeType: "application/json",
                 responseSchema: {
                     type: Type.OBJECT,
                     properties: {
                         butiran_jawapan: {
                             type: Type.ARRAY,
                             items: {
                               type: Type.OBJECT,
                               properties: {
                                  soalan: { type: Type.INTEGER },
                                  jawapan_pelajar: { type: Type.STRING, description: "Hanya huruf A, B, C, D, atau KOSONG, BATAL" },
                                  status: { type: Type.STRING, description: "Hanya BETUL, SALAH, KOSONG, atau BATAL" }
                               }
                             }
                         }
                     }
                 }
             }
        });

        if (response.text) {
           let cleanText = response.text;
           if (cleanText.includes('```json')) {
               cleanText = cleanText.split('```json')[1].split('```')[0].trim();
           } else if (cleanText.includes('```')) {
               cleanText = cleanText.split('```')[1].split('```')[0].trim();
           }
           const json = JSON.parse(cleanText);
           let butiranBaru = [];
           let markah = 0;
           for(let i=0;i<window.JUMLAH_SOALAN; i++) {
               let d = json.butiran_jawapan.find((x: any) => x.soalan === i+1);
               let studentAns: any = 'KOSONG';
               let sts = 2; // salah
               let isBetul = false;
               
               if(d && d.status !== 'KOSONG') {
                   if(d.jawapan_pelajar === 'A') studentAns = 'A';
                   if(d.jawapan_pelajar === 'B') studentAns = 'B';
                   if(d.jawapan_pelajar === 'C') studentAns = 'C';
                   if(d.jawapan_pelajar === 'D') studentAns = 'D';
                   
                   if(d.status === 'BETUL') { markah++; isBetul = true; }
                   if(d.status === 'BATAL') studentAns = 'BATAL';
               } else {
                   studentAns = 'KOSONG';
               }
               
               butiranBaru.push({
                   soalan: i + 1,
                   jawapanPelajar: studentAns,
                   jawapanSebenar: window.skemaJawapan[i],
                   betul: isBetul
               });
           }
           return { markah, butiran: butiranBaru };
        }
        return null;
    } catch(e) {
        console.error("AI Error", e);
        return null;
    }
}

function analisisImej(sumberCanvas: HTMLCanvasElement) {
    const ctx = sumberCanvas.getContext('2d', { willReadFrequently: true })!;
    const cw = sumberCanvas.width;
    const ch = sumberCanvas.height;
    const geo = dapatkanGeometriOMR(cw, ch);

    const canvasDebug = document.getElementById('canvas-debug') as HTMLCanvasElement;
    canvasDebug.width = cw; canvasDebug.height = ch;
    const ctxDebug = canvasDebug.getContext('2d')!;
    ctxDebug.drawImage(sumberCanvas, 0, 0);

    ctxDebug.strokeStyle = "rgba(0, 113, 227, 0.4)"; ctxDebug.lineWidth = 3;
    ctxDebug.strokeRect(geo.boxX, geo.boxY, geo.boxW, geo.boxH);
    if (geo.layout === '20' || geo.layout === '30') {
        let midX = geo.innerX + (geo.innerW / 2);
        ctxDebug.beginPath(); ctxDebug.moveTo(midX, geo.trueQuestionStartY); ctxDebug.lineTo(midX, geo.trueQuestionStartY + geo.trueQuestionAreaH); ctxDebug.stroke();
    } else if (geo.layout === '40') {
        let col2X = geo.innerX + (geo.innerW - geo.colW) / 2, col3X = geo.innerX + geo.innerW - geo.colW;
        ctxDebug.beginPath(); ctxDebug.moveTo(col2X - geo.innerW*0.01, geo.innerY); ctxDebug.lineTo(col2X - geo.innerW*0.01, geo.innerY + geo.innerH);
        ctxDebug.moveTo(col3X - geo.innerW*0.01, geo.innerY); ctxDebug.lineTo(col3X - geo.innerW*0.01, geo.innerY + geo.innerH); ctxDebug.stroke();
    }

    let markah = 0;
    let butiran: any = [];
    const r = geo.rowHeight * 0.40;
    const scanR = r * CONFIG_IMBASAN.radiusImbasan; 

    for (let i = 0; i < window.JUMLAH_SOALAN; i++) {
        let { cy, posX } = geo.getPilihanGeometri(i);
        let tahapKegelapan: number[] = [];
        for (let j = 0; j < window.PILIHAN.length; j++) {
            let cx = posX[j];
            let imgData = ctx.getImageData(cx - scanR, cy - scanR, scanR*2, scanR*2);
            let pixels = imgData.data, totalBrightness = 0;
            for (let p = 0; p < pixels.length; p += 4) {
                totalBrightness += (0.299 * pixels[p] + 0.587 * pixels[p+1] + 0.114 * pixels[p+2]);
            }
            tahapKegelapan.push(totalBrightness / (pixels.length / 4));
        }

        let sortedBright = [...tahapKegelapan].sort((a,b) => a - b);
        let avgPaper = (sortedBright[1] + sortedBright[2] + sortedBright[3]) / 3;
        let pilihanPelajar = null;

        let diff1 = avgPaper - sortedBright[0];
        let diff2 = avgPaper - sortedBright[1];

        if (diff1 > CONFIG_IMBASAN.ambangKosong) {
            let indeksJawapan = tahapKegelapan.indexOf(sortedBright[0]);
            pilihanPelajar = window.PILIHAN[indeksJawapan];
            
            // Semakan 'Double Mark' (BATAL) vs 'Padaman Tak Bersih'
            if (diff2 > CONFIG_IMBASAN.ambangKosong) {
                if ((sortedBright[1] - sortedBright[0]) < CONFIG_IMBASAN.pemaafSisaPadaman) {
                     pilihanPelajar = "BATAL";
                }
            }
        }

        let jawapanSebenar = window.skemaJawapan[i];
        let betul = false;
        if (pilihanPelajar === jawapanSebenar) { betul = true; markah++; }

        for (let j = 0; j < window.PILIHAN.length; j++) {
            let cx = posX[j];
            ctxDebug.beginPath(); ctxDebug.arc(cx, cy, r, 0, 2 * Math.PI); 
            if (window.PILIHAN[j] === pilihanPelajar) { 
                if (betul) {
                    ctxDebug.fillStyle = "rgba(34, 197, 94, 0.6)"; 
                } else {
                    ctxDebug.fillStyle = "rgba(239, 68, 68, 0.6)"; 
                }
                ctxDebug.fill(); 
            } 
            else if (pilihanPelajar === "BATAL" && (avgPaper - tahapKegelapan[j]) > CONFIG_IMBASAN.ambangKosong) { 
                ctxDebug.fillStyle = "rgba(251, 146, 60, 0.6)"; 
                ctxDebug.fill(); 
            } 
            else { 
                ctxDebug.strokeStyle = "rgba(239, 68, 68, 0.5)"; 
                ctxDebug.stroke(); 
            }
        }

        butiran.push({ soalan: i + 1, jawapanPelajar: pilihanPelajar || 'KOSONG', jawapanSebenar: jawapanSebenar, betul: betul });
    }

    let paddingY = geo.boxH * 0.05;
    let headerHeight = (geo.layout === '10' || geo.layout === '20') ? (geo.boxH * 0.88 * 0.3) : (geo.boxH * 0.9 * 0.2);
    
    let cropY, cropH, cropX, cropW;

    if (geo.layout === '10' || geo.layout === '20') {
        cropY = geo.boxY + paddingY + (headerHeight * 0.22); 
        cropH = headerHeight * 0.34; 
        cropX = geo.boxX - (geo.boxW * 0.05); 
        cropW = geo.boxW * 0.70; 
    } else {
        cropY = geo.boxY + paddingY + (headerHeight * 0.55); 
        cropH = headerHeight * 0.45; 
        cropX = geo.boxX - (geo.boxW * 0.05); 
        cropW = geo.boxW * 0.70; 
    }

    cropY = Math.max(0, cropY); cropX = Math.max(0, cropX);
    cropW = Math.min(cw - cropX, cropW); cropH = Math.min(ch - cropY, cropH);

    let canvasNama = document.createElement('canvas');
    canvasNama.width = cropW; canvasNama.height = cropH;
    canvasNama.getContext('2d')!.drawImage(sumberCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    let imejNamaDataUrl = canvasNama.toDataURL('image/jpeg', 0.5);

    let canvasKecil = document.createElement('canvas');
    let scaleDown = 500 / cw;
    canvasKecil.width = 500;
    canvasKecil.height = ch * scaleDown;
    canvasKecil.getContext('2d')!.drawImage(canvasDebug, 0, 0, canvasKecil.width, canvasKecil.height);
    let imejPenuhDataUrl = canvasKecil.toDataURL('image/jpeg', 0.5);

    let peratus = (markah / window.JUMLAH_SOALAN) * 100;
    let proBulan = parseInt(localStorage.getItem('cikguscan_pro_bulan_' + window.currentUser) as any) || 0;
    let trialFinished = localStorage.getItem('cikguscan_trial_finished_' + window.currentUser) === 'true';
    let trialStart = localStorage.getItem('cikguscan_trial_start_' + window.currentUser);
    
    if (proBulan <= 0 && !trialFinished && !trialStart) {
        trialStart = Date.now().toString();
        localStorage.setItem('cikguscan_trial_start_' + window.currentUser, trialStart);
        startTrialCountdown();
        
        let statusEl = document.getElementById('header-user-status');
        let btnKelas = document.getElementById('btn-pilih-kelas');
        if (statusEl) {
            statusEl.innerText = `CUBAAN PRO (60m 0s)`;
            statusEl.classList.remove('text-apple-textMuted', 'text-apple-blue');
            statusEl.classList.add('text-orange-500');
            if (btnKelas) btnKelas.parentElement!.classList.remove('hidden');
        }
    }

    let isTrialActive = false;
    if (proBulan <= 0 && !trialFinished && trialStart) {
        let elapsed = Math.floor((Date.now() - parseInt(trialStart)) / 1000);
        if (elapsed < 3600) isTrialActive = true;
    }
    
    const finaliseRekod = (finalMarkah: number, finalButiran: any[], isTukarTab: boolean = true, isAiVerified: boolean | 'pending' | 'failed' = false) => {
        let finalPeratus = (finalMarkah / window.JUMLAH_SOALAN) * 100;
        if (proBulan > 0 || isTrialActive) {
            let rekodBaharu = {
                id: window.idUntukGanti ? window.idUntukGanti : Date.now().toString(),
                markah: finalMarkah,
                jumlah: window.JUMLAH_SOALAN,
                peratus: parseFloat(finalPeratus.toFixed(1)),
                imejNama: imejNamaDataUrl,
                imejPenuh: imejPenuhDataUrl,
                butiran: finalButiran,
                kelas: window.kelasSemasa,
                isAiVerified: isAiVerified
            };

            window.idRekodSemasa = rekodBaharu.id;

            if (window.idUntukGanti) {
                let idx = window.senaraiRekodKelas.findIndex((r: any) => r.id === window.idUntukGanti);
                if (idx > -1) {
                    window.senaraiRekodKelas[idx] = rekodBaharu;
                } else {
                    window.senaraiRekodKelas.unshift(rekodBaharu);
                }
            } else {
                window.senaraiRekodKelas.unshift(rekodBaharu);
            }
            
            simpanRekodLokal();
        } else {
            window.idRekodSemasa = null; 
        }
        
        paparKeputusan(finalMarkah, finalButiran, isTukarTab);
    };

    if (localStorage.getItem('gemini_api_key')) {
        let ind = document.getElementById('scan-indicator');
        if (ind) {
            ind.innerText = "Disimpan & AI sdg mengesahkan...";
            ind.classList.replace('bg-black/40', 'bg-blue-500/80');
        }

        let pendingId = Date.now().toString();
        if (window.idUntukGanti) pendingId = window.idUntukGanti;
        window.idUntukGanti = pendingId;
        
        finaliseRekod(markah, butiran, true, 'pending');
        window.idUntukGanti = null;
        
        let aiIndicator = document.getElementById('ai-verifying-indicator');
        if (aiIndicator) {
            aiIndicator.classList.remove('hidden');
        }

        verifikasiAI(imejPenuhDataUrl, butiran).then(res => {
            if (aiIndicator) aiIndicator.classList.add('hidden');
            
            if (res) {
                window.idUntukGanti = pendingId;
                finaliseRekod(res.markah, res.butiran, false, true);
                window.idUntukGanti = null;
                paparAnalisisUI(); // Update senarai di background
                
                // Kemaskini paparan jika pengguna masih melihat keputusan ini
                if (window.idRekodSemasa === pendingId) {
                    paparKeputusan(res.markah, res.butiran, false);
                }
                
                // Kemaskini paparan butiran individu jika modal terbuka
                let modal = document.getElementById('modal-rekod');
                if (modal && !modal.classList.contains('hidden') && (window as any).modalRekodSemasaId === pendingId) {
                    (window as any).bukaModalRekod(pendingId);
                }
            } else {
                console.warn("AI Gagal: CikguScan mengekalkan kiraan tempatan.");
                window.idUntukGanti = pendingId;
                finaliseRekod(markah, butiran, false, 'failed');
                window.idUntukGanti = null;
                paparAnalisisUI();
                let modal = document.getElementById('modal-rekod');
                if (modal && !modal.classList.contains('hidden') && (window as any).modalRekodSemasaId === pendingId) {
                    (window as any).bukaModalRekod(pendingId);
                }
            }
        }).catch(err => {
            if (aiIndicator) aiIndicator.classList.add('hidden');
            console.error("AI Ralat", err);
            window.idUntukGanti = pendingId;
            finaliseRekod(markah, butiran, false, 'failed');
            window.idUntukGanti = null;
            paparAnalisisUI();
            let modal = document.getElementById('modal-rekod');
            if (modal && !modal.classList.contains('hidden') && (window as any).modalRekodSemasaId === pendingId) {
                (window as any).bukaModalRekod(pendingId);
            }
        });
    } else {
        finaliseRekod(markah, butiran, true);
        window.idUntukGanti = null;
    }
}

function paparKeputusan(markah: number, butiran: any, isTukarTab: boolean = true) {
    if (isTukarTab) tukarTab('keputusan'); 
    let peratus = (markah / window.JUMLAH_SOALAN) * 100;
    let proBulan = parseInt(localStorage.getItem('cikguscan_pro_bulan_' + window.currentUser) as any) || 0;
    let trialFinished = localStorage.getItem('cikguscan_trial_finished_' + window.currentUser) === 'true';
    let trialStart = localStorage.getItem('cikguscan_trial_start_' + window.currentUser);
    
    let isTrialActive = false;
    if (proBulan <= 0 && !trialFinished && trialStart) {
        let elapsed = Math.floor((Date.now() - parseInt(trialStart)) / 1000);
        if (elapsed < 3600) isTrialActive = true;
    }
    
    document.getElementById('skor-markah')!.innerText = markah.toString();
    document.getElementById('skor-total')!.innerText = `/${window.JUMLAH_SOALAN}`;
    document.getElementById('skor-peratus')!.innerText = `${peratus.toFixed(1)}%`;
    
    let labelKelas = document.getElementById('skor-kelas-label');
    let separatorKelas = document.getElementById('skor-separator');
    let btnPadamSemasa = document.getElementById('btn-padam-semasa');
    
    if (proBulan > 0 || isTrialActive) {
        if(labelKelas) {
            labelKelas.innerText = window.kelasSemasa;
            labelKelas.classList.remove('hidden');
        }
        if(separatorKelas) separatorKelas.classList.remove('hidden');
        if(btnPadamSemasa) {
            btnPadamSemasa.classList.remove('hidden');
            btnPadamSemasa.classList.add('flex');
        }
    } else {
        if(labelKelas) labelKelas.classList.add('hidden');
        if(separatorKelas) separatorKelas.classList.add('hidden');
        if(btnPadamSemasa) {
            btnPadamSemasa.classList.add('hidden');
            btnPadamSemasa.classList.remove('flex');
        }
    }

    let senaraiHtml = butiran.map((b: any) => {
        let ikon = b.betul ? 
            '<svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>' : 
            '<svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg>';
        let warnaTeks = b.betul ? 'text-green-600 font-bold' : 'text-red-500 font-bold';
        return `
            <div class="flex items-center justify-between p-3 bg-apple-bg rounded-xl border border-apple-border/30">
                <div class="w-16 font-semibold text-apple-text">No. ${b.soalan}</div>
                <div class="flex-1 text-center font-medium">Jawab: <span class="${warnaTeks}">${b.jawapanPelajar}</span></div>
                <div class="flex items-center justify-end gap-2 w-24 text-apple-textMuted font-medium">
                    Skema: ${b.jawapanSebenar} ${ikon}
                </div>
            </div>
        `;
    }).join('');
    document.getElementById('senarai-keputusan')!.innerHTML = senaraiHtml;
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function kemaskiniJumlahSoalan() {
    let inputEl = document.getElementById('input-jumlah-soalan') as HTMLInputElement;
    let nilai = parseInt(inputEl.value);
    if (isNaN(nilai) || nilai < 1) { nilai = 1; inputEl.value = '1'; }
    else if (nilai > 40) { nilai = 40; inputEl.value = '40'; paparAlert("Had Maksimum", "Maksimum 40 soalan dibenarkan."); }
    
    window.JUMLAH_SOALAN = nilai;
    localStorage.setItem('cikguscan_jumlah_' + window.currentUser, window.JUMLAH_SOALAN as any);
    
    let skemaBaru = Array(window.JUMLAH_SOALAN).fill(null);
    for(let i = 0; i < Math.min(window.skemaJawapan.length, window.JUMLAH_SOALAN); i++) {
        skemaBaru[i] = window.skemaJawapan[i];
    }
    window.skemaJawapan = skemaBaru;
    
    let btnPrintSkema = document.getElementById('btn-print-skema');
    if(btnPrintSkema) btnPrintSkema.classList.add('hidden');
    
    updatePageOrientation('omr');
    janaBorangSkema();
    janaBorangCetak();
}
document.getElementById('input-jumlah-soalan')!.addEventListener('change', kemaskiniJumlahSoalan);


function tukarTab(idTab: string) {
    let proBulan = parseInt(localStorage.getItem('cikguscan_pro_bulan_' + window.currentUser) as any) || 0;
    let trialFinished = localStorage.getItem('cikguscan_trial_finished_' + window.currentUser) === 'true';
    let trialStart = localStorage.getItem('cikguscan_trial_start_' + window.currentUser);
    let isPro = localStorage.getItem('cikguscan_is_pro_' + window.currentUser) === 'true';
    
    let isTrialActive = false;
    if (proBulan <= 0 && !isPro && !trialFinished && trialStart) {
        let elapsed = Math.floor((Date.now() - parseInt(trialStart)) / 1000);
        if (elapsed < 3600) isTrialActive = true;
    }

    if (idTab === 'analisis') {
        if (!isPro && proBulan <= 0 && !isTrialActive) {
            paparAlert("Akses Terhad.", "Khas langganan Pro sahaja.", true);
            return; 
        }
    }

    document.querySelectorAll('.tab-content').forEach((el: any) => {
        el.classList.add('hidden');
        el.classList.remove('flex', 'animate-fade-in'); 
    });
    
    document.querySelectorAll('.apple-segmented-control button').forEach((el: any) => {
        el.classList.remove('bg-white', 'text-apple-text', 'shadow-sm');
        el.classList.add('text-apple-textMuted');
    });

    let tabElement = document.getElementById('tab-' + idTab)!;
    if (idTab === 'cetak' || idTab === 'imbas' || idTab === 'analisis') {
        tabElement.classList.add('flex');
    }
    tabElement.classList.remove('hidden');

    let navBtn = document.getElementById('nav-' + idTab);
    if(navBtn) {
        navBtn.classList.remove('text-apple-textMuted');
        navBtn.classList.add('bg-white', 'text-apple-text', 'shadow-sm');
    }

    if (idTab === 'imbas') {
        window.isScanning = false;
        let banner = document.getElementById('banner-ganti')!;
        if(window.idUntukGanti) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
        
        if (proBulan > 0 || !trialFinished) {
            if (window.kelasSemasa === "Kelas Umum" || window.kelasSemasa.trim() === "") {
                bukaModalKelas();
            } else {
                setTimeout(() => mulakanKamera(), 100);
            }
        } else {
            setTimeout(() => mulakanKamera(), 100);
        }
    } else {
        if(idTab !== 'keputusan') {
            window.idUntukGanti = null; 
        }
        hentikanKamera();
    }

    if (idTab === 'analisis') {
        paparAnalisisUI();
    }
}

document.getElementById('nav-skema')!.addEventListener('click', () => tukarTab('skema'));
document.getElementById('nav-cetak')!.addEventListener('click', () => tukarTab('cetak'));
document.getElementById('nav-imbas')!.addEventListener('click', () => tukarTab('imbas'));
document.getElementById('nav-analisis')!.addEventListener('click', () => tukarTab('analisis'));
document.getElementById('btn-lihat-analisis-keputusan')!.addEventListener('click', () => tukarTab('analisis'));
document.getElementById('btn-imbas-seterusnya-keputusan')!.addEventListener('click', () => tukarTab('imbas'));

function tukarSubTabAnalisis(mod: string) {
    window.modAnalisisSemasa = mod;
    ['individu', 'kelas', 'item'].forEach(m => {
        let btn = document.getElementById('subnav-' + m);
        if(btn) {
            btn.classList.remove('bg-white', 'text-apple-text', 'shadow-sm');
            btn.classList.add('text-apple-textMuted');
        }
    });
    let activeBtn = document.getElementById('subnav-' + mod);
    if(activeBtn) {
        activeBtn.classList.remove('text-apple-textMuted');
        activeBtn.classList.add('bg-white', 'text-apple-text', 'shadow-sm');
    }
    paparAnalisisUI();
}

document.getElementById('subnav-individu')!.addEventListener('click', () => tukarSubTabAnalisis('individu'));
document.getElementById('subnav-kelas')!.addEventListener('click', () => tukarSubTabAnalisis('kelas'));
document.getElementById('subnav-item')!.addEventListener('click', () => tukarSubTabAnalisis('item'));

function paparAnalisisUI() {
    let container = document.getElementById('senarai-analisis')!;
    let dropdown = document.getElementById('filter-kelas-dropdown') as HTMLSelectElement;
    let filterValue = dropdown ? dropdown.value : 'Semua';

    let kelass = [...new Set(window.senaraiRekodKelas.map((r: any) => r.kelas || 'Kelas Umum'))];
    if (dropdown) {
        let optionsHtml = `<option value="Semua">Semua Kelas</option>`;
        kelass.forEach(k => {
            optionsHtml += `<option value="${k}" ${filterValue === k ? 'selected' : ''}>${k}</option>`;
        });
        dropdown.innerHTML = optionsHtml;
    }

    let filteredRecords = window.senaraiRekodKelas;
    if (filterValue !== 'Semua') {
        filteredRecords = window.senaraiRekodKelas.filter((r: any) => (r.kelas || 'Kelas Umum') === filterValue);
    }

    document.getElementById('jumlah-rekod')!.innerText = filteredRecords.length.toString();
    
    if (filteredRecords.length === 0) {
        container.innerHTML = '<div class="text-center py-10 px-4 text-apple-textMuted font-medium"><svg class="w-12 h-12 mx-auto text-gray-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>Belum ada sebarang rekod imbasan.</div>';
        container.className = "apple-card bg-[#f1f1f2] border border-[#e5e5ea] rounded-[24px] overflow-hidden shadow-inner flex flex-col p-2 gap-2 min-h-[300px]";
        return;
    }

    if (window.modAnalisisSemasa === 'individu') {
        container.className = "apple-card bg-[#f1f1f2] border border-[#e5e5ea] rounded-[24px] overflow-hidden shadow-inner flex flex-col p-2 gap-2 min-h-[300px]";
        container.innerHTML = filteredRecords.map((rekod: any) => `
            <div class="flex flex-col bg-white p-2.5 rounded-[16px] shadow-sm border border-[#e5e5ea] hover:border-apple-blue hover:shadow-md transition-all relative">
                <div class="flex items-center justify-between">
                    <div onclick="window.bukaModalRekod('${rekod.id}')" class="flex-1 flex items-center cursor-pointer active:scale-[0.98] mr-2 overflow-hidden">
                        <div class="w-[68%] h-[60px] bg-white rounded-[8px] overflow-hidden flex items-center justify-start border border-gray-200 shrink-0 px-1.5 py-1">
                            ${rekod.imejNama ? `<img src="${rekod.imejNama}" class="w-full h-full object-contain object-left scale-[1.15] origin-left" style="filter: grayscale(100%) contrast(180%) brightness(110%);" />` : '<span class="text-[10px] text-gray-400 font-medium">Tiada Imej</span>'}
                        </div>
                        <div class="w-[32%] flex flex-col items-end justify-center pr-2 leading-tight">
                            <div class="text-[11px] sm:text-xs text-apple-textMuted font-semibold tracking-wider">${rekod.markah} / ${rekod.jumlah}</div>
                            <div class="text-lg sm:text-xl font-bold text-apple-text">${rekod.peratus}%</div>
                        </div>
                    </div>
                    <button onclick="window.mintaSahkanPadamRekod(event, '${rekod.id}')" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all bg-gray-50/50 shrink-0" title="Padam Rekod Individu">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
                <div class="flex items-center gap-2 mt-2">
                    <div class="text-[10px] bg-gray-100 text-gray-500 px-2.5 py-0.5 rounded-full inline-block font-medium w-max">Kelas: ${rekod.kelas || 'Kelas Umum'}</div>
                    ${rekod.isAiVerified === true ? `<div class="text-[10px] bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 font-bold border border-blue-100"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>Disahkan AI</div>` : (rekod.isAiVerified === 'pending' ? `<div class="text-[10px] bg-orange-50 text-orange-600 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 font-bold border border-orange-100"><svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Disemak AI...</div>` : '')}
                </div>
            </div>
        `).join('');
    } else if (window.modAnalisisSemasa === 'kelas') {
        container.className = "apple-card bg-[#f1f1f2] border border-[#e5e5ea] rounded-[24px] overflow-hidden shadow-inner flex flex-col p-4 gap-4 min-h-[300px]";
        container.innerHTML = renderAnalisisKelasHtml(filteredRecords);
    } else if (window.modAnalisisSemasa === 'item') {
        container.className = "apple-card bg-[#f1f1f2] border border-[#e5e5ea] rounded-[24px] overflow-hidden shadow-inner flex flex-col p-4 gap-2 min-h-[300px]";
        container.innerHTML = renderAnalisisItemHtml(filteredRecords);
    }
}
document.getElementById('filter-kelas-dropdown')!.addEventListener('change', paparAnalisisUI);

function renderAnalisisKelasHtml(records: any) {
    let totalMarkah = records.map((r: any) => r.markah).sort((a: any,b: any) => a - b);
    let min = totalMarkah[0] || 0;
    let max = totalMarkah[totalMarkah.length - 1] || 0;
    let sum = totalMarkah.reduce((a: any,b: any) => a + b, 0);
    let avg = totalMarkah.length > 0 ? (sum / totalMarkah.length).toFixed(1) : "0";
    
    let median: any = 0;
    if (totalMarkah.length > 0) {
        let mid = Math.floor(totalMarkah.length / 2);
        median = totalMarkah.length % 2 !== 0 ? totalMarkah[mid] : ((totalMarkah[mid - 1] + totalMarkah[mid]) / 2).toFixed(1);
    }
    
    let avgPeratus = (parseFloat(avg) / window.JUMLAH_SOALAN * 100).toFixed(1);
    let minPeratus = (min / window.JUMLAH_SOALAN * 100).toFixed(1);
    let maxPeratus = (max / window.JUMLAH_SOALAN * 100).toFixed(1);
    let medPeratus = (parseFloat(median) / window.JUMLAH_SOALAN * 100).toFixed(1);

    let taburan: any = [
        { label: '90 - 100', min: 90, max: 100, count: 0 },
        { label: '80 - 89', min: 80, max: 89.999, count: 0 },
        { label: '70 - 79', min: 70, max: 79.999, count: 0 },
        { label: '65 - 69', min: 65, max: 69.999, count: 0 },
        { label: '60 - 64', min: 60, max: 64.999, count: 0 },
        { label: '55 - 59', min: 55, max: 59.999, count: 0 },
        { label: '50 - 54', min: 50, max: 54.999, count: 0 },
        { label: '45 - 49', min: 45, max: 49.999, count: 0 },
        { label: '40 - 44', min: 40, max: 44.999, count: 0 },
        { label: '0 - 39', min: 0, max: 39.999, count: 0 }
    ];

    records.forEach((r: any) => {
        let p = parseFloat(r.peratus);
        for (let i = 0; i < taburan.length; i++) {
            if (p >= taburan[i].min && p <= taburan[i].max) {
                taburan[i].count++;
                break;
            }
        }
    });

    taburan.forEach((t: any) => {
        let minScore = Math.ceil((t.min / 100) * window.JUMLAH_SOALAN);
        let maxScore = Math.floor((t.max / 100) * window.JUMLAH_SOALAN);
        if (minScore > maxScore) {
            t.scoreLabel = "-";
        } else if (minScore === maxScore) {
            t.scoreLabel = minScore.toString();
        } else {
            t.scoreLabel = minScore + " - " + maxScore;
        }
    });

    let taburanHtml = `
        <div class="bg-white rounded-xl shadow-sm border border-[#e5e5ea] overflow-hidden text-sm mt-4">
            <div class="bg-gray-50 border-b border-gray-200 p-3 text-gray-600 font-semibold text-center">
                Bilangan Pelajar Mengikut Peratus
            </div>
            <table class="w-full text-left border-collapse">
                <thead class="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold text-[11px] uppercase tracking-wider">
                    <tr>
                        <th class="p-2 border-r border-gray-200 text-center w-1/3">Peratus (%)</th>
                        <th class="p-2 border-r border-gray-200 text-center w-1/3">Item Betul</th>
                        <th class="p-2 text-center w-1/3">Bil. Pelajar</th>
                    </tr>
                </thead>
                <tbody>
    `;
    taburan.forEach((t: any) => {
        taburanHtml += `
            <tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                <td class="p-2.5 font-semibold text-gray-600 border-r border-gray-100 text-center w-1/3">${t.label}</td>
                <td class="p-2.5 text-center text-apple-textMuted font-medium border-r border-gray-100 w-1/3">${t.scoreLabel}</td>
                <td class="p-2.5 text-center font-bold text-apple-text w-1/3">${t.count}</td>
            </tr>
        `;
    });
    taburanHtml += `</tbody></table></div>`;

    return `
        <div class="bg-white rounded-xl shadow-sm border border-[#e5e5ea] overflow-hidden text-sm mb-2">
            <table class="w-full text-left border-collapse">
                <tr class="border-b border-gray-100"><td class="p-3 font-semibold text-gray-600 w-2/3 border-r border-gray-100">Jumlah Kertas</td><td class="p-3 text-right font-bold text-apple-text">${records.length}</td></tr>
                <tr class="border-b border-gray-100"><td class="p-3 font-semibold text-gray-600 border-r border-gray-100">Jumlah Soalan</td><td class="p-3 text-right font-bold text-apple-text">${window.JUMLAH_SOALAN}</td></tr>
                <tr><td class="p-3 font-semibold text-gray-600 border-r border-gray-100">Markah Penuh</td><td class="p-3 text-right font-bold text-apple-text">${window.JUMLAH_SOALAN}</td></tr>
            </table>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-[#e5e5ea] overflow-hidden text-sm">
            <table class="w-full text-left border-collapse">
                <tr class="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold"><td class="p-3 border-r border-gray-200 w-1/3"></td><td class="p-3 border-r border-gray-200 text-center w-1/3">Skor</td><td class="p-3 text-center w-1/3">Peratus</td></tr>
                <tr class="border-b border-gray-100"><td class="p-3 font-semibold text-gray-600 border-r border-gray-100">Minimum</td><td class="p-3 text-center font-bold text-apple-text border-r border-gray-100">${min}</td><td class="p-3 text-center font-bold text-apple-text">${minPeratus}%</td></tr>
                <tr class="border-b border-gray-100"><td class="p-3 font-semibold text-gray-600 border-r border-gray-100">Maksimum</td><td class="p-3 text-center font-bold text-apple-text border-r border-gray-100">${max}</td><td class="p-3 text-center font-bold text-apple-text">${maxPeratus}%</td></tr>
                <tr class="border-b border-gray-100"><td class="p-3 font-semibold text-gray-600 border-r border-gray-100">Purata</td><td class="p-3 text-center font-bold text-apple-text border-r border-gray-100">${avg}</td><td class="p-3 text-center font-bold text-apple-text">${avgPeratus}%</td></tr>
                <tr><td class="p-3 font-semibold text-gray-600 border-r border-gray-100">Median</td><td class="p-3 text-center font-bold text-apple-text border-r border-gray-100">${median}</td><td class="p-3 text-center font-bold text-apple-text">${medPeratus}%</td></tr>
            </table>
        </div>
        ${taburanHtml}
    `;
}

function renderAnalisisItemHtml(records: any) {
    let htmlTable = `<div class="bg-white rounded-xl shadow-sm border border-[#e5e5ea] overflow-x-auto text-xs sm:text-sm">
        <table class="w-full text-left border-collapse min-w-[500px]">
            <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                <tr>
                    <th class="p-2 border-r border-gray-200 w-10 text-center">#</th>
                    <th class="p-2 border-r border-gray-200 text-center">Jawapan</th>
                    <th class="p-2 border-r border-gray-200 text-center whitespace-nowrap">Bil. Betul</th>
                    <th class="p-2 border-r border-gray-200 text-center whitespace-nowrap">% Betul</th>
                    <th class="p-2 border-r border-gray-200 text-center whitespace-nowrap">Faktor Disk.</th>
                    <th class="p-2 w-1/3">Pilihan Lain</th>
                </tr>
            </thead>
            <tbody>`;

    let sortedRecords = [...records].sort((a, b) => b.markah - a.markah);
    let groupSize = Math.max(1, Math.round(sortedRecords.length * 0.27));
    let topGroup = sortedRecords.slice(0, groupSize);
    let bottomGroup = sortedRecords.slice(sortedRecords.length - groupSize);

    for (let i = 0; i < window.JUMLAH_SOALAN; i++) {
        let ans = window.skemaJawapan[i];
        if (!ans) continue;

        let correctCount = 0;
        let optionsCount: any = { 'A':0, 'B':0, 'C':0, 'D':0, 'BATAL':0, 'KOSONG':0 };

        records.forEach((r: any) => {
            let ansPelajar = r.butiran[i].jawapanPelajar;
            if(ansPelajar === ans) correctCount++;
            if(optionsCount[ansPelajar] !== undefined) optionsCount[ansPelajar]++;
            else optionsCount['KOSONG']++;
        });

        let percentCorrect = ((correctCount / records.length) * 100).toFixed(1);

        let df: any = 0;
        if (records.length >= 2) {
            let topCorrect = topGroup.filter(r => r.butiran[i].jawapanPelajar === ans).length;
            let bottomCorrect = bottomGroup.filter(r => r.butiran[i].jawapanPelajar === ans).length;
            df = ((topCorrect / groupSize) - (bottomCorrect / groupSize)).toFixed(3);
        } else {
            df = "-"; 
        }

        let altAnswersStr = ['A','B','C','D'].map(opt => {
            let pct = ((optionsCount[opt] / records.length) * 100).toFixed(0);
            if(parseFloat(pct) > 0) return `<span class="mr-2"><b>${opt}:</b>${pct}%</span>`;
            return '';
        }).join('');
        
        let batalPct = (((optionsCount['BATAL'] + optionsCount['KOSONG']) / records.length) * 100).toFixed(0);
        if(parseFloat(batalPct) > 0) altAnswersStr += `<span class="text-red-500"><b>Lain:</b>${batalPct}%</span>`;

        htmlTable += `
            <tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                <td class="p-2 border-r border-gray-100 text-center font-medium">${i+1}</td>
                <td class="p-2 border-r border-gray-100 text-center font-bold text-apple-text">${ans}</td>
                <td class="p-2 border-r border-gray-100 text-center">${correctCount}</td>
                <td class="p-2 border-r border-gray-100 text-center">${percentCorrect}%</td>
                <td class="p-2 border-r border-gray-100 text-center text-gray-500">${df}</td>
                <td class="p-2 whitespace-nowrap overflow-hidden text-xs">${altAnswersStr}</td>
            </tr>
        `;
    }
    
    htmlTable += `</tbody></table></div>`;
    return htmlTable;
}

function startPrintLoading(btnId: string, text: string) {
    const btn = document.getElementById(btnId) as HTMLButtonElement | null;
    if (!btn) return null;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="flex items-center justify-center gap-2"><svg class="animate-spin h-5 w-5 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${text}</span>`;
    return () => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    };
}

function executePrint(revertBtn: (() => void) | null) {
    // Menggunakan requestAnimationFrame untuk mengelakkan Safari terbelenggu
    // semasa menukar layout untuk pencetakan.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            try {
                // execCommand adakalanya lebih laju dalam Safari lama/tertentu
                if (!document.execCommand('print', false, null)) {
                    window.print();
                }
            } catch (e) {
                window.print();
            }
            if (revertBtn) {
                setTimeout(revertBtn, 500);
            }
        });
    });
}

function eksportPDF() {
    const revertBtn = startPrintLoading('btn-eksport-pdf', 'Memuatkan...');
    let dropdown = document.getElementById('filter-kelas-dropdown') as HTMLSelectElement;
    let filterValue = dropdown ? dropdown.value : 'Semua';
    let filteredRecords = window.senaraiRekodKelas;
    if (filterValue !== 'Semua') {
        filteredRecords = window.senaraiRekodKelas.filter((r: any) => (r.kelas || 'Kelas Umum') === filterValue);
    }

    if (filteredRecords.length === 0) {
        paparAlert("Tiada Data", "Sila imbas sekurang-kurangnya satu kertas sebelum mengeksport laporan PDF.");
        return;
    }

    let container = document.getElementById('cetakan-analisis-container')!;
    
    let reportHtml = `
        <div class="text-center mb-8 text-black border-b-2 border-gray-200 pb-6">
            <div class="flex items-center justify-center gap-2 mb-3">
                <svg class="w-10 h-10 text-apple-blue" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="6.5" y="5.5" width="11" height="13" rx="3.5" fill="currentColor" fill-opacity="0.2" />
                    <path d="M8 4H6.5C5.11929 4 4 5.11929 4 6.5V8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M16 4H17.5C18.8807 4 20 5.11929 20 6.5V8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M8 20H6.5C5.11929 20 4 18.8807 4 17.5V16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M16 20H17.5C18.8807 20 20 18.8807 20 17.5V16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M2 12H22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
                <div class="flex flex-col items-start gap-1">
                    <h1 class="text-3xl font-extrabold tracking-tight text-apple-text leading-none">CikguScan</h1>
                    <span class="bg-[#1d1d1f] text-white text-[10px] px-2.5 py-0.5 rounded-full font-medium tracking-wide shadow-sm">By Sir Halim</span>
                </div>
            </div>
            <h2 class="text-2xl font-bold uppercase tracking-tight mt-4">Laporan Analisis</h2>
            <p class="text-lg font-medium mt-1 text-gray-600">Kelas: <span class="text-black font-bold">${filterValue}</span></p>
            <p class="text-xs font-medium text-gray-400 mt-2">Tarikh Jana: ${new Date().toLocaleDateString('ms-MY')}</p>
        </div>
    `;

    reportHtml += `
        <div class="mb-10 text-black">
            <h2 class="text-xl font-bold border-b-2 border-black pb-2 mb-4 uppercase">1. Ringkasan & Taburan Kelas</h2>
            ${renderAnalisisKelasHtml(filteredRecords)}
        </div>
    `;

    reportHtml += `
        <div class="mb-10 print-page-break text-black">
            <h2 class="text-xl font-bold border-b-2 border-black pb-2 mb-4 uppercase">2. Analisis Item</h2>
            ${renderAnalisisItemHtml(filteredRecords)}
        </div>
    `;

    let tableIndividu = `<table class="w-full text-left border-collapse mt-4 text-sm text-black">
        <thead class="bg-gray-100 border-b border-gray-300 font-bold uppercase text-[11px] tracking-wider text-gray-600">
            <tr>
                <th class="p-3 border border-gray-300 w-12 text-center">Bil</th>
                <th class="p-3 border border-gray-300">Keratan Nama</th>
                <th class="p-3 border border-gray-300 text-center w-28">Kelas</th>
                <th class="p-3 border border-gray-300 text-center w-24">Markah</th>
                <th class="p-3 border border-gray-300 text-center w-24">Peratus</th>
            </tr>
        </thead>
        <tbody>`;
    
    let sortedIndividu = [...filteredRecords].sort((a,b) => b.markah - a.markah);
    
    sortedIndividu.forEach((rekod, index) => {
        tableIndividu += `
            <tr class="border-b border-gray-300 hover:bg-gray-50 transition-colors">
                <td class="p-2 border border-gray-300 text-center font-semibold text-gray-600">${index + 1}</td>
                <td class="p-2 border border-gray-300 bg-white">
                    ${rekod.imejNama ? `<img src="${rekod.imejNama}" class="h-8 sm:h-10 object-contain mx-auto sm:mx-0" style="filter: grayscale(100%) contrast(180%);" />` : '-'}
                </td>
                <td class="p-2 border border-gray-300 text-center font-medium text-gray-600">${rekod.kelas || 'Kelas Umum'}</td>
                <td class="p-2 border border-gray-300 text-center font-bold text-lg">${rekod.markah}/${window.JUMLAH_SOALAN}</td>
                <td class="p-2 border border-gray-300 text-center font-bold text-lg">${rekod.peratus}%</td>
            </tr>
        `;
    });
    tableIndividu += `</tbody></table>`;

    reportHtml += `
        <div class="print-page-break text-black">
            <h2 class="text-xl font-bold border-b-2 border-black pb-2 mb-4 uppercase">3. Senarai Markah Individu</h2>
            ${tableIndividu}
        </div>
    `;

    container.innerHTML = reportHtml;

    if (filterValue === 'Semua') {
        document.title = "Analisis Keseluruhan Cikgu Scan";
    } else {
        document.title = `Analisis Kelas ${filterValue} Cikgu Scan`;
    }

    document.body.classList.remove('mode-cetak-skema');
    updatePageOrientation('analisis');
    document.body.classList.add('mode-cetak-analisis');
    
    executePrint(revertBtn);
}
document.getElementById('btn-eksport-pdf')!.addEventListener('click', eksportPDF);

function janaBorangSkema() {
    const bekas = document.getElementById('borang-skema')!;
    bekas.innerHTML = '';
    for (let i = 0; i < window.JUMLAH_SOALAN; i++) {
        let divSoalan = document.createElement('div');
        divSoalan.className = "flex items-center justify-between bg-apple-bg/50 p-3.5 sm:p-4 rounded-[16px] hover:bg-apple-bg transition-colors";
        let htmlRadio = window.PILIHAN.map(p => `
            <label class="flex items-center justify-center w-8 h-8 relative cursor-pointer group">
                <input type="radio" name="soalan_${i}" value="${p}" class="peer sr-only" ${window.skemaJawapan[i] === p ? 'checked' : ''} onchange="window.skemaJawapan[${i}] = '${p}'">
                <div class="w-8 h-8 rounded-full border-2 border-apple-border flex items-center justify-center peer-checked:bg-apple-blue peer-checked:border-apple-blue transition-all duration-200 group-hover:border-apple-blue/50">
                    <span class="text-sm font-medium text-apple-text peer-checked:text-white transition-colors">${p}</span>
                </div>
            </label>
        `).join('');
        divSoalan.innerHTML = `
            <div class="font-bold text-apple-text w-10 text-lg">${i + 1}.</div>
            <div class="flex space-x-2 sm:space-x-4">${htmlRadio}</div>
        `;
        bekas.appendChild(divSoalan);
    }
}

function simpanSkema() {
    if (window.skemaJawapan.includes(null)) {
        paparAlert("Skema Belum Lengkap", "Cikgu, ada soalan yang belum disetkan jawapannya.");
        return;
    }
    
    localStorage.setItem('cikguscan_skema_' + window.currentUser, JSON.stringify(window.skemaJawapan));
    
    let btn = document.getElementById('btn-simpan-skema')!;
    let textAsal = btn.innerText;
    btn.innerText = "Tersimpan! ✓";
    btn.classList.replace('bg-apple-blue', 'bg-green-500');
    setTimeout(() => {
        btn.innerText = textAsal;
        btn.classList.replace('bg-green-500', 'bg-apple-blue');
    }, 2000);
    document.getElementById('btn-print-skema')!.classList.remove('hidden');
}
document.getElementById('btn-simpan-skema')!.addEventListener('click', simpanSkema);

function cetakSkema() {
    const revertBtn = startPrintLoading('btn-print-skema', 'Memuatkan...');
    document.title = "CikguScan OMR Skema";

    document.body.classList.remove('mode-cetak-analisis');
    updatePageOrientation('omr');
    janaBorangSkemaOMR();
    document.body.classList.add('mode-cetak-skema');
    
    executePrint(revertBtn);
}
document.getElementById('btn-print-skema')!.addEventListener('click', cetakSkema);

function cetakBorangOMR() {
    const revertBtn = startPrintLoading('btn-cetak-borang-omr', 'Memuatkan...');
    document.title = `CikguScan OMR ${window.JUMLAH_SOALAN} soalan`;

    document.body.classList.remove('mode-cetak-analisis', 'mode-cetak-skema');
    updatePageOrientation('omr');

    executePrint(revertBtn);
}
document.getElementById('btn-cetak-borang-omr')!.addEventListener('click', cetakBorangOMR);

function janaBorangSkemaOMR() {
    const bekas = document.getElementById('cetakan-skema-omr-container');
    if(!bekas) return;
    bekas.innerHTML = '';
    bekas.style.height = "auto";
    let divSet = document.createElement('div');
    if (window.JUMLAH_SOALAN <= 10) {
        bekas.className = "grid grid-cols-2 gap-y-12 gap-x-8 print:gap-y-16 print:gap-x-12 w-full px-4 print:px-8";
        divSet.className = "bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[320px] mx-auto w-full";
        divSet.innerHTML = getFormHTMLTemplate10(window.skemaJawapan, true);
    } else if (window.JUMLAH_SOALAN <= 20) {
        bekas.className = "grid grid-cols-2 gap-y-12 gap-x-8 print:gap-y-16 print:gap-x-12 w-full px-4 print:px-8";
        divSet.className = "bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[320px] mx-auto w-full";
        divSet.innerHTML = getFormHTMLTemplate20(window.skemaJawapan, true);
    } else if (window.JUMLAH_SOALAN <= 30) {
        bekas.className = "grid grid-cols-2 gap-16 print:gap-24 w-full px-8";
        divSet.className = "bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[480px] mx-auto w-full";
        divSet.innerHTML = getFormHTMLTemplate30(window.skemaJawapan, true);
    } else {
        bekas.className = "grid grid-cols-2 gap-16 print:gap-24 w-full px-8";
        divSet.className = "bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[480px] mx-auto w-full";
        divSet.innerHTML = getFormHTMLTemplate40(window.skemaJawapan, true);
    }
    bekas.appendChild(divSet);
}

function janaBorangCetak() {
    const bekas = document.getElementById('cetakan-kertas-container')!;
    const labelOrientasi = document.getElementById('label-orientasi')!;
    let textDesc = document.querySelector('#tab-cetak p.text-sm.text-apple-textMuted');
    bekas.innerHTML = '';
    updatePageOrientation('omr');

    let colCount = (window.JUMLAH_SOALAN <= 20) ? 4 : 2;
    if (window.JUMLAH_SOALAN <= 20) {
        labelOrientasi.innerText = "A4 Portrait (4 Borang / Kertas)";
        if(textDesc) textDesc.innerHTML = `<span class="text-xs block opacity-80">(Dicetak 4 borang serentak pada kertas A4 Portrait)</span>`;
        bekas.className = "grid grid-cols-2 gap-y-12 gap-x-8 print:gap-y-16 print:gap-x-12 w-full px-4 print:px-8";
    } else {
        labelOrientasi.innerText = "A4 Landscape (2 Borang / Kertas)";
        if(textDesc) textDesc.innerHTML = `<span class="text-xs block opacity-80">(Dicetak sebelah-menyebelah pada kertas A4)</span>`;
        bekas.className = "grid grid-cols-2 gap-16 print:gap-24 w-full px-8";
    }
    bekas.style.height = "auto"; 
    
    for (let s = 0; s < colCount; s++) {
        let divSet = document.createElement('div');
        divSet.className = `bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[${window.JUMLAH_SOALAN<=20?'320':'480'}px] mx-auto w-full`;
        if(window.JUMLAH_SOALAN <= 10) divSet.innerHTML = getFormHTMLTemplate10(null);
        else if(window.JUMLAH_SOALAN <= 20) divSet.innerHTML = getFormHTMLTemplate20(null);
        else if(window.JUMLAH_SOALAN <= 30) divSet.innerHTML = getFormHTMLTemplate30(null);
        else divSet.innerHTML = getFormHTMLTemplate40(null);
        bekas.appendChild(divSet);
    }
}

function updatePageOrientation(mode = 'omr') {
    let styleTag = document.getElementById('dynamic-print-style');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'dynamic-print-style';
        document.head.appendChild(styleTag);
    }
    if (mode === 'analisis') {
        styleTag.innerHTML = "@media print { @page { size: A4 portrait; margin: 15mm; } }";
    } else if (window.JUMLAH_SOALAN <= 20) {
        styleTag.innerHTML = "@media print { @page { size: A4 portrait; margin: 15mm; } }";
    } else {
        styleTag.innerHTML = "@media print { @page { size: A4 landscape; margin: 15mm; } }";
    }
}

async function openDeveloperPage() {
    document.getElementById('main-app-view')!.classList.add('hidden');
    document.getElementById('developer-view')!.classList.remove('hidden');
    await loadDeveloperUsers();
}

document.getElementById('btn-developer')?.addEventListener('click', openDeveloperPage);

document.getElementById('btn-dev-tutup')?.addEventListener('click', () => {
    document.getElementById('developer-view')!.classList.add('hidden');
    document.getElementById('main-app-view')!.classList.remove('hidden');
});

let allUsersData: any[] = [];

async function loadDeveloperUsers() {
    try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        allUsersData = [];
        const seenEmails = new Set();
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            data.uid = doc.id;
            
            if (data.email) {
                if (!seenEmails.has(data.email)) {
                    seenEmails.add(data.email);
                    allUsersData.push(data);
                } else {
                    // Update existing if this one is Pro and the existing one isn't 
                    const existingIndex = allUsersData.findIndex(u => u.email === data.email);
                    if (existingIndex !== -1 && data.isPro && !allUsersData[existingIndex].isPro) {
                        allUsersData[existingIndex] = data;
                    }
                }
            }
        });
        renderDeveloperUsers();
    } catch (error) {
        console.error("Error loading users:", error);
    }
}

document.getElementById('btn-dev-refresh')?.addEventListener('click', loadDeveloperUsers);

document.getElementById('dev-search')?.addEventListener('input', renderDeveloperUsers);

(window as any).toggleUserPro = async function(uid: string, toggleStatus: boolean) {
    try {
        const userRef = doc(db, 'users', uid);
        if (toggleStatus) {
            const expireDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
            await setDoc(userRef, { isPro: true, proExpireAt: Timestamp.fromDate(expireDate) }, { merge: true });
        } else {
            await setDoc(userRef, { isPro: false, proExpireAt: null }, { merge: true });
        }
        await loadDeveloperUsers();
    } catch (e) {
        console.error(e);
        paparAlert("Ralat", "Gagal mengemas kini status pengguna.");
    }
};

function renderDeveloperUsers() {
    const listEl = document.getElementById('dev-users-list');
    if (!listEl) return;
    const searchVal = (document.getElementById('dev-search') as HTMLInputElement)?.value.toLowerCase() || '';

    let html = '';
    const filtered = allUsersData.filter(u => u.email && u.email.toLowerCase().includes(searchVal));

    filtered.forEach(u => {
        let isPro = false;
        let daysLeftText = '';
        if (u.isPro) {
            if (u.proExpireAt && u.proExpireAt.toDate().getTime() > Date.now()) {
                isPro = true;
                const days = Math.ceil((u.proExpireAt.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                let expStr = u.proExpireAt.toDate().toLocaleDateString('ms-MY');
                daysLeftText = `<span class="bg-blue-600 text-white text-[11px] px-2.5 py-0.5 rounded-full font-bold inline-block">PRO (${days} hari lagi)</span><div class="text-[11px] text-gray-400 mt-1 font-medium">Tamat: ${expStr}</div>`;
            } else if (!u.proExpireAt) {
                isPro = true;
                daysLeftText = `<span class="bg-blue-600 text-white text-[11px] px-2.5 py-0.5 rounded-full font-bold inline-block">PRO (Lifetime)</span>`;
            }
        }
        
        let checkedAttr = isPro ? 'checked' : '';

        html += `
        <div class="bg-gray-50/20 rounded-[16px] p-4 sm:p-5 flex items-center justify-between border border-gray-200/80 shadow-sm transition-all hover:shadow-md">
            <div>
                <p class="font-bold text-gray-800 text-sm sm:text-base">${u.email}</p>
                <div class="mt-1 flex flex-col items-start justify-center">
                    ${isPro ? daysLeftText : `<span class="bg-gray-200 text-gray-500 text-[10px] sm:text-[11px] px-2.5 py-0.5 rounded-full font-bold tracking-wide uppercase">Percuma</span>`}
                </div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" class="sr-only peer" ${checkedAttr} onchange="window.toggleUserPro('${u.uid}', this.checked)">
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
        </div>
        `;
    });

    listEl.innerHTML = html;
}



