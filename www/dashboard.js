/* ==========================================================================
   SafePass Vault - Dashboard JavaScript
   Version: Secure User Vault + Search + Live Sync

   IMPORTANT:
   - Current vault ownership is based on 10-digit userid.
   - For real database security, Supabase Auth + RLS is required.
   - Never expose the Supabase SERVICE ROLE key in frontend.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {

    /* ======================================================================
       1. SUPABASE CONFIGURATION
       ====================================================================== */

    const SUPABASE_URL =
        "https://vgjsoicsmmzahhsuworg.supabase.co";

    const SUPABASE_ANON_KEY =
        "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv";

    let supabaseClient = null;
    let dashboardRealtimeSub = null;

    /*
      ======================================================================
      ACCOUNT STATUS GUARD
      ======================================================================
      The admin/user-management page can change a user's account status to
      Active, Suspended, Blocked, or Disabled. This dashboard checks the
      server-side user record and also listens for realtime changes.

      IMPORTANT:
      - The exact user table/column names can vary between SafePass builds.
      - The code therefore discovers a compatible user table + userid/status
        columns instead of hard-coding only one schema.
      - Realtime is used when available; polling remains as a fallback.
    */

    /*
      SafePass uses public.users for account management.  Older versions of
      this file tried many possible table/column combinations.  That caused a
      stream of PostgREST 400 errors whenever a guessed column did not exist.

      We now read one real users row first, inspect its actual keys in memory,
      and then make exactly one status query using the real column names.
    */
    const ACCOUNT_STATUS_TABLE = "users";

    const ACCOUNT_STATUS_ID_COLUMN_PREFERENCES = [
        "userId",
        "user_id",
        "userid",
        "id"
    ];

    const ACCOUNT_STATUS_COLUMN_PREFERENCES = [
        "status",
        "account_status",
        "accountStatus",
        "accountstatus",
        "user_status",
        "state"
    ];

    // Check quickly after login and keep checking once per second as fallback.
    const ACCOUNT_STATUS_POLL_MS = 1000;

    let accountStatusConfig = null;
    let accountStatusChannel = null;
    let accountStatusPollTimer = null;
    let accountStatusCheckInProgress = false;
    let accountRestrictionHandled = false;
    let accountStatusGateActive = false;

    /*
      Lock the dashboard while the server account status is checked.
      This prevents a restricted user from briefly using dashboard controls
      after login while the status request is in flight.
    */
    function showAccountStatusCheckingOverlay() {
        if (document.getElementById("safePassAccountStatusCheckingOverlay")) {
            accountStatusGateActive = true;
            return;
        }

        accountStatusGateActive = true;

        const overlay = document.createElement("div");
        overlay.id = "safePassAccountStatusCheckingOverlay";
        overlay.setAttribute("role", "status");
        overlay.setAttribute("aria-live", "polite");
        overlay.innerHTML = `
            <div class="safe-pass-status-checking-card">
                <div class="safe-pass-status-checking-spinner" aria-hidden="true"></div>
                <strong>Checking account status...</strong>
                <p>Please wait a moment.</p>
            </div>
        `;

        const style = document.createElement("style");
        style.id = "safePassAccountStatusCheckingStyles";
        style.textContent = `
            #safePassAccountStatusCheckingOverlay {
                position: fixed;
                inset: 0;
                z-index: 2147483646;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                box-sizing: border-box;
                background: rgba(10, 18, 30, 0.88);
                color: #243746;
                font-family: Arial, Helvetica, sans-serif;
            }
            #safePassAccountStatusCheckingOverlay .safe-pass-status-checking-card {
                width: min(360px, 100%);
                padding: 28px 24px;
                border-radius: 14px;
                background: #fff;
                text-align: center;
                box-shadow: 0 18px 48px rgba(0,0,0,.28);
            }
            #safePassAccountStatusCheckingOverlay strong { display: block; font-size: 17px; }
            #safePassAccountStatusCheckingOverlay p { margin: 9px 0 0; color: #65727d; font-size: 14px; }
            #safePassAccountStatusCheckingOverlay .safe-pass-status-checking-spinner {
                width: 34px;
                height: 34px;
                margin: 0 auto 16px;
                border: 4px solid #dce6ec;
                border-top-color: #177a9b;
                border-radius: 50%;
                animation: safePassStatusSpin .8s linear infinite;
            }
            @keyframes safePassStatusSpin { to { transform: rotate(360deg); } }
        `;

        document.head.appendChild(style);
        document.body.appendChild(overlay);
    }

    function hideAccountStatusCheckingOverlay() {
        const overlay = document.getElementById("safePassAccountStatusCheckingOverlay");
        const style = document.getElementById("safePassAccountStatusCheckingStyles");
        if (overlay) overlay.remove();
        if (style) style.remove();
        accountStatusGateActive = false;
    }

    // Block keyboard/click/form actions until status verification finishes,
    // and keep all interactions blocked after an account restriction is found.
    ["click", "submit", "keydown", "keypress", "keyup"].forEach(eventName => {
        document.addEventListener(eventName, event => {
            if (accountStatusGateActive || accountRestrictionHandled) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === "function") {
                    event.stopImmediatePropagation();
                }
            }
        }, true);
    });

    function normalizeAccountStatus(value) {
        if (value === null || value === undefined) {
            return "";
        }

        return String(value)
            .trim()
            .toLowerCase()
            .replace(/[-_]+/g, " ")
            .replace(/\s+/g, " ");
    }

    function getRestrictedAccountMessage(status) {
        const normalized = normalizeAccountStatus(status);

        if (normalized === "suspended") {
            return "Your account is suspended.";
        }

        if (normalized === "blocked") {
            return "Your account is blocked.";
        }

        if (
            normalized === "disabled" ||
            normalized === "disable"
        ) {
            return "Your account is disabled.";
        }

        return "";
    }

    function clearLoginSessionForRestriction() {
        if (dashboardRealtimeSub && supabaseClient) {
            try {
                supabaseClient.removeChannel(
                    dashboardRealtimeSub
                );
            } catch (error) {
                console.warn(
                    "Unable to remove dashboard realtime channel:",
                    error
                );
            }

            dashboardRealtimeSub = null;
        }

        if (accountStatusChannel && supabaseClient) {
            try {
                supabaseClient.removeChannel(
                    accountStatusChannel
                );
            } catch (error) {
                console.warn(
                    "Unable to remove account status channel:",
                    error
                );
            }

            accountStatusChannel = null;
        }

        if (accountStatusPollTimer) {
            clearInterval(accountStatusPollTimer);
            accountStatusPollTimer = null;
        }

        localStorage.removeItem("safePassUser");
        localStorage.removeItem("user");
        localStorage.removeItem("isLoggedIn");
        localStorage.removeItem("activeTab");

        /*
          IMPORTANT: Never delete vault data when an account is logged out
          or force-logged-out because of account status. Vault records are
          user data, not login-session data. The records remain in Supabase
          and the local cache remains available for the same user after the
          next login. The user can delete individual records from the vault
          UI when they choose to do so.
        */
    }

    function showAccountRestrictionPopup(status) {
        const message = getRestrictedAccountMessage(status);

        if (!message || accountRestrictionHandled) {
            return;
        }

        accountRestrictionHandled = true;

        /*
          Stop normal dashboard activity immediately. The popup is shown
          before redirecting so the user can clearly see why the session
          was terminated.
        */
        clearLoginSessionForRestriction();
        hideAccountStatusCheckingOverlay();

        const existingPopup =
            document.getElementById(
                "safePassAccountRestrictionOverlay"
            );

        if (existingPopup) {
            return;
        }

        const overlay =
            document.createElement("div");

        overlay.id =
            "safePassAccountRestrictionOverlay";

        overlay.innerHTML = `
            <div
                class="safe-pass-account-alert"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="safePassAccountAlertTitle"
                aria-describedby="safePassAccountAlertMessage"
            >
                <div class="safe-pass-warning-icon" aria-hidden="true">
                    &#9888;
                </div>

                <h2 id="safePassAccountAlertTitle">
                    Account Access Restricted
                </h2>

                <p
                    id="safePassAccountAlertMessage"
                    class="safe-pass-account-alert-message"
                >
                    ${escapeHTML(message)}
                </p>

                <p class="safe-pass-account-alert-contact">
                    Please contact SafePass Vault Admin.
                </p>

                <p class="safe-pass-account-alert-countdown" aria-live="polite">
                    Redirecting to the login page in
                    <strong id="safePassAccountAlertCountdown">10</strong>
                    seconds...
                </p>
            </div>
        `;

        const style =
            document.createElement("style");

        style.id =
            "safePassAccountRestrictionStyles";

        style.textContent = `
            #safePassAccountRestrictionOverlay {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                box-sizing: border-box;
                background: rgba(10, 18, 30, 0.72);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
            }

            #safePassAccountRestrictionOverlay
            .safe-pass-account-alert {
                width: min(460px, 100%);
                box-sizing: border-box;
                padding: 30px 28px 28px;
                border-radius: 16px;
                background: #ffffff;
                border: 1px solid #e1e7ec;
                box-shadow:
                    0 22px 60px rgba(0, 0, 0, 0.28);
                text-align: center;
                font-family:
                    Arial,
                    Helvetica,
                    sans-serif;
                animation:
                    safePassAlertIn
                    0.18s
                    ease-out;
            }

            #safePassAccountRestrictionOverlay
            .safe-pass-warning-icon {
                width: 68px;
                height: 68px;
                margin: 0 auto 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background: #fff4d6;
                color: #e59b00;
                border: 2px solid #f0c45c;
                font-size: 36px;
                font-weight: 700;
                line-height: 1;
            }

            #safePassAccountRestrictionOverlay
            h2 {
                margin: 0 0 12px;
                color: #244b5d;
                font-size: 21px;
                font-weight: 700;
            }

            #safePassAccountRestrictionOverlay
            .safe-pass-account-alert-message {
                margin: 0 0 10px;
                color: #d64545;
                font-size: 17px;
                font-weight: 700;
                line-height: 1.5;
            }

            #safePassAccountRestrictionOverlay
            .safe-pass-account-alert-contact {
                margin: 0;
                color: #5f6b75;
                font-size: 14px;
                line-height: 1.5;
            }

            #safePassAccountRestrictionOverlay
            .safe-pass-account-alert-countdown {
                margin: 18px 0 0;
                padding-top: 14px;
                border-top: 1px solid #edf0f3;
                color: #6b7680;
                font-size: 13px;
                line-height: 1.5;
            }

            #safePassAccountRestrictionOverlay
            .safe-pass-account-alert-countdown strong {
                display: inline-flex;
                min-width: 26px;
                justify-content: center;
                color: #d64545;
                font-size: 16px;
                font-weight: 700;
            }

            @keyframes safePassAlertIn {
                from {
                    opacity: 0;
                    transform: translateY(8px) scale(0.98);
                }

                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(overlay);

        /*
          Keep the warning visible for a full 10 seconds so the user has
          enough time to read it. The countdown updates once per second.
          The session/local cache was already cleared above.
        */
        const countdownElement =
            document.getElementById(
                "safePassAccountAlertCountdown"
            );

        let secondsRemaining = 10;

        const countdownTimer =
            window.setInterval(() => {
                secondsRemaining -= 1;

                if (countdownElement) {
                    countdownElement.textContent =
                        String(Math.max(secondsRemaining, 0));
                }

                if (secondsRemaining <= 0) {
                    window.clearInterval(countdownTimer);
                    window.location.replace("index.html");
                }
            }, 1000);
    }

    async function findAccountStatusConfig() {
        if (!supabaseClient) {
            return null;
        }

        const currentUserId = getCurrentUserId();

        if (!currentUserId) {
            return null;
        }

        /*
          IMPORTANT:
          Fetch the real row shape once. This avoids probing invalid columns
          such as user_id/userid/status/account_status and producing 400s.
        */
        try {
            const result = await supabaseClient
                .from(ACCOUNT_STATUS_TABLE)
                .select("*")
                .limit(1);

            if (result.error || !Array.isArray(result.data) || result.data.length === 0) {
                return null;
            }

            const sampleRow = result.data[0];
            const keys = Object.keys(sampleRow);

            const idColumn =
                ACCOUNT_STATUS_ID_COLUMN_PREFERENCES.find(
                    key => keys.includes(key)
                ) || "";

            const statusColumn =
                ACCOUNT_STATUS_COLUMN_PREFERENCES.find(
                    key => keys.includes(key)
                ) || "";

            if (!idColumn) {
                return null;
            }

            /*
              If the schema has no status field, the existing SafePass admin
              code treats a missing status as active. Do not issue invalid
              requests just to guess another column.
            */
            return {
                tableName: ACCOUNT_STATUS_TABLE,
                idColumn,
                statusColumn
            };
        } catch (_) {
            return null;
        }
    }

    async function readCurrentAccountStatus() {
        if (!supabaseClient || accountRestrictionHandled) {
            return "";
        }

        const currentUserId =
            getCurrentUserId();

        if (!currentUserId) {
            return "";
        }

        if (!accountStatusConfig) {
            accountStatusConfig =
                await findAccountStatusConfig();

            if (accountStatusConfig) {
                initAccountStatusRealtime();
            }
        }

        if (!accountStatusConfig) {
            return "";
        }

        try {
            /*
              If no status column exists in this SafePass schema, the users
              table itself is still the authoritative user list and the admin
              UI defaults missing status to active. Avoid an invalid REST query.
            */
            if (!accountStatusConfig.statusColumn) {
                const rowResult = await supabaseClient
                    .from(accountStatusConfig.tableName)
                    .select("*")
                    .eq(
                        accountStatusConfig.idColumn,
                        currentUserId
                    )
                    .limit(1);

                if (rowResult.error || !Array.isArray(rowResult.data) || !rowResult.data.length) {
                    return "";
                }

                hideAccountStatusCheckingOverlay();

                if (!accountStatusChannel) {
                    initAccountStatusRealtime();
                }

                initDashboardRealtime();
                loadVaultRecords();
                return "active";
            }

            const result =
                await supabaseClient
                    .from(
                        accountStatusConfig.tableName
                    )
                    .select(
                        accountStatusConfig.statusColumn
                    )
                    .eq(
                        accountStatusConfig.idColumn,
                        currentUserId
                    )
                    .limit(1);

            if (result.error) {
                return "";
            }

            const row =
                Array.isArray(result.data) &&
                result.data.length > 0
                    ? result.data[0]
                    : null;

            if (!row) {
                return "";
            }

            const status =
                normalizeAccountStatus(
                    row[
                        accountStatusConfig
                            .statusColumn
                    ]
                );

            const restrictedMessage =
                getRestrictedAccountMessage(
                    status
                );

            if (restrictedMessage) {
                showAccountRestrictionPopup(status);
            } else if (!accountRestrictionHandled) {
                // Only allow dashboard interaction after a real user row and
                // status field have been read successfully from Supabase.
                hideAccountStatusCheckingOverlay();
                initDashboardRealtime();
                loadVaultRecords();
            }

            return status;
        } catch (_) {
            return "";
        }
    }

    function initAccountStatusRealtime() {
        if (
            !supabaseClient ||
            !accountStatusConfig ||
            accountStatusChannel ||
            accountRestrictionHandled
        ) {
            return;
        }

        const currentUserId =
            getCurrentUserId();

        if (!currentUserId) {
            return;
        }

        accountStatusChannel =
            supabaseClient
                .channel(
                    "dashboard-account-status-" +
                    currentUserId
                )
                .on(
                    "postgres_changes",
                    {
                        event: "UPDATE",
                        schema: "public",
                        table:
                            accountStatusConfig
                                .tableName,
                        filter:
                            accountStatusConfig
                                .idColumn +
                            "=eq." +
                            currentUserId
                    },
                    payload => {
                        const newRow =
                            payload &&
                            payload.new
                                ? payload.new
                                : {};

                        const status =
                            normalizeAccountStatus(
                                newRow[
                                    accountStatusConfig
                                        .statusColumn
                                ]
                            );

                        if (
                            getRestrictedAccountMessage(
                                status
                            )
                        ) {
                            showAccountRestrictionPopup(
                                status
                            );
                        }
                    }
                )
                .subscribe(
                    () => {
                        /* Realtime status is intentionally silent in production UI. */
                    }
                );
    }

    async function initAccountStatusGuard() {
        if (!supabaseClient) {
            console.error(
                "Account status verification unavailable: Supabase client is not loaded."
            );
            // Keep the blocking overlay visible; status cannot be verified.
            return;
        }

        /*
          Check the database immediately during dashboard startup. The
          dashboard remains covered and keyboard/click actions are blocked
          until this first check finishes. A restricted status replaces the
          checking overlay with the warning popup and clears the login session.
        */
        accountStatusCheckInProgress = true;
        try {
            await readCurrentAccountStatus();
        } finally {
            accountStatusCheckInProgress = false;
        }

        /*
          The overlay is removed only inside readCurrentAccountStatus after a
          valid user row is fetched and its status is confirmed unrestricted.
          If schema/network verification fails, the dashboard stays blocked.

          Polling fallback makes the feature work even when the users table
          has not been added to the Supabase Realtime publication.
        */
        accountStatusPollTimer =
            window.setInterval(
                async () => {
                    if (
                        accountRestrictionHandled ||
                        accountStatusCheckInProgress
                    ) {
                        return;
                    }

                    accountStatusCheckInProgress =
                        true;

                    try {
                        await readCurrentAccountStatus();
                    } finally {
                        accountStatusCheckInProgress =
                            false;
                    }
                },
                ACCOUNT_STATUS_POLL_MS
            );
    }

    if (
        window.supabase &&
        typeof window.supabase.createClient === "function"
    ) {
        /*
          Reuse a page-level SafePass client when another SafePass script has
          already initialized one. This prevents multiple GoTrueClient
          instances from sharing the same auth storage key.
        */
        if (
            window.__safePassSupabaseClient &&
            typeof window.__safePassSupabaseClient.from === "function"
        ) {
            supabaseClient =
                window.__safePassSupabaseClient;
        } else {
            supabaseClient =
                window.supabase.createClient(
                    SUPABASE_URL,
                    SUPABASE_ANON_KEY,
                    {
                        realtime: {
                            params: {
                                eventsPerSecond: 10
                            }
                        }
                    }
                );

            window.__safePassSupabaseClient =
                supabaseClient;
        }
    }


    /* ======================================================================
       2. LOGIN SESSION
       ====================================================================== */

    const loggedInUserStr =
        localStorage.getItem("safePassUser") ||
        localStorage.getItem("user");

    const isLoggedIn =
        localStorage.getItem("isLoggedIn");

    if (
        !loggedInUserStr &&
        (!isLoggedIn || isLoggedIn === "false")
    ) {
        window.location.href = "index.html";
        return;
    }

    let loggedInUser = {};

    try {
        loggedInUser = loggedInUserStr
            ? JSON.parse(loggedInUserStr)
            : {};
    } catch (error) {

        console.error(
            "Unable to parse logged-in user:",
            error
        );

        localStorage.removeItem("safePassUser");
        localStorage.removeItem("user");
        localStorage.removeItem("isLoggedIn");

        window.location.href = "index.html";
        return;
    }


    /* ======================================================================
       3. USER ID HELPERS
       ====================================================================== */

    function normalizeUserId(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        const valueString =
            String(value).trim();

        return /^\d{10}$/.test(valueString)
            ? valueString
            : "";
    }


    function getCurrentUserId() {

        return normalizeUserId(
            loggedInUser.userId ??
            loggedInUser.userid ??
            loggedInUser.user_id ??
            loggedInUser.id ??
            ""
        );
    }


    const authenticatedUserId =
        getCurrentUserId();

    if (!/^\d{10}$/.test(authenticatedUserId)) {

        console.error(
            "Invalid or missing 10-digit User ID."
        );

        localStorage.removeItem("safePassUser");
        localStorage.removeItem("user");
        localStorage.removeItem("isLoggedIn");
        localStorage.removeItem("activeTab");

        window.location.href = "index.html";
        return;
    }

    // Show the blocking gate and begin verification immediately after login.
    // Dashboard controls stay blocked until Supabase confirms the account status.
    showAccountStatusCheckingOverlay();
    initAccountStatusGuard();

    function normalizeEmail(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .trim()
            .toLowerCase();
    }


    function normalizePhone(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .trim();
    }


    function getCurrentUserEmail() {

        return normalizeEmail(
            loggedInUser.email ??
            loggedInUser.emailAddress ??
            ""
        );
    }


    function getCurrentUserPhone() {

        return normalizePhone(
            loggedInUser.phoneNumber ??
            loggedInUser.phone ??
            loggedInUser.phonenumber ??
            ""
        );
    }


    function getCurrentUserName() {

        return String(
            loggedInUser.fullName ??
            loggedInUser.name ??
            loggedInUser.userName ??
            loggedInUser.userFullName ??
            ""
        ).trim();
    }


    /* ======================================================================
       4. DISPLAY USER NAME
       ====================================================================== */

    const displayUserNameElem =
        document.getElementById("displayUserName");

    if (displayUserNameElem) {

        displayUserNameElem.textContent =
            getCurrentUserName() || "User";
    }


    /* ======================================================================
       5. LOGOUT
       ====================================================================== */

    const logoutBtn =
        document.getElementById("logoutBtn");

    if (logoutBtn) {

        logoutBtn.addEventListener("click", () => {

            if (dashboardRealtimeSub && supabaseClient) {

                try {
                    supabaseClient.removeChannel(
                        dashboardRealtimeSub
                    );
                } catch (error) {
                    console.warn(error);
                }
            }

            localStorage.removeItem("safePassUser");
            localStorage.removeItem("user");
            localStorage.removeItem("isLoggedIn");
            localStorage.removeItem("activeTab");

            /*
              IMPORTANT: Logout only clears the login/session state.
              NEVER remove "vault_records" here. Vault data belongs to the
              user and must remain available after the next login.
            */

            window.location.href = "index.html";
        });
    }


    /* ======================================================================
       6. SAFE HTML ESCAPE
       ====================================================================== */

    function escapeHTML(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    function safeUrl(value) {

        if (!value) return "";

        const raw =
            String(value).trim();

        if (!raw) return "";

        let url = raw;

        if (
            !/^https?:\/\//i.test(url)
        ) {
            url = "https://" + url;
        }

        try {

            const parsed =
                new URL(url);

            if (
                parsed.protocol !== "http:" &&
                parsed.protocol !== "https:"
            ) {
                return "";
            }

            return parsed.href;

        } catch (error) {
            return "";
        }
    }


    /* ======================================================================
       7. NAVIGATION
       ====================================================================== */

    const tabHomeBtn =
        document.getElementById("tabHomeBtn");

    const tabRecordsBtn =
        document.getElementById("tabRecordsBtn");

    const homeView =
        document.getElementById("homeView");

    const recordsView =
        document.getElementById("recordsView");

    const logoBtn =
        document.getElementById("logoBtn");


    function switchToHome() {

        if (tabHomeBtn) {
            tabHomeBtn.classList.add("active");
        }

        if (tabRecordsBtn) {
            tabRecordsBtn.classList.remove("active");
        }

        if (homeView) {
            homeView.classList.add("active-view");
        }

        if (recordsView) {
            recordsView.classList.remove("active-view");
        }

        localStorage.setItem(
            "activeTab",
            "home"
        );
    }


    function switchToRecords() {

        if (tabRecordsBtn) {
            tabRecordsBtn.classList.add("active");
        }

        if (tabHomeBtn) {
            tabHomeBtn.classList.remove("active");
        }

        if (recordsView) {
            recordsView.classList.add("active-view");
        }

        if (homeView) {
            homeView.classList.remove("active-view");
        }

        localStorage.setItem(
            "activeTab",
            "records"
        );

        loadVaultRecords();
    }


    if (tabHomeBtn) {
        tabHomeBtn.addEventListener(
            "click",
            switchToHome
        );
    }


    if (tabRecordsBtn) {
        tabRecordsBtn.addEventListener(
            "click",
            switchToRecords
        );
    }


    if (logoBtn) {

        logoBtn.addEventListener(
            "click",
            () => {

                localStorage.setItem(
                    "activeTab",
                    "home"
                );

                window.location.reload();
            }
        );
    }


    const currentActiveTab =
        localStorage.getItem("activeTab") ||
        "home";

    if (currentActiveTab === "records") {
        switchToRecords();
    } else {
        switchToHome();
    }


    /* ======================================================================
       8. SERVICE / CATEGORY DATA
       ====================================================================== */

    const categorySelect =
        document.getElementById("categorySelect");

    const accountTypeSelect =
        document.getElementById("accountTypeSelect");

    const platformQuickLink =
        document.getElementById("platformQuickLink");

    const dynamicFieldsContainer =
        document.getElementById("dynamicFieldsContainer");


    if (platformQuickLink) {
        platformQuickLink.style.display = "none";
    }


    const serviceOptions = {

        "Social Media": [
            "Facebook",
            "Instagram",
            "Twitter (X)",
            "WhatsApp",
            "LinkedIn",
            "TikTok",
            "YouTube",
            "Other Social Media"
        ],

        "Email & Messaging": [
            "Gmail / Google",
            "Outlook / Hotmail",
            "Yahoo Mail",
            "Telegram"
        ],

        "Other Accounts": [
            "Website Membership",
            "Wi-Fi Network",
            "Software License",
            "Custom Note"
        ]
    };


    const bankingSubTypes = [
        "Mobile Banking",
        "Internet Banking",
        "Card Banking",
        "Crypto Wallet",
        "PayPal"
    ];


    const bankingPlatformOptions = {

        "Mobile Banking": [
            "bKash",
            "Nagad",
            "Rocket",
            "Upay",
            "CellFin",
            "Tap",
            "Other Mobile Wallet"
        ],

        "Internet Banking": [
            "Islami Bank Bangladesh",
            "Dutch-Bangla Bank (DBBL)",
            "BRAC Bank",
            "The City Bank",
            "Eastern Bank (EBL)",
            "Sonali Bank",
            "Janata Bank",
            "Agrani Bank",
            "Pubali Bank",
            "United Commercial Bank (UCB)",
            "Mutual Trust Bank (MTB)",
            "Standard Chartered Bank",
            "HSBC",
            "Other Bank"
        ],

        "Card Banking": [
            "Visa Card",
            "Master Card",
            "Debit Card",
            "Credit Card",
            "Gift Card",
            "Other Card"
        ],

        "Crypto Wallet": [
            "Binance",
            "Coinbase",
            "Trust Wallet",
            "MetaMask",
            "Other Crypto"
        ],

        "PayPal": [
            "PayPal Account"
        ]
    };


    /* ======================================================================
       9. CATEGORY CHANGE
       ====================================================================== */

    if (categorySelect) {

        categorySelect.addEventListener(
            "change",
            () => {

                const category =
                    categorySelect.value;

                const existingSubContainer =
                    document.getElementById(
                        "bankingSubTypeContainer"
                    );

                if (existingSubContainer) {
                    existingSubContainer.remove();
                }


                if (accountTypeSelect) {

                    accountTypeSelect.innerHTML =
                        '<option value="" disabled selected>Select Service</option>';

                    if (
                        category ===
                        "Banking & Financial"
                    ) {

                        createBankingTypeDropdown();

                    } else if (
                        serviceOptions[category]
                    ) {

                        serviceOptions[category]
                            .forEach(service => {

                                const option =
                                    document.createElement(
                                        "option"
                                    );

                                option.value = service;
                                option.textContent =
                                    service;

                                accountTypeSelect
                                    .appendChild(
                                        option
                                    );
                            });
                    }
                }


                renderDynamicFields(
                    category,
                    "",
                    ""
                );
            }
        );
    }


    /* ======================================================================
       10. BANKING SUB TYPE
       ====================================================================== */

    function createBankingTypeDropdown(
        selectedSub = "",
        selectedPlatform = ""
    ) {

        let subContainer =
            document.getElementById(
                "bankingSubTypeContainer"
            );


        if (!subContainer) {

            subContainer =
                document.createElement("div");

            subContainer.id =
                "bankingSubTypeContainer";

            subContainer.className =
                "form-group";


            const accountTypeParent =
                accountTypeSelect
                    ? accountTypeSelect.closest(
                        ".form-group"
                    )
                    : null;


            if (
                accountTypeParent &&
                accountTypeParent.parentNode
            ) {

                accountTypeParent.parentNode
                    .insertBefore(
                        subContainer,
                        accountTypeParent
                    );
            }
        }


        subContainer.innerHTML = `

            <label>
                Banking Type
                <span class="required">*</span>
            </label>

            <select
                id="bankingSubTypeSelect"
                class="form-control"
            >

                <option
                    value=""
                    disabled
                    ${!selectedSub ? "selected" : ""}
                >
                    Select Banking Type
                </option>

                ${bankingSubTypes.map(
                    sub => `
                        <option
                            value="${escapeHTML(sub)}"
                            ${sub === selectedSub ? "selected" : ""}
                        >
                            ${escapeHTML(sub)}
                        </option>
                    `
                ).join("")}

            </select>

            <small
                class="error-msg"
                id="err-bankingSubTypeSelect"
                style="
                    color:#e74c3c;
                    display:none;
                    margin-top:4px;
                    font-size:12px;
                "
            ></small>
        `;


        const subTypeSelectElem =
            document.getElementById(
                "bankingSubTypeSelect"
            );


        if (subTypeSelectElem) {

            if (selectedSub) {

                populatePlatformsForBanking(
                    selectedSub,
                    selectedPlatform
                );
            }


            subTypeSelectElem.addEventListener(
                "change",
                () => {

                    const chosenSub =
                        subTypeSelectElem.value;

                    populatePlatformsForBanking(
                        chosenSub,
                        ""
                    );

                    renderDynamicFields(
                        "Banking & Financial",
                        chosenSub,
                        ""
                    );
                }
            );
        }
    }


    /* ======================================================================
       11. BANKING PLATFORM
       ====================================================================== */

    function populatePlatformsForBanking(
        subType,
        selectedPlatform = ""
    ) {

        if (!accountTypeSelect) return;


        accountTypeSelect.innerHTML = `

            <option
                value=""
                disabled
                ${!selectedPlatform ? "selected" : ""}
            >
                Select ${escapeHTML(subType)} Provider
            </option>
        `;


        if (bankingPlatformOptions[subType]) {

            bankingPlatformOptions[subType]
                .forEach(platform => {

                    const option =
                        document.createElement("option");

                    option.value = platform;
                    option.textContent = platform;

                    if (
                        platform ===
                        selectedPlatform
                    ) {
                        option.selected = true;
                    }

                    accountTypeSelect
                        .appendChild(option);
                });
        }


        accountTypeSelect.onchange =
            function () {

                const subTypeSelectElem =
                    document.getElementById(
                        "bankingSubTypeSelect"
                    );

                const currentSub =
                    subTypeSelectElem
                        ? subTypeSelectElem.value
                        : "";


                renderDynamicFields(
                    "Banking & Financial",
                    currentSub,
                    accountTypeSelect.value
                );
            };
    }


    /* ======================================================================
       12. DYNAMIC FORM FIELDS
       ====================================================================== */

    function renderDynamicFields(
        category,
        subType = "",
        specificPlatform = "",
        presetData = {}
    ) {

        if (!dynamicFieldsContainer) {
            return;
        }


        dynamicFieldsContainer.innerHTML = "";


        if (
            category ===
            "Banking & Financial"
        ) {

            const isCardBanking =
                subType === "Card Banking" ||
                (
                    bankingPlatformOptions[
                        "Card Banking"
                    ] || []
                ).includes(
                    specificPlatform
                );


            const isInternetBanking =
                subType ===
                "Internet Banking";


            const isPayPal =
                subType === "PayPal" ||
                specificPlatform ===
                "PayPal Account";


            const isMobileBanking =
                subType ===
                "Mobile Banking";


            const isCryptoWallet =
                subType ===
                "Crypto Wallet";


            let mainNumLabel =
                "Account / Card Number <span class='required'>*</span>";

            let mainNumPlaceholder =
                "Enter number";


            if (isCardBanking) {

                mainNumLabel =
                    "Card Number <span class='required'>*</span>";

                mainNumPlaceholder =
                    "Enter card number";
            }


            if (isMobileBanking) {

                mainNumLabel =
                    "Account Number <span class='required'>*</span>";

                mainNumPlaceholder =
                    "Enter mobile account number";
            }


            if (isInternetBanking) {

                mainNumLabel =
                    "Account Number <span class='required'>*</span>";

                mainNumPlaceholder =
                    "Enter bank account number";
            }


            if (isCryptoWallet) {

                mainNumLabel =
                    "Account / Wallet ID <span class='required'>*</span>";

                mainNumPlaceholder =
                    "Enter crypto account or wallet ID";
            }


            if (isPayPal) {

                mainNumLabel =
                    "Account Number (Optional)";

                mainNumPlaceholder =
                    "Enter account number";
            }


            const cardBankNameField =
                isCardBanking
                    ? `

                <div class="form-group">

                    <label>
                        Card Bank Name
                        <span class="required">*</span>
                    </label>

                    <input
                        type="text"
                        id="fieldCardBankName"
                        placeholder="e.g. EBL, City Bank"
                        value="${escapeHTML(
                            presetData.cardBankName ??
                            presetData.cardbankname ??
                            ""
                        )}"
                    >

                    <small
                        class="error-msg"
                        id="err-fieldCardBankName"
                    ></small>

                </div>
            `
                    : "";


            const cryptoFields =
                isCryptoWallet
                    ? `

                <div class="form-group">

                    <label>
                        Crypto Account
                        (Optional)
                    </label>

                    <input
                        type="text"
                        id="fieldCryptoAccount"
                        placeholder="Enter crypto account"
                        value="${escapeHTML(
                            presetData.cryptoAccount ??
                            presetData.cryptoaccount ??
                            ""
                        )}"
                    >

                </div>

                <div class="form-group">

                    <label>
                        Crypto Card
                        (Optional)
                    </label>

                    <input
                        type="text"
                        id="fieldCryptoCard"
                        placeholder="Enter crypto card"
                        value="${escapeHTML(
                            presetData.cryptoCard ??
                            presetData.cryptocard ??
                            ""
                        )}"
                    >

                </div>
            `
                    : "";


            const emailLabel =
                isPayPal
                    ? "Email Address <span class='required'>*</span>"
                    : "Email Address (Optional)";


            const passwordLabel =
                isInternetBanking
                    ? "PIN / Password (Optional)"
                    : "PIN / Password <span class='required'>*</span>";


            const expiryDateVal =
                presetData.expiryDate ??
                presetData.expirydate ??
                "";


            const cvvVal =
                presetData.extraDetail ??
                presetData.extradetail ??
                "";


            const expiryDateField =
                isCardBanking
                    ? `

                <div class="form-group">

                    <label>
                        Card Expiry Date
                        <span class="required">*</span>
                    </label>

                    <input
                        type="text"
                        id="fieldExpiryDate"
                        maxlength="7"
                        placeholder="MM/YY"
                        value="${escapeHTML(
                            expiryDateVal
                        )}"
                    >

                </div>

            `
                    : `

                <div class="form-group">

                    <label>
                        Card Expiry Date
                        (Optional)
                    </label>

                    <input
                        type="text"
                        id="fieldExpiryDate"
                        maxlength="7"
                        placeholder="MM/YY"
                        value="${escapeHTML(
                            expiryDateVal
                        )}"
                    >

                </div>
            `;


            const cvvLabel =
                isCardBanking
                    ? "CVV Code <span class='required'>*</span>"
                    : "CVV Code (3 Digits) (Optional)";


            dynamicFieldsContainer.innerHTML = `

                <div class="form-group">

                    <label>
                        Account Holder Name
                        <span class="required">*</span>
                    </label>

                    <input
                        type="text"
                        id="fieldHolderName"
                        placeholder="e.g. John Doe"
                        value="${escapeHTML(
                            presetData.holderName ??
                            presetData.holdername ??
                            ""
                        )}"
                    >

                    <small
                        class="error-msg"
                        id="err-fieldHolderName"
                    ></small>

                </div>


                ${cardBankNameField}


                ${cryptoFields}


                <div class="form-group">

                    <label>
                        ${mainNumLabel}
                    </label>

                    <input
                        type="text"
                        id="fieldAccountNo"
                        placeholder="${escapeHTML(
                            mainNumPlaceholder
                        )}"
                        value="${escapeHTML(
                            presetData.identifier ??
                            ""
                        )}"
                    >

                    <small
                        class="error-msg"
                        id="err-fieldAccountNo"
                    ></small>

                </div>


                <div class="form-group">

                    <label>
                        Phone Number
                        <span class="required">*</span>
                    </label>

                    <input
                        type="text"
                        id="fieldPhoneNumber"
                        placeholder="Enter phone number"
                        value="${escapeHTML(
                            presetData.phoneNumber ??
                            presetData.phonenumber ??
                            ""
                        )}"
                    >

                    <small
                        class="error-msg"
                        id="err-fieldPhoneNumber"
                    ></small>

                </div>


                <div class="form-group">

                    <label>
                        ${emailLabel}
                    </label>

                    <input
                        type="email"
                        id="fieldEmail"
                        placeholder="e.g. user@example.com"
                        value="${escapeHTML(
                            presetData.email ??
                            ""
                        )}"
                    >

                    <small
                        class="error-msg"
                        id="err-fieldEmail"
                    ></small>

                </div>


                <div class="form-group">

                    <label>
                        Profile / Visit Link
                        (Optional)
                    </label>

                    <input
                        type="text"
                        id="fieldProfileLink"
                        placeholder="https://site.com"
                        value="${escapeHTML(
                            presetData.profileLink ??
                            presetData.profilelink ??
                            ""
                        )}"
                    >

                </div>


                <div class="form-group">

                    <label>
                        ${passwordLabel}
                    </label>

                    <input
                        type="password"
                        class="secure-input"
                        id="fieldSecret"
                        placeholder="******"
                        value="${escapeHTML(
                            presetData.secret ??
                            ""
                        )}"
                    >

                    <small
                        class="error-msg"
                        id="err-fieldSecret"
                    ></small>

                </div>


                ${expiryDateField}


                <div class="form-group">

                    <label>
                        ${cvvLabel}
                    </label>

                    <input
                        type="text"
                        id="fieldExtraDetail"
                        maxlength="3"
                        placeholder="3 digits"
                        value="${escapeHTML(
                            cvvVal
                        )}"
                    >

                </div>
            `;


            const expiryInput =
                document.getElementById(
                    "fieldExpiryDate"
                );


            if (expiryInput) {

                expiryInput.addEventListener(
                    "input",
                    function () {

                        let value =
                            this.value
                                .replace(/\D/g, "");

                        if (value.length >= 2) {

                            let month =
                                value.substring(0, 2);

                            const monthNumber =
                                parseInt(
                                    month,
                                    10
                                );

                            if (
                                monthNumber > 12
                            ) {
                                month = "12";
                            }

                            if (
                                monthNumber < 1
                            ) {
                                month = "01";
                            }

                            value =
                                month +
                                "/" +
                                value.substring(
                                    2,
                                    6
                                );
                        }

                        this.value = value;
                    }
                );
            }

        } else {

            /* ==============================================================
               NORMAL ACCOUNT FIELDS
               ============================================================== */

            dynamicFieldsContainer.innerHTML = `

                <div class="form-group">

                    <label>
                        Username / Email / Phone
                        <span class="required">*</span>
                    </label>

                    <input
                        type="text"
                        id="fieldIdentifier"
                        placeholder="e.g. example@gmail.com"
                        value="${escapeHTML(
                            presetData.identifier ??
                            ""
                        )}"
                    >

                    <small
                        class="error-msg"
                        id="err-fieldIdentifier"
                    ></small>

                </div>


                <div class="form-group">

                    <label>
                        Profile / Visit Link
                        (Optional)
                    </label>

                    <input
                        type="text"
                        id="fieldProfileLink"
                        placeholder="https://instagram.com/profile"
                        value="${escapeHTML(
                            presetData.profileLink ??
                            presetData.profilelink ??
                            ""
                        )}"
                    >

                </div>


                <div class="form-group">

                    <label>
                        Account Password
                        <span class="required">*</span>
                    </label>

                    <input
                        type="password"
                        class="secure-input"
                        id="fieldSecret"
                        placeholder="******"
                        value="${escapeHTML(
                            presetData.secret ??
                            ""
                        )}"
                    >

                    <small
                        class="error-msg"
                        id="err-fieldSecret"
                    ></small>

                </div>
            `;
        }
    }


    /* ======================================================================
       13. FORM ERROR HELPERS
       ====================================================================== */

    function showFieldError(
        fieldId,
        message
    ) {

        const field =
            document.getElementById(fieldId);

        const error =
            document.getElementById(
                "err-" + fieldId
            );


        if (field) {
            field.style.borderColor =
                "#e74c3c";
        }


        if (error) {

            error.textContent =
                message;

            error.style.display =
                "block";

            error.style.color =
                "#e74c3c";

            error.style.fontSize =
                "12px";
        }
    }


    function clearFieldErrors() {

        document
            .querySelectorAll(
                ".form-group input, .form-group select"
            )
            .forEach(input => {
                input.style.borderColor = "";
            });


        document
            .querySelectorAll(".error-msg")
            .forEach(error => {

                error.textContent = "";
                error.style.display = "none";
            });
    }


    /* ======================================================================
       14. SAVE / EDIT FORM
       ====================================================================== */

    const saveCredentialForm =
        document.getElementById(
            "saveCredentialForm"
        );

    const formTitle =
        document.getElementById(
            "formTitle"
        );

    const submitFormBtn =
        document.getElementById(
            "submitFormBtn"
        );

    const cancelEditBtn =
        document.getElementById(
            "cancelEditBtn"
        );

    const editRecordIdInput =
        document.getElementById(
            "editRecordId"
        );


    if (saveCredentialForm) {

        saveCredentialForm.addEventListener(
            "submit",
            async event => {

                event.preventDefault();

                clearFieldErrors();


                const category =
                    categorySelect
                        ? categorySelect.value
                        : "";


                const platform =
                    accountTypeSelect
                        ? accountTypeSelect.value
                        : "";


                if (!category) {

                    alert(
                        "Please select a category."
                    );

                    return;
                }


                let hasError = false;


                let bankingSubTypeVal =
                    "";


                if (
                    category ===
                    "Banking & Financial"
                ) {

                    const subtype =
                        document.getElementById(
                            "bankingSubTypeSelect"
                        );

                    bankingSubTypeVal =
                        subtype
                            ? subtype.value
                            : "";


                    if (!bankingSubTypeVal) {

                        showFieldError(
                            "bankingSubTypeSelect",
                            "Please select banking type."
                        );

                        hasError = true;
                    }
                }


                if (!platform) {

                    alert(
                        "Please select a platform/service."
                    );

                    return;
                }


                let holderNameVal = "";
                let identifierVal = "";
                let phoneNumberVal = "";
                let emailVal = "";
                let cardBankNameVal = "";
                let cryptoAccountVal = "";
                let cryptoCardVal = "";
                let profileLinkVal = "";
                let secretVal = "";
                let expiryDateVal = "";
                let extraDetailVal = "";


                if (
                    category ===
                    "Banking & Financial"
                ) {

                    holderNameVal =
                        document.getElementById(
                            "fieldHolderName"
                        )?.value.trim() || "";


                    identifierVal =
                        document.getElementById(
                            "fieldAccountNo"
                        )?.value.trim() || "";


                    phoneNumberVal =
                        document.getElementById(
                            "fieldPhoneNumber"
                        )?.value.trim() || "";


                    emailVal =
                        document.getElementById(
                            "fieldEmail"
                        )?.value.trim() || "";


                    profileLinkVal =
                        document.getElementById(
                            "fieldProfileLink"
                        )?.value.trim() || "";


                    secretVal =
                        document.getElementById(
                            "fieldSecret"
                        )?.value || "";


                    expiryDateVal =
                        document.getElementById(
                            "fieldExpiryDate"
                        )?.value.trim() || "";


                    extraDetailVal =
                        document.getElementById(
                            "fieldExtraDetail"
                        )?.value.trim() || "";


                    cardBankNameVal =
                        document.getElementById(
                            "fieldCardBankName"
                        )?.value.trim() || "";


                    cryptoAccountVal =
                        document.getElementById(
                            "fieldCryptoAccount"
                        )?.value.trim() || "";


                    cryptoCardVal =
                        document.getElementById(
                            "fieldCryptoCard"
                        )?.value.trim() || "";


                    if (!holderNameVal) {

                        showFieldError(
                            "fieldHolderName",
                            "Account holder name is required."
                        );

                        hasError = true;
                    }


                    const isCardBanking =
                        bankingSubTypeVal ===
                            "Card Banking" ||
                        (
                            bankingPlatformOptions[
                                "Card Banking"
                            ] || []
                        ).includes(platform);


                    if (
                        isCardBanking &&
                        !cardBankNameVal
                    ) {

                        showFieldError(
                            "fieldCardBankName",
                            "Card bank name is required."
                        );

                        hasError = true;
                    }


                    const isPayPal =
                        bankingSubTypeVal ===
                            "PayPal" ||
                        platform ===
                            "PayPal Account";


                    if (
                        !isPayPal &&
                        !identifierVal
                    ) {

                        showFieldError(
                            "fieldAccountNo",
                            "Account/Card number is required."
                        );

                        hasError = true;
                    }


                    if (!phoneNumberVal) {

                        showFieldError(
                            "fieldPhoneNumber",
                            "Phone number is required."
                        );

                        hasError = true;
                    }


                    if (
                        isPayPal &&
                        !emailVal
                    ) {

                        showFieldError(
                            "fieldEmail",
                            "Email address is required."
                        );

                        hasError = true;
                    }


                    const isInternetBanking =
                        bankingSubTypeVal ===
                        "Internet Banking";


                    if (
                        !isInternetBanking &&
                        !secretVal
                    ) {

                        showFieldError(
                            "fieldSecret",
                            "PIN or password is required."
                        );

                        hasError = true;
                    }

                } else {

                    identifierVal =
                        document.getElementById(
                            "fieldIdentifier"
                        )?.value.trim() || "";


                    profileLinkVal =
                        document.getElementById(
                            "fieldProfileLink"
                        )?.value.trim() || "";


                    secretVal =
                        document.getElementById(
                            "fieldSecret"
                        )?.value || "";


                    if (!identifierVal) {

                        showFieldError(
                            "fieldIdentifier",
                            "Username, email, or phone is required."
                        );

                        hasError = true;
                    }


                    if (!secretVal) {

                        showFieldError(
                            "fieldSecret",
                            "Account password is required."
                        );

                        hasError = true;
                    }
                }


                if (hasError) {
                    return;
                }


                const currentUserId =
                    getCurrentUserId();


                if (
                    !/^\d{10}$/.test(
                        currentUserId
                    )
                ) {

                    alert(
                        "Your login session is invalid. Please log in again."
                    );

                    window.location.href =
                        "index.html";

                    return;
                }


                const editId =
                    editRecordIdInput
                        ? editRecordIdInput.value.trim()
                        : "";


                const recordId =
                    editId ||
                    "rec-" +
                    Date.now() +
                    "-" +
                    Math.random()
                        .toString(36)
                        .slice(2, 8);


                const payloadData = {

                    id: recordId,

                    userid: currentUserId,

                    userfullname:
                        getCurrentUserName(),

                    category:
                        category,

                    bankingsubtype:
                        bankingSubTypeVal,

                    platform:
                        platform,

                    notes:
                        document.getElementById(
                            "extraNotes"
                        )?.value || "",

                    holdername:
                        holderNameVal,

                    cardbankname:
                        cardBankNameVal,

                    cryptoaccount:
                        cryptoAccountVal,

                    cryptocard:
                        cryptoCardVal,

                    identifier:
                        identifierVal,

                    phonenumber:
                        phoneNumberVal,

                    email:
                        emailVal,

                    profilelink:
                        profileLinkVal,

                    secret:
                        secretVal,

                    expirydate:
                        expiryDateVal,

                    extradetail:
                        extraDetailVal
                };


                let cloudSaved = false;
                let cloudSaveError = null;
                let savedCloudRecord = null;


                /* ==========================================================
                   SUPABASE SAVE
                   ==========================================================
                   The credentials table may use either a text id supplied by
                   the dashboard or a numeric/UUID auto-generated id. Try the
                   normal record first. If the database rejects the custom id
                   because of its type/default, retry without id so Supabase
                   can generate it.
                */

                try {

                    if (!supabaseClient) {
                        throw new Error(
                            "Supabase client unavailable."
                        );
                    }


                    if (editId) {

                        const {
                            error
                        } = await supabaseClient
                            .from("credentials")
                            .update(payloadData)
                            .eq("id", editId)
                            .eq(
                                "userid",
                                currentUserId
                            );


                        if (error) {
                            throw error;
                        }

                        savedCloudRecord = payloadData;

                    } else {

                        /* First attempt: keep the existing SafePass record id. */
                        const firstInsert = await supabaseClient
                            .from("credentials")
                            .insert([payloadData]);


                        if (!firstInsert.error) {

                            savedCloudRecord = payloadData;

                        } else {

                            /*
                              Some credentials tables define id as bigint, uuid,
                              identity, or another generated type. In that case
                              a value such as "rec-..." is rejected. Retry with
                              the id removed and let the database generate it.
                            */
                            const retryPayload = { ...payloadData };
                            delete retryPayload.id;

                            const secondInsert = await supabaseClient
                                .from("credentials")
                                .insert([retryPayload])
                                .select()
                                .maybeSingle();


                            if (secondInsert.error) {
                                throw new Error(
                                    (firstInsert.error?.message || "Initial insert failed.") +
                                    " | Retry without record id failed: " +
                                    (secondInsert.error?.message || "Unknown database error.")
                                );
                            }

                            savedCloudRecord =
                                secondInsert.data ||
                                retryPayload;
                        }
                    }


                    cloudSaved = true;

                } catch (error) {

                    cloudSaveError = error;

                    console.error(
                        "Supabase save error:",
                        error
                    );
                }


                /* ==========================================================
                   LOCAL CACHE
                   ========================================================== */

                let localRecords = [];

                try {

                    const parsed =
                        JSON.parse(
                            localStorage.getItem(
                                "vault_records"
                            ) || "[]"
                        );

                    if (
                        Array.isArray(parsed)
                    ) {
                        localRecords =
                            parsed;
                    }

                } catch (error) {

                    localRecords = [];
                }


                const localRecordToStore =
                    savedCloudRecord ||
                    payloadData;


                if (editId) {

                    let found = false;


                    localRecords =
                        localRecords.map(
                            record => {

                                const sameUser =
                                    normalizeUserId(
                                        record.userid ??
                                        record.userId ??
                                        record.user_id ??
                                        ""
                                    ) ===
                                    currentUserId;


                                const sameRecord =
                                    String(
                                        record.id ??
                                        record._id ??
                                        ""
                                    ) ===
                                    String(
                                        editId
                                    );


                                if (
                                    sameUser &&
                                    sameRecord
                                ) {

                                    found = true;

                                    return localRecordToStore;
                                }


                                return record;
                            }
                        );


                    if (!found) {
                        localRecords.push(
                            localRecordToStore
                        );
                    }

                } else {

                    localRecords.push(
                        localRecordToStore
                    );
                }


                localStorage.setItem(
                    "vault_records",
                    JSON.stringify(
                        localRecords.filter(
                            recordBelongsToCurrentUser
                        )
                    )
                );


                if (cloudSaved) {

                    alert(
                        editId
                            ? "Credential details updated successfully!"
                            : "Credentials securely saved to vault!"
                    );

                } else {

                    const rawCloudError =
                        cloudSaveError?.message ||
                        cloudSaveError?.details ||
                        cloudSaveError?.hint ||
                        "Unknown Supabase error.";

                    const readableCloudError =
                        String(rawCloudError)
                            .replace(/\s+/g, " ")
                            .trim()
                            .slice(0, 500);

                    alert(
                        (editId
                            ? "Cloud update failed. "
                            : "Cloud save failed. ") +
                        "The record was kept in this browser.\n\n" +
                        "Database message: " +
                        readableCloudError
                    );
                }


                resetFormState();

                switchToRecords();
            }
        );
    }


    /* ======================================================================
       15. RESET FORM
       ====================================================================== */

    function resetFormState() {

        if (saveCredentialForm) {
            saveCredentialForm.reset();
        }


        clearFieldErrors();


        const subContainer =
            document.getElementById(
                "bankingSubTypeContainer"
            );


        if (subContainer) {
            subContainer.remove();
        }


        if (editRecordIdInput) {
            editRecordIdInput.value = "";
        }


        if (formTitle) {

            formTitle.innerHTML =
                '<i class="fa-solid fa-key"></i> Store New Credential';
        }


        if (submitFormBtn) {

            submitFormBtn.innerHTML =
                '<i class="fa-solid fa-lock"></i> Save To Vault';
        }


        if (cancelEditBtn) {

            cancelEditBtn.style.display =
                "none";
        }


        if (dynamicFieldsContainer) {
            dynamicFieldsContainer.innerHTML = "";
        }


        if (accountTypeSelect) {

            accountTypeSelect.innerHTML =
                '<option value="" disabled selected>Select Service</option>';
        }
    }


    if (cancelEditBtn) {

        cancelEditBtn.addEventListener(
            "click",
            resetFormState
        );
    }


    /* ======================================================================
       16. VAULT DATA
       ====================================================================== */

    let allRecords = [];

    let activeTimers = {};


    /* ======================================================================
       17. RECORD OWNERSHIP
       ====================================================================== */

    function recordBelongsToCurrentUser(
        record
    ) {

        if (
            !record ||
            typeof record !== "object"
        ) {
            return false;
        }


        const currentUserId =
            getCurrentUserId();


        const recordUserId =
            normalizeUserId(
                record.userid ??
                record.userId ??
                record.user_id ??
                ""
            );


        /*
          IMPORTANT:
          If a valid userid exists, userid is the owner.
        */

        if (recordUserId) {

            return (
                !!currentUserId &&
                recordUserId ===
                currentUserId
            );
        }


        /*
          Legacy records without userid.
        */

        const currentEmail =
            getCurrentUserEmail();

        const currentPhone =
            getCurrentUserPhone();


        const recordEmail =
            normalizeEmail(
                record.email ?? ""
            );


        const recordPhone =
            normalizePhone(
                record.phonenumber ??
                record.phoneNumber ??
                ""
            );


        if (
            currentEmail &&
            recordEmail &&
            currentEmail ===
            recordEmail
        ) {
            return true;
        }


        if (
            currentPhone &&
            recordPhone &&
            currentPhone ===
            recordPhone
        ) {
            return true;
        }


        return false;
    }


    /* ======================================================================
       18. DEDUPLICATION
       ====================================================================== */

    function deduplicateRecords(
        records
    ) {

        const result = [];
        const seen = new Set();


        for (const record of records) {

            if (
                !record ||
                typeof record !== "object"
            ) {
                continue;
            }


            const id =
                record.id ??
                record._id ??
                "";


            const fallbackKey = [
                record.userid ?? "",
                record.platform ?? "",
                record.identifier ?? "",
                record.email ?? "",
                record.phonenumber ?? "",
                record.secret ?? ""
            ].join("|");


            const key =
                id !== ""
                    ? "id:" + String(id)
                    : "data:" + fallbackKey;


            if (seen.has(key)) {
                continue;
            }


            seen.add(key);

            result.push(record);
        }


        return result;
    }


    /* ======================================================================
       19. LOAD VAULT RECORDS
       ====================================================================== */

    async function loadVaultRecords() {

        // Never fetch/render vault records while account verification is
        // pending or after a restricted account has been detected.
        if (accountStatusGateActive || accountRestrictionHandled) {
            return;
        }

        const currentUserId =
            getCurrentUserId();


        if (!currentUserId) {

            console.error(
                "Vault blocked: invalid User ID."
            );

            allRecords = [];

            renderRecords([]);

            return;
        }


        let serverData = [];

        let cloudQuerySucceeded =
            false;


        /* ==============================================================
           SUPABASE QUERY
           ============================================================== */

        try {

            if (supabaseClient) {

                /*
                  Main query:
                  userid must equal current logged-in userid.
                */

                const useridResult =
                    await supabaseClient
                        .from("credentials")
                        .select("*")
                        .eq(
                            "userid",
                            currentUserId
                        );


                if (
                    useridResult.error
                ) {

                    console.error(
                        "Supabase userid query error:",
                        useridResult.error
                    );

                } else {

                    cloudQuerySucceeded =
                        true;

                    if (
                        Array.isArray(
                            useridResult.data
                        )
                    ) {

                        serverData.push(
                            ...useridResult.data
                        );
                    }
                }


                /*
                  Legacy email recovery.
                */

                const email =
                    getCurrentUserEmail();


                if (email) {

                    const emailResult =
                        await supabaseClient
                            .from("credentials")
                            .select("*")
                            .eq(
                                "email",
                                email
                            );


                    if (
                        !emailResult.error &&
                        Array.isArray(
                            emailResult.data
                        )
                    ) {

                        cloudQuerySucceeded =
                            true;

                        serverData.push(
                            ...emailResult.data
                        );
                    }
                }


                /*
                  Legacy phone recovery.
                */

                const phone =
                    getCurrentUserPhone();


                if (phone) {

                    const phoneResult =
                        await supabaseClient
                            .from("credentials")
                            .select("*")
                            .eq(
                                "phonenumber",
                                phone
                            );


                    if (
                        !phoneResult.error &&
                        Array.isArray(
                            phoneResult.data
                        )
                    ) {

                        cloudQuerySucceeded =
                            true;

                        serverData.push(
                            ...phoneResult.data
                        );
                    }
                }
            }

        } catch (error) {

            console.error(
                "Supabase vault loading error:",
                error
            );
        }


        /* ==============================================================
           LOCAL CACHE
           ============================================================== */

        let localData = [];


        try {

            const parsed =
                JSON.parse(
                    localStorage.getItem(
                        "vault_records"
                    ) || "[]"
                );


            if (
                Array.isArray(parsed)
            ) {

                localData =
                    parsed.filter(
                        recordBelongsToCurrentUser
                    );
            }

        } catch (error) {

            console.warn(
                "Local vault cache could not be read:",
                error
            );
        }


        /* ==============================================================
           SECURITY FILTER
           ============================================================== */

        const filteredServerData =
            serverData.filter(
                recordBelongsToCurrentUser
            );


        const filteredLocalData =
            localData.filter(
                recordBelongsToCurrentUser
            );


        /* ==============================================================
           COMBINE
           ============================================================== */

        allRecords =
            deduplicateRecords([
                ...filteredServerData,
                ...filteredLocalData
            ]);


        /*
          Do NOT erase local cache if cloud returned nothing.
        */

        if (
            cloudQuerySucceeded &&
            filteredServerData.length > 0
        ) {

            localStorage.setItem(
                "vault_records",
                JSON.stringify(
                    filteredServerData
                )
            );

        } else if (
            filteredLocalData.length > 0
        ) {

            localStorage.setItem(
                "vault_records",
                JSON.stringify(
                    filteredLocalData
                )
            );
        }


        /*
          Re-apply current search after reload.
        */

        applyVaultSearch();
    }


    /* ======================================================================
       20. SEARCH SYSTEM
       ====================================================================== */

    let currentSearchText = "";


    function getSearchInput() {

        /*
          Supports several possible IDs.
        */

        return (
            document.getElementById(
                "recordSearchInput"
            ) ||

            document.getElementById(
                "searchRecords"
            ) ||

            document.getElementById(
                "searchInput"
            ) ||

            document.getElementById(
                "vaultSearch"
            ) ||

            document.querySelector(
                'input[placeholder*="Search by platform"]'
            ) ||

            document.querySelector(
                'input[placeholder*="Search"]'
            )
        );
    }


    function getRecordSearchText(
        record
    ) {

        return [

            record.userid,
            record.userId,
            record.user_id,

            record.userfullname,
            record.fullName,
            record.name,

            record.category,
            record.bankingsubtype,
            record.bankingSubType,

            record.platform,

            record.identifier,

            record.username,

            record.email,

            record.phonenumber,
            record.phoneNumber,

            record.holdername,
            record.holderName,

            record.cardbankname,
            record.cardBankName,

            record.notes
        ]
            .filter(
                value =>
                    value !== null &&
                    value !== undefined
            )
            .map(
                value =>
                    String(value)
                        .toLowerCase()
            )
            .join(" ");
    }


    function applyVaultSearch() {

        const query =
            currentSearchText
                .trim()
                .toLowerCase();


        if (!query) {

            renderRecords(
                allRecords
            );

            return;
        }


        /*
          Supports multiple words.

          Example:
          "badhan 6094497007"

          Every word must exist somewhere
          in the same record.
        */

        const words =
            query
                .split(/\s+/)
                .filter(Boolean);


        const filtered =
            allRecords.filter(
                record => {

                    const searchable =
                        getRecordSearchText(
                            record
                        );


                    return words.every(
                        word =>
                            searchable.includes(
                                word
                            )
                    );
                }
            );


        renderRecords(
            filtered
        );
    }


    function initVaultSearch() {

        const searchInput =
            getSearchInput();


        if (!searchInput) {

            console.warn(
                "Vault search input not found."
            );

            return;
        }


        /*
          IMPORTANT:
          Search works while typing.
        */

        searchInput.addEventListener(
            "input",
            function () {

                currentSearchText =
                    this.value || "";

                applyVaultSearch();
            }
        );


        /*
          Also works with Enter.
        */

        searchInput.addEventListener(
            "keyup",
            function () {

                currentSearchText =
                    this.value || "";

                applyVaultSearch();
            }
        );
    }


    initVaultSearch();


    /* ======================================================================
       21. REALTIME SYNC
       ====================================================================== */

    function initDashboardRealtime() {

        if (!supabaseClient) {
            return;
        }


        if (dashboardRealtimeSub) {

            try {

                supabaseClient.removeChannel(
                    dashboardRealtimeSub
                );

            } catch (error) {
                console.warn(error);
            }
        }


        const currentUserId =
            getCurrentUserId();


        if (!currentUserId) {
            return;
        }


        dashboardRealtimeSub =
            supabaseClient
                .channel(
                    "dashboard-credentials-" +
                    currentUserId
                )
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "credentials",
                        filter:
                            `userid=eq.${currentUserId}`
                    },
                    () => {

                        loadVaultRecords();
                    }
                )
                .subscribe(
                    () => {
                        /* Keep realtime connection details out of the console. */
                    }
                );
    }


    /* ======================================================================
       22. CROSS TAB SYNC
       ====================================================================== */

    window.addEventListener(
        "storage",
        event => {

            if (
                event.key ===
                "vault_records"
            ) {

                loadVaultRecords();
            }
        }
    );


    /* ======================================================================
       23. RENDER RECORDS
       ====================================================================== */

    function renderRecords(
        records
    ) {

        const grid =
            document.getElementById(
                "recordsGrid"
            );


        const noDataMsg =
            document.getElementById(
                "noDataMessage"
            );


        if (!grid) {
            return;
        }


        grid.innerHTML = "";


        if (
            !records ||
            records.length === 0
        ) {

            if (noDataMsg) {

                noDataMsg.style.display =
                    "block";

                noDataMsg.textContent =
                    currentSearchText
                        ? "No matching vault record found."
                        : "No vault records found.";
            }

            return;
        }


        if (noDataMsg) {
            noDataMsg.style.display =
                "none";
        }


        records.forEach(
            (item, index) => {

                const card =
                    document.createElement(
                        "div"
                    );


                card.className =
                    "record-card";


                const realPassword =
                    item.secret ??
                    item.password ??
                    "";


                const realCvv =
                    item.extraDetail ??
                    item.extradetail ??
                    "";


                const expiryDateVal =
                    item.expiryDate ??
                    item.expirydate ??
                    "";


                const identifierVal =
                    item.identifier ||
                    "N/A";


                const phoneVal =
                    item.phoneNumber ??
                    item.phonenumber ??
                    "";


                const profileLinkVal =
                    item.profileLink ??
                    item.profilelink ??
                    "";


                const subTypeVal =
                    item.bankingSubType ??
                    item.bankingsubtype ??
                    "";


                const holderVal =
                    item.holderName ??
                    item.holdername ??
                    "";


                const cardBankVal =
                    item.cardBankName ??
                    item.cardbankname ??
                    "";


                const cryptoAccVal =
                    item.cryptoAccount ??
                    item.cryptoaccount ??
                    "";


                const cryptoCardVal =
                    item.cryptoCard ??
                    item.cryptocard ??
                    "";


                const category =
                    item.category ||
                    "General";


                const platform =
                    item.platform ||
                    "Account";


                const notes =
                    item.notes ||
                    "";


                const userId =
                    item.userid ??
                    item.userId ??
                    item.user_id ??
                    "";


                const email =
                    item.email ||
                    "";


                const itemUniqueId =
                    item.id ??
                    item._id ??
                    "";


                const safeProfileUrl =
                    safeUrl(
                        profileLinkVal
                    );


                const pwdId =
                    "pwd-" +
                    index +
                    "-" +
                    Date.now();


                const cvvId =
                    "cvv-" +
                    index +
                    "-" +
                    Date.now();


                const subTypeBadge =
                    subTypeVal
                        ? `
                            <span
                                class="record-badge"
                                style="
                                    background:#2980b9;
                                    margin-left:5px;
                                "
                            >
                                ${escapeHTML(
                                    subTypeVal
                                )}
                            </span>
                          `
                        : "";


                const profileHtml =
                    safeProfileUrl
                        ? `
                            <div class="record-field">

                                <strong>
                                    Profile Link:
                                </strong>

                                <a
                                    href="${escapeHTML(
                                        safeProfileUrl
                                    )}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    ${escapeHTML(
                                        profileLinkVal
                                    )}
                                </a>

                            </div>
                          `
                        : "";


                card.innerHTML = `

                    <div>

                        <span class="record-badge">
                            ${escapeHTML(
                                category
                            )}
                        </span>

                        ${subTypeBadge}

                    </div>


                    <div class="record-title">

                        <i
                            class="fa-solid fa-shield-halved"
                        ></i>

                        ${escapeHTML(
                            platform
                        )}

                    </div>


                    ${
                        userId
                            ? `
                                <div class="record-field">
                                    <strong>
                                        User ID:
                                    </strong>
                                    ${escapeHTML(
                                        userId
                                    )}
                                </div>
                              `
                            : ""
                    }


                    ${
                        holderVal
                            ? `
                                <div class="record-field">
                                    <strong>
                                        Holder:
                                    </strong>
                                    ${escapeHTML(
                                        holderVal
                                    )}
                                </div>
                              `
                            : ""
                    }


                    ${
                        cardBankVal
                            ? `
                                <div class="record-field">
                                    <strong>
                                        Card Bank:
                                    </strong>
                                    ${escapeHTML(
                                        cardBankVal
                                    )}
                                </div>
                              `
                            : ""
                    }


                    ${
                        cryptoAccVal
                            ? `
                                <div class="record-field">
                                    <strong>
                                        Crypto Account:
                                    </strong>
                                    ${escapeHTML(
                                        cryptoAccVal
                                    )}
                                </div>
                              `
                            : ""
                    }


                    ${
                        cryptoCardVal
                            ? `
                                <div class="record-field">
                                    <strong>
                                        Crypto Card:
                                    </strong>
                                    ${escapeHTML(
                                        cryptoCardVal
                                    )}
                                </div>
                              `
                            : ""
                    }


                    <div class="record-field">

                        <strong>
                            Number/Identifier:
                        </strong>

                        ${escapeHTML(
                            identifierVal
                        )}

                    </div>


                    ${
                        phoneVal
                            ? `
                                <div class="record-field">
                                    <strong>
                                        Phone Number:
                                    </strong>
                                    ${escapeHTML(
                                        phoneVal
                                    )}
                                </div>
                              `
                            : ""
                    }


                    ${
                        email
                            ? `
                                <div class="record-field">
                                    <strong>
                                        Email:
                                    </strong>
                                    ${escapeHTML(
                                        email
                                    )}
                                </div>
                              `
                            : ""
                    }


                    ${
                        expiryDateVal
                            ? `
                                <div class="record-field">
                                    <strong>
                                        Expiry Date:
                                    </strong>
                                    ${escapeHTML(
                                        expiryDateVal
                                    )}
                                </div>
                              `
                            : ""
                    }


                    ${profileHtml}


                    ${
                        realCvv
                            ? `
                                <div
                                    class="record-field password-field-wrapper"
                                >

                                    <strong>
                                        CVV:
                                    </strong>

                                    <span
                                        id="${cvvId}"
                                        class="password-masked"
                                        data-secret="${escapeHTML(
                                            realCvv
                                        )}"
                                    >
                                        •••
                                    </span>

                                    <button
                                        type="button"
                                        class="eye-toggle-btn"
                                        data-target="${cvvId}"
                                        title="Show CVV"
                                    >
                                        <i
                                            class="fa-solid fa-eye"
                                        ></i>
                                    </button>

                                </div>
                              `
                            : ""
                    }


                    ${
                        realPassword
                            ? `
                                <div
                                    class="record-field password-field-wrapper"
                                >

                                    <strong>
                                        Password/PIN:
                                    </strong>

                                    <span
                                        id="${pwdId}"
                                        class="password-masked"
                                        data-secret="${escapeHTML(
                                            realPassword
                                        )}"
                                    >
                                        ••••••••
                                    </span>

                                    <button
                                        type="button"
                                        class="eye-toggle-btn"
                                        data-target="${pwdId}"
                                        title="Show Password"
                                    >
                                        <i
                                            class="fa-solid fa-eye"
                                        ></i>
                                    </button>

                                </div>
                              `
                            : ""
                    }


                    ${
                        notes
                            ? `
                                <div class="record-field">
                                    <strong>
                                        Notes:
                                    </strong>
                                    ${escapeHTML(
                                        notes
                                    )}
                                </div>
                              `
                            : ""
                    }


                    <div class="card-actions">

                        <button
                            type="button"
                            class="action-btn edit-btn"
                            data-id="${escapeHTML(
                                itemUniqueId
                            )}"
                        >
                            <i
                                class="fa-solid fa-pen-to-square"
                            ></i>
                            Edit
                        </button>


                        <button
                            type="button"
                            class="action-btn delete-btn"
                            data-id="${escapeHTML(
                                itemUniqueId
                            )}"
                        >
                            <i
                                class="fa-solid fa-trash-can"
                            ></i>
                            Delete
                        </button>

                    </div>
                `;


                grid.appendChild(card);
            }
        );


        /* ==================================================================
           PASSWORD / CVV SHOW-HIDE
           ================================================================== */

        document
            .querySelectorAll(
                ".eye-toggle-btn"
            )
            .forEach(button => {

                button.addEventListener(
                    "click",
                    function () {

                        const targetId =
                            this.getAttribute(
                                "data-target"
                            );


                        const span =
                            document.getElementById(
                                targetId
                            );


                        const icon =
                            this.querySelector(
                                "i"
                            );


                        if (!span) {
                            return;
                        }


                        const realSecret =
                            span.getAttribute(
                                "data-secret"
                            ) || "";


                        if (
                            activeTimers[
                                targetId
                            ]
                        ) {

                            clearTimeout(
                                activeTimers[
                                    targetId
                                ]
                            );

                            delete activeTimers[
                                targetId
                            ];
                        }


                        const hiddenValue =
                            realSecret.length === 3
                                ? "•••"
                                : "••••••••";


                        if (
                            span.textContent.trim() ===
                            hiddenValue
                        ) {

                            span.textContent =
                                realSecret;


                            icon.classList.remove(
                                "fa-eye"
                            );

                            icon.classList.add(
                                "fa-eye-slash"
                            );


                            activeTimers[
                                targetId
                            ] =
                                setTimeout(
                                    () => {

                                        span.textContent =
                                            hiddenValue;

                                        icon.classList.remove(
                                            "fa-eye-slash"
                                        );

                                        icon.classList.add(
                                            "fa-eye"
                                        );

                                        delete activeTimers[
                                            targetId
                                        ];

                                    },
                                    10000
                                );

                        } else {

                            span.textContent =
                                hiddenValue;


                            icon.classList.remove(
                                "fa-eye-slash"
                            );

                            icon.classList.add(
                                "fa-eye"
                            );
                        }
                    }
                );
            });


        /* ==================================================================
           DELETE
           ================================================================== */

        setupDeleteButtons();


        /* ==================================================================
           EDIT
           ================================================================== */

        setupEditButtons();
    }


    /* ======================================================================
       24. DELETE SYSTEM
       ====================================================================== */

    function setupDeleteButtons() {

        const deleteModal =
            document.getElementById(
                "deleteModal"
            );


        const confirmDeleteBtn =
            document.getElementById(
                "confirmDeleteBtn"
            );


        const cancelDeleteBtn =
            document.getElementById(
                "cancelDeleteBtn"
            );


        let recordToDeleteId =
            null;


        document
            .querySelectorAll(
                ".delete-btn"
            )
            .forEach(button => {

                button.addEventListener(
                    "click",
                    function () {

                        recordToDeleteId =
                            this.getAttribute(
                                "data-id"
                            );


                        if (deleteModal) {

                            deleteModal.style.display =
                                "flex";

                            deleteModal.classList.add(
                                "active"
                            );

                        } else {

                            const confirmed =
                                confirm(
                                    "Are you sure you want to delete this record?"
                                );

                            if (confirmed) {

                                performDelete(
                                    recordToDeleteId
                                );
                            }
                        }
                    }
                );
            });


        if (cancelDeleteBtn) {

            cancelDeleteBtn.addEventListener(
                "click",
                () => {

                    recordToDeleteId =
                        null;


                    if (deleteModal) {

                        deleteModal.style.display =
                            "none";

                        deleteModal.classList.remove(
                            "active"
                        );
                    }
                }
            );
        }


        if (confirmDeleteBtn) {

            /*
              clone prevents duplicate event listeners
            */

            const newButton =
                confirmDeleteBtn.cloneNode(
                    true
                );


            confirmDeleteBtn.parentNode
                .replaceChild(
                    newButton,
                    confirmDeleteBtn
                );


            newButton.addEventListener(
                "click",
                async () => {

                    if (
                        !recordToDeleteId
                    ) {
                        return;
                    }


                    await performDelete(
                        recordToDeleteId
                    );


                    recordToDeleteId =
                        null;


                    if (deleteModal) {

                        deleteModal.style.display =
                            "none";

                        deleteModal.classList.remove(
                            "active"
                        );
                    }
                }
            );
        }
    }


    async function performDelete(
        recordId
    ) {

        const currentUserId =
            getCurrentUserId();


        if (
            !recordId ||
            !currentUserId
        ) {
            return;
        }


        /*
          First verify record belongs to
          current user's loaded vault.
        */

        const target =
            allRecords.find(
                record =>
                    String(
                        record.id ??
                        record._id ??
                        ""
                    ) ===
                    String(recordId)
            );


        if (
            !target ||
            !recordBelongsToCurrentUser(
                target
            )
        ) {

            alert(
                "You cannot delete this record."
            );

            return;
        }


        let cloudDeleted =
            false;


        try {

            if (supabaseClient) {

                const {
                    error
                } = await supabaseClient
                    .from("credentials")
                    .delete()
                    .eq(
                        "id",
                        recordId
                    )
                    .eq(
                        "userid",
                        currentUserId
                    );


                if (error) {
                    throw error;
                }


                cloudDeleted =
                    true;
            }

        } catch (error) {

            console.error(
                "Supabase delete error:",
                error
            );
        }


        /* ==============================================================
           LOCAL DELETE
           ============================================================== */

        let localRecords = [];


        try {

            const parsed =
                JSON.parse(
                    localStorage.getItem(
                        "vault_records"
                    ) || "[]"
                );


            if (
                Array.isArray(parsed)
            ) {
                localRecords =
                    parsed;
            }

        } catch (error) {

            localRecords = [];
        }


        localRecords =
            localRecords.filter(
                record => {

                    const sameUser =
                        normalizeUserId(
                            record.userid ??
                            record.userId ??
                            record.user_id ??
                            ""
                        ) ===
                        currentUserId;


                    const sameId =
                        String(
                            record.id ??
                            record._id ??
                            ""
                        ) ===
                        String(recordId);


                    return !(
                        sameUser &&
                        sameId
                    );
                }
            );


        localStorage.setItem(
            "vault_records",
            JSON.stringify(
                localRecords
            )
        );


        if (!cloudDeleted) {

            alert(
                "Cloud delete failed. The record was removed from this browser cache only."
            );

        } else {

            alert(
                "Vault record deleted successfully."
            );
        }


        await loadVaultRecords();
    }


    /* ======================================================================
       25. EDIT SYSTEM
       ====================================================================== */

    function setupEditButtons() {

        document
            .querySelectorAll(
                ".edit-btn"
            )
            .forEach(button => {

                button.addEventListener(
                    "click",
                    function () {

                        const recordId =
                            this.getAttribute(
                                "data-id"
                            );


                        const targetRecord =
                            allRecords.find(
                                record =>
                                    String(
                                        record.id ??
                                        record._id ??
                                        ""
                                    ) ===
                                    String(
                                        recordId
                                    ) &&
                                    recordBelongsToCurrentUser(
                                        record
                                    )
                            );


                        if (!targetRecord) {

                            alert(
                                "Record not found for editing."
                            );

                            return;
                        }


                        switchToHome();


                        if (categorySelect) {

                            categorySelect.value =
                                targetRecord.category ||
                                "";


                            categorySelect.dispatchEvent(
                                new Event(
                                    "change"
                                )
                            );
                        }


                        const subTypeVal =
                            targetRecord.bankingSubType ??
                            targetRecord.bankingsubtype ??
                            "";


                        if (
                            targetRecord.category ===
                            "Banking & Financial"
                        ) {

                            setTimeout(
                                () => {

                                    const subtype =
                                        document.getElementById(
                                            "bankingSubTypeSelect"
                                        );


                                    if (subtype) {

                                        subtype.value =
                                            subTypeVal;

                                        subtype.dispatchEvent(
                                            new Event(
                                                "change"
                                            )
                                        );
                                    }


                                    setTimeout(
                                        () => {

                                            if (
                                                accountTypeSelect
                                            ) {

                                                accountTypeSelect.value =
                                                    targetRecord.platform ||
                                                    "";

                                                accountTypeSelect.dispatchEvent(
                                                    new Event(
                                                        "change"
                                                    )
                                                );
                                            }


                                            renderDynamicFields(
                                                targetRecord.category,
                                                subTypeVal,
                                                targetRecord.platform ||
                                                    "",
                                                targetRecord
                                            );

                                        },
                                        80
                                    );

                                },
                                80
                            );

                        } else {

                            setTimeout(
                                () => {

                                    if (
                                        accountTypeSelect
                                    ) {

                                        accountTypeSelect.value =
                                            targetRecord.platform ||
                                            "";
                                    }


                                    renderDynamicFields(
                                        targetRecord.category,
                                        "",
                                        targetRecord.platform ||
                                            "",
                                        targetRecord
                                    );

                                },
                                80
                            );
                        }


                        if (
                            editRecordIdInput
                        ) {

                            editRecordIdInput.value =
                                targetRecord.id ??
                                targetRecord._id ??
                                "";
                        }


                        if (formTitle) {

                            formTitle.innerHTML =
                                '<i class="fa-solid fa-pen-to-square"></i> Edit Credential Details';
                        }


                        if (submitFormBtn) {

                            submitFormBtn.innerHTML =
                                '<i class="fa-solid fa-floppy-disk"></i> Update Vault Record';
                        }


                        if (cancelEditBtn) {

                            cancelEditBtn.style.display =
                                "inline-block";
                        }


                        const notesElem =
                            document.getElementById(
                                "extraNotes"
                            );


                        if (notesElem) {

                            notesElem.value =
                                targetRecord.notes ||
                                "";
                        }


                        window.scrollTo({
                            top: 0,
                            behavior: "smooth"
                        });
                    }
                );
            });
    }


    /* ======================================================================
       26. INITIAL LOAD
       ====================================================================== */

    // Vault data is loaded only after the server confirms this account is
    // not suspended, blocked, or disabled. The account-status guard calls
    // loadVaultRecords() after successful verification.

});




