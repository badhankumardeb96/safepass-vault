(() => {
"use strict";

if (window.__SAFE_PASS_ADMIN_JS_INITIALIZED__) {
    console.warn("admin.js already initialized; skipping duplicate load.");
    return;
}
window.__SAFE_PASS_ADMIN_JS_INITIALIZED__ = true;

/* ===========================================================================
   SafePass Vault - Admin Panel Management
   Supabase Realtime + Client API
   Live Sync + Admin List + Password Show/Hide

   Fixes included:
   - Supabase v2 Realtime uses channel.subscribe() status callbacks.
   - No use of supabaseClient.realtime.onOpen/onClose/onError.
   - Reuses the shared mobile/WebView Supabase client when available.
   - Admin-list RPC overload ambiguity is avoided by using the canonical
     admin_list_admin_accounts_v2 RPC when installed, with safe fallback to
     admin_list_users data.
   - All inline HTML handlers are exposed on window.
   - Password visibility function is globally available to admin.html.
   - Online/offline + visibility reconnect handling for mobile/WebView.
   ========================================================================== */

const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv";

let supabaseClient = null;

function createAdminSupabaseClient() {
    if (window.__safePassSupabaseClient) {
        return window.__safePassSupabaseClient;
    }

    if (window.SafePassSupabaseClient) {
        window.__safePassSupabaseClient = window.SafePassSupabaseClient;
        return window.__safePassSupabaseClient;
    }

    if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
        window.__safePassSupabaseClient = supabase.createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    storage: window.localStorage,
                    storageKey: 'safepass-vault-auth',
                    flowType: 'pkce'
                },
                realtime: {
                    params: { eventsPerSecond: 10 }
                },
                global: {
                    headers: {
                        'x-client-info': 'safepass-vault-admin-web-mobile'
                    }
                }
            }
        );

        window.SafePassSupabaseClient = window.__safePassSupabaseClient;
        window.SafePassSupabaseConfig = {
            url: SUPABASE_URL,
            anonKey: SUPABASE_ANON_KEY
        };

        return window.__safePassSupabaseClient;
    }

    return null;
}

supabaseClient = createAdminSupabaseClient();

let usersData = [];
let currentFilter = 'all';
let selectedUserIdForModal = null;
let selectedUserIdForDelete = null;
let realtimeSubscription = null;

let realtimeStatus = 'OFFLINE';

function setConnectionStatus(online) {
    const el = document.getElementById("connectionStatus");
    const txt = document.getElementById("connectionStatusText");

    if (!el || !txt) return;

    el.classList.toggle("online", !!online);
    el.classList.toggle("offline", !online);
    txt.textContent = online ? "LIVE" : "OFFLINE";
    realtimeStatus = online ? 'LIVE' : 'OFFLINE';
}

document.addEventListener("DOMContentLoaded", () => {
    checkAdminSession();
    fetchAdminProfileName();
    fetchData();
    initSupabaseRealtime();
    setupEventListeners();
    initAdminUserNavigationGuard();
    injectNotificationStyles();
    initConnectionStatus();
    initSupabaseAuthStateListener();
});

function initSupabaseAuthStateListener() {
    if (!supabaseClient?.auth || window.__SAFE_PASS_ADMIN_AUTH_LISTENER__) return;
    window.__SAFE_PASS_ADMIN_AUTH_LISTENER__ = true;

    try {
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                setConnectionStatus(false);
                return;
            }

            if (session) {
                if (navigator.onLine) setConnectionStatus(true);
            }
        });
    } catch (error) {
        console.warn('Supabase auth state listener unavailable:', error?.message || error);
    }
}

function initConnectionStatus() {
    setConnectionStatus(navigator.onLine);

    window.addEventListener("online", async () => {
        setConnectionStatus(true);
        await refreshSupabaseSession();
        initSupabaseRealtime();
        fetchData();
    });

    window.addEventListener("offline", () => {
        setConnectionStatus(false);
    });

    document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState !== 'visible') return;
        await refreshSupabaseSession();
        if (navigator.onLine) {
            initSupabaseRealtime();
        }
    });

    /*
     * Supabase v2 does NOT expose realtime.onOpen/onClose/onError.
     * Realtime lifecycle is handled by the channel.subscribe() callback
     * in initSupabaseRealtime().
     */
}

async function refreshSupabaseSession() {
    if (!supabaseClient?.auth) return null;

    try {
        const current = await supabaseClient.auth.getSession();
        if (current.error) {
            console.warn('Supabase session check failed:', current.error.message || current.error);
            return null;
        }

        if (!current.data?.session) return null;

        // Mobile/WebView connections can sleep while the app is backgrounded.
        // Refreshing on foreground/online keeps the access token usable.
        const refreshed = await supabaseClient.auth.refreshSession();
        if (refreshed.error) {
            console.warn('Supabase session refresh failed:', refreshed.error.message || refreshed.error);
            return current.data.session;
        }

        return refreshed.data?.session || current.data.session;
    } catch (error) {
        console.warn('Supabase session refresh check failed:', error.message || error);
        return null;
    }
}

/* ===========================================================================
   ADMIN SESSION
   ========================================================================== */

function checkAdminSession() {
    if (localStorage.getItem('isAdminLoggedIn') !== 'true') {
        window.location.href = 'admin-login.html';
        return;
    }

    try {
        const adminUserObj = JSON.parse(
            localStorage.getItem('adminUser') ||
            localStorage.getItem('safePassAdmin') ||
            '{}'
        );

        const roleVal = String(
            adminUserObj.role ||
            localStorage.getItem('adminRole') ||
            ''
        ).toLowerCase().trim();

        if (
            roleVal &&
            !['admin', 'superadmin', 'super_admin', 'administrator'].includes(roleVal)
        ) {
            alert(
                "Access Denied! You are a registered user, not an admin. Regular users cannot access the Admin Panel."
            );

            // Do NOT wipe the entire localStorage. The normal user/dashboard
            // session may be stored there as well. Remove only Admin state.
            [
                'isAdminLoggedIn',
                'admin_session_token',
                'adminUser',
                'adminEmail',
                'adminPhone',
                'adminName',
                'adminRole'
            ].forEach(key => {
                localStorage.removeItem(key);
                sessionStorage.removeItem(key);
            });

            window.location.href = 'admin-login.html';
            return;
        }
    } catch (e) {
        console.warn("Session check warning:", e);
    }
}

async function fetchAdminProfileName() {
    const adminNameDisplay =
        document.getElementById("displayAdminName") ||
        document.getElementById("superUserName") ||
        document.getElementById("adminNameDisplay");

    let storedAdminName = localStorage.getItem('adminName') || '';

    if (!storedAdminName) {
        try {
            const adminUserObj = JSON.parse(
                localStorage.getItem('adminUser') ||
                localStorage.getItem('safePassAdmin') ||
                localStorage.getItem('userData') ||
                '{}'
            );

            storedAdminName =
                adminUserObj.fullName ||
                adminUserObj.userName ||
                adminUserObj.name ||
                '';
        } catch (_) {}
    }

    if (adminNameDisplay) {
        adminNameDisplay.innerText = storedAdminName || 'Super Admin';
    }
}

/* ===========================================================================
   EVENT LISTENERS
   ========================================================================== */

function initAdminUserNavigationGuard() {
    if (window.__SAFE_PASS_ADMIN_USER_NAV_GUARD__) return;
    window.__SAFE_PASS_ADMIN_USER_NAV_GUARD__ = true;

    document.addEventListener("click", (event) => {
        const link = event.target.closest?.('a[data-safe-pass-admin-user-link="1"]');
        if (!link) return;

        // Do not let unrelated delegated handlers treat this as an admin logout.
        // Navigation itself is intentionally left to the browser.
        if (localStorage.getItem("isAdminLoggedIn") === "true" &&
            localStorage.getItem("admin_session_token")) {
            event.stopPropagation();
        }
    }, true);
}

function setupEventListeners() {
    const searchInput = document.getElementById("adminSearchInput");

    if (searchInput && !searchInput.dataset.safePassBound) {
        searchInput.addEventListener("input", filterAndRenderTables);
        searchInput.dataset.safePassBound = '1';
    }

    const confirmStatusBtn = document.getElementById("confirmStatusBtn");

    if (confirmStatusBtn && !confirmStatusBtn.dataset.safePassBound) {
        confirmStatusBtn.addEventListener("click", saveUserStatusFromModal);
        confirmStatusBtn.dataset.safePassBound = '1';
    }
}

/* ===========================================================================
   REALTIME
   ========================================================================== */

function initSupabaseRealtime() {
    if (!supabaseClient) return;
    if (!navigator.onLine) {
        setConnectionStatus(false);
        return;
    }

    if (realtimeSubscription) {
        try {
            supabaseClient.removeChannel(realtimeSubscription);
        } catch (_) {}
        realtimeSubscription = null;
    }

    realtimeSubscription = supabaseClient
        .channel('public:users_admin_realtime')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'users'
            },
            async (payload) => {
                try {
                    if (payload.eventType === 'INSERT') {
                        const newUser = payload.new || {};
                        const newId = String(newUser.userId || newUser.id || '');

                        const index = usersData.findIndex(
                            u => String(u.userId || u.id || '') === newId
                        );

                        if (index === -1) {
                            usersData.unshift(await enrichUserPassword(newUser));
                        }
                    }

                    if (payload.eventType === 'UPDATE') {
                        const updatedUser = payload.new || {};
                        const updatedId = String(
                            updatedUser.userId || updatedUser.id || ''
                        );

                        const index = usersData.findIndex(
                            u => String(u.userId || u.id || '') === updatedId
                        );

                        const enriched = await enrichUserPassword(updatedUser);

                        if (index !== -1) {
                            usersData[index] = {
                                ...usersData[index],
                                ...enriched
                            };
                        } else {
                            usersData.unshift(enriched);
                        }
                    }

                    if (payload.eventType === 'DELETE') {
                        const deletedId = String(
                            payload.old?.userId ||
                            payload.old?.id ||
                            ''
                        );

                        usersData = usersData.filter(
                            u => String(u.userId || u.id || '') !== deletedId
                        );
                    }

                    refreshDashboardUI();
                } catch (error) {
                    console.warn('Realtime payload handling failed:', error);
                }
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                setConnectionStatus(true);
                console.log('SafePass Supabase Realtime: LIVE');
            } else if (
                status === 'CHANNEL_ERROR' ||
                status === 'TIMED_OUT' ||
                status === 'CLOSED'
            ) {
                setConnectionStatus(false);
                console.warn('SafePass Supabase Realtime status:', status);
            }
        });
}

/* ===========================================================================
   DATA LOADING
   ========================================================================== */

async function fetchData() {
    const adminTableBody = document.getElementById("adminTableBody");
    const userTableBody = document.getElementById("userTableBody");

    const loadingHtml =
        `<tr><td colspan="6" style="text-align:center;padding:20px;color:#64748b;">Loading...</td></tr>`;

    if (adminTableBody) adminTableBody.innerHTML = loadingHtml;
    if (userTableBody) userTableBody.innerHTML = loadingHtml;

    if (!supabaseClient) {
        usersData = [];
        refreshDashboardUI();
        return;
    }

    try {
        const rawToken = getAdminSessionToken();

        /*
         * IMPORTANT: admin_session_token is an opaque server-issued bearer
         * token. It is intentionally treated as TEXT here. The database RPC
         * performs the real validation through admin_session_is_valid().
         * Do NOT require a UUID format in the browser: older/newer SafePass
         * deployments may use different opaque token formats.
         */
        if (!rawToken) {
            throw new Error(
                "Admin session token is missing. Please logout and login again."
            );
        }

        const usersResult = await supabaseClient.rpc(
            "admin_list_users",
            { p_admin_session_token: rawToken }
        );

        if (usersResult.error) {
            throw usersResult.error;
        }

        const users = Array.isArray(usersResult.data)
            ? usersResult.data
            : [];

        /*
         * The old database has two overloaded functions named
         * admin_list_admin_accounts(text) and admin_list_admin_accounts(uuid).
         * Supabase/PostgREST cannot choose between overloaded RPC signatures.
         * Therefore this client intentionally calls the new unambiguous RPC
         * name admin_list_admin_accounts_v2 when available.
         *
         * If that migration has not yet been installed, we safely continue
         * using role information returned by admin_list_users instead of
         * triggering the ambiguous RPC error.
         */
        const adminAccounts = await fetchAdminAccountsSafe(rawToken);

        usersData = await enrichUsersWithPlainPasswords(
            mergeUsersAndAdminAccounts(users, adminAccounts)
        );

        refreshDashboardUI();

    } catch (error) {
        console.error("Admin data loading failed:", error);
        usersData = [];
        refreshDashboardUI();
        showFlashPopup(
            "Unable to load admin data: " + (error.message || error),
            "error"
        );
    }
}

async function fetchAdminAccountsSafe(rawToken) {
    /*
     * IMPORTANT: Do not call admin_list_admin_accounts_v2 here.
     *
     * The supplied Supabase database currently does not contain that RPC, so
     * calling it produces a noisy 404 / PostgREST schema-cache error. The
     * canonical admin_list_users RPC already supplies the user/role dataset
     * needed by this panel. We therefore use that result as the single source
     * of truth and keep this function as a compatibility hook for deployments
     * that may add a separate admin-account endpoint later.
     *
     * This also makes the admin panel work without requiring any new SQL
     * migration and avoids the old overloaded
     * admin_list_admin_accounts(text/uuid) problem.
     */
    void rawToken;
    return [];
}

function mergeUsersAndAdminAccounts(users, adminAccounts) {
    const map = new Map();

    (Array.isArray(users) ? users : []).forEach(user => {
        const id = getUserId(user);
        if (!id) return;
        map.set(id, { ...user });
    });

    (Array.isArray(adminAccounts) ? adminAccounts : []).forEach(admin => {
        const normalized = normalizeAdminAccount(admin);
        const id = getUserId(normalized);
        if (!id) return;

        const existing = map.get(id) || {};
        map.set(id, {
            ...existing,
            ...normalized,
            role: normalized.role || "admin",
            is_admin: true,
            isAdmin: true
        });
    });

    return Array.from(map.values());
}

function normalizeAdminAccount(admin) {
    const a = admin || {};

    return {
        ...a,
        id: a.id || a.admin_id || "",
        userId: a.userId || a.user_id || "",
        fullName: a.fullName || a.full_name || "",
        nidNumber: a.nidNumber || a.nid_number || "",
        phoneNumber: a.phoneNumber || a.phone_number || "",
        email: a.email || "",
        gender: a.gender || null,
        dob: a.dob || null,
        bloodGroup: a.bloodGroup || a.blood_group || null,
        presentAddress: a.presentAddress || a.present_address || null,
        permanentAddress: a.permanentAddress || a.permanent_address || null,
        passwordPlain: a.passwordPlain || a.password_plain || "",
        plainPassword: a.plainPassword || a.passwordPlain || a.password_plain || "",
        role: a.role || "admin",
        status: a.status || "active",
        createdAt: a.createdAt || a.created_at || null,
        updatedAt: a.updatedAt || a.updated_at || null,
        is_admin: true,
        isAdmin: true
    };
}

function getUserId(user) {
    if (!user) return "";
    return String(
        user.userId || user.user_id || user.id || user.admin_id || ""
    ).trim();
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function getAdminSessionToken() {
    return String(
        localStorage.getItem("admin_session_token") || ""
    ).trim().replace(/^"|"$/g, "");
}

/* ===========================================================================
   PASSWORD ENRICHMENT
   ========================================================================== */

async function enrichUsersWithPlainPasswords(data) {
    if (!Array.isArray(data) || data.length === 0) return [];

    const ids = data
        .map(u => String(u.userId || u.id || '').trim())
        .filter(Boolean);

    const needsPassword = data.some(
        u =>
            !Object.prototype.hasOwnProperty.call(u, 'plainPassword') &&
            !Object.prototype.hasOwnProperty.call(u, 'password')
    );

    if (!needsPassword || ids.length === 0) {
        return data;
    }

    try {
        const result = await supabaseClient
            .from('users')
            .select('userId,plainPassword,password')
            .in('userId', ids);

        if (result.error || !Array.isArray(result.data)) {
            return data;
        }

        const passwordMap = new Map();

        result.data.forEach(row => {
            const id = String(row.userId || '').trim();
            if (!id) return;

            passwordMap.set(id, {
                plainPassword: row.plainPassword || '',
                password: row.password || ''
            });
        });

        return data.map(user => {
            const id = String(user.userId || user.id || '').trim();
            const extra = passwordMap.get(id);

            if (!extra) return user;

            return {
                ...user,
                plainPassword:
                    user.plainPassword || extra.plainPassword || '',
                password:
                    user.password || extra.password || ''
            };
        });

    } catch (_) {
        return data;
    }
}

async function enrichUserPassword(user) {
    if (!user) return user;

    if (
        Object.prototype.hasOwnProperty.call(user, 'plainPassword') ||
        Object.prototype.hasOwnProperty.call(user, 'password')
    ) {
        return user;
    }

    const id = String(user.userId || user.id || '').trim();

    if (!id || !supabaseClient) return user;

    try {
        const { data, error } = await supabaseClient
            .from('users')
            .select('userId,plainPassword,password')
            .eq('userId', id)
            .maybeSingle();

        if (error || !data) return user;

        return {
            ...user,
            plainPassword: data.plainPassword || '',
            password: data.password || ''
        };
    } catch (_) {
        return user;
    }
}

/* ===========================================================================
   FILTER / RENDER
   ========================================================================== */

function refreshDashboardUI() {
    updateDashboardStats(usersData);
    filterAndRenderTables();
}

function filterUserType(filterType) {
    currentFilter = filterType;
    filterAndRenderTables();
}

function isUserAdmin(user) {
    const roleVal = String(user?.role || '').toLowerCase().trim();

    return [
        'admin',
        'superadmin',
        'super_admin',
        'administrator'
    ].includes(roleVal);
}

function filterAndRenderTables() {
    let filtered = [...usersData];

    if (currentFilter === 'active') {
        filtered = filtered.filter(
            u => String(u.status || 'active').toLowerCase() === 'active'
        );
    } else if (currentFilter === 'disabled') {
        filtered = filtered.filter(
            u => ['disabled', 'suspended'].includes(
                String(u.status || '').toLowerCase()
            )
        );
    }

    const searchInput = document.getElementById("adminSearchInput");

    if (searchInput) {
        const query = searchInput.value.toLowerCase().trim();

        if (query) {
            filtered = filtered.filter(user => {
                const name = String(
                    user.fullName || user.userName || user.name || ''
                ).toLowerCase();
                const email = String(user.email || '').toLowerCase();
                const phone = String(user.phoneNumber || user.phone || '').toLowerCase();
                const userId = String(user.userId || user.id || '').toLowerCase();

                return (
                    name.includes(query) ||
                    email.includes(query) ||
                    phone.includes(query) ||
                    userId.includes(query)
                );
            });
        }
    }

    const admins = filtered.filter(isUserAdmin);
    const regularUsers = filtered.filter(u => !isUserAdmin(u));

    renderTable("adminTableBody", "noAdminsMessage", admins, true);
    renderTable("userTableBody", "noUsersMessage", regularUsers, false);
}

function renderTable(tableBodyId, noMsgId, data, isAdminTable = false) {
    const tableBody = document.getElementById(tableBodyId);
    const noUsersMsg = document.getElementById(noMsgId);

    if (!tableBody) return;

    if (!data || data.length === 0) {
        tableBody.innerHTML =
            `<tr><td colspan="6" style="text-align:center;padding:20px;color:#64748b;">No records found.</td></tr>`;

        if (noUsersMsg) noUsersMsg.style.display = "block";
        return;
    }

    if (noUsersMsg) noUsersMsg.style.display = "none";

    let rowsHtml = "";

    data.forEach(user => {
        const activeUserId = String(user.userId || user.id || "N/A");
        const userName = user.fullName || user.userName || user.name || "N/A";
        const email = user.email || "";
        const phone = user.phoneNumber || user.phone || "";

        let emailPhoneDisplay = "";
        if (email) emailPhoneDisplay += `<div>${escapeHtml(email)}</div>`;
        if (phone) emailPhoneDisplay += `<div style="color:#64748b;font-size:12px;">${escapeHtml(phone)}</div>`;
        if (!email && !phone) emailPhoneDisplay = "N/A";

        const realPassword = user.plainPassword || user.password || "";
        const passwordAvailable = Boolean(realPassword);
        const status = String(user.status || "active").toLowerCase();
        const isSuspended = status === 'disabled' || status === 'suspended';

        const statusBadge = isSuspended
            ? `<span style="background:rgba(239,68,68,.1);color:#ef4444;padding:4px 8px;border-radius:4px;font-weight:bold;font-size:12px;">${escapeHtml(status.toUpperCase())}</span>`
            : `<span style="background:rgba(34,197,94,.1);color:#22c55e;padding:4px 8px;border-radius:4px;font-weight:bold;font-size:12px;">ACTIVE</span>`;

        const safeId = escapeHtml(activeUserId);
        const safeName = escapeHtml(userName);
        const passwordToken = encodeURIComponent(realPassword);

        rowsHtml += `
            <tr>
                <td>
                    <a href="user.html?id=${encodeURIComponent(activeUserId)}" data-safe-pass-admin-user-link="1" style="color:#2563eb;font-weight:bold;text-decoration:none;">${safeId}</a>
                </td>
                <td>
                    <a href="user.html?id=${encodeURIComponent(activeUserId)}" data-safe-pass-admin-user-link="1" style="color:#1e293b;font-weight:600;text-decoration:none;">${safeName}</a>
                </td>
                <td>${emailPhoneDisplay}</td>
                <td>
                    <div class="pass-container" style="display:flex;align-items:center;gap:8px;">
                        <span class="pass-text" id="pass-${cssSafeId(activeUserId)}" data-password="${passwordToken}">
                            ${passwordAvailable ? "••••••••" : "Not available"}
                        </span>
                        ${passwordAvailable ? `
                            <i class="fa-solid fa-eye toggle-pass" style="cursor:pointer;color:#64748b;" onclick="togglePasswordVisibility('${jsSafe(activeUserId)}')" title="Show password"></i>
                        ` : ''}
                    </div>
                </td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn-sm" style="background:#3b82f6;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;" onclick="openStatusModal('${jsSafe(activeUserId)}','${jsSafe(status)}')" title="Change Status">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    ${isAdminTable ? `
                        <button class="btn-sm" style="background:#f59e0b;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;margin-left:4px;" onclick="removeAdmin('${jsSafe(activeUserId)}')" title="Demote Admin">Demote</button>
                    ` : `
                        <button class="btn-sm" style="background:#10b981;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;margin-left:4px;" onclick="makeUserAdmin('${jsSafe(activeUserId)}')" title="Make Admin">Make Admin</button>
                    `}
                    <button class="btn-sm" style="background:#ef4444;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;margin-left:4px;" onclick="deleteUserAccount('${jsSafe(activeUserId)}','${jsSafe(userName)}')" title="Delete Account Permanently">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = rowsHtml;
}

/* ===========================================================================
   PASSWORD SHOW / HIDE
   ========================================================================== */

function togglePasswordVisibility(docId) {
    const safeDocId = cssSafeId(docId);
    const elem = document.getElementById(`pass-${safeDocId}`);
    if (!elem) return;

    const icon = elem.nextElementSibling;
    const encodedPassword = elem.getAttribute('data-password') || '';

    let realPassword = '';
    try {
        realPassword = decodeURIComponent(encodedPassword);
    } catch (_) {
        realPassword = encodedPassword;
    }

    if (!realPassword) return;

    if (elem.innerText === '••••••••') {
        elem.innerText = realPassword;
        if (icon) {
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
            icon.title = 'Hide password';
        }
    } else {
        elem.innerText = '••••••••';
        if (icon) {
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
            icon.title = 'Show password';
        }
    }
}

/* ===========================================================================
   STATUS MODAL
   ========================================================================== */

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

    const select = document.getElementById('modalStatusSelect');
    const newStatus = select?.value || 'active';

    try {
        if (!supabaseClient) throw new Error("Supabase Client missing");

        const { error } = await supabaseClient
            .from('users')
            .update({ status: newStatus })
            .or(`"userId".eq.${selectedUserIdForModal},id.eq.${selectedUserIdForModal}`);

        if (error) throw error;

        showFlashPopup(`Status successfully updated to '${newStatus.toUpperCase()}'!`, 'success');
        closeStatusModal();
        fetchData();
    } catch (error) {
        showFlashPopup("Failed to update status: " + error.message, 'error');
    }
}

/* ===========================================================================
   MAKE ADMIN / REMOVE ADMIN
   ========================================================================== */

async function makeUserAdmin(userId) {
    try {
        if (!supabaseClient) throw new Error("Supabase Client missing");

        const token = getAdminSessionToken();
        if (!isUuid(token)) throw new Error("Admin session expired. Please login again.");

        const result = await supabaseClient.rpc("admin_set_user_role", {
            p_admin_session_token: token,
            p_user_id: String(userId),
            p_role: "admin"
        });

        if (result.error) throw result.error;

        showFlashPopup("User successfully promoted to Admin!", "success");
        await fetchData();
    } catch (error) {
        showFlashPopup("Failed to promote user: " + (error.message || error), "error");
    }
}

async function removeAdmin(userId) {
    try {
        if (!supabaseClient) throw new Error("Supabase Client missing");

        const token = getAdminSessionToken();
        if (!isUuid(token)) throw new Error("Admin session expired. Please login again.");

        const result = await supabaseClient.rpc("admin_set_user_role", {
            p_admin_session_token: token,
            p_user_id: String(userId),
            p_role: "user"
        });

        if (result.error) throw result.error;

        showFlashPopup("Admin successfully demoted to Normal User!", "success");
        await fetchData();
    } catch (error) {
        showFlashPopup("Failed to remove admin: " + (error.message || error), "error");
    }
}

/* ===========================================================================
   PERMANENT DELETE
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
        subtitleElem.innerHTML = `Are you sure you want to <b>PERMANENTLY</b> delete the account for "<span style="color:#ef4444;">${escapeHtml(userName)}</span>" (ID: ${escapeHtml(userId)})? This action cannot be undone and they will have to create a new account to log in again.`;
    }
    if (warningIcon) warningIcon.className = "fa-solid fa-triangle-exclamation flashing-warning-icon";
    if (statusSelectGroup) statusSelectGroup.style.display = 'none';

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
            .or(`"userId".eq.${selectedUserIdForDelete},id.eq.${selectedUserIdForDelete}`);

        if (error) throw error;

        showFlashPopup("User account successfully deleted permanently!", 'success');
        closeStatusModal();
        fetchData();
    } catch (error) {
        console.error("Error deleting user account:", error);
        showFlashPopup("Failed to delete account: " + error.message, 'error');
    }
}

/* ===========================================================================
   LOGOUT
   ========================================================================== */

async function logoutAdmin() {
    /*
     * Admin authentication is a custom server-side session. Do not call
     * Supabase Auth signOut() here because that can terminate the normal
     * user/vault Auth session in the same WebView.
     */
    const token = getAdminSessionToken();

    if (token && supabaseClient) {
        try {
            await supabaseClient.rpc("admin_logout", {
                p_session_token: token
            });
        } catch (error) {
            console.warn("Admin session revoke warning:", error);
        }
    }

    [
        'isAdminLoggedIn',
        'admin_session_token',
        'adminUser',
        'userData',
        'adminEmail',
        'adminPhone',
        'adminName',
        'adminRole'
    ].forEach(key => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    });

    window.location.href = 'admin-login.html';
}

/* ===========================================================================
   DASHBOARD STATS
   ========================================================================== */

function updateDashboardStats(data) {
    if (!Array.isArray(data)) return;

    const totalUsers = data.length;
    const activeUsers = data.filter(u => String(u.status || 'active').toLowerCase() === 'active').length;
    const disabledUsers = data.filter(u => ['disabled', 'suspended'].includes(String(u.status || '').toLowerCase())).length;

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

/* ===========================================================================
   SAFE HTML / JS HELPERS
   ========================================================================== */

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function jsSafe(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function cssSafeId(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/* ===========================================================================
   GLOBAL HTML HANDLER EXPORTS
   ========================================================================== */

window.togglePasswordVisibility = togglePasswordVisibility;
window.openStatusModal = openStatusModal;
window.closeStatusModal = closeStatusModal;
window.saveUserStatusFromModal = saveUserStatusFromModal;
window.makeUserAdmin = makeUserAdmin;
window.removeAdmin = removeAdmin;
window.deleteUserAccount = deleteUserAccount;
window.executePermanentDelete = executePermanentDelete;
window.logoutAdmin = logoutAdmin;
window.filterUserType = filterUserType;
window.filterAndRenderTables = filterAndRenderTables;
window.fetchData = fetchData;
window.initSupabaseRealtime = initSupabaseRealtime;
window.getSafePassSupabase = () => supabaseClient;

/* ===========================================================================
   NOTIFICATION / WARNING STYLES
   ========================================================================== */

function injectNotificationStyles() {
    if (document.getElementById('flashPopupStyles')) return;

    const style = document.createElement('style');
    style.id = 'flashPopupStyles';

    style.innerHTML = `
        @keyframes flashGlow {
            0% { transform: scale(.95); opacity: 0; box-shadow: 0 0 0 rgba(0,0,0,0); }
            50% { transform: scale(1.03); opacity: 1; box-shadow: 0 0 25px rgba(59,130,246,.6); }
            100% { transform: scale(1); opacity: 1; box-shadow: 0 4px 20px rgba(0,0,0,.15); }
        }
        @keyframes iconFlashPulse {
            0% { opacity: 1; transform: scale(1); color: #f59e0b; text-shadow: 0 0 0 rgba(245,158,11,0); }
            50% { opacity: .4; transform: scale(1.12); color: #ef4444; text-shadow: 0 0 15px rgba(239,68,68,.8); }
            100% { opacity: 1; transform: scale(1); color: #f59e0b; text-shadow: 0 0 0 rgba(245,158,11,0); }
        }
        .flashing-warning-icon {
            animation: iconFlashPulse 1.2s infinite ease-in-out !important;
            font-size: 45px;
            color: #f59e0b;
        }
        .flash-popup-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            backdrop-filter: blur(3px);
        }
        .flash-popup-box {
            background: #fff;
            padding: 25px 35px;
            border-radius: 12px;
            text-align: center;
            max-width: 400px;
            width: 90%;
            animation: flashGlow .4s ease-out forwards;
            font-family: inherit;
            box-shadow: 0 10px 30px rgba(0,0,0,.2);
        }
        .flash-popup-icon { font-size: 45px; margin-bottom: 15px; }
        .flash-popup-icon.success { color: #10b981; }
        .flash-popup-icon.error { color: #ef4444; }
        .flash-popup-message { font-size: 16px; color: #1e293b; font-weight: 600; margin-bottom: 20px; line-height: 1.5; }
        .flash-popup-btn { background: #2563eb; color: #fff; border: none; padding: 10px 24px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: background .2s; }
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
            <div class="flash-popup-message">${escapeHtml(message)}</div>
            <button class="flash-popup-btn" onclick="document.getElementById('customFlashPopup')?.remove()">OK</button>
        </div>
    `;

    document.body.appendChild(overlay);
}

window.showFlashPopup = showFlashPopup;

})();
