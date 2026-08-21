/* ==========================================================================
    User Details & Admin Control Logic (user.js) - Vault Grid Fix
    ========================================================================== */

// Supabase Configuration
const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv";

let supabaseClient = null;
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const API_BASE_URL = '/api';
let currentUserId = null;
let userData = null;
let realtimeSubscription = null;

// DOM লোড হলে URL থেকে User ID সংগ্রহ করে প্রসেস শুরু করা
document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    currentUserId = urlParams.get('id') || urlParams.get('userId');

    if (!currentUserId) {
        showFlashPopup("No User ID found!", "error");
        setTimeout(() => { window.location.href = "admin.html"; }, 1500);
        return;
    }

    injectNotificationStyles();

    // ১. প্রাথমিক ডাটা ফেচ করা
    loadUserDetails();

    // ২. ইভেন্ট লিসেনার যুক্ত করা
    setupEventListeners();

    // ৩. Supabase রিয়েল-টাইম লাইভ আপডেটের জন্য কানেকশন সেটআপ
    initSupabaseRealtime();

    // ৪. লোকাল স্টোরেজ লাইভ সিঙ্ক লিসেনার
    window.addEventListener('storage', () => {
        loadUserDetails();
    });

    // ৫. ব্যাকগ্রাউন্ডে নিয়মিত সিঙ্ক চেক
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            loadUserDetails(true);
        }
    }, 2000);
});

/* ==========================================================================
   Setup Event Listeners
   ========================================================================== */
function setupEventListeners() {
    const statusElem = document.getElementById("statusSelect") || document.getElementById("userStatusSelect");
    if (statusElem) {
        statusElem.addEventListener("change", updateUserStatus);
    }

    const updatePassBtn = document.getElementById("updatePasswordBtn");
    if (updatePassBtn) {
        updatePassBtn.addEventListener("click", updatePassword);
    }

    const deleteAccBtn = document.getElementById("deleteAccountBtn");
    if (deleteAccBtn) {
        deleteAccBtn.addEventListener("click", deleteAccount);
    }
}

/* ==========================================================================
   Load User Information & Vault Records
   ========================================================================== */
async function loadUserDetails(isSilent = false) {
    try {
        let allUsers = [];

        // ১. Supabase থেকে ইউজার আনা
        if (supabaseClient) {
            const { data, error } = await supabaseClient.from('users').select('*');
            if (!error && data) {
                allUsers = data;
            }
        }

        // ২. LocalStorage চেক করা
        if (allUsers.length === 0) {
            const localDataKeys = ['app_users_db', 'users', 'admin_users', 'all_users', 'registered_users', 'registeredUsers', 'safePassUser'];
            for (let key of localDataKeys) {
                const raw = localStorage.getItem(key);
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) {
                            allUsers = allUsers.concat(parsed);
                        } else if (parsed && typeof parsed === 'object') {
                            allUsers.push(parsed);
                        }
                    } catch (e) {}
                }
            }
        }

        const targetCleanId = String(currentUserId).trim();
        
        // ইউজার ম্যাচ করা
        userData = allUsers.find(u => {
            const uId = String(u.userId || u.id || '').trim();
            const uNid = String(u.nidNumber || u.nid || '').trim();
            const uPhone = String(u.phoneNumber || u.phone || '').trim();
            return uId === targetCleanId || uNid === targetCleanId || uPhone === targetCleanId;
        });

        if (!userData) {
            userData = {
                userId: targetCleanId,
                fullName: "User " + targetCleanId,
                email: "N/A",
                phoneNumber: "N/A",
                status: "active"
            };
        }

        // ৩. LocalStorage এবং Supabase থেকে সব সম্ভাব্য ভল্ট ডেটা সংগ্রহ করা
        let rawVaultData = [];

        const localVaultKeys = [
            'vault_records', 'user_vaults', 'vaults', 'saved_vaults', 
            'vault_data', 'passwords', 'user_vault_records', 'vaultList', 
            'credentials', 'vault', 'my_vault', 'vaultData'
        ];

        for (let vk of localVaultKeys) {
            const vRaw = localStorage.getItem(vk);
            if (vRaw) {
                try {
                    const vParsed = JSON.parse(vRaw);
                    if (Array.isArray(vParsed)) {
                        vParsed.forEach(lv => {
                            rawVaultData.push(lv);
                        });
                    } else if (vParsed && typeof vParsed === 'object') {
                        rawVaultData.push(vParsed);
                    }
                } catch(e) {}
            }
        }

        // Supabase থেকে ভল্ট টেবিল চেক করা
        if (supabaseClient) {
            const possibleTableNames = ['credentials', 'vault', 'vaults', 'vault_records', 'user_vaults'];
            for (let tName of possibleTableNames) {
                try {
                    const { data: vData, error } = await supabaseClient.from(tName).select('*');
                    if (!error && vData && vData.length > 0) {
                        vData.forEach(item => {
                            const itemUid = String(item.userId || item.user_id || item.uid || item.ownerId || '').trim();
                            if (itemUid === targetCleanId || !itemUid) {
                                rawVaultData.push(item);
                            }
                        });
                    }
                } catch (e) {}
            }
        }

        // ডুপ্লিকেট দূর করার জন্য ইউনিক ফিল্টার (Unique Filter by ID, platform & identifier)
        const uniqueVaultMap = new Map();
        rawVaultData.forEach(item => {
            const uniqueKey = item.id || `${item.platform || item.service || 'p'}_${item.identifier || item.username || item.email || 'u'}_${item.password || item.secret || 's'}`;
            if (!uniqueVaultMap.has(uniqueKey)) {
                uniqueVaultMap.set(uniqueKey, item);
            }
        });

        userData.vaultRecords = Array.from(uniqueVaultMap.values());

        renderUserInfo(userData);

    } catch (err) {
        console.error("Error in loadUserDetails:", err);
        if (!isSilent) {
            userData = { userId: currentUserId, fullName: "User Profile", vaultRecords: [] };
            renderUserInfo(userData);
        }
    }
}

/* ==========================================================================
   Render User Information to UI
   ========================================================================== */
function renderUserInfo(user) {
    if (!user) return;

    // Display Name & User ID
    const nameElem = document.getElementById("userNameDisplay") || document.getElementById("displayUserName");
    if (nameElem) nameElem.innerText = user.fullName || user.userName || user.name || user.username || "User " + currentUserId;

    const idElem = document.getElementById("userIdDisplay") || document.getElementById("displayUserId");
    if (idElem) idElem.innerText = user.userId || user.nidNumber || user.id || currentUserId;

    // Status Dropdown
    const statusElem = document.getElementById("statusSelect") || document.getElementById("userStatusSelect");
    if (statusElem && document.activeElement !== statusElem) {
        statusElem.value = (user.status || "active").toLowerCase();
    }

    // Personal Info Fields
    const nidVal = user.nidNumber || user.nid || user.nidNo || user.nationalId || user.nid_number || "N/A";
    const emailVal = user.email || user.userEmail || user.mail || user.emailAddress || "N/A";
    const phoneVal = user.phoneNumber || user.phone || user.mobile || user.contact || user.phone_number || "N/A";
    const genderVal = user.gender || user.sex || "N/A";
    const dobVal = user.dob || user.dateOfBirth || user.birthDate || user.birthday || user.date_of_birth || "N/A";
    const bloodVal = user.bloodGroup || user.blood || user.bg || user.blood_group || "N/A";
    const addressVal = user.address || user.presentAddress || user.fullAddress || user.location || user.city || user.permanentAddress || "N/A";

    if (document.getElementById("infoNid")) document.getElementById("infoNid").innerText = nidVal;
    if (document.getElementById("infoEmail")) document.getElementById("infoEmail").innerText = emailVal;
    if (document.getElementById("infoPhone")) document.getElementById("infoPhone").innerText = phoneVal;
    if (document.getElementById("infoGender")) document.getElementById("infoGender").innerText = genderVal;
    if (document.getElementById("infoDob")) document.getElementById("infoDob").innerText = dobVal;
    if (document.getElementById("infoBlood")) document.getElementById("infoBlood").innerText = bloodVal;
    if (document.getElementById("infoAddress")) document.getElementById("infoAddress").innerText = addressVal;

    // Password Display
    let displayPass = user.plainPassword || user.rawPassword || user.password || user.pass || user.userPassword || "";
    const passInput = document.getElementById("currentPasswordInput");
    if (passInput && document.activeElement !== passInput) {
        passInput.value = displayPass;
    }

    // Vault Items Render
    const vaultContainer = document.getElementById("userVaultContainer") || 
                           document.getElementById("vaultCardsGrid") || 
                           document.getElementById("vaultRecordsContainer") ||
                           document.querySelector(".vault-records-section");
                           
    if (!vaultContainer) {
        console.error("❌ Vault Container element not found in HTML!");
        return;
    }

    vaultContainer.innerHTML = "";
    let records = user.vaultRecords || user.vaultData || [];

    if (!records || records.length === 0) {
        vaultContainer.innerHTML = `<div class="col-12 text-muted text-center py-3">No saved vault records found for this user.</div>`;
    } else {
        records.forEach((item) => {
            const category = item.category || item.type || 'SOCIAL MEDIA';
            const platform = item.platform || item.service || item.accountType || item.title || item.siteName || 'Platform';
            const holder = item.holderName || item.holder || item.accountHolder || '';
            const username = item.identifier || item.username || item.email || item.phone || item.user || 'N/A';
            const pass = item.secret || item.password || item.pin || item.pass || '••••••••';
            const notes = item.notes || item.securityNotes || '';

            const card = document.createElement("div");
            card.className = "col-md-4 col-sm-6 mb-3";

            card.innerHTML = `
                <div class="p-3 border border-secondary rounded text-light shadow-sm h-100" style="background-color: #1e293b !important;">
                    <div style="font-size: 11px; font-weight: bold; color: #3b82f6; text-transform: uppercase; margin-bottom: 5px;">${category}</div>
                    <div class="d-flex align-items-center mb-2">
                        <i class="fa-solid fa-shield-halved text-info me-2"></i>
                        <h6 class="text-info fw-bold m-0">${platform}</h6>
                    </div>
                    ${holder ? `<p class="mb-1 small text-muted"><strong>Holder:</strong> ${holder}</p>` : ''}
                    <p class="mb-1 text-truncate" style="color: #f8fafc;"><strong>Identifier:</strong> ${username}</p>
                    <p class="mb-1 small" style="color: #cbd5e1;"><strong>Password/PIN:</strong> <span style="font-family: monospace; background: rgba(15, 23, 42, 0.8); padding: 2px 6px; border-radius: 4px; color: #f59e0b;">${pass}</span></p>
                    ${notes ? `<p class="mb-0 text-muted small mt-2 border-top border-secondary pt-1"><strong>Notes:</strong> ${notes}</p>` : ''}
                </div>
            `;
            vaultContainer.appendChild(card);
        });
    }
}

/* ==========================================================================
   Update User Status
   ========================================================================== */
async function updateUserStatus() {
    const statusElem = document.getElementById("statusSelect") || document.getElementById("userStatusSelect");
    if (!statusElem) return;

    const newStatus = statusElem.value;
    try {
        if (supabaseClient) {
            await supabaseClient
                .from('users')
                .update({ status: newStatus })
                .or(`userId.eq.${currentUserId},id.eq.${currentUserId},nidNumber.eq.${currentUserId}`);
        }

        await fetch(`${API_BASE_URL}/admin/update-user/${currentUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        showFlashPopup(`Status successfully updated to '${newStatus.toUpperCase()}'!`, "success");
    } catch (e) {
        console.error(e);
        showFlashPopup("Failed to update status!", "error");
    }
}

/* ==========================================================================
   Update User Password
   ========================================================================== */
async function updatePassword() {
    const inputElem = document.getElementById("newPasswordInput");
    if (!inputElem) return;

    const newPass = inputElem.value.trim();
    if (!newPass) {
        showFlashPopup("Please enter a new password!", "error");
        return;
    }

    try {
        if (supabaseClient) {
            await supabaseClient
                .from('users')
                .update({ password: newPass, plainPassword: newPass })
                .or(`userId.eq.${currentUserId},id.eq.${currentUserId},nidNumber.eq.${currentUserId}`);
        }

        await fetch(`${API_BASE_URL}/admin/update-user/${currentUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: newPass })
        });
        
        showFlashPopup("Password updated successfully!", "success");
        if (document.getElementById("currentPasswordInput")) {
            document.getElementById("currentPasswordInput").value = newPass;
        }
        inputElem.value = "";
    } catch (e) {
        console.error(e);
        showFlashPopup("Failed to update password!", "error");
    }
}

/* ==========================================================================
   Delete Account Permanently
   ========================================================================== */
async function deleteAccount() {
    if (confirm("Are you sure you want to permanently delete this user account?")) {
        try {
            if (supabaseClient) {
                await supabaseClient
                    .from('users')
                    .delete()
                    .or(`userId.eq.${currentUserId},id.eq.${currentUserId},nidNumber.eq.${currentUserId}`);
            }

            await fetch(`${API_BASE_URL}/admin/delete-user/${currentUserId}`, {
                method: 'DELETE'
            });
            
            showFlashPopup("Account deleted successfully!", "success");
            setTimeout(() => { window.location.href = "admin.html"; }, 1500);
        } catch (e) {
            console.error(e);
            showFlashPopup("Failed to delete account!", "error");
        }
    }
}

/* ==========================================================================
   Supabase Real-Time Live Sync Integration
   ========================================================================== */
function initSupabaseRealtime() {
    if (!supabaseClient) return;

    realtimeSubscription = supabaseClient
        .channel('public:user_details_sync_all')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'users' },
            (payload) => {
                if (payload.eventType === 'DELETE') {
                    const deletedId = payload.old.id || payload.old.userId || payload.old.nidNumber;
                    if (String(deletedId) === String(currentUserId)) {
                        showFlashPopup("This user account has been deleted!", "error");
                        setTimeout(() => { window.location.href = "admin.html"; }, 1500);
                        return;
                    }
                }
            }
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'credentials' }, () => { loadUserDetails(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vault' }, () => { loadUserDetails(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vaults' }, () => { loadUserDetails(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vault_records' }, () => { loadUserDetails(); })
        .subscribe();
}

/* ==========================================================================
   Custom Flash Popup Notification System
   ========================================================================== */
function injectNotificationStyles() {
    if (document.getElementById('flashPopupStyles')) return;
    const style = document.createElement('style');
    style.id = 'flashPopupStyles';
    style.innerHTML = `
        @keyframes flashGlow {
            0% { transform: scale(0.95); opacity: 0; box-shadow: 0 0 0 rgba(0,0,0,0); }
            50% { transform: scale(1.03); opacity: 1; box-shadow: 0 0 25px rgba(59, 130, 246, 0.6); }
            100% { transform: scale(1); opacity: 1; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
        }
        .flash-popup-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center;
            z-index: 99999; backdrop-filter: blur(3px);
        }
        .flash-popup-box {
            background: #ffffff; padding: 25px 35px; border-radius: 12px; text-align: center;
            max-width: 400px; width: 90%; animation: flashGlow 0.4s ease-out forwards;
            font-family: inherit; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        .flash-popup-icon { font-size: 45px; margin-bottom: 15px; }
        .flash-popup-icon.success { color: #10b981; }
        .flash-popup-icon.error { color: #ef4444; }
        .flash-popup-message { font-size: 16px; color: #1e293b; font-weight: 600; margin-bottom: 20px; line-height: 1.5; }
        .flash-popup-btn {
            background: #2563eb; color: #ffffff; border: none; padding: 10px 24px;
            border-radius: 6px; font-weight: 600; cursor: pointer; transition: background 0.2s;
        }
        .flash-popup-btn:hover { background: #1d4ed8; }
    `;
    document.head.appendChild(style);
}

function showFlashPopup(message, type = 'success') {
    const existing = document.getElementById('customFlashPopup');
    if (existing) existing.remove();

    const iconClass = type === 'success' 
        ? 'fa-solid fa-circle-check flash-popup-icon success' 
        : 'fa-solid fa-circle-exclamation flash-popup-icon error';

    const overlay = document.createElement('div');
    overlay.id = 'customFlashPopup';
    overlay.className = 'flash-popup-overlay';
    overlay.innerHTML = `
        <div class="flash-popup-box">
            <div class="${iconClass}"></div>
            <div class="flash-popup-message">${message}</div>
            <button class="flash-popup-btn" onclick="document.getElementById('customFlashPopup').remove()">OK</button>
        </div>
    `;
    document.body.appendChild(overlay);
}