/* ==========================================================================
    User Details & Admin Control Logic (user.js) - Clean Address & Extra Info Fix
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

    // ৬. পেজ লোডের সময় নেটওয়ার্ক স্ট্যাটাস চেক
    updateNetworkStatusIndicator(navigator.onLine);
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

        if (supabaseClient) {
            const { data, error } = await supabaseClient.from('users').select('*');
            if (!error && data) {
                allUsers = data;
            }
        }

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

    const nameElem = document.getElementById("userNameDisplay") || document.getElementById("displayUserName");
    if (nameElem) {
        nameElem.innerText = user.fullName || user.userName || user.name || user.username || "User " + currentUserId;
        nameElem.style.color = "#ffffff";
        nameElem.style.textShadow = "0 2px 4px rgba(0,0,0,0.5)";
    }

    const idElem = document.getElementById("userIdDisplay") || document.getElementById("displayUserId");
    if (idElem) {
        idElem.innerText = user.userId || user.nidNumber || user.id || currentUserId;
        idElem.style.fontSize = "22px";
        idElem.style.padding = "4px 12px";
        idElem.style.letterSpacing = "1.2px";
        idElem.style.color = "#ffffff";
        idElem.style.fontWeight = "800";
    }

    const deleteAccBtn = document.getElementById("deleteAccountBtn");
    if (deleteAccBtn) {
        deleteAccBtn.style.background = "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)";
        deleteAccBtn.style.color = "#ffffff";
        deleteAccBtn.style.border = "none";
        deleteAccBtn.style.fontWeight = "700";
        deleteAccBtn.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.4)";

        const parentCard = deleteAccBtn.closest('.p-4, .card, div');
        if (parentCard) {
            parentCard.style.background = "linear-gradient(135deg, #1f1b24 0%, #111827 100%)";
            parentCard.style.border = "1px solid #7f1d1d";
        }
    }

    const statusElem = document.getElementById("statusSelect") || document.getElementById("userStatusSelect");
    if (statusElem && document.activeElement !== statusElem) {
        statusElem.value = (user.status || "active").toLowerCase();
    }

    const nidVal = user.nidNumber || user.nid || user.nidNo || user.nationalId || user.nid_number || "N/A";
    const emailVal = user.email || user.userEmail || user.mail || user.emailAddress || "N/A";
    const phoneVal = user.phoneNumber || user.phone || user.mobile || user.contact || user.phone_number || "N/A";
    const genderVal = user.gender || user.sex || "N/A";
    const dobVal = user.dob || user.dateOfBirth || user.birthDate || user.birthday || user.date_of_birth || "N/A";
    const bloodVal = user.bloodGroup || user.blood || user.bg || user.blood_group || "N/A";
    
    // প্রেজেন্ট এবং পার্মানেন্ট অ্যাড্রেস আলাদাভাবে ফেচ করা
    const presentAddr = user.presentAddress || user.address || user.location || user.city || "N/A";
    const permanentAddr = user.permanentAddress || user.perAddress || user.permanent_address || presentAddr;

    if (document.getElementById("infoNid")) document.getElementById("infoNid").innerText = nidVal;
    if (document.getElementById("infoEmail")) document.getElementById("infoEmail").innerText = emailVal;
    if (document.getElementById("infoPhone")) document.getElementById("infoPhone").innerText = phoneVal;
    if (document.getElementById("infoGender")) document.getElementById("infoGender").innerText = genderVal;
    if (document.getElementById("infoDob")) document.getElementById("infoDob").innerText = dobVal;
    if (document.getElementById("infoBlood")) document.getElementById("infoBlood").innerText = bloodVal;
    
    // প্রেজেন্ট ও পার্মানেন্ট অ্যাড্রেসের জন্য আলাদা এলিমেন্ট আপডেট
    if (document.getElementById("infoPresentAddress")) {
        document.getElementById("infoPresentAddress").innerText = presentAddr;
    }
    if (document.getElementById("infoPermanentAddress")) {
        document.getElementById("infoPermanentAddress").innerText = permanentAddr;
    }
    
    const singleAddressElem = document.getElementById("infoAddress");
    if (singleAddressElem && !document.getElementById("infoPresentAddress")) {
        singleAddressElem.innerHTML = `
            <div style="margin-bottom: 6px;"><strong style="color: #94a3b8; font-size: 12px; display: block; letter-spacing: 0.5px;">PRESENT ADDRESS</strong><span style="color: #ffffff; font-size: 15px;">${presentAddr}</span></div>
            <div><strong style="color: #94a3b8; font-size: 12px; display: block; letter-spacing: 0.5px; margin-top: 8px;">PERMANENT ADDRESS</strong><span style="color: #ffffff; font-size: 15px;">${permanentAddr}</span></div>
        `;
    }

    let displayPass = user.plainPassword || user.rawPassword || user.password || user.pass || user.userPassword || "";
    const passInput = document.getElementById("currentPasswordInput");
    if (passInput && document.activeElement !== passInput) {
        passInput.value = displayPass;
    }

    const vaultContainer = document.getElementById("userVaultContainer") || 
                           document.getElementById("vaultCardsGrid") || 
                           document.getElementById("vaultRecordsContainer") ||
                           document.querySelector(".vault-records-section");
                           
    if (!vaultContainer) return;

    vaultContainer.innerHTML = "";
    let records = user.vaultRecords || user.vaultData || [];

    if (!records || records.length === 0) {
        vaultContainer.innerHTML = `<div class="col-12 text-light text-center py-4 fs-5">No saved vault records found for this user.</div>`;
    } else {
        records.forEach((item) => {
            const category = item.category || item.type || 'BANKING & FINANCIAL';
            const platform = item.platform || item.service || item.accountType || item.title || item.siteName || 'Pubali Bank';
            const holder = item.holderName || item.holder || item.accountHolder || '';
            const username = item.identifier || item.username || item.email || item.phone || item.user || 'N/A';
            const pass = item.secret || item.password || item.pin || item.pass || '••••••••';
            
            const extra = item.extraDetail || item.extra || item.extraField || item.additional || item.branch || item.cvv || item.extraInfo || item.subInfo || item.accNo || item.accountNumber || item.routingNumber || item.extra_info || '';
            const notes = item.notes || item.securityNotes || '';

            const card = document.createElement("div");
            card.className = "col-md-4 col-sm-6 mb-4";

            card.innerHTML = `
                <div class="p-4 rounded shadow-lg h-100" style="background: #111827 !important; border: 1px solid #374151 !important; color: #ffffff;">
                    <div style="font-size: 12px; font-weight: 700; color: #38bdf8; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">${category}</div>
                    <div class="d-flex align-items-center mb-3">
                        <i class="fa-solid fa-shield-halved text-info fa-lg me-2"></i>
                        <h5 class="text-white fw-bold m-0" style="font-size: 17px;">${platform}</h5>
                    </div>
                    ${holder ? `<p class="mb-2 text-light" style="font-size: 14px;"><strong>Holder:</strong> <span style="color: #e2e8f0;">${holder}</span></p>` : ''}
                    <p class="mb-2 text-light" style="font-size: 14px;"><strong>Identifier:</strong> <span style="color: #f1f5f9; font-weight: 500;">${username}</span></p>
                    ${extra ? `<p class="mb-2 text-light" style="font-size: 14px;"><strong>Extra:</strong> <span style="color: #38bdf8; font-weight: 600; background: #1e293b; padding: 2px 8px; border-radius: 4px; border: 1px solid #334155;">${extra}</span></p>` : ''}
                    
                    <!-- এখানে justify-content-between সরিয়ে স্বাভাবিক করা হয়েছে যাতে পাসওয়ার্ড ও পিন কাছাকাছি দেখায় -->
                    <p class="mb-2 text-light" style="font-size: 14px;">
                        <strong>Password/PIN:</strong> 
                        <span style="font-family: monospace; background: #1f2937; padding: 3px 10px; border-radius: 4px; color: #fbbf24; font-weight: bold; border: 1px solid #4b5563; margin-left: 8px;">${pass}</span>
                    </p>

                    ${notes ? `<p class="mb-0 text-light pt-2 mt-2" style="font-size: 13.5px; border-top: 1px dashed #374151;"><strong>Notes:</strong> <span style="color: #9ca3af;">${notes}</span></p>` : ''}
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
    const inputElem = document.getElementById("newPasswordInput") || document.getElementById("setNewPasswordInput");
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
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                updateNetworkStatusIndicator(true);
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                updateNetworkStatusIndicator(false);
            }
        });
}

/* ==========================================================================
    Custom Flash Popup & Live Sync Indicator
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

window.addEventListener('online', () => { updateNetworkStatusIndicator(true); });
window.addEventListener('offline', () => { updateNetworkStatusIndicator(false); });

function updateNetworkStatusIndicator(isOnline) {
    let indicator = document.getElementById('liveSyncIndicator') || document.querySelector('.live-sync-badge');
    
    if (indicator) {
        if (isOnline && navigator.onLine) {
            indicator.className = "live-sync-badge online";
            indicator.innerHTML = `
                <div class="live-sync-dots">
                    <span class="dot dot-1"></span>
                    <span class="dot dot-2"></span>
                    <span class="dot dot-3"></span>
                </div>
                <span class="sync-text">Live Sync Active</span>
            `;
        } else {
            indicator.className = "live-sync-badge offline";
            indicator.innerHTML = `
                <div class="live-sync-dots">
                    <span class="dot dot-1"></span>
                    <span class="dot dot-2"></span>
                    <span class="dot dot-3"></span>
                </div>
                <span class="sync-text">Slow / Disconnected</span>
            `;
        }
    }
}

setInterval(() => {
    updateNetworkStatusIndicator(navigator.onLine);
}, 2000);