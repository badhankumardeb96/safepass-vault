// ============================================================================
// SafePass Vault - Admin Login
// ============================================================================
// Preserves the original UI, field IDs, PIN flow, warning popup, and login
// behavior while using the secure separate Admin-account architecture.
//
// Security model:
// 1. FIRST PIN (login_pin) is verified by the server.
// 2. Admin registration uses the separate SECOND PIN in adminregister.js.
// 3. Admin login is checked ONLY against public.admin_accounts.
// 4. Normal public.users/Auth credentials cannot grant Admin Panel access.
// 5. Successful Admin login receives a server-issued admin session token.
// 6. No Supabase Auth sign-in or legacy-auth bootstrap is used for Admin login.
// ============================================================================

// Supabase Configuration
const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv";

let supabaseClient = null;

if (
    typeof supabase !== "undefined" &&
    typeof supabase.createClient === "function"
) {
    supabaseClient = supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );

    // উইন্ডো অবজেক্টে assign করে রাখা যাতে সব ফাংশন থেকে সহজে access করা যায়
    window.supabaseClient = supabaseClient;
}

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const loginBtn = document.getElementById("loginBtn");

    // Warning Popup Elements
    const warningPopup = document.getElementById("warningPopup");
    const warningMessage = document.getElementById("warningMessage");
    const popupCloseBtn = document.getElementById("popupCloseBtn");

    // Pin Modal Elements
    const openPinModalBtn = document.getElementById("openPinModalBtn");
    const pinModal = document.getElementById("pinModal");
    const closePinModalBtn = document.getElementById("closePinModalBtn");
    const verifyPinBtn = document.getElementById("verifyPinBtn");
    const secretPinInput = document.getElementById("secretPinInput");

    // Helper function to show custom popup smoothly
    function showWarning(htmlMessage) {
        if (warningMessage) {
            warningMessage.innerHTML = htmlMessage;
        }

        if (warningPopup) {
            warningPopup.style.display = "flex";
        }
    }

    // Popup close
    if (popupCloseBtn && warningPopup) {
        popupCloseBtn.addEventListener("click", () => {
            warningPopup.style.display = "none";
        });
    }

    // ------------------------------------------------------------------------
    // 1. Create Account button -> Step 1 PIN modal
    // ------------------------------------------------------------------------
    if (openPinModalBtn) {
        openPinModalBtn.addEventListener("click", () => {
            const pinLockoutTime =
                localStorage.getItem("pinLockoutTime");

            const currentTime = Date.now();

            if (
                pinLockoutTime &&
                currentTime < Number(pinLockoutTime)
            ) {
                const remainingMinutes = Math.ceil(
                    (Number(pinLockoutTime) - currentTime) /
                    (1000 * 60)
                );

                showWarning(
                    `<b>Access Disabled!</b> Too many incorrect PIN attempts. ` +
                    `System access is blocked for 3 hours. Please try again after ` +
                    `<b>${remainingMinutes} minutes</b>.`
                );

                return;
            }

            // Lockout expired -> reset local attempt state
            if (
                pinLockoutTime &&
                currentTime >= Number(pinLockoutTime)
            ) {
                localStorage.removeItem("pinLockoutTime");
                localStorage.removeItem("pinFailAttempts");
                localStorage.removeItem("wasDisabledOnce");
                localStorage.removeItem("isSuspended");
            }

            // Clear stale Step-1 / setup markers.
            sessionStorage.removeItem("admin_step1_verified");
            sessionStorage.removeItem("admin_step1_token");
            sessionStorage.removeItem("admin_step1_verified_at");
            sessionStorage.removeItem("admin_step2_verified");
            sessionStorage.removeItem("admin_pin_verified");
            sessionStorage.removeItem("admin_registration_token");

            if (secretPinInput) {
                secretPinInput.value = "";
            }

            if (pinModal) {
                pinModal.style.display = "flex";
            }

            if (secretPinInput) {
                secretPinInput.focus();
            }
        });
    }

    // PIN modal close
    if (closePinModalBtn && pinModal) {
        closePinModalBtn.addEventListener("click", () => {
            pinModal.style.display = "none";
        });
    }

    // ------------------------------------------------------------------------
    // Server-side PIN verification helper
    // ------------------------------------------------------------------------
    async function verifyPinFromDatabase(enteredPin, pinKey) {
        try {
            const client =
                window.supabaseClient || supabaseClient;

            if (!client) {
                throw new Error(
                    "Supabase client is not initialized."
                );
            }

            const normalizedKey = String(pinKey || "")
                .trim()
                .toLowerCase();

            const normalizedPin = String(enteredPin || "")
                .trim();

            if (!normalizedKey || !normalizedPin) {
                return false;
            }

            /*
             * public.settings is protected by RLS.
             * The login page must NOT SELECT the settings table directly.
             * The SECURITY DEFINER RPC checks the PIN server-side without
             * exposing the stored PIN value.
             */
            const { data, error } = await client.rpc(
                "verify_admin_security_pin",
                {
                    p_key: normalizedKey,
                    p_pin: normalizedPin
                }
            );

            console.log(
                "[SafePass] Server-side PIN verification:",
                normalizedKey,
                "result =",
                data,
                "error =",
                error
            );

            if (error) {
                throw new Error(
                    `Security PIN verification failed: ${
                        error.message || "Database error."
                    }`
                );
            }

            return data === true;
        } catch (err) {
            console.error(
                "PIN verification exception:",
                err
            );

            throw err;
        }
    }

    function resetPinButton() {
        if (verifyPinBtn) {
            verifyPinBtn.innerHTML = "Verify & Open";
            verifyPinBtn.disabled = false;
        }
    }

    // ------------------------------------------------------------------------
    // 2. Step 1 PIN verification logic
    // ------------------------------------------------------------------------
    async function handlePinVerification() {
        const enteredPin = secretPinInput
            ? secretPinInput.value.trim()
            : "";

        const currentTime = Date.now();

        if (!enteredPin) {
            showWarning(
                "<b>Warning!</b> Please enter the secret PIN."
            );
            return;
        }

        // Check local lockout before making a database request.
        const pinLockoutTime =
            localStorage.getItem("pinLockoutTime");

        if (
            pinLockoutTime &&
            currentTime < Number(pinLockoutTime)
        ) {
            const remainingMinutes = Math.ceil(
                (Number(pinLockoutTime) - currentTime) /
                (1000 * 60)
            );

            showWarning(
                `<b>Access Disabled!</b> Too many incorrect PIN attempts. ` +
                `Please try again after <b>${remainingMinutes} minutes</b>.`
            );

            return;
        }

        if (
            pinLockoutTime &&
            currentTime >= Number(pinLockoutTime)
        ) {
            localStorage.removeItem("pinLockoutTime");
            localStorage.removeItem("pinFailAttempts");
            localStorage.removeItem("wasDisabledOnce");
            localStorage.removeItem("isSuspended");
        }

        if (verifyPinBtn) {
            verifyPinBtn.innerHTML = "Checking...";
            verifyPinBtn.disabled = true;
        }

        let isValidPin = false;

        try {
            // FIRST PIN = login_pin
            isValidPin = await verifyPinFromDatabase(
                enteredPin,
                "login_pin"
            );
        } catch (error) {
            resetPinButton();

            // Database/RLS/network problems are NOT treated as failed PIN attempts.
            showWarning(
                `<b>PIN Verification Error!</b><br>` +
                `${error.message || "Could not verify the PIN from Supabase."}` +
                `<br><br><small>Open the browser Console (F12) for details.</small>`
            );

            return;
        }

        resetPinButton();

        if (isValidPin) {
            // Successful Step 1
            localStorage.removeItem("pinFailAttempts");
            localStorage.removeItem("pinLockoutTime");
            localStorage.removeItem("isSuspended");
            localStorage.removeItem("wasDisabledOnce");

            /*
             * IMPORTANT:
             * Do NOT mark Step 1 as fully verified with only a boolean.
             * Issue a server-side, short-lived Step-1 setup token so that
             * adminregister.js can require proof from the database.
             */
            try {
                const client =
                    window.supabaseClient || supabaseClient;

                if (!client) {
                    throw new Error(
                        "Supabase client is not initialized."
                    );
                }

                const { data, error } = await client.rpc(
                    "issue_admin_setup_token",
                    {
                        p_pin: enteredPin
                    }
                );

                if (error) {
                    throw error;
                }

                const setupToken =
                    data &&
                    typeof data === "object"
                        ? (
                            data.setup_token ||
                            data.token ||
                            data.step1_token
                        )
                        : data;

                if (!setupToken) {
                    throw new Error(
                        "Server did not issue a Step-1 verification token."
                    );
                }

                // Store only the opaque server-issued token.
                sessionStorage.setItem(
                    "admin_step1_token",
                    String(setupToken)
                );

                sessionStorage.setItem(
                    "admin_step1_verified",
                    "true"
                );

                sessionStorage.setItem(
                    "admin_step1_verified_at",
                    String(Date.now())
                );

                // Step 2 and registration token must always start fresh.
                sessionStorage.removeItem(
                    "admin_step2_verified"
                );

                sessionStorage.removeItem(
                    "admin_pin_verified"
                );

                sessionStorage.removeItem(
                    "admin_registration_token"
                );

                if (pinModal) {
                    pinModal.style.display = "none";
                }

                // Go to Step 2.
                // adminregister.js verifies admin_register_pin.
                window.location.href = "adminregister.html";
            } catch (error) {
                console.error(
                    "Step-1 setup-token issue error:",
                    error
                );

                showWarning(
                    `<b>Security Error!</b><br>` +
                    `${error.message || "Could not create the secure Step-1 verification token."}`
                );
            }

            return;
        }

        // --------------------------------------------------------------------
        // Wrong PIN
        // --------------------------------------------------------------------
        let failAttempts = parseInt(
            localStorage.getItem("pinFailAttempts") || "3",
            10
        );

        if (
            !Number.isFinite(failAttempts) ||
            failAttempts < 1 ||
            failAttempts > 3
        ) {
            failAttempts = 3;
        }

        failAttempts -= 1;

        if (failAttempts <= 0) {
            const threeHoursLater =
                currentTime + (3 * 60 * 60 * 1000);

            localStorage.setItem(
                "pinLockoutTime",
                String(threeHoursLater)
            );

            localStorage.setItem(
                "wasDisabledOnce",
                "true"
            );

            localStorage.setItem(
                "pinFailAttempts",
                "3"
            );

            sessionStorage.removeItem(
                "admin_step1_verified"
            );

            sessionStorage.removeItem(
                "admin_step1_token"
            );

            sessionStorage.removeItem(
                "admin_step1_verified_at"
            );

            sessionStorage.removeItem(
                "admin_step2_verified"
            );

            sessionStorage.removeItem(
                "admin_pin_verified"
            );

            sessionStorage.removeItem(
                "admin_registration_token"
            );

            if (pinModal) {
                pinModal.style.display = "none";
            }

            // Log out any locally stored Admin state.
            localStorage.removeItem("isAdminLoggedIn");
            localStorage.removeItem("isLoggedIn");
            localStorage.removeItem("userData");
            localStorage.removeItem("adminUser");
            localStorage.removeItem("adminEmail");
            localStorage.removeItem("adminPhone");
            localStorage.removeItem("adminName");
            localStorage.removeItem("adminRole");
            localStorage.removeItem("admin_session_token");

            showWarning(
                `<b>SECURITY ALERT: ACCOUNT DISABLED!</b> ` +
                `Incorrect PIN entered 3 times. Your account is disabled for ` +
                `<b>3 hours</b>. You have been logged out.`
            );
        } else {
            localStorage.setItem(
                "pinFailAttempts",
                String(failAttempts)
            );

            if (pinModal) {
                pinModal.style.display = "none";
            }

            showWarning(
                `<b>Wrong PIN!</b> Attempts left: ${failAttempts}.` +
                `<br><span style="font-size: 0.9rem; color: #555;">` +
                `(Note: Reaching 0 will disable your account for 3 hours).` +
                `</span>`
            );

            if (secretPinInput) {
                secretPinInput.value = "";
            }
        }
    }

    // Verify & Open button
    if (verifyPinBtn) {
        verifyPinBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            await handlePinVerification();
        });
    }

    // Enter key in PIN input
    if (secretPinInput) {
        secretPinInput.addEventListener(
            "keydown",
            async (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    await handlePinVerification();
                }
            }
        );
    }

    // ------------------------------------------------------------------------
    // 3. Secured Admin Login Handler
    // ------------------------------------------------------------------------
    /*
     * IMPORTANT:
     * Admin login is completely separate from normal user login.
     *
     * verify_admin_login() checks ONLY public.admin_accounts.
     * Therefore:
     * - A normal public.users account cannot become Admin merely because
     *   its role is "admin".
     * - A normal user's Supabase Auth password cannot log into this panel.
     * - Same email/phone/NID can exist in public.users and admin_accounts.
     *
     * No service-role key is exposed in this browser code.
     */
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            if (
                localStorage.getItem("isSuspended") === "true"
            ) {
                showWarning(
                    `<b>Access Denied!</b> Your account is suspended. ` +
                    `Please contact system owner.`
                );
                return;
            }

            const identifierInput =
                document.getElementById("loginIdentifier");

            const passwordInput =
                document.getElementById("loginPassword");

            const identifier = identifierInput
                ? identifierInput.value.trim()
                : "";

            const password = passwordInput
                ? passwordInput.value
                : "";

            if (!identifier || !password) {
                showWarning(
                    "Please enter both email/phone/User ID and password."
                );
                return;
            }

            if (loginBtn) {
                loginBtn.innerHTML =
                    '<i class="fa-solid fa-spinner fa-spin"></i> Checking Access...';

                loginBtn.disabled = true;
            }

            try {
                const client =
                    window.supabaseClient || supabaseClient;

                if (!client) {
                    throw new Error(
                        "Supabase client is not initialized."
                    );
                }

                /*
                 * ONLY this RPC authenticates an Admin.
                 * It does NOT query public.users and does NOT use Supabase Auth.
                 */
                const {
                    data: loginData,
                    error: loginError
                } = await client.rpc(
                    "verify_admin_login",
                    {
                        p_identifier: identifier,
                        p_password: password
                    }
                );

                if (loginError) {
                    throw loginError;
                }

                const result = Array.isArray(loginData)
                    ? loginData[0]
                    : loginData;

                if (
                    !result ||
                    result.success !== true
                ) {
                    showWarning(
                        `<b>Access Denied!</b> ` +
                        `${result?.message || "Invalid Admin ID, email, phone, or password."}`
                    );

                    resetLoginButton();
                    return;
                }

                const roleVal = String(
                    result.role || ""
                )
                    .toLowerCase()
                    .trim();

                if (roleVal !== "admin") {
                    showWarning(
                        `<b>Access Denied!</b> This account is not an Admin account.`
                    );

                    resetLoginButton();
                    return;
                }

                const status = String(
                    result.status || "active"
                )
                    .toLowerCase()
                    .trim();

                if (
                    [
                        "disabled",
                        "suspended",
                        "blocked",
                        "banned",
                        "disable"
                    ].includes(status)
                ) {
                    showWarning(
                        `<b>Access Denied!</b> This admin account is ${status}.`
                    );

                    resetLoginButton();
                    return;
                }

                const adminSessionToken =
                    result.session_token ||
                    result.admin_session_token ||
                    result.token;

                if (!adminSessionToken) {
                    throw new Error(
                        "Admin authentication succeeded but no secure session token was returned."
                    );
                }

                /*
                 * Store only the information needed by the existing Admin UI.
                 * The real authorization is the server-side session token.
                 */
                const adminUser = {
                    userId:
                        result.user_id ||
                        result.userId ||
                        "",
                    fullName:
                        result.full_name ||
                        result.fullName ||
                        "Admin",
                    email:
                        result.email ||
                        "",
                    phoneNumber:
                        result.phone_number ||
                        result.phoneNumber ||
                        "",
                    role: "admin",
                    status: status
                };

                localStorage.setItem(
                    "isAdminLoggedIn",
                    "true"
                );

                localStorage.setItem(
                    "isLoggedIn",
                    "true"
                );

                localStorage.setItem(
                    "admin_session_token",
                    String(adminSessionToken)
                );

                localStorage.setItem(
                    "userData",
                    JSON.stringify(adminUser)
                );

                localStorage.setItem(
                    "adminUser",
                    JSON.stringify(adminUser)
                );

                localStorage.setItem(
                    "adminEmail",
                    adminUser.email
                );

                localStorage.setItem(
                    "adminPhone",
                    adminUser.phoneNumber
                );

                localStorage.setItem(
                    "adminName",
                    adminUser.fullName
                );

                localStorage.setItem(
                    "adminRole",
                    "admin"
                );

                /*
                 * Old Auth/legacy bootstrap values are intentionally NOT used.
                 * Clear stale normal-user Auth-related admin state so an old
                 * login cannot accidentally be reused by admin.js.
                 */
                localStorage.removeItem(
                    "auth_user_id"
                );

                // A successful Admin login goes directly to the Admin Panel.
                window.location.href = "admin.html";
            } catch (error) {
                console.error(
                    "Admin Login Error:",
                    error
                );

                showWarning(
                    `<b>Login Failed!</b> ` +
                    `${error.message || "Unable to verify Admin account."}`
                );

                resetLoginButton();
            }
        });
    }

    function resetLoginButton() {
        if (loginBtn) {
            loginBtn.innerHTML =
                '<i class="fa-solid fa-right-to-bracket"></i> Login to Dashboard';

            loginBtn.disabled = false;
        }
    }
});
