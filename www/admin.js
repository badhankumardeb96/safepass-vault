/* ==========================================================================
    Admin Panel Management Script (Supabase Realtime + Client API) - Live Sync
    ========================================================================== */

// Supabase Configuration
const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv";

let supabaseClient = null;
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let usersData = [];
let currentFilter = 'all'; // Default Filter
let selectedUserIdForModal = null;
let selectedUserIdForDelete = null; // ডিলিট করার জন্য ইউজার আইডি সংরক্ষণের ভেরিয়েবল
let realtimeSubscription = null;

// Initialize Dashboard and Setup Event Listeners on DOM Load
document.addEventListener("DOMContentLoaded", () => {
    checkAdminSession();
    fetchAdminProfileName(); 
    fetchData(); 
    initSupabaseRealtime(); 
    setupEventListeners();
    injectNotificationStyles(); // ফ্ল্যাশিং এবং পপআপ স্টাইল যুক্ত করার জন্য
});

// Strict Admin Session & Role Guard
function checkAdminSession() {
    if (localStorage.getItem('isAdminLoggedIn') !== 'true') {
        window.location.href = 'admin-login.html';
        return;
    }

    try {
        const adminUserObj = JSON.parse(localStorage.getItem('adminUser') || localStorage.getItem('safePassAdmin') || '{}');
        const roleVal = String(adminUserObj.role || adminUserObj.userType || adminUserObj.type || localStorage.getItem('adminRole') || '').toLowerCase().trim();
        
        if (roleVal && roleVal !== 'admin' && roleVal !== 'superadmin' && roleVal !== 'super_admin' && roleVal !== 'administrator') {
            alert("Access Denied! You are a registered user, not an admin. Regular users cannot access the Admin Panel.");
            localStorage.clear();
            window.location.href = 'admin-login.html';
        }
    } catch (e) {
        console.error("Session check error:", e);
    }
}

async function fetchAdminProfileName() {
    const adminNameDisplay = document.getElementById("displayAdminName") || document.getElementById("superUserName") || document.getElementById("adminNameDisplay");
    
    let storedAdminName = localStorage.getItem('adminName');
    
    if (!storedAdminName) {
        try {
            const adminUserObj = JSON.parse(localStorage.getItem('adminUser') || localStorage.getItem('safePassAdmin') || '{}');
            storedAdminName = adminUserObj.fullName || adminUserObj.userName || adminUserObj.name;
        } catch (e) {}
    }

    if (adminNameDisplay && storedAdminName) {
        adminNameDisplay.innerText = storedAdminName;
    }

    try {
        if (!supabaseClient) return;

        const loggedInEmail = localStorage.getItem('adminEmail') || '';
        const loggedInPhone = localStorage.getItem('adminPhone') || '';

        if (!loggedInEmail && !loggedInPhone) return;

        const { data, error } = await supabaseClient
            .from('users')
            .select('*')
            .or(`email.eq.${loggedInEmail},phoneNumber.eq.${loggedInPhone},phone.eq.${loggedInPhone}`)
            .maybeSingle();

        if (!error && data) {
            const dbRole = String(data.role || data.userType || '').toLowerCase().trim();
            if (dbRole && dbRole !== 'admin' && dbRole !== 'superadmin' && dbRole !== 'super_admin' && dbRole !== 'administrator') {
                alert("Access Denied! You are a registered user, not an admin. Regular users cannot access the Admin Panel.");
                localStorage.clear();
                window.location.href = 'admin-login.html';
                return;
            }

            const realFullName = data.fullName || data.userName || data.name;
            if (realFullName) {
                if (adminNameDisplay) adminNameDisplay.innerText = realFullName;
                localStorage.setItem('adminName', realFullName);
            }
        }
    } catch (err) {
        console.error("Could not fetch exact admin profile name:", err);
    }
}

function setupEventListeners() {
    const searchInput = document.getElementById("adminSearchInput");
    if (searchInput) {
        searchInput.addEventListener("input", filterAndRenderTables);
    }

    const confirmStatusBtn = document.getElementById("confirmStatusBtn");
    if (confirmStatusBtn) {
        confirmStatusBtn.addEventListener("click", saveUserStatusFromModal);
    }
}

function initSupabaseRealtime() {
    if (!supabaseClient) return;

    realtimeSubscription = supabaseClient
        .channel('public:users_admin_realtime')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'users' },
            (payload) => {
                if (payload.eventType === 'INSERT') {
                    const newUser = payload.new;
                    const index = usersData.findIndex(u => String(u.userId || u.id) === String(newUser.userId || newUser.id));
                    if (index === -1) usersData.unshift(newUser);
                } else if (payload.eventType === 'UPDATE') {
                    const updatedUser = payload.new;
                    const index = usersData.findIndex(u => String(u.userId || u.id) === String(updatedUser.userId || updatedUser.id));
                    if (index !== -1) {
                        usersData[index] = { ...usersData[index], ...updatedUser };
                    } else {
                        usersData.unshift(updatedUser);
                    }
                } else if (payload.eventType === 'DELETE') {
                    const deletedId = payload.old.id || payload.old.userId;
                    usersData = usersData.filter(u => String(u.userId || u.id) !== String(deletedId));
                }
                refreshDashboardUI();
            }
        )
        .subscribe();
}

async function fetchData() {
    const adminTableBody = document.getElementById("adminTableBody");
    const userTableBody = document.getElementById("userTableBody");
    
    const loadingHtml = `<tr><td colspan="6" style="text-align:center; padding: 20px;">
        <i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px;"></i>Loading real data...
    </td></tr>`;

    if (adminTableBody && usersData.length === 0) adminTableBody.innerHTML = loadingHtml;
    if (userTableBody && usersData.length === 0) userTableBody.innerHTML = loadingHtml;

    try {
        if (!supabaseClient) throw new Error("Supabase SDK is not initialized.");

        const { data, error } = await supabaseClient.from('users').select('*');
        if (error) throw error;

        usersData = data || [];
        refreshDashboardUI();
    } catch (error) {
        console.error("Data Loading Error:", error);
    }
}

function refreshDashboardUI() {
    updateDashboardStats(usersData);
    filterAndRenderTables();
}

function filterUserType(filterType) {
    currentFilter = filterType;
    filterAndRenderTables();
}

function isUserAdmin(u) {
    const roleVal = String(u.role || u.userType || u.type || u.accountType || '').toLowerCase().trim();
    return (
        roleVal === 'admin' || 
        roleVal === 'superadmin' || 
        roleVal === 'super_admin' || 
        roleVal === 'administrator' || 
        u.isAdmin === true || 
        u.is_admin === true
    );
}

function filterAndRenderTables() {
    let filtered = [...usersData];

    if (currentFilter === 'active') {
        filtered = filtered.filter(u => (u.status || 'active').toLowerCase() === 'active');
    } else if (currentFilter === 'disabled') {
        filtered = filtered.filter(u => ['disabled', 'suspended'].includes((u.status || '').toLowerCase()));
    }

    const searchInput = document.getElementById("adminSearchInput");
    if (searchInput) {
        const query = searchInput.value.toLowerCase().trim();
        if (query) {
            filtered = filtered.filter(user => {
                const name = (user.fullName || user.userName || user.name || '').toLowerCase();
                const email = (user.email || '').toLowerCase();
                const phone = (user.phoneNumber || user.phone || '').toLowerCase();
                const userId = String(user.userId || user.id || '').toLowerCase();
                return name.includes(query) || email.includes(query) || phone.includes(query) || userId.includes(query);
            });
        }
    }

    const admins = filtered.filter(u => isUserAdmin(u));
    const regularUsers = filtered.filter(u => !isUserAdmin(u));

    renderTable("adminTableBody", "noAdminsMessage", admins, true);
    renderTable("userTableBody", "noUsersMessage", regularUsers, false);
}

function renderTable(tableBodyId, noMsgId, data, isAdminTable = false) {
    const tableBody = document.getElementById(tableBodyId);
    const noUsersMsg = document.getElementById(noMsgId);
    if (!tableBody) return;

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: #64748b;">No records found.</td></tr>`;
        if (noUsersMsg) noUsersMsg.style.display = "block";
        return;
    }

    if (noUsersMsg) noUsersMsg.style.display = "none";

    let rowsHtml = "";

    data.forEach((user) => {
        const activeUserId = String(user.userId || user.id || "N/A");
        const userName = user.fullName || user.userName || user.name || "N/A";
        const email = user.email || "";
        const phone = user.phoneNumber || user.phone || "";

        let emailPhoneDisplay = "";
        if (email) emailPhoneDisplay += `<div>${email}</div>`;
        if (phone) emailPhoneDisplay += `<div style="color:#64748b; font-size:12px;">${phone}</div>`;
        if (!email && !phone) emailPhoneDisplay = "N/A";

        let displayPassword = user.plainPassword || user.password || "••••••••";
        const status = (user.status || "active").toLowerCase();
        const isSuspended = status === 'disabled' || status === 'suspended';

        const statusBadge = isSuspended
            ? `<span style="background:rgba(239, 68, 68, 0.1); color:#ef4444; padding:4px 8px; border-radius:4px; font-weight:bold; font-size:12px;">${status.toUpperCase()}</span>`
            : `<span style="background:rgba(34, 197, 94, 0.1); color:#22c55e; padding:4px 8px; border-radius:4px; font-weight:bold; font-size:12px;">ACTIVE</span>`;

        rowsHtml += `
            <tr>
                <td><a href="user.html?id=${activeUserId}" style="color:#2563eb; font-weight:bold; text-decoration:none;">${activeUserId}</a></td>
                <td><a href="user.html?id=${activeUserId}" style="color:#1e293b; font-weight:600; text-decoration:none;">${userName}</a></td>
                <td>${emailPhoneDisplay}</td>
                <td>
                    <div class="pass-container" style="display:flex; align-items:center; gap:8px;">
                        <span class="pass-text" id="pass-${activeUserId}">••••••••</span>
                        <i class="fa-solid fa-eye toggle-pass" style="cursor:pointer; color:#64748b;" onclick="togglePasswordVisibility('${activeUserId}', '${escapeQuotes(displayPassword)}')"></i>
                    </div>
                </td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn-sm" style="background:#3b82f6; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer;" onclick="openStatusModal('${activeUserId}', '${status}')" title="Change Status">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    
                    ${isAdminTable 
                      ? `<button class="btn-sm" style="background:#f59e0b; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; margin-left: 4px;" onclick="removeAdmin('${activeUserId}')" title="Demote Admin">Demote</button>` 
                      : `<button class="btn-sm" style="background:#10b981; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; margin-left: 4px;" onclick="makeUserAdmin('${activeUserId}')" title="Make Admin">Make Admin</button>`
                    }

                    <button class="btn-sm" style="background:#ef4444; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; margin-left: 4px;" onclick="deleteUserAccount('${activeUserId}', '${escapeQuotes(userName)}')" title="Delete Account Permanently">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = rowsHtml;
}

function updateDashboardStats(data) {
    if (!Array.isArray(data)) return;

    const totalUsers = data.length; 
    const activeUsers = data.filter(u => (u.status || 'active').toLowerCase() === 'active').length;
    const disabledUsers = data.filter(u => ['disabled', 'suspended'].includes((u.status || '').toLowerCase())).length;

    const totalElem = document.getElementById("statTotalUsers");
    const activeElem = document.getElementById("statActiveUsers");
    const disabledElem = document.getElementById("statDisabledUsers");

    if (totalElem) totalElem.innerText = totalUsers;
    if (activeElem) activeElem.innerText = activeUsers;
    if (disabledElem) disabledElem.innerText = disabledUsers;

    setupCardClickEvents(totalElem, 'all');
    setupCardClickEvents(activeElem, 'active');
    setupCardClickEvents(disabledElem, 'disabled');
}

function setupCardClickEvents(element, filterType) {
    if (!element) return;
    const card = element.closest('.stat-card') || element.parentElement;
    if (card) {
        card.style.cursor = 'pointer';
        card.onclick = () => filterUserType(filterType);
    }
}

function escapeQuotes(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function togglePasswordVisibility(docId, realPassword) {
    const elem = document.getElementById(`pass-${docId}`);
    if (!elem) return;
    const icon = elem.nextElementSibling;

    if (elem.innerText === '••••••••') {
        elem.innerText = realPassword;
        if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
    } else {
        elem.innerText = '••••••••';
        if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
    }
}

function openStatusModal(userId, currentStatus) {
    selectedUserIdForModal = userId;
    selectedUserIdForDelete = null;
    
    const modal = document.getElementById('statusModal');
    const select = document.getElementById('modalStatusSelect');
    const statusSelectGroup = document.querySelector('.modal-form-group');
    const titleElem = document.getElementById('modalUserTitle');
    const subtitleElem = document.getElementById('modalUserSubtitle');
    const confirmBtn = document.getElementById('confirmStatusBtn');
    const warningIcon = document.querySelector('.warning-icon-wrapper i');

    if (statusSelectGroup) statusSelectGroup.style.display = 'block';
    if (titleElem) titleElem.innerText = "Update User Access Status";
    if (subtitleElem) subtitleElem.innerText = "Are you sure you want to change this user's status?";
    if (warningIcon) warningIcon.className = "fa-solid fa-triangle-exclamation flashing-warning-icon";
    if (confirmBtn) {
        confirmBtn.innerText = "Save Changes";
        confirmBtn.style.background = ""; 
        confirmBtn.onclick = saveUserStatusFromModal; 
    }

    if (select) select.value = currentStatus || 'active';
    if (modal) modal.style.display = 'flex';
}

function closeStatusModal() {
    selectedUserIdForModal = null;
    selectedUserIdForDelete = null;
    
    const modal = document.getElementById('statusModal');
    if (modal) modal.style.display = 'none';

    setTimeout(() => {
        const statusSelectGroup = document.querySelector('.modal-form-group');
        const confirmBtn = document.getElementById('confirmStatusBtn');
        const titleElem = document.getElementById('modalUserTitle');
        const subtitleElem = document.getElementById('modalUserSubtitle');

        if (statusSelectGroup) statusSelectGroup.style.display = 'block';
        if (titleElem) titleElem.innerText = "Update User Access Status";
        if (subtitleElem) subtitleElem.innerText = "Are you sure you want to change this user's status?";
        if (confirmBtn) {
            confirmBtn.innerText = "Save Changes";
            confirmBtn.style.background = "";
            confirmBtn.onclick = saveUserStatusFromModal;
        }
    }, 200);
}

async function saveUserStatusFromModal() {
    if (!selectedUserIdForModal) return;
    const newStatus = document.getElementById('modalStatusSelect').value;

    try {
        if (!supabaseClient) throw new Error("Supabase Client missing");
        const { error } = await supabaseClient
            .from('users')
            .update({ status: newStatus })
            .or(`userId.eq.${selectedUserIdForModal},id.eq.${selectedUserIdForModal}`);

        if (error) throw error;
        showFlashPopup(`Status successfully updated to '${newStatus.toUpperCase()}'!`, 'success');
        closeStatusModal();
        fetchData(); 
    } catch (error) {
        showFlashPopup("Failed to update status: " + error.message, 'error');
    }
}

async function makeUserAdmin(userId) {
    const { error } = await supabaseClient
        .from('users')
        .update({ role: 'admin' }) 
        .or(`userId.eq.${userId},id.eq.${userId}`);

    if (!error) {
        showFlashPopup('User successfully promoted to Admin!', 'success');
        fetchData(); 
    } else {
        showFlashPopup("Failed to promote user: " + error.message, 'error');
    }
}

async function removeAdmin(userId) {
    const { error } = await supabaseClient
        .from('users')
        .update({ role: 'user' }) 
        .or(`userId.eq.${userId},id.eq.${userId}`);

    if (!error) {
        showFlashPopup('Admin successfully demoted to Normal User!', 'success');
        fetchData(); 
    } else {
        showFlashPopup("Failed to remove admin: " + error.message, 'error');
    }
}

/* ==========================================================================
    Permanent Delete Account Function (প্রফেশনাল ফ্ল্যাশিং ওয়ার্নিং আইকনসহ ডিলিট মডাল)
    ========================================================================== */
function deleteUserAccount(userId, userName) {
    selectedUserIdForDelete = userId;
    selectedUserIdForModal = null; 
    
    const titleElem = document.getElementById('modalUserTitle');
    const subtitleElem = document.getElementById('modalUserSubtitle');
    const confirmBtn = document.getElementById('confirmStatusBtn');
    const statusSelectGroup = document.querySelector('.modal-form-group');
    const warningIcon = document.querySelector('.warning-icon-wrapper i');

    if (titleElem) titleElem.innerText = "Delete Account Permanently";
    if (subtitleElem) {
        subtitleElem.innerHTML = `Are you sure you want to <b>PERMANENTLY</b> delete the account for "<span style="color:#ef4444;">${userName}</span>" (ID: ${userId})? This action cannot be undone and they will have to create a new account to log in again.`;
    }

    // ওয়ার্নিং আইকনটিতে নিশ্চিত ফ্ল্যাশিং ইফেক্ট নিশ্চিত করা
    if (warningIcon) {
        warningIcon.className = "fa-solid fa-triangle-exclamation flashing-warning-icon";
    }

    // স্ট্যাটাস সিলেক্ট ড্রপডাউন হাইড রাখা
    if (statusSelectGroup) statusSelectGroup.style.display = 'none';

    // বাটন ডিজাইন প্রফেশনাল ডিলিট স্টাইলে রূপান্তর
    if (confirmBtn) {
        confirmBtn.innerText = "Yes, Delete";
        confirmBtn.style.background = "#ef4444";
        confirmBtn.onclick = executePermanentDelete; 
    }

    const modal = document.getElementById('statusModal');
    if (modal) modal.style.display = 'flex';
}

async function executePermanentDelete() {
    if (!selectedUserIdForDelete) return;

    try {
        if (!supabaseClient) throw new Error("Supabase Client missing");

        const { error } = await supabaseClient
            .from('users')
            .delete()
            .or(`userId.eq.${selectedUserIdForDelete},id.eq.${selectedUserIdForDelete}`);

        if (error) throw error;

        showFlashPopup("User account successfully deleted permanently!", 'success');
        closeStatusModal();
        fetchData(); 
    } catch (error) {
        console.error("Error deleting user account:", error);
        showFlashPopup("Failed to delete account: " + error.message, 'error');
    }
}

async function logoutAdmin() {
    if (supabaseClient) {
        await supabaseClient.auth.signOut();
    }
    localStorage.clear();
    window.location.href = 'admin-login.html';
}

/* ==========================================================================
    Custom Flash Popup Notification System with Icons & Flashing CSS
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
        @keyframes iconFlashPulse {
            0% { opacity: 1; transform: scale(1); color: #f59e0b; text-shadow: 0 0 0 rgba(245, 158, 11, 0); }
            50% { opacity: 0.4; transform: scale(1.12); color: #ef4444; text-shadow: 0 0 15px rgba(239, 68, 68, 0.8); }
            100% { opacity: 1; transform: scale(1); color: #f59e0b; text-shadow: 0 0 0 rgba(245, 158, 11, 0); }
        }
        .flashing-warning-icon {
            animation: iconFlashPulse 1.2s infinite ease-in-out !important;
            font-size: 45px;
            color: #f59e0b;
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
        .flash-popup-icon {
            font-size: 45px; margin-bottom: 15px;
        }
        .flash-popup-icon.success { color: #10b981; }
        .flash-popup-icon.error { color: #ef4444; }
        .flash-popup-message {
            font-size: 16px; color: #1e293b; font-weight: 600; margin-bottom: 20px; line-height: 1.5;
        }
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

    const iconClass = type === 'success' ? 'fa-solid fa-circle-check flash-popup-icon success' : 'fa-solid fa-circle-exclamation flash-popup-icon error';

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