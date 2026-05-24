if (window.location.hostname === "cikgu-scan.vercel.app") {
  window.location.href =
    "https://cikguscan.onrender.com" +
    window.location.pathname +
    window.location.search +
    window.location.hash;
}

import "./index.css";
import { registerSW } from "virtual:pwa-register";
import {
  doc,
  getDoc,
  setDoc,
  query,
  collection,
  getDocs,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  orderBy,
  writeBatch
} from "firebase/firestore";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { ref, uploadString, getDownloadURL, deleteObject } from "firebase/storage";
import { db, auth, googleProvider, storage } from "./firebase";

if ("serviceWorker" in navigator) {
  registerSW({
    immediate: true,
    onRegistered(r) {
      console.log("SW Registered:", r);
    },
    onRegisterError(error) {
      console.log("SW registration error:", error);
    },
  });
}

// PWA Install Prompt Logic
let deferredPrompt: any = (window as any).deferredPromptEvent;

function showInstallButton(e: any) {
  deferredPrompt = e;
  let btnInstall = document.getElementById("btn-install-pwa");
  if (btnInstall) {
    btnInstall.classList.remove("hidden");
    btnInstall.classList.add("flex");
  }
}

if (deferredPrompt) {
  showInstallButton(deferredPrompt);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  showInstallButton(e);
});

const btnInstallPwa = document.getElementById("btn-install-pwa");
if (btnInstallPwa) {
  btnInstallPwa.addEventListener("click", async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredPrompt = null;
        (window as any).deferredPromptEvent = null;
        btnInstallPwa.classList.add("hidden");
        btnInstallPwa.classList.remove("flex");
      }
    }
  });
}

import { GoogleGenAI, Type } from "@google/genai";

declare global {
  interface Window {
    currentUser: string | null;
    isLoginMode: boolean;
    isPro: boolean;
    proExpireAt: number | null;
    trialInterval: any;
    trialStart: number | null;
    trialCompleted: boolean;
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
    pentaksiranList: any[];
    currentPentaksiranId: string | null;
    editingPentaksiranId: string | null;
    currentUserId: string | null;
    telahSahkanImbasan: boolean;
  }
}

// GLOBALS
window.currentUser = "local";
window.currentUserId = null;
window.isLoginMode = false;
window.isPro = false;
window.proExpireAt = null;
window.trialInterval = null;
window.trialStart = null;
window.trialCompleted = false;
window.JUMLAH_SOALAN = 40;
window.PILIHAN = ["A", "B", "C", "D"];
window.mulaImbasSemulaRekod = (id: string) => {
  window.idUntukGanti = id;
  let rekod = window.senaraiRekodKelas.find((r: any) => r.id === id);
  if (rekod) {
    window.kelasSemasa = rekod.namaKelas;
    document.getElementById("btn-pilih-kelas")!.innerText =
      "Kelas: " + window.kelasSemasa;
  }
  document.getElementById("modal-rekod")!.classList.add("hidden");
  document.getElementById("modal-rekod")!.classList.remove("flex");
  tukarTab("imbas");
};
window.skemaJawapan = Array(window.JUMLAH_SOALAN).fill(null);
window.streamKamera = null;
window.gelungKamera = null;
window.isScanning = false;
window.pentaksiranList = [];
window.currentPentaksiranId = null;
window.editingPentaksiranId = null;
window.autoSnapCounter = 0;
window.kelasSemasa = "Kelas Umum";
window.modAnalisisSemasa = "individu";
window.senaraiRekodKelas = [];
window.idUntukGanti = null;
window.idRekodSemasa = null;
window.telahSahkanImbasan = false;

const CONFIG_IMBASAN = {
  // 1. Parameter Kamera & Bingkai
  bingkaiSabar: 30, // Bilangan bingkai yg ditunggu sebelum auto-snap utk elak motion blur.

  // 2. Parameter Pengesanan Segi Empat (Marker)
  ambangMarkerHitam: 0.7, // 70% dari nilai kertas putih (paper brightness) sebagai had piksel tu dikira gelap.
  nisbahPikselMarker: 0.23, // Mesti sekurang-kurangnya 23% dari kotak marker wujud piksel hitam/hitam pudar.

  // 3. Parameter Analisis Bulatan Jawapan (OMR)
  radiusImbasan: 0.55, // 55% jejari akan diimbas dari setiap tanda bulat. Lebih besar = makin senang nampak sisa padaman yg luar orbit.
  ambangKosong: 10, // Beza minimum gelapnya dakwat dengan kertas. Jika takat kegelapan < 10, ia set "KOSONG" (soalan tak dijawab).
  pemaafSisaPadaman: 12, // Kalau ada dua jawapan ditanda tebal, tapi beza kegelapan Jawapan Pertama dan Kedua adalah lebih daripada 12, sistem anggap Jawapan Kedua tu dipadam kurang sempurna dan akan terima Jawapan Pertama sbg valid.
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

function updateStatusHeader() {
  let statusEl = document.getElementById("header-user-status");
  if (!statusEl) return;
  
  if (window.isPro) {
    if (window.proExpireAt) {
      let daysLeft = Math.ceil((window.proExpireAt - Date.now()) / (1000 * 60 * 60 * 24));
      statusEl.innerText = `AKAUN PRO (${daysLeft} HARI)`;
    } else {
      statusEl.innerText = "AKAUN PRO";
    }
    statusEl.className = "text-[9px] sm:text-[10px] font-bold uppercase tracking-wider whitespace-nowrap text-blue-600";
    return;
  }
  
  if (window.trialStart && !window.trialCompleted) {
    let elapsed = Math.floor((Date.now() - window.trialStart) / 1000);
    let remaining = 7200 - elapsed; // 2 hours
    
    if (remaining > 0) {
      let h = Math.floor(remaining / 3600);
      let m = Math.floor((remaining % 3600) / 60);
      let s = remaining % 60;
      let timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      
      statusEl.innerText = `AKAUN PRO (TRIAL) ${timeStr}`;
      statusEl.className = "text-[9px] sm:text-[10px] font-bold uppercase tracking-wider whitespace-nowrap text-orange-500";
      
      if (!window.trialInterval) {
        window.trialInterval = setInterval(() => updateStatusHeader(), 1000);
      }
      return;
    } else {
       if (!window.trialCompleted) {
         window.trialCompleted = true;
         if (window.currentUserId) {
            updateDoc(doc(db, "users", window.currentUserId), { trialCompleted: true, lastLogin: serverTimestamp() }).catch(() => {});
         }
       }
       if (window.trialInterval) {
         clearInterval(window.trialInterval);
         window.trialInterval = null;
       }
    }
  }

  statusEl.innerText = "Akaun Percuma";
  statusEl.className = "text-[9px] sm:text-[10px] font-bold uppercase tracking-wider whitespace-nowrap text-apple-textMuted";
}

window.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (user) => {
    const mainAppView = document.getElementById("main-app-view");
    const authView = document.getElementById("auth-view");
    const headerEmail = document.getElementById("header-user-email");
    const loginBtn = document.getElementById("btn-login");
    const logoutBtn = document.getElementById("btn-logout");
    const devBtn = document.getElementById("btn-developer");

    if (user && user.email) {
      window.currentUser = user.email;
      window.currentUserId = user.uid;
      window.isLoginMode = true;
      if (headerEmail) headerEmail.innerText = user.email;

      if (loginBtn) loginBtn.classList.add("hidden");
      if (logoutBtn) logoutBtn.classList.remove("hidden");

      if (devBtn) {
        if (user.email === "abdulhalimroslan@gmail.com") {
          devBtn.classList.remove("hidden");
          devBtn.classList.add("flex");
        } else {
          devBtn.classList.add("hidden");
          devBtn.classList.remove("flex");
        }
      }

      if (mainAppView) mainAppView.classList.remove("hidden");
      if (authView) authView.classList.add("hidden");

      // Set/update user profile
      const userRef = doc(db, "users", user.uid);
      getDoc(userRef)
        .then(async (docSnap) => {
          let localKelasStr = localStorage.getItem("cikguscan_senarai_kelas_" + user.email) || "[]";
          let localKelasLocalStr = localStorage.getItem("cikguscan_senarai_kelas_local") || "[]";
          let allLocalKelas = Array.from(new Set([ ...JSON.parse(localKelasStr), ...JSON.parse(localKelasLocalStr) ]));

          if (!docSnap.exists()) {
            await setDoc(userRef, {
              email: user.email,
              isPro: false,
              lastLogin: serverTimestamp(),
              trialCompleted: false,
              senaraiKelas: [...allLocalKelas],
            });
            window.isPro = false;
          } else {
            let data = docSnap.data();
            let cloudKelas = data.senaraiKelas || [];
            let mergedClasses = Array.from(new Set([...cloudKelas, ...allLocalKelas]));
            
            let isExpired = false;
            if (data.isPro && data.proExpireAt) {
              let expireTime = data.proExpireAt.toMillis();
              if (Date.now() > expireTime) {
                isExpired = true;
              }
            }
            if (isExpired) {
              await updateDoc(userRef, {
                isPro: false,
                proExpireAt: null,
                lastLogin: serverTimestamp(),
                senaraiKelas: mergedClasses,
              });
              window.isPro = false;
            } else {
              await updateDoc(userRef, {
                lastLogin: serverTimestamp(),
                senaraiKelas: mergedClasses,
              });
              window.isPro = data.isPro || false;
              if (data.proExpireAt) {
                window.proExpireAt = data.proExpireAt.toMillis();
              }
            }
          }
          
          if (docSnap.exists()) {
             let data = docSnap.data();
             window.trialCompleted = data.trialCompleted || false;
             if (data.trialStart) {
                window.trialStart = typeof data.trialStart === 'number' ? data.trialStart : data.trialStart.toMillis();
             }
             
             // The cloudKelas was already merged and uploaded. Let's make sure the UI receives the merged version.
             let cloudKelas = data.senaraiKelas || [];
             let mergedClasses = Array.from(new Set([...cloudKelas, ...allLocalKelas]));
             localStorage.setItem("cikguscan_senarai_kelas_" + window.currentUser, JSON.stringify(mergedClasses));
          } else {
             localStorage.setItem("cikguscan_senarai_kelas_" + window.currentUser, JSON.stringify(allLocalKelas));
          }
          
          muatSenaraiKelasLokal();
          renderKelasList();

          updateStatusHeader();
        })
        .catch((err) => console.error("Error setting user profile", err));

      getDoc(doc(db, "user_api_keys", window.currentUser))
        .then((docSnap) => {
          if (docSnap.exists() && docSnap.data().geminiApiKey) {
            localStorage.setItem("gemini_api_key", docSnap.data().geminiApiKey);
          }
        })
        .catch((err) => console.error("Error Loading Key", err));
    } else {
      window.currentUser = "local";
      window.currentUserId = null;
      window.isLoginMode = false;
      if (headerEmail) headerEmail.innerText = "Sila log masuk";
      if (loginBtn) loginBtn.classList.remove("hidden");
      if (logoutBtn) logoutBtn.classList.add("hidden");
      if (devBtn) {
        devBtn.classList.add("hidden");
        devBtn.classList.remove("flex");
      }

      if (mainAppView) mainAppView.classList.add("hidden");
      if (authView) authView.classList.remove("hidden");
    }

    let statusEl = document.getElementById("header-user-status");
    let btnKelas = document.getElementById("btn-pilih-kelas");

    if (statusEl) {
      if (!user) {
        statusEl.innerText = "Log Masuk Diperlukan";
      }
      statusEl.classList.add("text-blue-600");
    }
    if (btnKelas) {
      btnKelas.parentElement!.classList.remove("hidden");
    }

    initAppContent();
  });
});

document.getElementById("btn-login")?.addEventListener("click", () => {
  signInWithPopup(auth, googleProvider).catch((err) => {
    console.error(err);
    paparAlert("Ralat", "Gagal log masuk. Sila cuba lagi.");
  });
});

document.getElementById("btn-login-utama")?.addEventListener("click", () => {
  signInWithPopup(auth, googleProvider).catch((err) => {
    console.error(err);
    paparAlert("Ralat", "Gagal log masuk. Sila cuba lagi.");
  });
});

document
  .getElementById("btn-developer")
  ?.addEventListener("click", async () => {
    const modal = document.getElementById("admin-modal");
    const listContainer = document.getElementById("admin-user-list");

    if (modal) modal.classList.remove("hidden");
    if (modal) modal.classList.add("flex");

    if (listContainer) {
      listContainer.innerHTML = `<div class="flex flex-col items-center justify-center p-8 text-gray-400">
        <svg class="animate-spin w-8 h-8 mb-2" viewBox="0 0 24 24"><path fill="currentColor" d="M4 12A8 8 0 0112 4V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <span>Memuatkan senarai...</span>
    </div>`;
    }

    try {
      const q = query(collection(db, "users"));
      const querySnapshot = await getDocs(q);

      if (listContainer) {
        listContainer.innerHTML = "";
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const uid = docSnap.id;
          const email = data.email || "Unknown";
          
          if (email.toLowerCase() === "abdulhalimroslan@gmail.com") return;

          const isPro = data.isPro || false;

          let proDetail = "";
          if (isPro && data.proExpireAt) {
            const dt = new Date(data.proExpireAt.toMillis());
            proDetail = `<span class="text-xs text-green-600 block mt-1">Tamat: ${dt.toLocaleDateString()}</span>`;
          } else if (isPro) {
            proDetail = `<span class="text-xs text-green-600 block mt-1">PRO Aktif (Tiada Tarikh Tamat)</span>`;
          }

          const div = document.createElement("div");
          div.className =
            "flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 admin-user-item";
          div.setAttribute("data-email", email.toLowerCase());
          div.innerHTML = `
          <div>
            <div class="font-medium text-apple-text">${email}</div>
            ${proDetail}
          </div>
          <div class="flex items-center gap-3">
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" class="sr-only peer admin-pro-toggle" data-uid="${uid}" data-email="${email}" ${isPro ? "checked" : ""}>
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
            <div class="flex items-center gap-1">
              <button class="w-8 h-8 rounded-full bg-red-100 text-red-500 hover:bg-red-200 flex justify-center items-center admin-delete-user" title="Padam Pengguna">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              </button>
              <button class="hidden px-3 py-1 bg-red-500 text-white text-xs font-semibold rounded-full hover:bg-red-600 admin-confirm-delete" data-uid="${uid}" data-email="${email}">Sah Padam</button>
              <button class="hidden w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 justify-center items-center admin-cancel-delete" title="Batal">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
          </div>
        `;
          listContainer.appendChild(div);
        });

        // Search Input Filtering
        const searchInput = document.getElementById(
          "admin-search-input",
        ) as HTMLInputElement;
        if (searchInput) {
          searchInput.value = "";
          searchInput.addEventListener("input", (e) => {
            const val = (e.target as HTMLInputElement).value.toLowerCase();
            document.querySelectorAll(".admin-user-item").forEach((item) => {
              const el = item as HTMLElement;
              const emel = el.getAttribute("data-email") || "";
              if (emel.includes(val)) {
                el.style.display = "flex";
              } else {
                el.style.display = "none";
              }
            });
          });
        }

        // Bind toggle events
        document.querySelectorAll(".admin-pro-toggle").forEach((el) => {
          el.addEventListener("change", async (e) => {
            const target = e.target as HTMLInputElement;
            const uid = target.getAttribute("data-uid");
            if (!uid) return;

            target.disabled = true;
            try {
              const userRef = doc(db, "users", uid);
              if (target.checked) {
                const expireDate = new Date();
                expireDate.setDate(expireDate.getDate() + 365);
                await updateDoc(userRef, {
                  isPro: true,
                  proExpireAt: expireDate,
                });
              } else {
                await updateDoc(userRef, {
                  isPro: false,
                  proExpireAt: null,
                });
              }
            } catch (err) {
              console.error(err);
              target.checked = !target.checked; // revert UI
              paparAlert("Ralat", "Gagal mengemaskini status PRO.");
            } finally {
              target.disabled = false;
            }
          });
        });

        // Bind delete events
        document.querySelectorAll(".admin-delete-user").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const target = e.currentTarget as HTMLButtonElement;
            const container = target.parentElement;
            if (!container) return;

            target.classList.add("hidden");
            container
              .querySelector(".admin-confirm-delete")
              ?.classList.remove("hidden");
            container
              .querySelector(".admin-cancel-delete")
              ?.classList.remove("hidden");
            container
              .querySelector(".admin-cancel-delete")
              ?.classList.add("flex");
          });
        });

        document.querySelectorAll(".admin-cancel-delete").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const target = e.currentTarget as HTMLButtonElement;
            const container = target.parentElement;
            if (!container) return;

            target.classList.add("hidden");
            target.classList.remove("flex");
            container
              .querySelector(".admin-confirm-delete")
              ?.classList.add("hidden");
            container
              .querySelector(".admin-delete-user")
              ?.classList.remove("hidden");
          });
        });

        document.querySelectorAll(".admin-confirm-delete").forEach((btn) => {
          btn.addEventListener("click", async (e) => {
            const target = e.currentTarget as HTMLButtonElement;
            const uid = target.getAttribute("data-uid");
            const email = target.getAttribute("data-email");
            if (!uid || !email) return;

            target.disabled = true;
            try {
              await deleteDoc(doc(db, "users", uid));
              target.closest(".admin-user-item")?.remove();
              // also delete their user_api_keys ?
              await deleteDoc(doc(db, "user_api_keys", email));
            } catch (err) {
              console.error(err);
              paparAlert("Ralat", "Gagal memadam pengguna.");
              target.disabled = false;
            }
          });
        });
      }
    } catch (err) {
      console.error(err);
      if (listContainer) {
        listContainer.innerHTML = `<div class="text-red-500 text-center p-4">Gagal memuatkan senarai pengguna. Sila pastikan 'Role' adalah Admin dan cuba lagi.</div>`;
      }
    }
  });

document.getElementById("btn-tutup-admin")?.addEventListener("click", () => {
  const modal = document.getElementById("admin-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
});

document.getElementById("btn-logout")?.addEventListener("click", () => {
  signOut(auth).catch((error) => {
    paparAlert("Ralat", "Gagal log keluar.");
  });
});

window.addEventListener("afterprint", () => {
  document.body.classList.remove("mode-cetak-analisis", "mode-cetak-skema");
  updatePageOrientation("omr");
  document.title = "CikguScan OMR";
});

function initAppContent() {
  muatSenaraiPentaksiran().then(() => {
    muatRekodLokal();
    updatePageOrientation();
    janaBorangSkema();
    janaBorangCetak();
    tukarTab("skema");
  });
}

function paparAlert(title: string, msg: string, isProAlert = false) {
  document.getElementById("alert-title")!.innerText = title;
  document.getElementById("alert-msg")!.innerText = msg;

  let btnContainer = document.getElementById("alert-btn-container")!;
  if (isProAlert) {
    btnContainer.innerHTML = `
            <button id="btn-tutup-alert-inner" class="w-full bg-apple-text text-white py-3 rounded-[14px] font-medium hover:bg-black transition-all active:scale-[0.98]">Tutup</button>
            <a href="https://forms.gle/JHdycPrpD3MRhqHo6" target="_blank" class="w-full bg-apple-blue text-white py-3 rounded-[14px] font-medium hover:bg-apple-blueHover transition-all active:scale-[0.98] flex items-center justify-center">Langgan Pro</a>
        `;
  } else {
    btnContainer.innerHTML = `
            <button id="btn-tutup-alert-inner" class="w-full bg-apple-blue text-white py-3 rounded-[14px] font-medium hover:bg-apple-blueHover transition-all active:scale-[0.98]">Selesai</button>
        `;
  }
  document
    .getElementById("btn-tutup-alert-inner")!
    .addEventListener("click", tutupAlert);

  document.getElementById("modal-alert")!.classList.remove("hidden");
  document.getElementById("modal-alert")!.classList.add("flex");
}

function tutupAlert() {
  document.getElementById("modal-alert")!.classList.add("hidden");
  document.getElementById("modal-alert")!.classList.remove("flex");
}

let confirmCallback: any = null;
function paparConfirm(title: string, msg: string, callback: any) {
  document.getElementById("confirm-title")!.innerText = title;
  document.getElementById("confirm-msg")!.innerText = msg;
  confirmCallback = callback;
  document.getElementById("modal-confirm")!.classList.remove("hidden");
  document.getElementById("modal-confirm")!.classList.add("flex");
}

function tutupConfirm() {
  document.getElementById("modal-confirm")!.classList.add("hidden");
  document.getElementById("modal-confirm")!.classList.remove("flex");
  confirmCallback = null;
}

document
  .getElementById("btn-confirm-ok")!
  .addEventListener("click", function () {
    if (confirmCallback) confirmCallback();
    tutupConfirm();
  });
document
  .getElementById("btn-confirm-batal")!
  .addEventListener("click", tutupConfirm);

async function muatRekodLokal() {
  let data = localStorage.getItem(
    "cikguscan_rekod_kelas_" + window.currentUser,
  );
  if (data) {
    try {
      window.senaraiRekodKelas = JSON.parse(data);
    } catch (e) {
      window.senaraiRekodKelas = [];
    }
  } else {
    window.senaraiRekodKelas = [];
  }
  kemaskiniBadgeAnalisis();

  if (window.currentUserId && window.currentUser !== "local") {
    try {
      const q = query(collection(db, "users", window.currentUserId, "rekods"));
      const snapshot = await getDocs(q);
      const cloudRecords = snapshot.docs.map(doc => doc.data());
      if (cloudRecords.length > 0) {
        // Sync cloud into local storage
        window.senaraiRekodKelas = cloudRecords.sort((a, b) => parseInt(b.id) - parseInt(a.id));
        localStorage.setItem("cikguscan_rekod_kelas_" + window.currentUser, JSON.stringify(window.senaraiRekodKelas));
        kemaskiniBadgeAnalisis();
      }
    } catch (err) {
      console.error("Error loading cloud records", err);
    }
  }
}

async function syncRekodKeCloud(rekod: any) {
  if (!window.currentUserId || window.currentUser === "local") return;

  const rekodToSave = { ...rekod };
  
  if (rekodToSave.imejNama && rekodToSave.imejNama.startsWith("data:image")) {
    try {
      const imejNamaRef = ref(storage, `users/${window.currentUserId}/rekods/${rekod.id}_nama.jpg`);
      await uploadString(imejNamaRef, rekodToSave.imejNama, "data_url");
      rekodToSave.imejNama = await getDownloadURL(imejNamaRef);
    } catch(e) { console.error("Err img", e); }
  }

  const firestoreDocData = { ...rekodToSave };
  delete firestoreDocData.imejPenuh; // Do not save the full image to Firestore

  const docRef = doc(db, "users", window.currentUserId, "rekods", rekod.id);
  await setDoc(docRef, firestoreDocData);

  const index = window.senaraiRekodKelas.findIndex((r: any) => r.id === rekod.id);
  if (index > -1) {
    window.senaraiRekodKelas[index] = rekodToSave;
    localStorage.setItem(
      "cikguscan_rekod_kelas_" + window.currentUser,
      JSON.stringify(window.senaraiRekodKelas),
    );
  }
}

async function deleteRekodDariCloud(id: string) {
  if (!window.currentUserId || window.currentUser === "local") return;
  try {
    await deleteDoc(doc(db, "users", window.currentUserId, "rekods", id));
    try { await deleteObject(ref(storage, `users/${window.currentUserId}/rekods/${id}_nama.jpg`)); } catch(e){}
    try { await deleteObject(ref(storage, `users/${window.currentUserId}/rekods/${id}_penuh.jpg`)); } catch(e){}
  } catch (err) {
    console.error("Failed to delete record from cloud", err);
  }
}

function simpanRekodLokal() {
  localStorage.setItem(
    "cikguscan_rekod_kelas_" + window.currentUser,
    JSON.stringify(window.senaraiRekodKelas),
  );
  kemaskiniBadgeAnalisis();
}

function mintaSahkanPadamSemua() {
  paparConfirm(
    "Padam Semua Data",
    "Cikgu pasti mahu memadam semua rekod imbasan dalam sistem?",
    () => {
      let currentIds = window.senaraiRekodKelas.map((r:any) => r.id);
      window.senaraiRekodKelas = [];
      simpanRekodLokal();
      paparAnalisisUI();
      currentIds.forEach((id: string) => deleteRekodDariCloud(id));
    },
  );
}
document
  .getElementById("btn-padam-semua")!
  .addEventListener("click", mintaSahkanPadamSemua);

(window as any).mintaSahkanPadamRekod = function (event: any, id: string) {
  event.stopPropagation();
  paparConfirm(
    "Padam Rekod Individu",
    "Cikgu pasti mahu padam rekod pelajar ini?",
    () => {
      window.senaraiRekodKelas = window.senaraiRekodKelas.filter(
        (r: any) => r.id !== id,
      );
      simpanRekodLokal();
      paparAnalisisUI();
      deleteRekodDariCloud(id);
    },
  );
};

function mintaSahkanPadamSemasa() {
  if (window.idRekodSemasa) {
    paparConfirm(
      "Buang Imbasan Ini",
      "Data ini akan dibuang dan tidak dimasukkan ke dalam tab Analisis. Teruskan?",
      () => {
        let deletedId = window.idRekodSemasa;
        window.senaraiRekodKelas = window.senaraiRekodKelas.filter(
          (r: any) => r.id !== window.idRekodSemasa,
        );
        simpanRekodLokal();
        window.idRekodSemasa = null;
        tukarTab("imbas");
        if (deletedId) deleteRekodDariCloud(deletedId);
      },
    );
  }
}
document
  .getElementById("btn-padam-semasa")!
  .addEventListener("click", mintaSahkanPadamSemasa);

function kemaskiniBadgeAnalisis() {
  let badge = document.getElementById("badge-analisis");
  if (badge) {
    if (window.senaraiRekodKelas.length > 0) {
      badge.classList.replace("hidden", "flex");
      badge.innerText = window.senaraiRekodKelas.length.toString();
    } else {
      badge.classList.replace("flex", "hidden");
    }
  }
}

function bukaModalAI() {
  let input = document.getElementById("input-api-key") as HTMLInputElement;
  input.value =
    localStorage.getItem("gemini_api_key") ||
    "AIzaSyAtAnovHgs1PTZxqAiKzkhDHl3Q5cs9-l8";
  document.getElementById("modal-ai")!.classList.remove("hidden");
  document.getElementById("modal-ai")!.classList.add("flex");
  setTimeout(() => input.focus(), 100);
}
document
  .getElementById("btn-tetapan-ai")!
  .addEventListener("click", bukaModalAI);

function tutupModalAI() {
  document.getElementById("modal-ai")!.classList.add("hidden");
  document.getElementById("modal-ai")!.classList.remove("flex");
}
document
  .getElementById("btn-batal-ai")!
  .addEventListener("click", tutupModalAI);

async function simpanAI() {
  let val = (
    document.getElementById("input-api-key") as HTMLInputElement
  ).value.trim();
  if (val !== "") {
    localStorage.setItem("gemini_api_key", val);
    if (window.currentUser && window.currentUser !== "local") {
      try {
        await setDoc(
          doc(db, "user_api_keys", window.currentUser),
          { geminiApiKey: val },
          { merge: true },
        );
      } catch (e) {}
    }
    paparAlert(
      "Berjaya",
      "API Key telah disimpan. AI kini akan digunakan untuk mengesahkan ketepatan imbasan OMR.",
    );
  } else {
    localStorage.removeItem("gemini_api_key");
    if (window.currentUser && window.currentUser !== "local") {
      try {
        await setDoc(
          doc(db, "user_api_keys", window.currentUser),
          { geminiApiKey: "" },
          { merge: true },
        );
      } catch (e) {}
    }
    paparAlert(
      "AI Aktif (Default)",
      "API Key Aktif (Default). Sistem akan menggunakan API Key dari CikguScan.",
    );
  }
  tutupModalAI();
}
document.getElementById("btn-simpan-ai")!.addEventListener("click", simpanAI);

document
  .getElementById("btn-semak-api-key")
  ?.addEventListener("click", async () => {
    const input = document.getElementById("input-api-key") as HTMLInputElement;
    const apiKey =
      input.value.trim() || "AIzaSyAtAnovHgs1PTZxqAiKzkhDHl3Q5cs9-l8";

    const btn = document.getElementById(
      "btn-semak-api-key",
    ) as HTMLButtonElement;
    const oriText = btn.innerHTML;
    btn.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-apple-blue" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Menyemak...`;
    btn.disabled = true;

    try {
      const ai = new GoogleGenAI({ apiKey });
      await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: ["Say hello"],
      });
      paparAlert(
        "Berjaya",
        "API Key sah dan berjaya berhubung dengan pelayan Google Gemini.",
      );
    } catch (e: any) {
      paparAlert("Ralat", "Gagal berhubung: " + e.message);
    } finally {
      btn.innerHTML = oriText;
      btn.disabled = false;
    }
  });

function bukaModalKelas() {
  let modalSelect = document.getElementById("modal-select-pentaksiran") as HTMLSelectElement;
  if (modalSelect) {
    modalSelect.innerHTML =
      window.pentaksiranList
        .map((p) => `<option value="${p.id}">${p.nama}</option>`)
        .join("") || `<option value="">Tiada Pentaksiran. Sila cipta di tab skema.</option>`;
    if (window.currentPentaksiranId) {
      modalSelect.value = window.currentPentaksiranId;
    }
  }

  let input = document.getElementById("input-nama-kelas") as HTMLSelectElement;
  muatSenaraiKelasLokal();
  input.value = window.kelasSemasa || "Kelas Umum";
  document.getElementById("modal-kelas")!.classList.remove("hidden");
  document.getElementById("modal-kelas")!.classList.add("flex");
  setTimeout(() => input.focus(), 100);

  let tabImbas = document.getElementById("tab-imbas")!;
  if (!tabImbas.classList.contains("hidden")) {
    hentikanKamera();
  }
}
document
  .getElementById("btn-pilih-kelas")!
  .addEventListener("click", bukaModalKelas);

function tutupModalKelas() {
  document.getElementById("modal-kelas")!.classList.add("hidden");
  document.getElementById("modal-kelas")!.classList.remove("flex");

  let tabImbas = document.getElementById("tab-imbas")!;
  if (!tabImbas.classList.contains("hidden")) {
    if (
      window.kelasSemasa === "Kelas Umum" ||
      window.kelasSemasa.trim() === ""
    ) {
      paparAlert(
        "Kamera Dijeda",
        "Kamera tidak akan diaktifkan sehingga nama kelas dimasukkan. Sila tekan butang 'Kelas' di atas untuk memasukkan nama kelas.",
      );
    } else {
      setTimeout(() => mulakanKamera(), 100);
    }
  }
}
document
  .getElementById("btn-batal-kelas")!
  .addEventListener("click", tutupModalKelas);

function simpanKelas() {
  let modalSelect = document.getElementById("modal-select-pentaksiran") as HTMLSelectElement;
  let pid = modalSelect ? modalSelect.value : "";
  if (pid === "" && window.pentaksiranList.length > 0) {
    paparAlert("Perhatian", "Sila pilih pentaksiran terlebih dahulu.");
    return;
  }

  let val = (
    document.getElementById("input-nama-kelas") as HTMLSelectElement
  ).value.trim();
  if (val !== "") {
    window.kelasSemasa = val;
    window.telahSahkanImbasan = true;
    
    if (pid !== "") {
      window.currentPentaksiranId = pid;
      const p = window.pentaksiranList.find((x: any) => x.id === pid);
      if (p) {
        window.JUMLAH_SOALAN = p.jumlahSoalan;
        window.skemaJawapan = [...p.skemaJawapan];
      }
      const mainSelect = document.getElementById("select-pentaksiran") as HTMLSelectElement;
      if (mainSelect) mainSelect.value = pid;
    }

    document.getElementById("btn-pilih-kelas")!.innerText =
      "Kelas: " + window.kelasSemasa;
    document.getElementById("modal-kelas")!.classList.add("hidden");
    document.getElementById("modal-kelas")!.classList.remove("flex");
    paparAnalisisUI();

    let tabImbas = document.getElementById("tab-imbas")!;
    if (!tabImbas.classList.contains("hidden")) {
      setTimeout(() => mulakanKamera(true), 100);
    }
  } else {
    paparAlert(
      "Perhatian",
      "Sila masukkan nama kelas untuk meneruskan imbasan.",
    );
  }
}
document
  .getElementById("btn-simpan-kelas")!
  .addEventListener("click", simpanKelas);

(window as any).bukaModalRekod = function (id: string, isRefresh: boolean = false) {
  (window as any).modalRekodSemasaId = id;
  let rekod = window.senaraiRekodKelas.find((r: any) => r.id === id);
  if (!rekod) return;

  let ikonBetul =
    '<svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>';
  let ikonSalah =
    '<svg class="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg>';

  let butiranHtml = rekod.butiran
    .map((b: any) => {
      let ikon = b.betul ? ikonBetul : ikonSalah;
      let warnaTeks = b.betul ? "text-green-600" : "text-red-500";
      return `
            <div class="flex items-center justify-between p-2 bg-white rounded-lg border border-gray-100 text-sm shadow-sm">
                <div class="w-12 font-semibold text-gray-500">No. ${b.soalan}</div>
                <div class="flex-1 text-center font-bold ${warnaTeks}">${b.jawapanPelajar}</div>
                <div class="flex items-center justify-end gap-1 w-20 text-gray-400 font-medium text-xs">
                    Skema: ${b.jawapanSebenar} ${ikon}
                </div>
            </div>
        `;
    })
    .join("");

  let aiVerifiedHtml = "";
  if (rekod.isAiVerified === true) {
    aiVerifiedHtml = `<div class="absolute top-3 right-3 flex items-center justify-center bg-blue-50 text-blue-600 text-xs font-bold px-2.5 py-1 rounded-full border border-blue-100 shadow-sm gap-1">
             <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
             Disahkan AI
           </div>`;
  } else if (rekod.isAiVerified === "pending") {
    aiVerifiedHtml = `<div class="absolute top-3 right-3 flex items-center justify-center bg-orange-50 text-orange-600 text-xs font-bold px-2.5 py-1 rounded-full border border-orange-100 shadow-sm gap-1">
             <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
             Disemak AI...
           </div>`;
  } else if (rekod.isAiVerified === "failed") {
    aiVerifiedHtml = `<div class="absolute top-3 right-3 flex items-center justify-center bg-gray-100 text-gray-500 text-xs font-bold px-2.5 py-1 rounded-full border border-gray-200 shadow-sm gap-1">
             <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
             AI Gagal
           </div>`;
  } else if (rekod.isAiVerified === "error") {
    aiVerifiedHtml = `<div class="absolute top-3 right-3 flex items-center justify-center bg-red-50 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full border border-red-100 shadow-sm gap-1">
             <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
             Terdapat Ralat (AI)
           </div>`;
  }

  let keratanNamaHtml = rekod.imejNama
    ? `<div class="mt-4 mb-2 flex flex-col items-center justify-center gap-1">
             <img src="${rekod.imejNama}" class="h-12 sm:h-14 object-contain" />
             ${rekod.namaDiramal ? `<div class="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full w-max mt-1 max-w-[90%] truncate shadow-sm border border-blue-100">${rekod.namaDiramal}</div>` : ""}
           </div>`
    : "";

  document.getElementById("modal-kandungan")!.innerHTML = `
        <div class="mb-6 bg-white p-4 rounded-2xl shadow-sm text-center border border-gray-100 relative">
            <div class="text-xs bg-gray-100 text-gray-500 px-3 py-1 rounded-full absolute top-3 left-3 font-semibold">${rekod.kelas || "Kelas Umum"}</div>
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

  let btnPaparOMR = document.getElementById("btn-modal-omr")!;
  btnPaparOMR.innerText = "Papar OMR";
  btnPaparOMR.onclick = () => {
    let section = document.getElementById("bahagian-omr-penuh")!;
    if (section.classList.contains("hidden")) {
      section.classList.remove("hidden");
      btnPaparOMR.innerText = "Tutup OMR";
    } else {
      section.classList.add("hidden");
      btnPaparOMR.innerText = "Papar OMR";
    }
  };

  document.getElementById("btn-modal-imbas")!.onclick = () =>
    window.mulaImbasSemulaRekod(id);

  let modal = document.getElementById("modal-rekod")!;
  modal.classList.remove("hidden");
  modal.classList.add("flex");

  if (!isRefresh) {
    document.getElementById("modal-kandungan")!.scrollTop = 0;
  }
};

function tutupModalRekod() {
  let modal = document.getElementById("modal-rekod")!;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}
document
  .getElementById("btn-tutup-modal-rekod")!
  .addEventListener("click", tutupModalRekod);

function binaBarisSoalan10(index: number, skemaJawapanList: any = null) {
  if (index >= window.JUMLAH_SOALAN) return "";
  let htmlBulatan = window.PILIHAN.map((p) => {
    let fillCircle = "white",
      fillText = "#9CA3AF",
      strokeColor = "#D1D5DB";
    if (skemaJawapanList) {
      let isJawapan = skemaJawapanList[index] === p;
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
  }).join("");
  return `
    <div class="flex items-center w-[85%] mx-auto" style="height: ${100 / window.JUMLAH_SOALAN}%;">
        <div class="w-[20%] text-right pr-3 text-[14px] text-black font-medium">${index + 1}</div>
        <div class="w-[80%] flex justify-between h-[85%]">${htmlBulatan}</div>
    </div>`;
}

function getFormHTMLTemplate10(skemaJawapanList: any = null, isSkema = false) {
  let rows = "";
  for (let i = 0; i < window.JUMLAH_SOALAN; i++)
    rows += binaBarisSoalan10(i, skemaJawapanList);
  let headerHtml = isSkema
    ? `
        <div class="h-[30%] flex flex-col">
            <div class="flex-1 flex flex-col mb-2">
                <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Skema Jawapan</div>
                <div class="flex-1 border-[2px] border-black w-[90%]"></div>
            </div><div class="flex-1 flex flex-col"></div>
        </div>`
    : `
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
  if (index >= window.JUMLAH_SOALAN)
    return `<div class="w-full" style="height: 10%;"></div>`;
  let htmlBulatan = window.PILIHAN.map((p) => {
    let fillCircle = "white",
      fillText = "#9CA3AF",
      strokeColor = "#D1D5DB";
    if (skemaJawapanList) {
      let isJawapan = skemaJawapanList[index] === p;
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
  }).join("");
  return `
    <div class="flex items-center w-full" style="height: 10%;">
        <div class="w-[22%] text-right pr-1 sm:pr-2 text-[11px] sm:text-[13px] text-black font-medium">${index + 1}</div>
        <div class="w-[78%] flex justify-between h-[85%]">${htmlBulatan}</div>
    </div>`;
}

function getFormHTMLTemplate20(skemaJawapanList: any = null, isSkema = false) {
  let col1 = "",
    col2 = "";
  for (let i = 0; i < 10; i++) col1 += binaBarisSoalan20(i, skemaJawapanList);
  for (let i = 10; i < 20; i++) col2 += binaBarisSoalan20(i, skemaJawapanList);
  let headerHtml = isSkema
    ? `
        <div class="h-[30%] flex flex-col">
            <div class="flex-1 flex flex-col mb-2">
                <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Skema Jawapan</div>
                <div class="flex-1 border-[2px] border-black w-[90%]"></div>
            </div><div class="flex-1 flex flex-col"></div>
        </div>`
    : `
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
  if (index >= window.JUMLAH_SOALAN)
    return `<div class="w-full" style="height: ${100 / 15}%;"></div>`;
  let htmlBulatan = window.PILIHAN.map((p) => {
    let fillCircle = "white",
      fillText = "#9CA3AF",
      strokeColor = "#D1D5DB";
    if (skemaJawapanList) {
      let isJawapan = skemaJawapanList[index] === p;
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
  }).join("");
  return `
    <div class="flex items-center w-full" style="height: ${100 / 15}%;">
        <div class="w-[18%] text-right pr-2 text-[11px] sm:text-[13px] text-black font-medium">${index + 1}</div>
        <div class="w-[82%] flex justify-between h-[85%]">${htmlBulatan}</div>
    </div>`;
}

function getFormHTMLTemplate30(skemaJawapanList: any = null, isSkema = false) {
  let col1 = "",
    col2 = "";
  for (let i = 0; i < 15; i++) col1 += binaBarisSoalan30(i, skemaJawapanList);
  for (let i = 15; i < 30; i++) col2 += binaBarisSoalan30(i, skemaJawapanList);
  let headerHtml = isSkema
    ? `
        <div class="h-[20%] flex flex-col w-[100%]">
            <div class="flex w-full justify-between items-end h-full pb-2">
                <div class="w-full flex flex-col">
                    <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Skema Jawapan</div>
                    <div class="w-full h-8 border-[2px] border-black"></div>
                </div>
            </div>
        </div>`
    : `
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

function binaBarisSoalan40(
  index: number,
  totalRowsInBlock: number,
  skemaJawapanList: any = null,
) {
  if (index >= window.JUMLAH_SOALAN)
    return `<div class="w-full" style="height: ${100 / totalRowsInBlock}%;"></div>`;
  let htmlBulatan = window.PILIHAN.map((p) => {
    let fillCircle = "white",
      fillText = "#9CA3AF",
      strokeColor = "#D1D5DB";
    if (skemaJawapanList) {
      let isJawapan = skemaJawapanList[index] === p;
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
  }).join("");
  return `
    <div class="flex items-center w-full" style="height: ${100 / totalRowsInBlock}%;">
        <div class="w-[18%] text-right pr-1 sm:pr-2 text-[10px] sm:text-[12px] text-black font-medium">${index + 1}</div>
        <div class="w-[82%] flex justify-between h-[85%]">${htmlBulatan}</div>
    </div>`;
}

function getFormHTMLTemplate40(skemaJawapanList: any = null, isSkema = false) {
  let col1Top = "",
    col1Bot = "",
    col2Top = "",
    col2Bot = "",
    col3Top = "",
    col3Bot = "";
  for (let i = 0; i < 7; i++)
    col1Top += binaBarisSoalan40(i, 7, skemaJawapanList);
  for (let i = 7; i < 15; i++)
    col1Bot += binaBarisSoalan40(i, 8, skemaJawapanList);
  for (let i = 15; i < 22; i++)
    col2Top += binaBarisSoalan40(i, 7, skemaJawapanList);
  for (let i = 22; i < 30; i++)
    col2Bot += binaBarisSoalan40(i, 8, skemaJawapanList);
  for (let i = 30; i < 37; i++)
    col3Top += binaBarisSoalan40(i, 7, skemaJawapanList);
  for (let i = 37; i < 40; i++)
    col3Bot += binaBarisSoalan40(i, 8, skemaJawapanList);

  let headerHtml = isSkema
    ? `
        <div class="h-[20%] flex flex-col w-[100%]">
            <div class="flex w-full justify-between items-end h-full pb-2">
                <div class="w-full flex flex-col">
                    <div class="text-[13px] sm:text-[15px] mb-1 font-medium text-black">Skema Jawapan</div>
                    <div class="w-full h-8 border-[2px] border-black"></div>
                </div>
            </div>
        </div>`
    : `
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
  let boxW = cw * 0.7,
    boxH = boxW * 1.35;
  if (boxH > ch * 0.85) {
    boxH = ch * 0.85;
    boxW = boxH / 1.35;
  }
  const boxX = (cw - boxW) / 2,
    boxY = (ch - boxH) / 2;
  let paddingY = boxH * 0.06,
    innerH = boxH * 0.88;
  let trueQuestionStartY = boxY + paddingY + innerH * 0.35;
  let trueQuestionAreaH = innerH * 0.65;
  let rowHeight = trueQuestionAreaH / window.JUMLAH_SOALAN;
  let innerW = boxW * 0.88,
    rowW = innerW * 0.85;
  let rowX = boxX + boxW * 0.06 + (innerW - rowW) / 2;

  function getPilihanGeometri(soalanIndex: number) {
    let cY = trueQuestionStartY + soalanIndex * rowHeight + rowHeight / 2;
    let bubbleAreaW = rowW * 0.8,
      bubbleAreaX = rowX + rowW * 0.2;
    let posX = [
      bubbleAreaX + bubbleAreaW * 0.125,
      bubbleAreaX + bubbleAreaW * 0.375,
      bubbleAreaX + bubbleAreaW * 0.625,
      bubbleAreaX + bubbleAreaW * 0.875,
    ];
    return { cy: cY, posX: posX };
  }
  return {
    boxX,
    boxY,
    boxW,
    boxH,
    rowHeight,
    getPilihanGeometri,
    trueQuestionStartY,
    layout: "10",
  };
}

function dapatkanGeometriOMR20(cw: number, ch: number) {
  let boxW = cw * 0.7,
    boxH = boxW * 1.35;
  if (boxH > ch * 0.85) {
    boxH = ch * 0.85;
    boxW = boxH / 1.35;
  }
  const boxX = (cw - boxW) / 2,
    boxY = (ch - boxH) / 2;
  let paddingY = boxH * 0.06,
    innerH = boxH * 0.88;
  let trueQuestionStartY = boxY + paddingY + innerH * 0.35;
  let trueQuestionAreaH = innerH * 0.65;
  let rowHeight = trueQuestionAreaH / 10;
  let innerW = boxW * 0.88,
    innerX = boxX + boxW * 0.06,
    colW = innerW * 0.48;

  function getPilihanGeometri(soalanIndex: number) {
    let col = Math.floor(soalanIndex / 10),
      row = soalanIndex % 10;
    let cY = trueQuestionStartY + row * rowHeight + rowHeight / 2;
    let cXOffset = col === 0 ? 0 : innerW - colW;
    let colX = innerX + cXOffset;
    let bubbleAreaW = colW * 0.78,
      bubbleAreaX = colX + colW * 0.22;
    let posX = [
      bubbleAreaX + bubbleAreaW * 0.125,
      bubbleAreaX + bubbleAreaW * 0.375,
      bubbleAreaX + bubbleAreaW * 0.625,
      bubbleAreaX + bubbleAreaW * 0.875,
    ];
    return { cy: cY, posX: posX };
  }
  return {
    boxX,
    boxY,
    boxW,
    boxH,
    rowHeight,
    getPilihanGeometri,
    innerX,
    innerW,
    trueQuestionStartY,
    trueQuestionAreaH,
    layout: "20",
  };
}

function dapatkanGeometriOMR30(cw: number, ch: number) {
  let boxW = cw * 0.7,
    boxH = boxW * 1.35;
  if (boxH > ch * 0.85) {
    boxH = ch * 0.85;
    boxW = boxH / 1.35;
  }
  const boxX = (cw - boxW) / 2,
    boxY = (ch - boxH) / 2;
  let paddingX = boxW * 0.05,
    paddingY = boxH * 0.05;
  let innerW = boxW - paddingX * 2,
    innerH = boxH - paddingY * 2;
  let innerX = boxX + paddingX;
  let trueQuestionStartY = boxY + paddingY + innerH * 0.2;
  let trueQuestionAreaH = innerH * 0.8,
    rowHeight = trueQuestionAreaH / 15;
  let colW = innerW * 0.48;

  function getPilihanGeometri(soalanIndex: number) {
    let col = Math.floor(soalanIndex / 15),
      row = soalanIndex % 15;
    let cY = trueQuestionStartY + row * rowHeight + rowHeight / 2;
    let cXOffset = col === 0 ? 0 : innerW - colW;
    let colX = innerX + cXOffset;
    let bubbleAreaW = colW * 0.82,
      bubbleAreaX = colX + colW * 0.18;
    let posX = [
      bubbleAreaX + bubbleAreaW * 0.125,
      bubbleAreaX + bubbleAreaW * 0.375,
      bubbleAreaX + bubbleAreaW * 0.625,
      bubbleAreaX + bubbleAreaW * 0.875,
    ];
    return { cy: cY, posX: posX };
  }
  return {
    boxX,
    boxY,
    boxW,
    boxH,
    rowHeight,
    getPilihanGeometri,
    innerX,
    innerW,
    colW,
    trueQuestionStartY,
    trueQuestionAreaH,
    layout: "30",
  };
}

function dapatkanGeometriOMR40(cw: number, ch: number) {
  let boxW = cw * 0.7,
    boxH = boxW * 1.35;
  if (boxH > ch * 0.85) {
    boxH = ch * 0.85;
    boxW = boxH / 1.35;
  }
  const boxX = (cw - boxW) / 2,
    boxY = (ch - boxH) / 2;
  let paddingX = boxW * 0.05,
    paddingY = boxH * 0.05;
  let innerW = boxW * 0.9,
    innerH = boxH * 0.9;
  let innerX = boxX + paddingX,
    innerY = boxY + paddingY;
  let headerH = innerH * 0.2,
    gridY = innerY + headerH,
    gridH = innerH * 0.8;
  let rowHeight = gridH / 17,
    colW = innerW * 0.32;

  function getPilihanGeometri(soalanIndex: number) {
    let col: any, row: any, isTopBlock: any;
    let n = soalanIndex + 1;
    if (n >= 1 && n <= 7) {
      col = 0;
      row = n - 1;
      isTopBlock = true;
    } else if (n >= 8 && n <= 15) {
      col = 0;
      row = n - 8;
      isTopBlock = false;
    } else if (n >= 16 && n <= 22) {
      col = 1;
      row = n - 16;
      isTopBlock = true;
    } else if (n >= 23 && n <= 30) {
      col = 1;
      row = n - 23;
      isTopBlock = false;
    } else if (n >= 31 && n <= 37) {
      col = 2;
      row = n - 31;
      isTopBlock = true;
    } else if (n >= 38 && n <= 40) {
      col = 2;
      row = n - 38;
      isTopBlock = false;
    }

    let cXOffset = 0;
    if (col === 1) cXOffset = (innerW - colW) / 2;
    else if (col === 2) cXOffset = innerW - colW;

    let cX = innerX + cXOffset;
    let blockStartY = isTopBlock ? gridY : gridY + 9 * rowHeight;
    let cY = blockStartY + row * rowHeight + rowHeight / 2;
    let bubbleAreaW = colW * 0.82,
      bubbleAreaX = cX + colW * 0.18;
    let posX = [
      bubbleAreaX + bubbleAreaW * 0.125,
      bubbleAreaX + bubbleAreaW * 0.375,
      bubbleAreaX + bubbleAreaW * 0.625,
      bubbleAreaX + bubbleAreaW * 0.875,
    ];
    return { cy: cY, posX: posX };
  }
  return {
    boxX,
    boxY,
    boxW,
    boxH,
    rowHeight,
    getPilihanGeometri,
    innerX,
    innerY,
    innerW,
    innerH,
    colW,
    trueQuestionStartY: innerY + headerH,
    layout: "40",
  };
}

async function mulakanKamera(skipConfirm: boolean = false) {
  if (!skipConfirm && !window.telahSahkanImbasan) {
    if (window.pentaksiranList.length === 0) {
      if (document.getElementById("tab-imbas")?.classList.contains("flex")) {
        paparAlert("Tiada Pentaksiran", "Sila cipta pentaksiran terlebih dahulu pada tab Skema.", true);
        tukarTab("skema");
      }
      return;
    }
    bukaModalKelas();
    return;
  }

  const video = document.getElementById("kamera") as HTMLVideoElement;
  const ind = document.getElementById("scan-indicator")!;
  ind.innerText = "Mengimbas OMR...";
  ind.classList.replace("bg-green-500/80", "bg-black/40");

  (window as any).isScanning = false;
  (window as any).autoSnapCounter = 0;

  if ((window as any).streamKamera) {
    video.play().catch((e) => console.log(e));
    renderFrameKamera();
    setupFlashButton();
    return;
  }

  try {
    (window as any).streamKamera = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    video.srcObject = (window as any).streamKamera;
    await video.play();
    renderFrameKamera();
    setupFlashButton();
  } catch (err) {
    paparAlert(
      "Kamera Gagal",
      "Kamera tidak dapat diakses. Sila benarkan tetapan privasi pelayar untuk mengakses kamera.",
    );
  }
}

function setupFlashButton() {
  const track = (window as any).streamKamera?.getVideoTracks()[0];
  const btnFlash = document.getElementById("btn-toggle-flash");
  if (track && track.getCapabilities && btnFlash) {
    const capabilities = track.getCapabilities();
    if (capabilities.torch) {
      btnFlash.classList.remove("hidden");
      let isFlashOn = localStorage.getItem("cikguscan_flash_pref") !== "false";

      try {
        track.applyConstraints({
          advanced: [{ torch: isFlashOn }],
        });
        if (isFlashOn) {
          btnFlash.classList.replace("bg-black/50", "bg-yellow-500/80");
        } else {
          btnFlash.classList.replace("bg-yellow-500/80", "bg-black/50");
        }
      } catch (e) {
        console.error("Failed to auto-on flash", e);
        isFlashOn = false;
      }

      btnFlash.onclick = async () => {
        isFlashOn = !isFlashOn;
        try {
          await track.applyConstraints({
            advanced: [{ torch: isFlashOn }],
          });
          localStorage.setItem("cikguscan_flash_pref", isFlashOn.toString());
          if (isFlashOn) {
            btnFlash.classList.replace("bg-black/50", "bg-yellow-500/80");
          } else {
            btnFlash.classList.replace("bg-yellow-500/80", "bg-black/50");
          }
        } catch (e) {
          console.error("Failed to toggle flash", e);
        }
      };
    } else {
      btnFlash.classList.add("hidden");
    }
  }
}

function hentikanKamera() {
  (window as any).isScanning = true;
  if ((window as any).streamKamera) {
    (window as any).streamKamera
      .getTracks()
      .forEach((track: any) => track.stop());
    (window as any).streamKamera = null;
    (document.getElementById("kamera") as HTMLVideoElement).srcObject = null;
  }
  if ((window as any).gelungKamera)
    cancelAnimationFrame((window as any).gelungKamera);
  const btnFlash = document.getElementById("btn-toggle-flash");
  if (btnFlash) {
    btnFlash.classList.add("hidden");
    btnFlash.classList.replace("bg-yellow-500/80", "bg-black/50");
  }
}

function renderFrameKamera() {
  if (!window.streamKamera || window.isScanning) return;

  const video = document.getElementById("kamera") as HTMLVideoElement;
  const cvsVideo = document.getElementById("canvas-video") as HTMLCanvasElement;
  const cvsOverlay = document.getElementById(
    "canvas-overlay",
  ) as HTMLCanvasElement;

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
    const ctxV = cvsVideo.getContext("2d", { willReadFrequently: true })!;
    const ctxO = cvsOverlay.getContext("2d")!;

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
        let ind = document.getElementById("scan-indicator")!;
        ind.innerText = "Berjaya!";
        ind.classList.replace("bg-black/40", "bg-green-500/80");
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

        ctxO.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctxO.fillRect(0, 0, cw, ch);
        setTimeout(() => {
          tangkapDanTanda(true);
        }, 200);
        return;
      }
    }
  }
  if (!window.isScanning)
    window.gelungKamera = requestAnimationFrame(renderFrameKamera);
}

function lukisPanduan(ctx: any, cw: number, ch: number, geo: any) {
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.fillRect(0, 0, cw, ch);
  ctx.clearRect(geo.boxX, geo.boxY, geo.boxW, geo.boxH);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(geo.boxX, geo.boxY, geo.boxW, geo.boxH);

  let ts = Math.max(16, geo.boxW * 0.035),
    halfTs = ts / 2;
  ctx.strokeStyle = "#0071e3";
  ctx.lineWidth = 3;
  ctx.fillStyle = "rgba(0, 113, 227, 0.15)";

  ctx.fillRect(geo.boxX - halfTs, geo.boxY - halfTs, ts, ts);
  ctx.strokeRect(geo.boxX - halfTs, geo.boxY - halfTs, ts, ts);
  ctx.fillRect(geo.boxX - halfTs, geo.boxY + geo.boxH / 2 - halfTs, ts, ts);
  ctx.strokeRect(geo.boxX - halfTs, geo.boxY + geo.boxH / 2 - halfTs, ts, ts);
  ctx.fillRect(geo.boxX - halfTs, geo.boxY + geo.boxH - halfTs, ts, ts);
  ctx.strokeRect(geo.boxX - halfTs, geo.boxY + geo.boxH - halfTs, ts, ts);
  ctx.fillRect(geo.boxX + geo.boxW - halfTs, geo.boxY - halfTs, ts, ts);
  ctx.strokeRect(geo.boxX + geo.boxW - halfTs, geo.boxY - halfTs, ts, ts);
  ctx.fillRect(
    geo.boxX + geo.boxW - halfTs,
    geo.boxY + geo.boxH / 2 - halfTs,
    ts,
    ts,
  );
  ctx.strokeRect(
    geo.boxX + geo.boxW - halfTs,
    geo.boxY + geo.boxH / 2 - halfTs,
    ts,
    ts,
  );
  ctx.fillRect(
    geo.boxX + geo.boxW - halfTs,
    geo.boxY + geo.boxH - halfTs,
    ts,
    ts,
  );
  ctx.strokeRect(
    geo.boxX + geo.boxW - halfTs,
    geo.boxY + geo.boxH - halfTs,
    ts,
    ts,
  );

  const r = geo.rowHeight * 0.4;
  for (let i = 0; i < window.JUMLAH_SOALAN; i++) {
    let { cy, posX } = geo.getPilihanGeometri(i);
    for (let j = 0; j < 4; j++) {
      ctx.beginPath();
      ctx.arc(posX[j], cy, r, 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(0, 113, 227, 0.2)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  if (geo.layout === "20" || geo.layout === "30") {
    let midX = geo.innerX + geo.innerW / 2;
    ctx.beginPath();
    ctx.moveTo(midX, geo.trueQuestionStartY);
    ctx.lineTo(midX, geo.trueQuestionStartY + geo.trueQuestionAreaH);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (geo.layout === "40") {
    let col2X = geo.innerX + (geo.innerW - geo.colW) / 2,
      col3X = geo.innerX + geo.innerW - geo.colW;
    ctx.beginPath();
    ctx.moveTo(col2X - geo.innerW * 0.01, geo.innerY);
    ctx.lineTo(col2X - geo.innerW * 0.01, geo.innerY + geo.innerH);
    ctx.moveTo(col3X - geo.innerW * 0.01, geo.innerY);
    ctx.lineTo(col3X - geo.innerW * 0.01, geo.innerY + geo.innerH);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function semakAutoSnap(ctx: any, geo: any) {
  let size = Math.max(10, geo.boxW * 0.025),
    half = size / 2;
  let whitePoints = [
    { x: geo.boxX + geo.boxW * 0.15, y: geo.boxY + geo.boxH * 0.05 },
    { x: geo.boxX + geo.boxW * 0.85, y: geo.boxY + geo.boxH * 0.05 },
  ];
  let highestAvg = 0;
  for (let wp of whitePoints) {
    let sx = Math.max(0, Math.min(ctx.canvas.width - size, wp.x - half)),
      sy = Math.max(0, Math.min(ctx.canvas.height - size, wp.y - half));
    let cData = ctx.getImageData(sx, sy, size, size),
      sum = 0;
    for (let i = 0; i < cData.data.length; i += 4)
      sum +=
        0.299 * cData.data[i] +
        0.587 * cData.data[i + 1] +
        0.114 * cData.data[i + 2];
    let avg = sum / (cData.data.length / 4);
    if (avg > highestAvg) highestAvg = avg;
  }

  let paperBrightness = highestAvg || 200;
  if (paperBrightness < 90) return false;

  let darkThreshold = paperBrightness * CONFIG_IMBASAN.ambangMarkerHitam,
    requiredDarkPixelsRatio = CONFIG_IMBASAN.nisbahPikselMarker;
  let titikUjian = [
    { x: geo.boxX - half, y: geo.boxY - half },
    { x: geo.boxX + geo.boxW - half, y: geo.boxY - half },
    { x: geo.boxX - half, y: geo.boxY + geo.boxH / 2 - half },
    { x: geo.boxX + geo.boxW - half, y: geo.boxY + geo.boxH / 2 - half },
    { x: geo.boxX - half, y: geo.boxY + geo.boxH - half },
    { x: geo.boxX + geo.boxW - half, y: geo.boxY + geo.boxH - half },
  ];

  for (let pt of titikUjian) {
    let ptx = Math.max(0, Math.min(ctx.canvas.width - size, pt.x)),
      pty = Math.max(0, Math.min(ctx.canvas.height - size, pt.y));
    let imgData = ctx.getImageData(ptx, pty, size, size),
      pixels = imgData.data,
      darkCount = 0,
      totalPixels = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      let brightness =
        0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      if (brightness < darkThreshold) darkCount++;
    }
    if (darkCount / totalPixels < requiredDarkPixelsRatio) return false;
  }
  return true;
}

function tangkapDanTanda(dariAutoSnap = false) {
  if (window.skemaJawapan.includes(null)) {
    paparAlert(
      "Skema Belum Lengkap",
      "Harap maklum, skema jawapan belum lengkap disetkan. Sila lengkapkan sebelum mengimbas.",
    );
    window.isScanning = false;
    return;
  }
  window.isScanning = true;
  const cvsVideo = document.getElementById("canvas-video") as HTMLCanvasElement;
  if (!cvsVideo.width) return;

  if (window.gelungKamera) cancelAnimationFrame(window.gelungKamera);
  analisisImej(cvsVideo);
}
document
  .getElementById("btn-tangkap-dan-tanda")!
  .addEventListener("click", () => tangkapDanTanda(false));

async function verifikasiAI(
  imejBase64: string,
  imejNamaBase64: string | null,
  butiranAsal: any[],
): Promise<{
  markah: number;
  butiran: any[];
  ralat?: boolean;
  nama?: string;
} | null> {
  const apiKey =
    localStorage.getItem("gemini_api_key") ||
    "AIzaSyAtAnovHgs1PTZxqAiKzkhDHl3Q5cs9-l8";
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({ apiKey });

    let skemaPrompt = "";
    for (let i = 0; i < window.JUMLAH_SOALAN; i++) {
      skemaPrompt += `Soalan ${i + 1}: ${window.skemaJawapan[i] || "Tiada"}\n`;
    }

    const prompt = `Anda adalah sistem pengesahan jawapan OMR (Optical Mark Recognition) bernama CikguScan.
Sistem tempatan telah menganalisis imej OMR ini dan mendapati jawapan berikut (sebagai panduan awal sahaja):
${butiranAsal.map((b: any, i: number) => `S${i + 1}: Jawapan yang dipilih ${b.jawapanPelajar === "KOSONG" ? "KOSONG" : b.jawapanPelajar}`).join("\n")}

Sila semak semula gambar helaian OMR pelajar ini (serta keratan nama sekiranya ada) dan berikan ketepatan muktamad.
Terdapat ${window.JUMLAH_SOALAN} soalan semuanya. Kertas ini mungkin mempunyai kecacatan (tersenget dsb). Jika pelajar bulatkan lebih dari satu pilihan, set statusnya sebagai BATAL. Jika tiada jawapan dibulatkan, status KOSONG. Siri markah asal daripada sistem tempatan adalah agak tepat. Anda hanya perlu membuat pembetulan logik jika ada kesilapan silau dan sebagainya.

**PENTING - SEMAKAN BULATAN (OMR):**
- Tolong sahkan secara teliti setiap bulatan sekiranya sistem tempatan terlepas pandang.
- Sila ambil kira bulatan yang DILOREK SECARA TIDAK SEMPURNA (sebagai contoh, hanya lorekan kasar, sebahagian dakwat/terconteng, atau bulatan yang tidak dihitamkan sepenuhnya). Selagi ada tanda niat untuk memilih di dalam bulatan tersebut, anggap ia sebagai jawapan yang dipilih.
- Jangan terlepas pandang lorekan atau tanda kecil di dalam bulatan.

**MANDATORI OCR TULISAN TANGAN:**
Sekiranya imej keratan nama disertakan, anda MESTI BACA DAN TEKA SEBAIK MUNGKIN tulisan tangan tersebut untuk mendapatkan nama pelajar, nombor kad pengenalan, nombor matrik, darjah/kelas, atau apa-apa maklumat bertulis di bahagian atas kertas. 
Tuliskan maklumat tersebut ke dalam \`nama_pelajar\`. Jika tiada kesan dakwat langsung, barulah tinggalkan kosong.

Skema Jawapan Sebenar:
${skemaPrompt}

PENTING:
- Sila bandingkan bulatan pada kertas OMR dengan Skema Jawapan Sebenar.
- 'jawapan_pelajar' mesti diisi dengan huruf A, B, C, atau D. Jika kosong tulis KOSONG, jika batal tulis BATAL.
- 'status' mesti BETUL, SALAH, BATAL atau KOSONG.`;

    const base64Data = imejBase64.split(",")[1];
    const mimeType = imejBase64.split(";")[0].split(":")[1];

    let contentsConfig: any = [
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
    ];

    if (imejNamaBase64) {
      contentsConfig.push({
        inlineData: {
          data: imejNamaBase64.split(",")[1],
          mimeType: imejNamaBase64.split(";")[0].split(":")[1],
        },
      });
    }

    contentsConfig.push(prompt);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contentsConfig,
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
                  jawapan_pelajar: {
                    type: Type.STRING,
                    description: "Hanya huruf A, B, C, D, atau KOSONG, BATAL",
                  },
                  status: {
                    type: Type.STRING,
                    description: "Hanya BETUL, SALAH, KOSONG, atau BATAL",
                  },
                },
              },
            },
            ralat_imbasan_dikesan: {
              type: Type.BOOLEAN,
              description:
                "Set kepada true jika anda mendapati sistem tempatan salah mengesan banyak jawapan akibat masalah penjajaran imbasan, terlalu gelap, tersenget atau tidak dapat dibaca di sebahagian ruang bulatan",
            },
            nama_pelajar: {
              type: Type.STRING,
              description:
                "Nama yang berjaya dibaca daripada bahagian atas kertas OMR / keratan nama. Biarkan kosong sekiranya tidak dijumpai.",
            },
          },
        },
      },
    });

    if (response.text) {
      let cleanText = response.text;
      if (cleanText.includes("```json")) {
        cleanText = cleanText.split("```json")[1].split("```")[0].trim();
      } else if (cleanText.includes("```")) {
        cleanText = cleanText.split("```")[1].split("```")[0].trim();
      }
      const json = JSON.parse(cleanText);
      console.log("AI Verification Output:", json);
      let butiranBaru = [];
      let markah = 0;
      let diffCount = 0;
      for (let i = 0; i < window.JUMLAH_SOALAN; i++) {
        let d = json.butiran_jawapan.find((x: any) => x.soalan === i + 1);
        let studentAns: any = "KOSONG";
        let sts = 2; // salah
        let isBetul = false;

        if (d && d.status !== "KOSONG") {
          if (d.jawapan_pelajar === "A") studentAns = "A";
          if (d.jawapan_pelajar === "B") studentAns = "B";
          if (d.jawapan_pelajar === "C") studentAns = "C";
          if (d.jawapan_pelajar === "D") studentAns = "D";

          if (d.status === "BETUL") {
            markah++;
            isBetul = true;
          }
          if (d.status === "BATAL") studentAns = "BATAL";
        } else {
          studentAns = "KOSONG";
        }

        let originalAns = butiranAsal[i].jawapanPelajar;
        if (
          studentAns !== originalAns &&
          originalAns !== "BATAL" &&
          originalAns !== "KOSONG"
        ) {
          diffCount++;
        }

        butiranBaru.push({
          soalan: i + 1,
          jawapanPelajar: studentAns,
          jawapanSebenar: window.skemaJawapan[i],
          betul: isBetul,
        });
      }
      let isRalat = json.ralat_imbasan_dikesan || diffCount >= 3;
      return {
        markah,
        butiran: butiranBaru,
        ralat: isRalat,
        nama: json.nama_pelajar,
      };
    }
    return null;
  } catch (e) {
    console.error(
      "AI Error object:",
      JSON.stringify(e, Object.getOwnPropertyNames(e), 2),
    );
    return null;
  }
}

function analisisImej(sumberCanvas: HTMLCanvasElement) {
  const ctx = sumberCanvas.getContext("2d", { willReadFrequently: true })!;
  const cw = sumberCanvas.width;
  const ch = sumberCanvas.height;
  const geo = dapatkanGeometriOMR(cw, ch);

  const canvasDebug = document.getElementById(
    "canvas-debug",
  ) as HTMLCanvasElement;
  canvasDebug.width = cw;
  canvasDebug.height = ch;
  const ctxDebug = canvasDebug.getContext("2d")!;
  ctxDebug.drawImage(sumberCanvas, 0, 0);

  ctxDebug.strokeStyle = "rgba(0, 113, 227, 0.4)";
  ctxDebug.lineWidth = 3;
  ctxDebug.strokeRect(geo.boxX, geo.boxY, geo.boxW, geo.boxH);
  if (geo.layout === "20" || geo.layout === "30") {
    let midX = geo.innerX + geo.innerW / 2;
    ctxDebug.beginPath();
    ctxDebug.moveTo(midX, geo.trueQuestionStartY);
    ctxDebug.lineTo(midX, geo.trueQuestionStartY + geo.trueQuestionAreaH);
    ctxDebug.stroke();
  } else if (geo.layout === "40") {
    let col2X = geo.innerX + (geo.innerW - geo.colW) / 2,
      col3X = geo.innerX + geo.innerW - geo.colW;
    ctxDebug.beginPath();
    ctxDebug.moveTo(col2X - geo.innerW * 0.01, geo.innerY);
    ctxDebug.lineTo(col2X - geo.innerW * 0.01, geo.innerY + geo.innerH);
    ctxDebug.moveTo(col3X - geo.innerW * 0.01, geo.innerY);
    ctxDebug.lineTo(col3X - geo.innerW * 0.01, geo.innerY + geo.innerH);
    ctxDebug.stroke();
  }

  let markah = 0;
  let butiran: any = [];
  const r = geo.rowHeight * 0.4;
  const scanR = r * CONFIG_IMBASAN.radiusImbasan;

  for (let i = 0; i < window.JUMLAH_SOALAN; i++) {
    let { cy, posX } = geo.getPilihanGeometri(i);
    let tahapKegelapan: number[] = [];
    for (let j = 0; j < window.PILIHAN.length; j++) {
      let cx = posX[j];
      let imgData = ctx.getImageData(
        cx - scanR,
        cy - scanR,
        scanR * 2,
        scanR * 2,
      );
      let pixels = imgData.data,
        totalBrightness = 0;
      for (let p = 0; p < pixels.length; p += 4) {
        totalBrightness +=
          0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
      }
      tahapKegelapan.push(totalBrightness / (pixels.length / 4));
    }

    let sortedBright = [...tahapKegelapan].sort((a, b) => a - b);
    let avgPaper = (sortedBright[1] + sortedBright[2] + sortedBright[3]) / 3;
    let pilihanPelajar = null;

    let diff1 = avgPaper - sortedBright[0];
    let diff2 = avgPaper - sortedBright[1];

    if (diff1 > CONFIG_IMBASAN.ambangKosong) {
      let indeksJawapan = tahapKegelapan.indexOf(sortedBright[0]);
      pilihanPelajar = window.PILIHAN[indeksJawapan];

      // Semakan 'Double Mark' (BATAL) vs 'Padaman Tak Bersih'
      if (diff2 > CONFIG_IMBASAN.ambangKosong) {
        if (
          sortedBright[1] - sortedBright[0] <
          CONFIG_IMBASAN.pemaafSisaPadaman
        ) {
          pilihanPelajar = "BATAL";
        }
      }
    }

    let jawapanSebenar = window.skemaJawapan[i];
    let betul = false;
    if (pilihanPelajar === jawapanSebenar) {
      betul = true;
      markah++;
    }

    for (let j = 0; j < window.PILIHAN.length; j++) {
      let cx = posX[j];
      ctxDebug.beginPath();
      ctxDebug.arc(cx, cy, r, 0, 2 * Math.PI);
      if (window.PILIHAN[j] === pilihanPelajar) {
        if (betul) {
          ctxDebug.fillStyle = "rgba(34, 197, 94, 0.6)";
        } else {
          ctxDebug.fillStyle = "rgba(239, 68, 68, 0.6)";
        }
        ctxDebug.fill();
      } else if (
        pilihanPelajar === "BATAL" &&
        avgPaper - tahapKegelapan[j] > CONFIG_IMBASAN.ambangKosong
      ) {
        ctxDebug.fillStyle = "rgba(251, 146, 60, 0.6)";
        ctxDebug.fill();
      } else {
        ctxDebug.strokeStyle = "rgba(239, 68, 68, 0.5)";
        ctxDebug.stroke();
      }
    }

    butiran.push({
      soalan: i + 1,
      jawapanPelajar: pilihanPelajar || "KOSONG",
      jawapanSebenar: jawapanSebenar,
      betul: betul,
    });
  }

  let paddingY = geo.boxH * 0.05;
  let headerHeight =
    geo.layout === "10" || geo.layout === "20"
      ? geo.boxH * 0.88 * 0.3
      : geo.boxH * 0.9 * 0.2;

  let cropY, cropH, cropX, cropW;

  if (geo.layout === "10" || geo.layout === "20") {
    cropY = geo.boxY + paddingY + headerHeight * 0.22;
    cropH = headerHeight * 0.34;
    cropX = geo.boxX - geo.boxW * 0.05;
    cropW = geo.boxW * 0.7;
  } else {
    cropY = geo.boxY + paddingY + headerHeight * 0.55;
    cropH = headerHeight * 0.45;
    cropX = geo.boxX - geo.boxW * 0.05;
    cropW = geo.boxW * 0.7;
  }

  cropY = Math.max(0, cropY);
  cropX = Math.max(0, cropX);
  cropW = Math.min(cw - cropX, cropW);
  cropH = Math.min(ch - cropY, cropH);

  let canvasNama = document.createElement("canvas");
  canvasNama.width = cropW;
  canvasNama.height = cropH;
  canvasNama
    .getContext("2d")!
    .drawImage(sumberCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  let imejNamaDataUrl = canvasNama.toDataURL("image/jpeg", 0.5);

  let canvasKecil = document.createElement("canvas");
  let scaleDown = 500 / cw;
  canvasKecil.width = 500;
  canvasKecil.height = ch * scaleDown;
  canvasKecil
    .getContext("2d")!
    .drawImage(canvasDebug, 0, 0, canvasKecil.width, canvasKecil.height);
  let imejPenuhDataUrl = canvasKecil.toDataURL("image/jpeg", 0.5);

  let canvasAI = document.createElement("canvas");
  canvasAI.width = 500;
  canvasAI.height = ch * scaleDown;
  canvasAI
    .getContext("2d")!
    .drawImage(sumberCanvas, 0, 0, canvasAI.width, canvasAI.height);
  let imejPenuhDataUrlUnmarked = canvasAI.toDataURL("image/jpeg", 0.5);

  let peratus = (markah / window.JUMLAH_SOALAN) * 100;
  let proBulan = 0;
  let isPro = window.isPro || false;
  let isTrialActive = false;
  
  if (!isPro && !window.trialCompleted) {
    if (!window.trialStart) {
      window.trialStart = Date.now();
      if (window.currentUserId) {
        updateDoc(doc(db, "users", window.currentUserId), { trialStart: window.trialStart, lastLogin: serverTimestamp() }).catch(() => {});
      }
      paparAlert("Akaun PRO Diaktifkan!", "Tahniah! Cikgu mendapat akses penuh ciri-ciri PRO untuk 2 jam seterusnya.");
      updateStatusHeader();
    }
    
    let elapsed = Math.floor((Date.now() - window.trialStart) / 1000);
    if (elapsed < 7200) {
      isTrialActive = true;
    } else {
      window.trialCompleted = true;
      if (window.currentUserId) {
         updateDoc(doc(db, "users", window.currentUserId), { trialCompleted: true, lastLogin: serverTimestamp() }).catch(() => {});
      }
      updateStatusHeader();
    }
  }

  const finaliseRekod = (
    finalMarkah: number,
    finalButiran: any[],
    isTukarTab: boolean = true,
    isAiVerified: boolean | "pending" | "failed" | "error" = false,
    namaDiramal: string | null = null,
  ) => {
    let finalPeratus = (finalMarkah / window.JUMLAH_SOALAN) * 100;
    if (isPro || proBulan > 0 || isTrialActive) {
      let existingRekod = null;
      if (window.idUntukGanti) {
        existingRekod = window.senaraiRekodKelas.find((r:any) => r.id === window.idUntukGanti);
      }

      let finalImejNama = imejNamaDataUrl;
      let finalImejPenuh = imejPenuhDataUrl;

      if (existingRekod) {
        if (existingRekod.imejNama && existingRekod.imejNama.startsWith("http")) finalImejNama = existingRekod.imejNama;
        if (existingRekod.imejPenuh && existingRekod.imejPenuh.startsWith("http")) finalImejPenuh = existingRekod.imejPenuh;
      }

      let rekodBaharu: any = {
        id: window.idUntukGanti ? window.idUntukGanti : Date.now().toString(),
        markah: finalMarkah,
        jumlah: window.JUMLAH_SOALAN,
        peratus: parseFloat(finalPeratus.toFixed(1)),
        imejNama: finalImejNama,
        imejPenuh: finalImejPenuh,
        butiran: finalButiran,
        kelas: window.kelasSemasa,
        pentaksiranId: window.currentPentaksiranId || "umum",
        isAiVerified: isAiVerified,
      };
      if (namaDiramal) {
        rekodBaharu.namaDiramal = namaDiramal;
      }

      window.idRekodSemasa = rekodBaharu.id;

      if (window.idUntukGanti) {
        let idx = window.senaraiRekodKelas.findIndex(
          (r: any) => r.id === window.idUntukGanti,
        );
        if (idx > -1) {
          window.senaraiRekodKelas[idx] = rekodBaharu;
        } else {
          window.senaraiRekodKelas.unshift(rekodBaharu);
        }
      } else {
        window.senaraiRekodKelas.unshift(rekodBaharu);
      }

      simpanRekodLokal();
      syncRekodKeCloud(rekodBaharu).catch(e => console.error(e));
    } else {
      window.idRekodSemasa = null;
    }

    paparKeputusan(finalMarkah, finalButiran, isTukarTab);
  };

  if (true) {
    let ind = document.getElementById("scan-indicator");
    if (ind) {
      ind.innerText = "Disimpan & AI sdg mengesahkan...";
      ind.classList.replace("bg-black/40", "bg-blue-500/80");
    }

    let pendingId = Date.now().toString();
    if (window.idUntukGanti) pendingId = window.idUntukGanti;
    window.idUntukGanti = pendingId;

    finaliseRekod(markah, butiran, true, "pending");
    window.idUntukGanti = null;

    let aiIndicator = document.getElementById("ai-verifying-indicator");
    if (aiIndicator) {
      aiIndicator.classList.remove("hidden");
    }

    verifikasiAI(imejPenuhDataUrlUnmarked, imejNamaDataUrl, butiran)
      .then((res) => {
        if (aiIndicator) aiIndicator.classList.add("hidden");

        if (res) {
          window.idUntukGanti = pendingId;
          finaliseRekod(
            res.markah,
            res.butiran,
            false,
            res.ralat ? "error" : true,
            res.nama,
          );
          window.idUntukGanti = null;
          paparAnalisisUI(); // Update senarai di background

          // Kemaskini paparan jika pengguna masih melihat keputusan ini
          if (window.idRekodSemasa === pendingId) {
            paparKeputusan(res.markah, res.butiran, false);
          }

          // Kemaskini paparan butiran individu jika modal terbuka
          let modal = document.getElementById("modal-rekod");
          if (
            modal &&
            !modal.classList.contains("hidden") &&
            (window as any).modalRekodSemasaId === pendingId
          ) {
            (window as any).bukaModalRekod(pendingId, true);
          }
        } else {
          console.warn("AI Gagal: CikguScan mengekalkan kiraan tempatan.");
          window.idUntukGanti = pendingId;
          finaliseRekod(markah, butiran, false, "failed");
          window.idUntukGanti = null;
          paparAnalisisUI();
          let modal = document.getElementById("modal-rekod");
          if (
            modal &&
            !modal.classList.contains("hidden") &&
            (window as any).modalRekodSemasaId === pendingId
          ) {
            (window as any).bukaModalRekod(pendingId, true);
          }
        }
      })
      .catch((err) => {
        if (aiIndicator) aiIndicator.classList.add("hidden");
        console.error("AI Ralat", err);
        window.idUntukGanti = pendingId;
        finaliseRekod(markah, butiran, false, "failed");
        window.idUntukGanti = null;
        paparAnalisisUI();
        let modal = document.getElementById("modal-rekod");
        if (
          modal &&
          !modal.classList.contains("hidden") &&
          (window as any).modalRekodSemasaId === pendingId
        ) {
          (window as any).bukaModalRekod(pendingId, true);
        }
      });
  } else {
    finaliseRekod(markah, butiran, true);
    window.idUntukGanti = null;
  }
}

function paparKeputusan(
  markah: number,
  butiran: any,
  isTukarTab: boolean = true,
) {
  if (isTukarTab) tukarTab("keputusan");
  let peratus = (markah / window.JUMLAH_SOALAN) * 100;
  let proBulan = 0;
  let isPro = window.isPro || false;
  let isTrialActive = false;
  
  if (!isPro && window.trialStart && !window.trialCompleted) {
    let elapsed = Math.floor((Date.now() - window.trialStart) / 1000);
    if (elapsed < 7200) {
      isTrialActive = true;
    }
  }

  document.getElementById("skor-markah")!.innerText = markah.toString();
  document.getElementById("skor-total")!.innerText = `/${window.JUMLAH_SOALAN}`;
  document.getElementById("skor-peratus")!.innerText = `${peratus.toFixed(1)}%`;

  let labelKelas = document.getElementById("skor-kelas-label");
  let separatorKelas = document.getElementById("skor-separator");
  let btnPadamSemasa = document.getElementById("btn-padam-semasa");

  let rekodSemasa = window.senaraiRekodKelas.find(
    (r: any) => r.id === window.idRekodSemasa,
  );
  let nameContainer = document.getElementById("skor-imej-nama-container");
  let nameImg = document.getElementById("skor-imej-nama") as HTMLImageElement;

  if (rekodSemasa && rekodSemasa.imejNama) {
    nameImg.src = rekodSemasa.imejNama;
    nameContainer?.classList.remove("hidden");

    // Add predicted name beneath the image
    let labelNama = document.getElementById("skor-nama-diramal");
    if (!labelNama) {
      labelNama = document.createElement("div");
      labelNama.id = "skor-nama-diramal";
      labelNama.className =
        "text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full mt-2 mx-auto text-center border border-blue-100 max-w-[90%] truncate";
      nameContainer?.appendChild(labelNama);
    }
    if (rekodSemasa.namaDiramal) {
      labelNama.innerText = rekodSemasa.namaDiramal;
      labelNama.classList.remove("hidden");
    } else {
      labelNama.classList.add("hidden");
    }
  } else {
    nameContainer?.classList.add("hidden");
  }

  if (isPro || proBulan > 0 || isTrialActive) {
    if (labelKelas) {
      labelKelas.innerText = window.kelasSemasa;
      labelKelas.classList.remove("hidden");
    }
    if (separatorKelas) separatorKelas.classList.remove("hidden");
    if (btnPadamSemasa) {
      btnPadamSemasa.classList.remove("hidden");
      btnPadamSemasa.classList.add("flex");
    }
  } else {
    if (labelKelas) labelKelas.classList.add("hidden");
    if (separatorKelas) separatorKelas.classList.add("hidden");
    if (btnPadamSemasa) {
      btnPadamSemasa.classList.add("hidden");
      btnPadamSemasa.classList.remove("flex");
    }
  }

  let senaraiHtml = butiran
    .map((b: any) => {
      let ikon = b.betul
        ? '<svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>'
        : '<svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg>';
      let warnaTeks = b.betul
        ? "text-green-600 font-bold"
        : "text-red-500 font-bold";
      return `
            <div class="flex items-center justify-between p-3 bg-apple-bg rounded-xl border border-apple-border/30">
                <div class="w-16 font-semibold text-apple-text">No. ${b.soalan}</div>
                <div class="flex-1 text-center font-medium">Jawab: <span class="${warnaTeks}">${b.jawapanPelajar}</span></div>
                <div class="flex items-center justify-end gap-2 w-24 text-apple-textMuted font-medium">
                    Skema: ${b.jawapanSebenar} ${ikon}
                </div>
            </div>
        `;
    })
    .join("");
  document.getElementById("senarai-keputusan")!.innerHTML = senaraiHtml;

  if (isTukarTab) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function kemaskiniJumlahSoalan() {
  let inputEl = document.getElementById(
    "input-jumlah-soalan",
  ) as HTMLInputElement;
  let nilai = parseInt(inputEl.value);
  if (isNaN(nilai) || nilai < 1) {
    nilai = 1;
    inputEl.value = "1";
  } else if (nilai > 40) {
    nilai = 40;
    inputEl.value = "40";
    paparAlert("Had Maksimum", "Maksimum 40 soalan dibenarkan.");
  }

  window.JUMLAH_SOALAN = nilai;
  localStorage.setItem(
    "cikguscan_jumlah_" + window.currentUser,
    window.JUMLAH_SOALAN as any,
  );

  let skemaBaru = Array(window.JUMLAH_SOALAN).fill(null);
  for (
    let i = 0;
    i < Math.min(window.skemaJawapan.length, window.JUMLAH_SOALAN);
    i++
  ) {
    skemaBaru[i] = window.skemaJawapan[i];
  }
  window.skemaJawapan = skemaBaru;

  let btnPrintSkema = document.getElementById("btn-print-skema");
  if (btnPrintSkema) btnPrintSkema.classList.add("hidden");

  updatePageOrientation("omr");
  janaBorangSkema();
  janaBorangCetak();
}
document
  .getElementById("input-jumlah-soalan")!
  .addEventListener("change", kemaskiniJumlahSoalan);

function tukarTab(idTab: string) {
  let proBulan = 0;
  let isPro = window.isPro || false;
  let isTrialActive = false;
  
  if (!isPro && window.trialStart && !window.trialCompleted) {
    let elapsed = Math.floor((Date.now() - window.trialStart) / 1000);
    if (elapsed < 7200) {
      isTrialActive = true;
    }
  }

  if (idTab === "analisis") {
    if (!isPro && proBulan <= 0 && !isTrialActive) {
      paparAlert("Akses Terhad.", "Khas langganan Pro sahaja.", true);
      return;
    }
  }

  document.querySelectorAll(".tab-content").forEach((el: any) => {
    el.classList.add("hidden");
    el.classList.remove("flex", "animate-fade-in");
  });

  document
    .querySelectorAll(".apple-segmented-control button")
    .forEach((el: any) => {
      el.classList.remove("bg-white", "text-apple-text", "shadow-sm");
      el.classList.add("text-apple-textMuted");
    });

  let tabElement = document.getElementById("tab-" + idTab)!;
  if (idTab === "cetak" || idTab === "imbas" || idTab === "analisis") {
    tabElement.classList.add("flex");
  }
  tabElement.classList.remove("hidden");

  let navBtn = document.getElementById("nav-" + idTab);
  if (navBtn) {
    navBtn.classList.remove("text-apple-textMuted");
    navBtn.classList.add("bg-white", "text-apple-text", "shadow-sm");
  }

  if (idTab === "imbas") {
    window.isScanning = false;
    let banner = document.getElementById("banner-ganti")!;
    if (window.idUntukGanti) {
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }

    if (isPro || proBulan > 0 || isTrialActive) {
      if (
        window.kelasSemasa === "Kelas Umum" ||
        window.kelasSemasa.trim() === ""
      ) {
        bukaModalKelas();
      } else {
        setTimeout(() => mulakanKamera(), 100);
      }
    } else {
      setTimeout(() => mulakanKamera(), 100);
    }
  } else {
    if (idTab !== "keputusan") {
      window.idUntukGanti = null;
    }
    hentikanKamera();
  }

  if (idTab === "analisis") {
    paparAnalisisUI();
  }
}

document
  .getElementById("nav-skema")!
  .addEventListener("click", () => tukarTab("skema"));
document
  .getElementById("nav-cetak")!
  .addEventListener("click", () => tukarTab("cetak"));
document
  .getElementById("nav-imbas")!
  .addEventListener("click", () => tukarTab("imbas"));
document
  .getElementById("nav-analisis")!
  .addEventListener("click", () => tukarTab("analisis"));
document
  .getElementById("btn-lihat-analisis-keputusan")!
  .addEventListener("click", () => tukarTab("analisis"));
document
  .getElementById("btn-imbas-seterusnya-keputusan")!
  .addEventListener("click", () => tukarTab("imbas"));

function tukarSubTabAnalisis(mod: string) {
  window.modAnalisisSemasa = mod;
  ["individu", "kelas", "item"].forEach((m) => {
    let btn = document.getElementById("subnav-" + m);
    if (btn) {
      btn.classList.remove("bg-white", "text-apple-text", "shadow-sm");
      btn.classList.add("text-apple-textMuted");
    }
  });
  let activeBtn = document.getElementById("subnav-" + mod);
  if (activeBtn) {
    activeBtn.classList.remove("text-apple-textMuted");
    activeBtn.classList.add("bg-white", "text-apple-text", "shadow-sm");
  }
  paparAnalisisUI();
}

document
  .getElementById("subnav-individu")!
  .addEventListener("click", () => tukarSubTabAnalisis("individu"));
document
  .getElementById("subnav-kelas")!
  .addEventListener("click", () => tukarSubTabAnalisis("kelas"));
document
  .getElementById("subnav-item")!
  .addEventListener("click", () => tukarSubTabAnalisis("item"));

function paparAnalisisUI() {
  let container = document.getElementById("senarai-analisis")!;
  let dropdown = document.getElementById(
    "filter-kelas-dropdown",
  ) as HTMLSelectElement;
  let filterValue = dropdown ? dropdown.value : "Semua";

  let baseRecords = window.senaraiRekodKelas;
  if (window.currentPentaksiranId) {
    baseRecords = window.senaraiRekodKelas.filter(
      (r: any) => (r.pentaksiranId || "umum") === window.currentPentaksiranId,
    );
  }

  let kelass = [
    ...new Set(baseRecords.map((r: any) => r.kelas || "Kelas Umum")),
  ];
  if (dropdown) {
    let optionsHtml = `<option value="Semua">Semua Kelas</option>`;
    kelass.forEach((k) => {
      optionsHtml += `<option value="${k}" ${filterValue === k ? "selected" : ""}>${k}</option>`;
    });
    dropdown.innerHTML = optionsHtml;
  }

  let filteredRecords = baseRecords;
  if (filterValue !== "Semua") {
    filteredRecords = baseRecords.filter(
      (r: any) => (r.kelas || "Kelas Umum") === filterValue,
    );
  }

  document.getElementById("jumlah-rekod")!.innerText =
    filteredRecords.length.toString();

  if (filteredRecords.length === 0) {
    container.innerHTML =
      '<div class="text-center py-10 px-4 text-apple-textMuted font-medium"><svg class="w-12 h-12 mx-auto text-gray-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>Belum ada sebarang rekod imbasan.</div>';
    container.className =
      "apple-card bg-[#f1f1f2] border border-[#e5e5ea] rounded-[24px] overflow-hidden shadow-inner flex flex-col p-2 gap-2 min-h-[300px]";
    return;
  }

  if (window.modAnalisisSemasa === "individu") {
    container.className =
      "apple-card bg-[#f1f1f2] border border-[#e5e5ea] rounded-[24px] overflow-hidden shadow-inner flex flex-col p-2 gap-2 min-h-[300px]";
    container.innerHTML = filteredRecords
      .map(
        (rekod: any) => `
            <div class="flex flex-col bg-white p-2.5 rounded-[16px] shadow-sm border border-[#e5e5ea] hover:border-apple-blue hover:shadow-md transition-all relative">
                <div class="flex items-center justify-between">
                    <div onclick="window.bukaModalRekod('${rekod.id}')" class="flex-1 flex items-center cursor-pointer active:scale-[0.98] mr-2 overflow-hidden">
                        <div class="w-[68%] h-[60px] bg-white rounded-[8px] overflow-hidden flex flex-col items-center justify-center border border-gray-200 shrink-0 px-1 py-1 relative">
                            ${rekod.imejNama ? `<img src="${rekod.imejNama}" class="w-full ${rekod.namaDiramal ? "h-[70%]" : "h-full"} object-contain object-left scale-[1.10] origin-left" style="filter: grayscale(100%) contrast(180%) brightness(110%);" />` : '<span class="text-[10px] text-gray-400 font-medium my-auto">Tiada Imej</span>'}
                            ${rekod.namaDiramal ? `<div class="w-full text-center text-[9px] font-bold text-blue-700 bg-blue-50/80 truncate px-1 border-t border-blue-100">${rekod.namaDiramal}</div>` : ""}
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
                    <div class="text-[10px] bg-gray-100 text-gray-500 px-2.5 py-0.5 rounded-full inline-block font-medium w-max">Kelas: ${rekod.kelas || "Kelas Umum"}</div>
                    ${rekod.isAiVerified === true ? `<div class="text-[10px] bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 font-bold border border-blue-100"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>Disahkan AI</div>` : rekod.isAiVerified === "pending" ? `<div class="text-[10px] bg-orange-50 text-orange-600 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 font-bold border border-orange-100"><svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Disemak AI...</div>` : rekod.isAiVerified === "error" ? `<div class="text-[10px] bg-red-50 text-red-600 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 font-bold border border-red-100"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>Terdapat Ralat (AI)</div>` : ""}
                </div>
            </div>
        `,
      )
      .join("");
  } else if (window.modAnalisisSemasa === "kelas") {
    container.className =
      "apple-card bg-[#f1f1f2] border border-[#e5e5ea] rounded-[24px] overflow-hidden shadow-inner flex flex-col p-4 gap-4 min-h-[300px]";
    container.innerHTML = renderAnalisisKelasHtml(filteredRecords);
  } else if (window.modAnalisisSemasa === "item") {
    container.className =
      "apple-card bg-[#f1f1f2] border border-[#e5e5ea] rounded-[24px] overflow-hidden shadow-inner flex flex-col p-4 gap-2 min-h-[300px]";
    container.innerHTML = renderAnalisisItemHtml(filteredRecords);
  }
}
document
  .getElementById("filter-kelas-dropdown")!
  .addEventListener("change", paparAnalisisUI);

function renderAnalisisKelasHtml(records: any) {
  let totalMarkah = records
    .map((r: any) => r.markah)
    .sort((a: any, b: any) => a - b);
  let min = totalMarkah[0] || 0;
  let max = totalMarkah[totalMarkah.length - 1] || 0;
  let sum = totalMarkah.reduce((a: any, b: any) => a + b, 0);
  let avg =
    totalMarkah.length > 0 ? (sum / totalMarkah.length).toFixed(1) : "0";

  let median: any = 0;
  if (totalMarkah.length > 0) {
    let mid = Math.floor(totalMarkah.length / 2);
    median =
      totalMarkah.length % 2 !== 0
        ? totalMarkah[mid]
        : ((totalMarkah[mid - 1] + totalMarkah[mid]) / 2).toFixed(1);
  }

  let avgPeratus = ((parseFloat(avg) / window.JUMLAH_SOALAN) * 100).toFixed(1);
  let minPeratus = ((min / window.JUMLAH_SOALAN) * 100).toFixed(1);
  let maxPeratus = ((max / window.JUMLAH_SOALAN) * 100).toFixed(1);
  let medPeratus = ((parseFloat(median) / window.JUMLAH_SOALAN) * 100).toFixed(
    1,
  );

  let taburan: any = [
    { label: "90 - 100", min: 90, max: 100, count: 0 },
    { label: "80 - 89", min: 80, max: 89.999, count: 0 },
    { label: "70 - 79", min: 70, max: 79.999, count: 0 },
    { label: "65 - 69", min: 65, max: 69.999, count: 0 },
    { label: "60 - 64", min: 60, max: 64.999, count: 0 },
    { label: "55 - 59", min: 55, max: 59.999, count: 0 },
    { label: "50 - 54", min: 50, max: 54.999, count: 0 },
    { label: "45 - 49", min: 45, max: 49.999, count: 0 },
    { label: "40 - 44", min: 40, max: 44.999, count: 0 },
    { label: "0 - 39", min: 0, max: 39.999, count: 0 },
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
    let optionsCount: any = { A: 0, B: 0, C: 0, D: 0, BATAL: 0, KOSONG: 0 };

    records.forEach((r: any) => {
      let ansPelajar = r.butiran[i].jawapanPelajar;
      if (ansPelajar === ans) correctCount++;
      if (optionsCount[ansPelajar] !== undefined) optionsCount[ansPelajar]++;
      else optionsCount["KOSONG"]++;
    });

    let percentCorrect = ((correctCount / records.length) * 100).toFixed(1);

    let df: any = 0;
    if (records.length >= 2) {
      let topCorrect = topGroup.filter(
        (r) => r.butiran[i].jawapanPelajar === ans,
      ).length;
      let bottomCorrect = bottomGroup.filter(
        (r) => r.butiran[i].jawapanPelajar === ans,
      ).length;
      df = (topCorrect / groupSize - bottomCorrect / groupSize).toFixed(3);
    } else {
      df = "-";
    }

    let altAnswersStr = ["A", "B", "C", "D"]
      .map((opt) => {
        let pct = ((optionsCount[opt] / records.length) * 100).toFixed(0);
        if (parseFloat(pct) > 0)
          return `<span class="mr-2"><b>${opt}:</b>${pct}%</span>`;
        return "";
      })
      .join("");

    let batalPct = (
      ((optionsCount["BATAL"] + optionsCount["KOSONG"]) / records.length) *
      100
    ).toFixed(0);
    if (parseFloat(batalPct) > 0)
      altAnswersStr += `<span class="text-red-500"><b>Lain:</b>${batalPct}%</span>`;

    htmlTable += `
            <tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                <td class="p-2 border-r border-gray-100 text-center font-medium">${i + 1}</td>
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
        if (!document.execCommand("print", false, null)) {
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
  const revertBtn = startPrintLoading("btn-eksport-pdf", "Memuatkan...");
  let dropdown = document.getElementById(
    "filter-kelas-dropdown",
  ) as HTMLSelectElement;
  let filterValue = dropdown ? dropdown.value : "Semua";
  let filteredRecords = window.senaraiRekodKelas;
  if (filterValue !== "Semua") {
    filteredRecords = window.senaraiRekodKelas.filter(
      (r: any) => (r.kelas || "Kelas Umum") === filterValue,
    );
  }

  if (filteredRecords.length === 0) {
    paparAlert(
      "Tiada Data",
      "Sila imbas sekurang-kurangnya satu kertas sebelum mengeksport laporan PDF.",
    );
    return;
  }

  let container = document.getElementById("cetakan-analisis-container")!;

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
            <p class="text-xs font-medium text-gray-400 mt-2">Tarikh Jana: ${new Date().toLocaleDateString("ms-MY")}</p>
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

  let sortedIndividu = [...filteredRecords].sort((a, b) => b.markah - a.markah);

  sortedIndividu.forEach((rekod, index) => {
    tableIndividu += `
            <tr class="border-b border-gray-300 hover:bg-gray-50 transition-colors">
                <td class="p-2 border border-gray-300 text-center font-semibold text-gray-600">${index + 1}</td>
                <td class="p-2 border border-gray-300 bg-white">
                    ${rekod.imejNama ? `<div class="flex flex-col items-center justify-center gap-1"><img src="${rekod.imejNama}" class="h-8 sm:h-10 object-contain mx-auto sm:mx-0" style="filter: grayscale(100%) contrast(180%);" />${rekod.namaDiramal ? `<div class="text-[10px] font-bold text-blue-700 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-sm">${rekod.namaDiramal}</div>` : ""}</div>` : "-"}
                </td>
                <td class="p-2 border border-gray-300 text-center font-medium text-gray-600">${rekod.kelas || "Kelas Umum"}</td>
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

  if (filterValue === "Semua") {
    document.title = "Analisis Keseluruhan Cikgu Scan";
  } else {
    document.title = `Analisis Kelas ${filterValue} Cikgu Scan`;
  }

  document.body.classList.remove("mode-cetak-skema");
  updatePageOrientation("analisis");
  document.body.classList.add("mode-cetak-analisis");

  executePrint(revertBtn);
}
document
  .getElementById("btn-eksport-pdf")!
  .addEventListener("click", eksportPDF);

function janaBorangSkema() {
  const bekas = document.getElementById("borang-skema")!;
  bekas.innerHTML = "";
  for (let i = 0; i < window.JUMLAH_SOALAN; i++) {
    let divSoalan = document.createElement("div");
    divSoalan.className =
      "flex items-center justify-between bg-apple-bg/50 p-3.5 sm:p-4 rounded-[16px] hover:bg-apple-bg transition-colors";
    let htmlRadio = window.PILIHAN.map(
      (p) => `
            <label class="flex items-center justify-center w-8 h-8 relative cursor-pointer group">
                <input type="radio" name="soalan_${i}" value="${p}" class="peer sr-only" ${window.skemaJawapan[i] === p ? "checked" : ""} onchange="window.skemaJawapan[${i}] = '${p}'; setTimeout(() => janaBorangSkemaOMR(), 50);">
                <div class="w-8 h-8 rounded-full border-2 border-apple-border flex items-center justify-center peer-checked:bg-apple-blue peer-checked:border-apple-blue transition-all duration-200 group-hover:border-apple-blue/50">
                    <span class="text-sm font-medium text-apple-text peer-checked:text-white transition-colors">${p}</span>
                </div>
            </label>
        `,
    ).join("");
    divSoalan.innerHTML = `
            <div class="font-bold text-apple-text w-10 text-lg">${i + 1}.</div>
            <div class="flex space-x-2 sm:space-x-4">${htmlRadio}</div>
        `;
    bekas.appendChild(divSoalan);
  }
  setTimeout(() => janaBorangSkemaOMR(), 50);
}

// --- PENTAKSIRAN LOGIC ---
async function muatSenaraiPentaksiran() {
  if (window.currentUserId) {
    try {
      const q = query(
        collection(db, "users", window.currentUserId, "pentaksirans"),
      );
      const snapshot = await getDocs(q);
      window.pentaksiranList = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (e) {
      console.error("Gagal muat pentaksiran", e);
      window.pentaksiranList = [];
    }
  } else {
    window.pentaksiranList = JSON.parse(
      localStorage.getItem("cikguscan_pentaksirans_local") || "[]",
    );
  }

  // Pre-select first pentaksiran if none selected
  if (!window.currentPentaksiranId && window.pentaksiranList.length > 0) {
    window.currentPentaksiranId = window.pentaksiranList[0].id;
    window.JUMLAH_SOALAN = window.pentaksiranList[0].jumlahSoalan;
    window.skemaJawapan = [...window.pentaksiranList[0].skemaJawapan];
  }

  renderPentaksiranList();
  renderKelasList();
  renderAnalisisPentaksiranList();
  updateSelectPentaksiranDropdown();
}

function renderPentaksiranList() {
  const container = document.getElementById("pentaksiran-list-container");
  if (!container) return;

  if (window.pentaksiranList.length === 0) {
    container.innerHTML = `<div class="text-center text-apple-textMuted mt-10">Belum ada pentaksiran. Klik Tambah untuk bermula.</div>`;
    return;
  }

  container.innerHTML = window.pentaksiranList
    .map(
      (p) => `
    <div class="bg-white rounded-2xl p-4 sm:p-5 flex items-center justify-between shadow-sm border border-apple-border/50 hover:border-apple-border hover:shadow-md cursor-pointer transition-all pentaksiran-item" data-id="${p.id}">
      <div class="flex-1">
        <h3 class="font-bold text-apple-text text-lg">${p.nama}</h3>
        <p class="text-sm text-apple-textMuted">${p.jumlahSoalan} Soalan</p>
      </div>
      <div class="flex items-center space-x-2" onclick="event.stopPropagation()">
        <div class="flex items-center gap-1">
          <button class="w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-100 flex justify-center items-center transition-colors btn-trigger-delete-pentaksiran" title="Padam" data-id="${p.id}">
            <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
          <button class="hidden px-3 py-1 bg-red-500 text-white text-xs font-semibold rounded-full hover:bg-red-600 btn-confirm-delete-pentaksiran" data-id="${p.id}">Sah Padam</button>
          <button class="hidden w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 justify-center items-center btn-cancel-delete-pentaksiran" title="Batal">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      </div>
    </div>
  `,
    )
    .join("");

  document.querySelectorAll(".pentaksiran-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const id = item.getAttribute("data-id");
      openPentaksiranForm(id);
    });
  });

  document.querySelectorAll(".btn-trigger-delete-pentaksiran").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const parent = (e.target as HTMLElement).closest('.flex.items-center.gap-1')!;
      parent.querySelector('.btn-trigger-delete-pentaksiran')!.classList.add('hidden');
      parent.querySelector('.btn-trigger-delete-pentaksiran')!.classList.remove('flex');
      parent.querySelector('.btn-confirm-delete-pentaksiran')!.classList.remove('hidden');
      parent.querySelector('.btn-confirm-delete-pentaksiran')!.classList.add('block');
      parent.querySelector('.btn-cancel-delete-pentaksiran')!.classList.remove('hidden');
      parent.querySelector('.btn-cancel-delete-pentaksiran')!.classList.add('flex');
    });
  });

  document.querySelectorAll(".btn-cancel-delete-pentaksiran").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const parent = (e.target as HTMLElement).closest('.flex.items-center.gap-1')!;
      parent.querySelector('.btn-trigger-delete-pentaksiran')!.classList.remove('hidden');
      parent.querySelector('.btn-trigger-delete-pentaksiran')!.classList.add('flex');
      parent.querySelector('.btn-confirm-delete-pentaksiran')!.classList.add('hidden');
      parent.querySelector('.btn-confirm-delete-pentaksiran')!.classList.remove('block');
      parent.querySelector('.btn-cancel-delete-pentaksiran')!.classList.add('hidden');
      parent.querySelector('.btn-cancel-delete-pentaksiran')!.classList.remove('flex');
    });
  });

  document.querySelectorAll(".btn-confirm-delete-pentaksiran").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = btn.getAttribute("data-id");
      if (id) {
          hapusPentaksiran(id, true);
      }
    });
  });
}

function renderKelasList() {
  const container = document.getElementById("kelas-list-container");
  if (!container) return;

  let listStr = localStorage.getItem("cikguscan_senarai_kelas_" + window.currentUser) || "[]";
  let senaraiKelas = JSON.parse(listStr);

  if (senaraiKelas.length === 0) {
    container.innerHTML = `<div class="text-center text-apple-textMuted mt-10 mb-10">Belum ada kelas ditambah. Klik Tambah Kelas untuk bermula.</div>`;
    return;
  }

  container.innerHTML = senaraiKelas
    .map(
      (k: string, index: number) => `
    <div class="bg-white rounded-2xl p-4 sm:p-5 flex items-center justify-between shadow-sm border border-apple-border/50 transition-all kelas-item">
      <div class="flex-1">
        <h3 class="font-bold text-apple-text text-lg">${k}</h3>
      </div>
      <div class="flex items-center space-x-2" onclick="event.stopPropagation()">
        <div class="flex items-center gap-1">
          <button class="w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-100 flex justify-center items-center transition-colors btn-trigger-delete-kelas" title="Padam" data-index="${index}">
            <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
          <button class="hidden px-3 py-1 bg-red-500 text-white text-xs font-semibold rounded-full hover:bg-red-600 btn-confirm-delete-kelas" data-index="${index}">Sah Padam</button>
          <button class="hidden w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 justify-center items-center btn-cancel-delete-kelas" title="Batal">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      </div>
    </div>
  `,
    )
    .join("");

  document.querySelectorAll(".btn-trigger-delete-kelas").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const parent = (e.target as HTMLElement).closest('.flex.items-center.gap-1')!;
      parent.querySelector('.btn-trigger-delete-kelas')!.classList.add('hidden');
      parent.querySelector('.btn-trigger-delete-kelas')!.classList.remove('flex');
      parent.querySelector('.btn-confirm-delete-kelas')!.classList.remove('hidden');
      parent.querySelector('.btn-confirm-delete-kelas')!.classList.add('block');
      parent.querySelector('.btn-cancel-delete-kelas')!.classList.remove('hidden');
      parent.querySelector('.btn-cancel-delete-kelas')!.classList.add('flex');
    });
  });

  document.querySelectorAll(".btn-cancel-delete-kelas").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const parent = (e.target as HTMLElement).closest('.flex.items-center.gap-1')!;
      parent.querySelector('.btn-trigger-delete-kelas')!.classList.remove('hidden');
      parent.querySelector('.btn-trigger-delete-kelas')!.classList.add('flex');
      parent.querySelector('.btn-confirm-delete-kelas')!.classList.add('hidden');
      parent.querySelector('.btn-confirm-delete-kelas')!.classList.remove('block');
      parent.querySelector('.btn-cancel-delete-kelas')!.classList.add('hidden');
      parent.querySelector('.btn-cancel-delete-kelas')!.classList.remove('flex');
    });
  });

  document.querySelectorAll(".btn-confirm-delete-kelas").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = parseInt(btn.getAttribute("data-index") || "-1");
      if (index > -1) {
          let listStr = localStorage.getItem("cikguscan_senarai_kelas_" + window.currentUser) || "[]";
          let senaraiKelas = JSON.parse(listStr);
          senaraiKelas.splice(index, 1);
          localStorage.setItem("cikguscan_senarai_kelas_" + window.currentUser, JSON.stringify(senaraiKelas));
          if (window.currentUserId) {
              updateDoc(doc(db, "users", window.currentUserId), { senaraiKelas }).catch((e) => console.error("Failed to delete senarai kelas", e));
          }
          renderKelasList();
          muatSenaraiKelasLokal();
      }
    });
  });
}

function hapusPentaksiran(id: string, bypassConfirm: boolean = false) {
  const proceedDelete = async () => {
    if (window.currentUserId) {
      try {
        await deleteDoc(doc(db, "users", window.currentUserId, "pentaksirans", id));
      } catch (err) {
        paparAlert("Ralat", "Gagal memadam dari pangkalan data awan.");
      }
    }
    
    window.pentaksiranList = window.pentaksiranList.filter(p => p.id !== id);
    
    if (!window.currentUserId) {
      localStorage.setItem("cikguscan_pentaksirans_local", JSON.stringify(window.pentaksiranList));
    }
    
    if (window.currentPentaksiranId === id) {
      window.currentPentaksiranId = null;
      if (window.pentaksiranList.length > 0) {
        window.currentPentaksiranId = window.pentaksiranList[0].id;
        window.JUMLAH_SOALAN = window.pentaksiranList[0].jumlahSoalan;
        window.skemaJawapan = [...window.pentaksiranList[0].skemaJawapan];
      }
    }
    
    renderPentaksiranList();
    renderAnalisisPentaksiranList();
    updateSelectPentaksiranDropdown();
  };

  if (bypassConfirm) {
    proceedDelete();
  } else {
    paparConfirm("Padam Pentaksiran", "Adakah Cikgu pasti mahu memadam pentaksiran ini? Semua rekod yang berkaitan juga mungkin terjejas.", proceedDelete);
  }
}

function renderAnalisisPentaksiranList() {
  const container = document.getElementById("analisis-pentaksiran-list");
  if (!container) return;

  if (window.pentaksiranList.length === 0) {
    container.innerHTML = `<div class="text-center text-apple-textMuted mt-10">Belum ada pentaksiran.</div>`;
    return;
  }

  container.innerHTML = window.pentaksiranList
    .map(
      (p) => `
    <div class="bg-white rounded-2xl p-4 sm:p-5 flex items-center justify-between shadow-sm border border-apple-border/50 hover:border-apple-border hover:shadow-md cursor-pointer transition-all analisis-pentaksiran-item" data-id="${p.id}">
      <div>
        <h3 class="font-bold text-apple-text text-lg">${p.nama}</h3>
        <p class="text-sm text-apple-textMuted">${p.jumlahSoalan} Soalan</p>
      </div>
      <div class="bg-apple-blue/10 text-apple-blue p-2 rounded-full">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
      </div>
    </div>
  `,
    )
    .join("");

  document.querySelectorAll(".analisis-pentaksiran-item").forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.getAttribute("data-id");
      openAnalisisDetails(id);
    });
  });
}

function updateSelectPentaksiranDropdown() {
  const select = document.getElementById(
    "select-pentaksiran",
  ) as HTMLSelectElement;
  if (!select) return;

  select.innerHTML =
    window.pentaksiranList
      .map((p) => `<option value="${p.id}">${p.nama}</option>`)
      .join("") || `<option value="">Pilih Pentaksiran...</option>`;

  if (window.currentPentaksiranId) {
    select.value = window.currentPentaksiranId;
  }

  select.addEventListener("change", (e) => {
    const id = (e.target as HTMLSelectElement).value;
    window.currentPentaksiranId = id;
    window.telahSahkanImbasan = false;
    const p = window.pentaksiranList.find((x) => x.id === id);
    if (p) {
      window.JUMLAH_SOALAN = p.jumlahSoalan;
      window.skemaJawapan = [...p.skemaJawapan];
      // Muat semula rekod untuk pentaksiran ini dalam analisis?
      muatRekodLokal(); // Assume we filter later if needed, right now let's just refresh.
      
      let tabImbas = document.getElementById("tab-imbas")!;
      if (!tabImbas.classList.contains("hidden")) {
        hentikanKamera();
        setTimeout(() => mulakanKamera(), 100);
      }
    }
  });
}

function openPentaksiranForm(id: string | null = null) {
  document.getElementById("pentaksiran-list-view")?.classList.add("hidden");
  const formView = document.getElementById("pentaksiran-form-view");
  formView?.classList.remove("hidden");

  const title = document.getElementById("pentaksiran-form-title")!;
  const inputNama = document.getElementById(
    "input-nama-pentaksiran",
  ) as HTMLInputElement;
  const tetapanContainer = document.getElementById(
    "tetapan-penskoran-container",
  )!;

  tetapanContainer.classList.add("hidden"); // Collapse by default

  window.editingPentaksiranId = id;

  let btnPrintSkema = document.getElementById("btn-print-skema");

  if (id) {
    const p = window.pentaksiranList.find((x) => x.id === id);
    if (p) {
      title.innerText = "Edit Pentaksiran";
      inputNama.value = p.nama;
      window.JUMLAH_SOALAN = p.jumlahSoalan;
      window.skemaJawapan = [...p.skemaJawapan];

      const inputJumlah = document.getElementById(
        "input-jumlah-soalan",
      ) as HTMLInputElement;
      if (inputJumlah) inputJumlah.value = p.jumlahSoalan.toString();
      
      if (btnPrintSkema) btnPrintSkema.classList.remove("hidden");
    }
  } else {
    title.innerText = "Tambah Pentaksiran";
    inputNama.value = "";
    window.JUMLAH_SOALAN = 40;
    window.skemaJawapan = Array(40).fill(null);
    const inputJumlah = document.getElementById(
      "input-jumlah-soalan",
    ) as HTMLInputElement;
    if (inputJumlah) inputJumlah.value = "40";
    
    if (btnPrintSkema) btnPrintSkema.classList.add("hidden");
  }

  janaBorangSkema();
}

function updateSelectPentaksiranDropdownSync() {
  const select = document.getElementById(
    "select-pentaksiran",
  ) as HTMLSelectElement;
  if (select && window.currentPentaksiranId) {
    select.value = window.currentPentaksiranId;
  }
}

function openAnalisisDetails(id: string | null) {
  document.getElementById("analisis-list-view")?.classList.add("hidden");
  document.getElementById("analisis-details-view")?.classList.remove("hidden");
  document.getElementById("analisis-details-view")?.classList.add("flex");

  if (id) {
    const p = window.pentaksiranList.find((x) => x.id === id);
    if (p) {
      document.getElementById("analisis-details-title")!.innerText = p.nama;
      window.currentPentaksiranId = id;
      window.JUMLAH_SOALAN = p.jumlahSoalan;
      window.skemaJawapan = [...p.skemaJawapan];
      updateSelectPentaksiranDropdownSync();
      paparAnalisisUI();
    }
  }
}

document
  .getElementById("btn-tambah-pentaksiran")
  ?.addEventListener("click", () => openPentaksiranForm(null));

function muatSenaraiKelasLokal() {
  let listStr = localStorage.getItem("cikguscan_senarai_kelas_" + window.currentUser) || "[]";
  let senaraiKelas = JSON.parse(listStr);
  let selectEl = document.getElementById("input-nama-kelas") as HTMLSelectElement;
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="Kelas Umum">Kelas Umum</option>';
  senaraiKelas.forEach((k: string) => {
    let opt = document.createElement("option");
    opt.value = k;
    opt.innerText = k;
    selectEl.appendChild(opt);
  });
}

document
  .getElementById("btn-tambah-kelas")
  ?.addEventListener("click", () => {
    let inputEl = document.getElementById("input-tambah-kelas-nama") as HTMLInputElement;
    if (inputEl) inputEl.value = "";
    document.getElementById("modal-tambah-kelas")!.classList.remove("hidden");
    document.getElementById("modal-tambah-kelas")!.classList.add("flex");
    setTimeout(() => { if (inputEl) inputEl.focus(); }, 100);
  });

document.getElementById("btn-batal-tambah-kelas")?.addEventListener("click", () => {
    document.getElementById("modal-tambah-kelas")!.classList.remove("flex");
    document.getElementById("modal-tambah-kelas")!.classList.add("hidden");
});

document.getElementById("btn-simpan-tambah-kelas")?.addEventListener("click", () => {
    let inputEl = document.getElementById("input-tambah-kelas-nama") as HTMLInputElement;
    if (!inputEl) return;
    let namaKelas = inputEl.value;
    
    if (namaKelas && namaKelas.trim() !== "") {
      let k = namaKelas.trim();
      let listStr = localStorage.getItem("cikguscan_senarai_kelas_" + window.currentUser) || "[]";
      let senaraiKelas = JSON.parse(listStr);
      if (!senaraiKelas.includes(k) && k !== "Kelas Umum") {
        senaraiKelas.push(k);
        localStorage.setItem("cikguscan_senarai_kelas_" + window.currentUser, JSON.stringify(senaraiKelas));
        if (window.currentUserId) {
            updateDoc(doc(db, "users", window.currentUserId), { senaraiKelas }).catch((e) => console.error("Failed to update senarai kelas", e));
        }
        
        document.getElementById("modal-tambah-kelas")!.classList.remove("flex");
        document.getElementById("modal-tambah-kelas")!.classList.add("hidden");
        
        paparAlert("Berjaya", "Kelas berjaya ditambah!");
        muatSenaraiKelasLokal(); // Reload dropdown
        renderKelasList(); // Refresh list view
      } else {
        paparAlert("Perhatian", "Kelas sudah wujud atau nama tidak dibenarkan.");
      }
    }
});

document
  .getElementById("btn-back-pentaksiran")
  ?.addEventListener("click", () => {
    document.getElementById("pentaksiran-form-view")?.classList.add("hidden");
    document
      .getElementById("pentaksiran-list-view")
      ?.classList.remove("hidden");
  });
document.getElementById("btn-back-analisis")?.addEventListener("click", () => {
  document.getElementById("analisis-details-view")?.classList.remove("flex");
  document.getElementById("analisis-details-view")?.classList.add("hidden");
  document.getElementById("analisis-list-view")?.classList.remove("hidden");
});
document
  .getElementById("btn-show-tetapan-penskoran")
  ?.addEventListener("click", () => {
    document
      .getElementById("tetapan-penskoran-container")
      ?.classList.toggle("hidden");
  });

// Original simpanSkema code starts below
async function simpanSkema() {
  const inputNama = document.getElementById(
    "input-nama-pentaksiran",
  ) as HTMLInputElement;
  const namaPentaksiran = inputNama
    ? inputNama.value.trim()
    : "Pentaksiran Umum";

  if (!namaPentaksiran) {
    paparAlert("Nama Diperlukan", "Sila masukkan nama pentaksiran.");
    return;
  }

  if (window.skemaJawapan.includes(null)) {
    paparAlert(
      "Skema Belum Lengkap",
      "Cikgu, ada soalan yang belum disetkan jawapannya.",
    );
    return;
  }

  let btn = document.getElementById("btn-simpan-skema") as HTMLButtonElement;
  let textAsal = btn.innerText;
  btn.innerText = "Menyimpan...";
  btn.disabled = true;

  try {
    const data = {
      nama: namaPentaksiran,
      jumlahSoalan: window.JUMLAH_SOALAN,
      skemaJawapan: window.skemaJawapan,
      updatedAt: serverTimestamp(),
    };

    if (window.currentUserId) {
      if (window.editingPentaksiranId) {
        await updateDoc(
          doc(
            db,
            "users",
            window.currentUserId,
            "pentaksirans",
            window.editingPentaksiranId,
          ),
          data,
        );
      } else {
        const docRef = doc(
          collection(db, "users", window.currentUserId, "pentaksirans"),
        );
        data["createdAt"] = serverTimestamp();
        await setDoc(docRef, data);
        window.editingPentaksiranId = docRef.id;
      }
    } else {
      // Local storage fallback for "local" user
      let locals = JSON.parse(
        localStorage.getItem("cikguscan_pentaksirans_local") || "[]",
      );
      if (window.editingPentaksiranId) {
        let index = locals.findIndex(
          (p: any) => p.id === window.editingPentaksiranId,
        );
        if (index > -1) locals[index] = { ...locals[index], ...data };
      } else {
        const newId = "local_" + Date.now();
        locals.push({
          id: newId,
          ...data,
          createdAt: new Date().toISOString(),
        });
        window.editingPentaksiranId = newId;
      }
      localStorage.setItem(
        "cikguscan_pentaksirans_local",
        JSON.stringify(locals),
      );
    }

    // Refresh lists
    await muatSenaraiPentaksiran();

    btn.innerText = "Tersimpan! ✓";
    btn.classList.replace("bg-apple-blue", "bg-green-500");
    let btnPrintSkema = document.getElementById("btn-print-skema");
    if (btnPrintSkema) btnPrintSkema.classList.remove("hidden");
    
    setTimeout(() => {
      btn.innerText = textAsal;
      btn.classList.replace("bg-green-500", "bg-apple-blue");
      btn.disabled = false;
    }, 1500);
  } catch (error) {
    console.error("Error saving pentaksiran:", error);
    paparAlert("Ralat", "Gagal menyimpan pentaksiran. Sila cuba lagi.");
    btn.innerText = textAsal;
    btn.disabled = false;
  }
}
document.getElementById("btn-simpan-skema")?.addEventListener("click", simpanSkema);

function cetakSkema() {
  const revertBtn = startPrintLoading("btn-print-skema", "Memuatkan...");
  document.title = "CikguScan OMR Skema";

  document.body.classList.remove("mode-cetak-analisis");
  updatePageOrientation("omr");
  janaBorangSkemaOMR();
  document.body.classList.add("mode-cetak-skema");

  executePrint(revertBtn);
}
document.getElementById("btn-print-skema")?.addEventListener("click", cetakSkema);

function cetakBorangOMR() {
  const revertBtn = startPrintLoading("btn-cetak-borang-omr", "Memuatkan...");
  document.title = `CikguScan OMR ${window.JUMLAH_SOALAN} soalan`;

  document.body.classList.remove("mode-cetak-analisis", "mode-cetak-skema");
  updatePageOrientation("omr");

  executePrint(revertBtn);
}
document.getElementById("btn-cetak-borang-omr")?.addEventListener("click", cetakBorangOMR);

function janaBorangSkemaOMR() {
  const bekas = document.getElementById("cetakan-skema-omr-container");
  if (!bekas) return;
  bekas.innerHTML = "";
  bekas.style.height = "auto";
  bekas.className = "w-full mx-auto mt-8 flex justify-center print:mt-0 print:block";
  let divSet = document.createElement("div");
  if (window.JUMLAH_SOALAN <= 10) {
    divSet.className =
      "bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[320px] w-full mx-auto";
    divSet.innerHTML = getFormHTMLTemplate10(window.skemaJawapan, true);
  } else if (window.JUMLAH_SOALAN <= 20) {
    divSet.className =
      "bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[320px] w-full mx-auto";
    divSet.innerHTML = getFormHTMLTemplate20(window.skemaJawapan, true);
  } else if (window.JUMLAH_SOALAN <= 30) {
    divSet.className =
      "bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[480px] w-full mx-auto";
    divSet.innerHTML = getFormHTMLTemplate30(window.skemaJawapan, true);
  } else {
    divSet.className =
      "bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[480px] w-full mx-auto";
    divSet.innerHTML = getFormHTMLTemplate40(window.skemaJawapan, true);
  }
  bekas.appendChild(divSet);
}

function janaBorangCetak() {
  const bekas = document.getElementById("cetakan-kertas-container")!;
  const labelOrientasi = document.getElementById("label-orientasi")!;
  let textDesc = document.querySelector(
    "#tab-cetak p.text-sm.text-apple-textMuted",
  );
  bekas.innerHTML = "";
  updatePageOrientation("omr");

  let colCount = window.JUMLAH_SOALAN <= 20 ? 4 : 2;
  if (window.JUMLAH_SOALAN <= 20) {
    labelOrientasi.innerText = "A4 Portrait (4 Borang / Kertas)";
    if (textDesc)
      textDesc.innerHTML = `<span class="text-xs block opacity-80">(Dicetak 4 borang serentak pada kertas A4 Portrait)</span>`;
    bekas.className =
      "grid grid-cols-2 gap-y-12 gap-x-8 print:gap-y-16 print:gap-x-12 w-full px-4 print:px-8";
  } else {
    labelOrientasi.innerText = "A4 Landscape (2 Borang / Kertas)";
    if (textDesc)
      textDesc.innerHTML = `<span class="text-xs block opacity-80">(Dicetak sebelah-menyebelah pada kertas A4)</span>`;
    bekas.className = "grid grid-cols-2 gap-16 print:gap-24 w-full px-8";
  }
  bekas.style.height = "auto";

  for (let s = 0; s < colCount; s++) {
    let divSet = document.createElement("div");
    divSet.className = `bg-white flex flex-col justify-start print:border-none break-inside-avoid max-w-[${window.JUMLAH_SOALAN <= 20 ? "320" : "480"}px] mx-auto w-full`;
    if (window.JUMLAH_SOALAN <= 10)
      divSet.innerHTML = getFormHTMLTemplate10(null);
    else if (window.JUMLAH_SOALAN <= 20)
      divSet.innerHTML = getFormHTMLTemplate20(null);
    else if (window.JUMLAH_SOALAN <= 30)
      divSet.innerHTML = getFormHTMLTemplate30(null);
    else divSet.innerHTML = getFormHTMLTemplate40(null);
    bekas.appendChild(divSet);
  }
}

function updatePageOrientation(mode = "omr") {
  let styleTag = document.getElementById("dynamic-print-style");
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "dynamic-print-style";
    document.head.appendChild(styleTag);
  }
  if (mode === "analisis") {
    styleTag.innerHTML =
      "@media print { @page { size: A4 portrait; margin: 15mm; } }";
  } else if (window.JUMLAH_SOALAN <= 20) {
    styleTag.innerHTML =
      "@media print { @page { size: A4 portrait; margin: 15mm; } }";
  } else {
    styleTag.innerHTML =
      "@media print { @page { size: A4 landscape; margin: 15mm; } }";
  }
}

// Empty
