/* ============================================================
   SafePass Vault - Admin Registration / User Management
   Corrected version - Custom Admin Session + Registration Token
   ============================================================ */

(() => {
    "use strict";

    if (window.__SAFE_PASS_ADMINREGISTER_INITIALIZED__) {
        console.warn("adminregister.js is already initialized. Skipping duplicate initialization.");
        return;
    }
    window.__SAFE_PASS_ADMINREGISTER_INITIALIZED__ = true;

    const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv";

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        console.error("Supabase JS client was not loaded.");
        alert("Supabase library failed to load. Please refresh the page.");
        return;
    }

    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const $ = id => document.getElementById(id);

    const pinModal = $("pinModal");
    const verifyPinBtn = $("verifyPinBtn");
    const cancelPinBtn = $("cancelPinBtn");
    const secretPinInput = $("secretPinInput");
    const pinErrorMsg = $("pinErrorMsg");
    const logoutBtn = $("logoutBtn");
    const adminRegisterForm = $("adminRegisterForm");
    const successPopup = $("successPopup");
    const popupMessage = $("popupMessage");
    const popupCloseBtn = $("popupCloseBtn");
    const userTableBody = $("userTableBody");
    const fullNameInput = $("fullName");
    const nidNumberInput = $("nidNumber");
    const phoneNumberInput = $("phoneNumber");
    const emailInput = $("email");
    const genderInput = $("gender");
    const dobInput = $("dob");
    const bloodGroupInput = $("bloodGroup");
    const passwordInput = $("password");
    const presentAddressInput = $("presentAddress");
    const permanentAddressInput = $("permanentAddress");
    const nidError = $("nidError");
    const phoneError = $("phoneError");
    const emailError = $("emailError");

    const SESSION_KEYS = {
        step1Verified: "admin_step1_verified",
        step1Token: "admin_step1_token",
        step1VerifiedAt: "admin_step1_verified_at",
        step2Verified: "admin_step2_verified",
        pinVerified: "admin_pin_verified",
        registrationToken: "admin_registration_token",
        adminSessionToken: "admin_session_token"
    };

    let pinLockoutTime = Number(localStorage.getItem("pinLockoutTime") || "0");
    let pinFailAttempts = Number(localStorage.getItem("pinFailAttempts") || "0");
    let wasDisabledOnce = localStorage.getItem("wasDisabledOnce") === "true";
    let isSuspended = localStorage.getItem("isSuspended") === "true";
    const MAX_PIN_ATTEMPTS = 5;
    const PIN_LOCKOUT_MS = 60 * 1000;

    const bdPhoneRegex = /^01[3-9]\d{8}$/;
    const nidRegex = /^(?:\d{10}|\d{17})$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function normalizeDigits(value) {
        return String(value ?? "").replace(/[০-৯]/g, d => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
    }

    function normalizePhone(value) {
        let phone = normalizeDigits(String(value ?? "").trim().replace(/\s+/g, ""));
        if (/^\+8801[3-9]\d{8}$/.test(phone)) phone = "0" + phone.slice(4);
        if (/^8801[3-9]\d{8}$/.test(phone)) phone = "0" + phone.slice(3);
        return phone;
    }

    function normalizeNid(value) {
        return normalizeDigits(String(value ?? "").trim().replace(/\s+/g, ""));
    }

    function setError(element, message) {
        if (!element) return;
        element.textContent = message || "";
        element.style.display = message ? "block" : "none";
    }

    function clearValidationErrors() {
        setError(nidError, "");
        setError(phoneError, "");
        setError(emailError, "");
    }

    function validateFormFields() {
        clearValidationErrors();
        let valid = true;
        const nid = normalizeNid(nidNumberInput?.value);
        const phone = normalizePhone(phoneNumberInput?.value);
        const email = String(emailInput?.value || "").trim().toLowerCase();

        if (!nidRegex.test(nid)) {
            setError(nidError, "NID must contain exactly 10 or 17 digits.");
            valid = false;
        }
        if (!bdPhoneRegex.test(phone)) {
            setError(phoneError, "Please enter a valid 11-digit Bangladeshi phone number (01XXXXXXXXX).");
            valid = false;
        }
        if (!emailRegex.test(email)) {
            setError(emailError, "Please enter a valid email address.");
            valid = false;
        }
        if (phoneNumberInput) phoneNumberInput.value = phone;
        if (nidNumberInput) nidNumberInput.value = nid;
        if (emailInput) emailInput.value = email;
        return valid;
    }

    function showSuccess(message) {
        if (popupMessage) popupMessage.textContent = message || "New user has been successfully registered.";
        if (successPopup) successPopup.style.display = "flex";
    }

    function hideSuccess() {
        if (successPopup) successPopup.style.display = "none";
    }

    function showPinError(message) {
        if (!pinErrorMsg) return;
        pinErrorMsg.textContent = message || "Invalid PIN! Try again.";
        pinErrorMsg.style.display = "block";
    }

    function clearPinError() {
        if (!pinErrorMsg) return;
        pinErrorMsg.textContent = "";
        pinErrorMsg.style.display = "none";
    }

    function isUuid(value) {
        return typeof value === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
    }

    function extractRegistrationToken(payload) {
        const visited = new WeakSet();
        function search(value) {
            if (value == null) return null;
            if (typeof value === "string") return isUuid(value.trim()) ? value.trim() : null;
            if (typeof value !== "object" || visited.has(value)) return null;
            visited.add(value);
            if (Array.isArray(value)) {
                for (const item of value) {
                    const found = search(item);
                    if (found) return found;
                }
                return null;
            }
            const priorityKeys = ["registration_token", "p_registration_token", "token", "step2_token", "admin_registration_token", "data", "result"];
            for (const key of priorityKeys) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    const found = search(value[key]);
                    if (found) return found;
                }
            }
            for (const key of Object.keys(value)) {
                const found = search(value[key]);
                if (found) return found;
            }
            return null;
        }
        return search(payload);
    }

    function isPinLocked() {
        const now = Date.now();
        if (isSuspended) return true;
        if (pinLockoutTime > now) return true;
        if (pinLockoutTime > 0 && pinLockoutTime <= now) {
            pinLockoutTime = 0;
            pinFailAttempts = 0;
            localStorage.setItem("pinLockoutTime", "0");
            localStorage.setItem("pinFailAttempts", "0");
        }
        return false;
    }

    function pinLockRemainingSeconds() {
        return Math.max(0, Math.ceil((pinLockoutTime - Date.now()) / 1000));
    }

    function registerPinFailure() {
        pinFailAttempts += 1;
        localStorage.setItem("pinFailAttempts", String(pinFailAttempts));
        if (pinFailAttempts >= MAX_PIN_ATTEMPTS) {
            pinLockoutTime = Date.now() + PIN_LOCKOUT_MS;
            wasDisabledOnce = true;
            localStorage.setItem("pinLockoutTime", String(pinLockoutTime));
            localStorage.setItem("wasDisabledOnce", "true");
            return true;
        }
        return false;
    }

    function resetPinFailures() {
        pinFailAttempts = 0;
        pinLockoutTime = 0;
        wasDisabledOnce = false;
        localStorage.setItem("pinFailAttempts", "0");
        localStorage.setItem("pinLockoutTime", "0");
        localStorage.setItem("wasDisabledOnce", "false");
    }

    function getAdminSessionToken() {
        return sessionStorage.getItem(SESSION_KEYS.adminSessionToken) ||
            localStorage.getItem(SESSION_KEYS.adminSessionToken) || null;
    }

    function getRegistrationToken() {
        const token = sessionStorage.getItem(SESSION_KEYS.registrationToken);
        return isUuid(token) ? token : null;
    }

    function getManagementToken() {
        /*
          admin.html uses the custom admin session token. During the
          registration flow, adminregister.html is intentionally reached
          BEFORE admin login creates that session. Step-2 creates a short-lived
          registration bearer token, so this page uses that token for the
          registration management RPC instead of incorrectly requiring an
          admin_session_token.
        */
        return getAdminSessionToken() || getRegistrationToken();
    }

    async function verifySecurityPin() {
        if (!secretPinInput) return;
        clearPinError();

        if (isPinLocked()) {
            showPinError(isSuspended ? "Access is currently suspended." : `Too many failed attempts. Try again in ${pinLockRemainingSeconds()} seconds.`);
            return;
        }

        const enteredPin = String(secretPinInput.value || "").trim();
        const step1Token = sessionStorage.getItem(SESSION_KEYS.step1Token);
        if (!isUuid(step1Token)) {
            showPinError("Registration security session is missing or expired. Please start again from Admin Login.");
            setTimeout(() => window.location.href = "admin-login.html", 900);
            return;
        }
        if (!enteredPin) {
            showPinError("Please enter the Secret Owner PIN.");
            secretPinInput.focus();
            return;
        }

        verifyPinBtn?.setAttribute("disabled", "disabled");
        if (verifyPinBtn) verifyPinBtn.textContent = "Verifying...";

        try {
            const { data, error } = await supabaseClient.rpc("verify_admin_registration_step2", {
                p_step1_token: step1Token,
                p_pin: enteredPin
            });

            if (error) {
                console.error("Security PIN verification failed:", error);
                const locked = registerPinFailure();
                showPinError(locked ? `Too many failed attempts. Try again in ${PIN_LOCKOUT_MS / 1000} seconds.` : `Invalid PIN! ${Math.max(0, MAX_PIN_ATTEMPTS - pinFailAttempts)} attempt(s) remaining.`);
                return;
            }

            if (data?.success === false) {
                showPinError(String(data.message || "Step-1 security token is invalid or expired."));
                sessionStorage.removeItem(SESSION_KEYS.step1Token);
                sessionStorage.removeItem(SESSION_KEYS.step1Verified);
                sessionStorage.removeItem(SESSION_KEYS.step1VerifiedAt);
                sessionStorage.removeItem(SESSION_KEYS.registrationToken);
                sessionStorage.removeItem(SESSION_KEYS.step2Verified);
                sessionStorage.removeItem(SESSION_KEYS.pinVerified);
                setTimeout(() => window.location.href = "admin-login.html", 1100);
                return;
            }

            const registrationToken = extractRegistrationToken(data);
            if (!registrationToken) {
                console.error("Step-2 RPC returned no valid UUID registration token:", data);
                showPinError("PIN verification failed because the server did not return a valid registration token.");
                return;
            }

            resetPinFailures();
            sessionStorage.setItem(SESSION_KEYS.step2Verified, "true");
            sessionStorage.setItem(SESSION_KEYS.pinVerified, "true");
            sessionStorage.setItem(SESSION_KEYS.registrationToken, registrationToken);
            sessionStorage.removeItem(SESSION_KEYS.step1Token);
            sessionStorage.removeItem(SESSION_KEYS.step1Verified);
            sessionStorage.removeItem(SESSION_KEYS.step1VerifiedAt);
            if (pinModal) pinModal.style.display = "none";
            if (secretPinInput) secretPinInput.value = "";

            await loadUsers();
        } catch (err) {
            console.error("Unexpected security PIN error:", err);
            showPinError("An unexpected error occurred. Please try again.");
        } finally {
            if (verifyPinBtn) {
                verifyPinBtn.disabled = false;
                verifyPinBtn.textContent = "Verify PIN";
            }
        }
    }

    function cancelPinVerification() {
        [SESSION_KEYS.step1Verified, SESSION_KEYS.step1Token, SESSION_KEYS.step1VerifiedAt,
            SESSION_KEYS.step2Verified, SESSION_KEYS.pinVerified, SESSION_KEYS.registrationToken]
            .forEach(key => sessionStorage.removeItem(key));
        window.location.href = "admin-login.html";
    }

    function generateUserId() {
        return Math.floor(1000000000 + Math.random() * 9000000000).toString();
    }

    async function registerNewUser(event) {
        event.preventDefault();
        if (!adminRegisterForm || !validateFormFields()) return;

        const registrationToken = getRegistrationToken();
        if (!registrationToken || sessionStorage.getItem(SESSION_KEYS.step2Verified) !== "true") {
            alert("Registration security verification is missing or expired. Please start again from Admin Login.");
            window.location.href = "admin-login.html";
            return;
        }

        const fullName = String(fullNameInput?.value || "").trim();
        const nidNumber = normalizeNid(nidNumberInput?.value);
        const phoneNumber = normalizePhone(phoneNumberInput?.value);
        const email = String(emailInput?.value || "").trim().toLowerCase();
        const gender = String(genderInput?.value || "").trim();
        const dob = String(dobInput?.value || "").trim();
        const bloodGroup = String(bloodGroupInput?.value || "").trim() || null;
        const password = String(passwordInput?.value || "");
        const presentAddress = String(presentAddressInput?.value || "").trim();
        const permanentAddress = String(permanentAddressInput?.value || "").trim();

        if (!fullName || !nidNumber || !phoneNumber || !email || !gender || !dob || !password || !presentAddress || !permanentAddress) {
            alert("Please fill in all required fields.");
            return;
        }

        const submitButton = adminRegisterForm.querySelector('button[type="submit"]');
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.dataset.originalText = submitButton.innerHTML;
            submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering...';
        }

        try {
            const { data, error } = await supabaseClient.rpc("create_admin_account", {
                p_registration_token: registrationToken,
                p_user_id: generateUserId(),
                p_full_name: fullName,
                p_nid_number: nidNumber,
                p_phone_number: phoneNumber,
                p_email: email,
                p_gender: gender,
                p_dob: dob,
                p_blood_group: bloodGroup,
                p_password: password,
                p_present_address: presentAddress,
                p_permanent_address: permanentAddress
            });

            if (error) {
                console.error("Admin Registration Failed:", error);
                let message = error.message || "Registration failed.";
                if (error.code === "22P02" && /uuid/i.test(message)) message = "Registration security token is invalid. Please verify the Secret Owner PIN again.";
                if (error.code === "23505") message = "This NID, phone number, email, or user ID already exists.";
                alert(message);
                return;
            }

            console.log("Admin Registration Successful:", data);
            showSuccess("New admin user has been successfully registered.");
            adminRegisterForm.reset();
            clearValidationErrors();
            await loadUsers();
        } catch (err) {
            console.error("Unexpected Admin Registration Error:", err);
            alert("An unexpected error occurred during registration. Please try again.");
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = submitButton.dataset.originalText || '<i class="fa-solid fa-check"></i> Complete Registration';
            }
        }
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getField(user, ...keys) {
        for (const key of keys) {
            if (user && user[key] !== undefined && user[key] !== null && user[key] !== "") return user[key];
        }
        return "";
    }

    function renderUserList(users) {
        if (!userTableBody) return;
        userTableBody.innerHTML = "";

        if (!Array.isArray(users) || users.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 5;
            cell.textContent = "No registered admin users found.";
            cell.style.textAlign = "center";
            cell.style.padding = "20px";
            row.appendChild(cell);
            userTableBody.appendChild(row);
            return;
        }

        users.forEach(user => {
            const row = document.createElement("tr");
            const userId = getField(user, "userId", "user_id", "userid", "id");
            const name = getField(user, "fullName", "full_name", "name", "userName");
            const nid = getField(user, "nidNumber", "nid_number", "nid");
            const phone = getField(user, "phoneNumber", "phone_number", "phone");
            const email = getField(user, "email");
            const role = String(getField(user, "role", "userType", "type") || "user").toLowerCase();
            const status = String(getField(user, "status") || "active").toLowerCase();

            row.innerHTML = `
                <td><a href="user.html?id=${encodeURIComponent(userId)}" style="color:#4f46e5;font-weight:bold;">${escapeHtml(userId)}</a></td>
                <td><strong>${escapeHtml(name)}</strong><br><small>NID: ${escapeHtml(nid || "N/A")}</small><br><small>Role: ${escapeHtml(role)}</small></td>
                <td>${escapeHtml(phone || "N/A")}<br><small>${escapeHtml(email || "N/A")}</small></td>
                <td>
                    <select class="status-select" data-userid="${escapeHtml(userId)}">
                        <option value="active" ${status === "active" ? "selected" : ""}>Active</option>
                        <option value="inactive" ${status === "inactive" ? "selected" : ""}>Inactive</option>
                        <option value="disable" ${status === "disable" || status === "disabled" ? "selected" : ""}>Disable</option>
                        <option value="suspended" ${status === "suspended" ? "selected" : ""}>Suspended</option>
                        <option value="blocked" ${status === "blocked" ? "selected" : ""}>Blocked</option>
                        <option value="banned" ${status === "banned" ? "selected" : ""}>Banned</option>
                    </select>
                    <button type="button" class="user-update-btn" data-user-id="${escapeHtml(userId)}">Update</button>
                </td>
                <td><button type="button" class="user-delete-btn" data-user-id="${escapeHtml(userId)}"><i class="fa-solid fa-trash"></i> Delete</button></td>
            `;
            userTableBody.appendChild(row);
        });
    }

    function normalizeRpcRows(data) {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.users)) return data.users;
        if (Array.isArray(data?.data)) return data.data;
        if (Array.isArray(data?.result)) return data.result;
        return [];
    }

    async function loadUsers() {
        if (!userTableBody) return;
        userTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;">Loading registered admins...</td></tr>';

        const adminSessionToken = getAdminSessionToken();
        const registrationToken = getRegistrationToken();

        try {
            let data;
            let error;

            if (adminSessionToken) {
                ({ data, error } = await supabaseClient.rpc("admin_list_users", {
                    p_session_token: adminSessionToken
                }));
            } else if (registrationToken) {
                ({ data, error } = await supabaseClient.rpc("admin_registration_list_users", {
                    p_registration_token: registrationToken
                }));
            } else {
                throw new Error("Registration security token not found. Please start again from Admin Login.");
            }

            if (error) throw error;
            renderUserList(normalizeRpcRows(data));
        } catch (err) {
            console.error("Error loading registered admins:", err);
            userTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:#b02a37;">Could not load registered admins: ${escapeHtml(err?.message || "Unknown error")}</td></tr>`;
        }
    }

    async function updateUserStatus(userId, status) {
        const token = getAdminSessionToken();
        if (!token) {
            alert("Admin session token not found. Status control is available from an authenticated Admin Panel session.");
            return;
        }
        try {
            const { error } = await supabaseClient.rpc("admin_update_user_status", {
                p_session_token: token,
                p_user_id: userId,
                p_status: status
            });
            if (error) throw error;
            await loadUsers();
        } catch (err) {
            console.error("Status update failed:", err);
            alert(err?.message || "Failed to update user status.");
        }
    }

    async function deleteUser(userId) {
        const token = getAdminSessionToken();
        if (!token) {
            alert("Admin session token not found. Delete is available from an authenticated Admin Panel session.");
            return;
        }
        if (!window.confirm(`Are you sure you want to delete user ${userId}? This action cannot be undone.`)) return;
        try {
            const { error } = await supabaseClient.rpc("admin_delete_user", {
                p_session_token: token,
                p_user_id: userId
            });
            if (error) throw error;
            await loadUsers();
        } catch (err) {
            console.error("User deletion failed:", err);
            alert(err?.message || "Failed to delete user.");
        }
    }

    function handleUserTableClick(event) {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.classList.contains("user-update-btn")) {
            const row = target.closest("tr");
            const select = row?.querySelector(".status-select");
            if (select) updateUserStatus(target.dataset.userId, select.value);
        } else if (target.classList.contains("user-delete-btn")) {
            deleteUser(target.dataset.userId);
        }
    }

    async function logout() {
        const adminToken = getAdminSessionToken();
        if (adminToken) {
            try {
                await supabaseClient.rpc("admin_logout", { p_session_token: adminToken });
            } catch (err) {
                console.warn("Admin session revoke warning:", err);
            }
        }
        Object.values(SESSION_KEYS).forEach(key => sessionStorage.removeItem(key));

        // Clear only the custom Admin/registration session. Do not use
        // localStorage.clear(), because the same WebView may contain the
        // normal SafePass user/vault session.
        [
            "isAdminLoggedIn",
            "admin_session_token",
            "adminUser",
            "adminEmail",
            "adminPhone",
            "adminName",
            "adminRole"
        ].forEach(key => {
            sessionStorage.removeItem(key);
            localStorage.removeItem(key);
        });

        // Keep normal user login state intact on the registration-management
        // page. The page itself will require an Admin/registration token when
        // protected operations are attempted.
        window.location.href = "admin-login.html";
    }

    function focusPinInput() {
        if (!secretPinInput || !pinModal || pinModal.style.display === "none") return;
        window.requestAnimationFrame(() => {
            try { secretPinInput.focus({ preventScroll: true }); } catch (_) { secretPinInput.focus(); }
        });
    }

    function init() {
        verifyPinBtn?.addEventListener("click", verifySecurityPin);
        cancelPinBtn?.addEventListener("click", cancelPinVerification);
        secretPinInput?.addEventListener("keydown", e => {
            if (e.key === "Enter") { e.preventDefault(); verifySecurityPin(); }
        });
        adminRegisterForm?.addEventListener("submit", registerNewUser);
        popupCloseBtn?.addEventListener("click", hideSuccess);
        logoutBtn?.addEventListener("click", logout);
        userTableBody?.addEventListener("click", handleUserTableClick);

        phoneNumberInput?.addEventListener("input", () => {
            const normalized = normalizePhone(phoneNumberInput.value).replace(/[^\d]/g, "").slice(0, 11);
            phoneNumberInput.value = normalized;
            setError(phoneError, normalized && !bdPhoneRegex.test(normalized) ? "Format: 01XXXXXXXXX" : "");
        });

        nidNumberInput?.addEventListener("input", () => {
            const normalized = normalizeNid(nidNumberInput.value).replace(/[^\d]/g, "");
            nidNumberInput.value = normalized;
            setError(nidError, normalized && !nidRegex.test(normalized) ? "NID must be 10 or 17 digits." : "");
        });

        emailInput?.addEventListener("input", () => {
            const value = emailInput.value.trim();
            setError(emailError, value && !emailRegex.test(value) ? "Please enter a valid email address." : "");
        });

        const step1Token = sessionStorage.getItem(SESSION_KEYS.step1Token);
        const registrationToken = sessionStorage.getItem(SESSION_KEYS.registrationToken);
        const step2Verified = sessionStorage.getItem(SESSION_KEYS.step2Verified) === "true";

        if (step2Verified && isUuid(registrationToken)) {
            if (pinModal) pinModal.style.display = "none";
            loadUsers();
            return;
        }

        if (!isUuid(step1Token)) {
            if (pinModal) pinModal.style.display = "none";
            window.location.replace("admin-login.html");
            return;
        }

        if (pinModal) pinModal.style.display = "flex";
        focusPinInput();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
