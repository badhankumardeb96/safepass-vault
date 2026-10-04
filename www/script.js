/* ==========================================================================
   SafePass Vault - Login Management
   --------------------------------------------------------------------------
   Supports login with:
     1) 10-digit SafePass User ID
     2) Registered email address
     3) Registered Bangladeshi phone number

   Authentication:
     - Supabase Auth is the actual password authentication system.
     - public.users is used only to resolve User ID / phone / email to the
       user's Auth email and to read account status/profile information.
     - Vault data is NOT deleted during logout.

   IMPORTANT:
     - Run supabase_login_lookup.sql before using this version.
     - Every user who logs in must have a corresponding Supabase Auth user
       with the same email and the intended password.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // App Splash & Loading Screen Injection
    // ==========================================

    const injectAppLoader = () => {
        if (document.getElementById('appSplashLoader')) return;

        const loaderHTML = `
            <div id="appSplashLoader">
                <div id="splashLogo">
                    <img src="assets/logo.png" alt="SafePass Vault Logo" />
                </div>
                <div class="spinner-clockwise"></div>
                <p>Loading please wait</p>
            </div>
        `;

        document.body.insertAdjacentHTML('afterbegin', loaderHTML);

        setTimeout(() => {
            const loader = document.getElementById('appSplashLoader');
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => loader.remove(), 400);
            }
        }, 800);
    };

    injectAppLoader();

    // ==========================================
    // Supabase Initialization
    // ==========================================

    const SUPABASE_URL = 'https://vgjsoicsmmzahhsuworg.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';

    let supabase = null;

    // Mobile/WebView safe Supabase initialization.
    // The same client configuration is used by the web app and mobile
    // wrappers (Capacitor/Cordova/WebView), so the app talks to the same
    // live Supabase project without requiring a separate mobile database.
    const createSafePassSupabaseClient = () => {
        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            return null;
        }

        // Reuse a client already created by another SafePass script instead
        // of creating duplicate clients in the same WebView/page.
        if (window.SafePassSupabaseClient) {
            return window.SafePassSupabaseClient;
        }

        const client = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    // Explicitly keep the Auth session in browser/WebView
                    // storage so mobile app sessions survive page changes.
                    storage: window.localStorage,
                    storageKey: 'safepass-vault-auth',
                    flowType: 'pkce'
                },
                global: {
                    headers: {
                        'x-client-info': 'safepass-vault-web-mobile'
                    }
                }
            }
        );

        window.SafePassSupabaseClient = client;
        window.SafePassSupabaseConfig = {
            url: SUPABASE_URL,
            anonKey: SUPABASE_ANON_KEY
        };

        return client;
    };

    supabase = createSafePassSupabaseClient();

    if (!supabase) {
        console.error(
            'Supabase client library missing! Make sure the Supabase JS CDN script is included in HTML before script.js.'
        );
    }

    // Keep mobile/web connectivity state in sync. This does not delete or
    // alter vault data; it only helps the UI recover when a WebView goes
    // offline and comes back online.
    window.addEventListener('online', async () => {
        if (!supabase) return;

        try {
            await supabase.auth.getSession();
        } catch (error) {
            console.warn('Supabase session refresh after reconnect failed:', error);
        }
    });

    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible' || !supabase) return;

        try {
            await supabase.auth.getSession();
        } catch (error) {
            console.warn('Supabase session check failed:', error);
        }
    });

    // Expose the authenticated client for other SafePass pages and a mobile
    // WebView bridge. No service-role key is exposed here; this is the public
    // publishable/anon client only.
    window.getSafePassSupabase = () => supabase;

    // ==========================================
    // Form & Input Elements
    // ==========================================

    const loginForm = document.getElementById('loginForm');
    const identifierInput = document.getElementById('identifier');
    const passwordInput = document.getElementById('password');
    const userIdGroup = document.getElementById('userIdGroup');
    const autoGeneratedUserIdInput =
        document.getElementById('autoGeneratedUserId');
    const loginBtn = document.getElementById('loginBtn');

    // ==========================================
    // Error Modal Elements
    // ==========================================

    const errorModal = document.getElementById('errorModal');
    const errorTitle = document.getElementById('errorTitle');
    const errorMessage = document.getElementById('errorMessage');
    const closeModalBtn = document.getElementById('closeModalBtn');

    // ==========================================
    // Forgot Password Modal Elements
    // ==========================================

    const forgotPasswordLink =
        document.getElementById('forgotPasswordLink');
    const forgotPromptModal =
        document.getElementById('forgotPromptModal');
    const resetIdentifierInput =
        document.getElementById('resetIdentifierInput');
    const submitForgotBtn =
        document.getElementById('submitForgotBtn');
    const cancelForgotBtn =
        document.getElementById('cancelForgotBtn');

    let isUserIdVerified = false;

    // ==========================================
    // Helper: Safe JSON Parse
    // ==========================================

    const safeJsonParse = (value, fallback) => {
        try {
            return JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    };

    // ==========================================
    // Helper: Escape HTML for injected messages
    // ==========================================

    const escapeHtml = (value) => {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    // ==========================================
    // Helper Function: Show Custom Error Modal
    // ==========================================

    const showErrorModal = (title, msg) => {
        if (errorTitle) {
            errorTitle.innerText = String(title || 'Error');
        }

        if (errorMessage) {
            errorMessage.innerText = String(msg || '');
        }

        if (errorModal) {
            errorModal.style.display = 'flex';
        } else {
            // Keep the app usable even if the original modal is missing.
            window.alert(`${title || 'Error'}\n\n${msg || ''}`);
        }
    };

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (errorModal) {
                errorModal.style.display = 'none';
            }
        });
    }

    // ==========================================
    // Success / Info Toast
    // ==========================================

    const showToast = (type, title, message) => {
        const oldToast = document.getElementById('safePassLoginToast');
        if (oldToast) oldToast.remove();

        const iconMap = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ⓘ'
        };

        const colorMap = {
            success: '#16803a',
            error: '#c62828',
            warning: '#a66a00',
            info: '#1f5f8b'
        };

        const color = colorMap[type] || colorMap.info;
        const icon = iconMap[type] || iconMap.info;

        const toast = document.createElement('div');
        toast.id = 'safePassLoginToast';
        toast.innerHTML = `
            <div class="safe-pass-login-toast-icon">${icon}</div>
            <div class="safe-pass-login-toast-content">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(message)}</span>
            </div>
        `;

        const styleId = 'safePassLoginToastStyles';
        let style = document.getElementById(styleId);

        if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                #safePassLoginToast {
                    position: fixed;
                    top: 24px;
                    right: 24px;
                    z-index: 2147483647;
                    width: min(390px, calc(100vw - 48px));
                    display: flex;
                    gap: 12px;
                    align-items: flex-start;
                    padding: 14px 16px;
                    box-sizing: border-box;
                    border-radius: 14px;
                    background: #fff;
                    border: 1px solid #e2e8ee;
                    box-shadow: 0 14px 40px rgba(0,0,0,.18);
                    font-family: Arial, Helvetica, sans-serif;
                    animation: safePassToastIn .22s ease-out;
                }

                #safePassLoginToast .safe-pass-login-toast-icon {
                    width: 34px;
                    height: 34px;
                    flex: 0 0 34px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    background: ${color};
                    color: #fff;
                    font-size: 19px;
                    font-weight: 700;
                }

                #safePassLoginToast .safe-pass-login-toast-content {
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                }

                #safePassLoginToast strong {
                    color: #243746;
                    font-size: 14px;
                }

                #safePassLoginToast span {
                    color: #5d6a74;
                    font-size: 13px;
                    line-height: 1.45;
                }

                @keyframes safePassToastIn {
                    from {
                        opacity: 0;
                        transform: translateY(-8px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        setTimeout(() => {
            if (toast.isConnected) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-8px)';
                toast.style.transition = 'opacity .2s ease, transform .2s ease';
                setTimeout(() => toast.remove(), 220);
            }
        }, 2800);
    };

    // ==========================================
    // Modal Background Click Dismiss
    // ==========================================

    window.addEventListener('click', (e) => {
        if (e.target === errorModal && errorModal) {
            errorModal.style.display = 'none';
        }

        if (e.target === forgotPromptModal && forgotPromptModal) {
            forgotPromptModal.style.display = 'none';

            if (resetIdentifierInput) {
                resetIdentifierInput.value = '';
            }
        }
    });

    // ==========================================
    // Keyboard Navigation & Enter Key Support
    // ==========================================

    window.addEventListener('keydown', (e) => {
        const isForgotOpen =
            forgotPromptModal &&
            getComputedStyle(forgotPromptModal).display !== 'none';

        const isErrorOpen =
            errorModal &&
            getComputedStyle(errorModal).display !== 'none';

        if (isForgotOpen) {
            if (e.key === 'Enter') {
                if (document.activeElement === cancelForgotBtn) {
                    e.preventDefault();

                    if (cancelForgotBtn) {
                        cancelForgotBtn.click();
                    }

                    return;
                }

                e.preventDefault();

                if (submitForgotBtn) {
                    submitForgotBtn.click();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();

                if (cancelForgotBtn) {
                    cancelForgotBtn.click();
                }
            }
        }

        if (isErrorOpen) {
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();

                if (closeModalBtn) {
                    closeModalBtn.click();
                }
            }
        }
    });

    // ==========================================
    // Validation Helpers
    // ==========================================

    const isValidEmail = (email) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            String(email || '').trim()
        );
    };

    const isValidBangladeshiPhone = (phone) => {
        return /^01[3-9]\d{8}$/.test(
            String(phone || '').replace(/\s+/g, '')
        );
    };

    const normalizePhone = (phone) => {
        return String(phone || '')
            .replace(/\s+/g, '')
            .trim();
    };

    const normalizeIdentifier = (value) => {
        return String(value || '').trim();
    };

    const getSafePassUserId = (rawUser) => {
        return String(
            rawUser?.userId ??
            rawUser?.userid ??
            rawUser?.user_id ??
            rawUser?.id ??
            ''
        ).trim();
    };

    // ==========================================
    // Prevent Copy-Paste Security on Password
    // ==========================================

    if (passwordInput) {
        ['copy', 'paste', 'cut', 'drop'].forEach((eventType) => {
            passwordInput.addEventListener(eventType, (e) => {
                e.preventDefault();

                showErrorModal(
                    'Security Restriction',
                    'For security reasons, copy-pasting passwords is restricted. Please type manually.'
                );
            });
        });
    }

    // ==========================================
    // Supabase RPC: Find Account by Email /
    // Phone / 10-digit User ID
    //
    // This replaces the old:
    //     supabase.from('users').select('*')
    //
    // We MUST NOT expose every users row to an
    // unauthenticated login page.
    // ==========================================

    const findUserByIdentifier = async (identifier) => {
        const cleanIdentifier = normalizeIdentifier(identifier);

        if (!cleanIdentifier) {
            return null;
        }

        if (!supabase) {
            throw new Error(
                'Supabase client is not available. Please make sure the Supabase JS CDN is loaded.'
            );
        }

        const { data, error } = await supabase.rpc(
            'lookup_login_account',
            {
                p_identifier: cleanIdentifier
            }
        );

        if (error) {
            console.error('lookup_login_account error:', error);

            const msg = String(error.message || '').toLowerCase();

            if (
                msg.includes('function') &&
                msg.includes('does not exist')
            ) {
                throw new Error(
                    'Login service is not configured in Supabase. Please run supabase_login_lookup.sql from the supplied ZIP in SQL Editor.'
                );
            }

            throw new Error(
                'Unable to verify the account right now. Please try again.'
            );
        }

        if (!data) {
            return null;
        }

        const row = Array.isArray(data) ? (data[0] || null) : data;

        if (!row) {
            return null;
        }

        // lookup_login_account() intentionally returns only safe lookup fields.
        // Normalize its snake_case response to the existing SafePass profile
        // shape used throughout the original application.
        return {
            ...row,
            userId: row.userId ?? row.user_id ?? '',
            fullName: row.fullName ?? row.full_name ?? '',
            phoneNumber: row.phoneNumber ?? row.phone_number ?? '',
            email: row.email ?? row.auth_email ?? '',
            authEmail: row.authEmail ?? row.auth_email ?? row.email ?? '',
            status: row.status ?? ''
        };
    };

    // ==========================================
    // Forgot Password Link Click
    // ==========================================

    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();

            if (!navigator.onLine) {
                showErrorModal(
                    'No Internet',
                    'Please check your internet connection to reset your password.'
                );
                return;
            }

            if (forgotPromptModal) {
                forgotPromptModal.style.display = 'flex';

                setTimeout(() => {
                    if (resetIdentifierInput) {
                        resetIdentifierInput.focus();
                    }
                }, 100);
            }
        });
    }

    // ==========================================
    // Cancel Forgot Password
    // ==========================================

    if (cancelForgotBtn) {
        cancelForgotBtn.addEventListener('click', () => {
            if (forgotPromptModal) {
                forgotPromptModal.style.display = 'none';
            }

            if (resetIdentifierInput) {
                resetIdentifierInput.value = '';
            }

            window.location.href = 'index.html';
        });
    }

    // ==========================================
    // Forgot Password Request Submit Handler
    // ==========================================

    if (submitForgotBtn) {
        submitForgotBtn.addEventListener('click', async () => {
            const inputVal = resetIdentifierInput
                ? resetIdentifierInput.value.trim()
                : '';

            if (!inputVal) {
                showErrorModal(
                    'Input Required',
                    'Please enter your registered email address.'
                );
                return;
            }

            if (!isValidEmail(inputVal)) {
                if (forgotPromptModal) {
                    forgotPromptModal.style.display = 'none';
                }

                if (resetIdentifierInput) {
                    resetIdentifierInput.value = '';
                }

                showErrorModal(
                    'Invalid Input!',
                    'Password recovery is only allowed using your registered email address.'
                );

                return;
            }

            if (!navigator.onLine) {
                showErrorModal(
                    'No Internet',
                    'Internet connection is required to submit password reset request.'
                );
                return;
            }

            try {
                submitForgotBtn.disabled = true;
                submitForgotBtn.innerText = 'Sending...';

                const existingUser =
                    await findUserByIdentifier(inputVal);

                if (!existingUser) {
                    if (forgotPromptModal) {
                        forgotPromptModal.style.display = 'none';
                    }

                    if (resetIdentifierInput) {
                        resetIdentifierInput.value = '';
                    }

                    showErrorModal(
                        'Email Not Found!',
                        'This email address is not registered in our system.'
                    );

                    return;
                }

                const authEmail = String(
                    existingUser.authEmail ||
                    existingUser.email ||
                    ''
                ).trim().toLowerCase();

                if (!isValidEmail(authEmail)) {
                    throw new Error(
                        'This account does not have a valid registered email address for password recovery.'
                    );
                }

                const redirectToUrl = new URL(
                    'reset-password.html',
                    window.location.href
                ).href;

                const { error: authError } =
                    await supabase.auth.resetPasswordForEmail(
                        authEmail,
                        {
                            redirectTo: redirectToUrl
                        }
                    );

                if (authError) {
                    console.warn(
                        'Supabase Auth mail warning:',
                        authError.message
                    );

                    throw new Error(
                        authError.message ||
                        'Unable to send password reset email.'
                    );
                }

                if (forgotPromptModal) {
                    forgotPromptModal.style.display = 'none';
                }

                if (resetIdentifierInput) {
                    resetIdentifierInput.value = '';
                }

                showErrorModal(
                    'Email Sent!',
                    'A password reset link has been sent successfully to your inbox.\nPlease check your email (and spam folder).'
                );
            } catch (err) {
                console.error(
                    'Forgot password request error:',
                    err
                );

                showErrorModal(
                    'Error',
                    err?.message ||
                    'Failed to submit password reset request.'
                );
            } finally {
                submitForgotBtn.disabled = false;
                submitForgotBtn.innerText = 'Submit Request';
            }
        });
    }

    // ==========================================
    // Restricted-account popup
    // ==========================================

    const showLoginRestrictionPopup = (status) => {
        const normalized = String(status || '')
            .trim()
            .toLowerCase()
            .replace(/[\_-]+/g, ' ')
            .replace(/\s+/g, ' ');

        let message = '';

        if (normalized === 'suspended') {
            message = 'Your account is suspended.';
        } else if (normalized === 'blocked') {
            message = 'Your account is blocked.';
        } else if (
            normalized === 'disabled' ||
            normalized === 'disable'
        ) {
            message = 'Your account is disabled.';
        }

        if (!message) {
            message = 'Your account access is restricted.';
        }

        const oldPopup = document.getElementById(
            'safePassLoginRestrictionOverlay'
        );

        if (oldPopup) {
            oldPopup.remove();
        }

        const oldStyle = document.getElementById(
            'safePassLoginRestrictionStyles'
        );

        if (oldStyle) {
            oldStyle.remove();
        }

        const overlay = document.createElement('div');
        overlay.id = 'safePassLoginRestrictionOverlay';

        overlay.innerHTML = `
            <div
                class="safe-pass-login-restriction-card"
                role="alertdialog"
                aria-modal="true"
            >
                <div class="safe-pass-login-warning">&#9888;</div>
                <h2>Account Access Restricted</h2>
                <p class="safe-pass-login-status">${escapeHtml(message)}</p>
                <p class="safe-pass-login-contact">
                    Please contact SafePass Vault Admin.
                </p>
                <p class="safe-pass-login-countdown">
                    Returning to login page in
                    <strong id="safePassLoginRestrictionCountdown">10</strong>
                    seconds...
                </p>
            </div>
        `;

        const style = document.createElement('style');
        style.id = 'safePassLoginRestrictionStyles';

        style.textContent = `
            #safePassLoginRestrictionOverlay {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                box-sizing: border-box;
                background: rgba(10, 18, 30, .78);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-restriction-card {
                width: min(460px, 100%);
                padding: 30px 28px 28px;
                box-sizing: border-box;
                border-radius: 16px;
                background: #fff;
                border: 1px solid #e1e7ec;
                box-shadow: 0 22px 60px rgba(0, 0, 0, .28);
                text-align: center;
                font-family: Arial, Helvetica, sans-serif;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-warning {
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
            }

            #safePassLoginRestrictionOverlay h2 {
                margin: 0 0 12px;
                color: #244b5d;
                font-size: 21px;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-status {
                margin: 0 0 10px;
                color: #d64545;
                font-size: 17px;
                font-weight: 700;
                line-height: 1.5;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-contact {
                margin: 0;
                color: #5f6b75;
                font-size: 14px;
                line-height: 1.5;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-countdown {
                margin: 18px 0 0;
                padding-top: 14px;
                border-top: 1px solid #edf0f3;
                color: #6b7680;
                font-size: 13px;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-countdown strong {
                display: inline-flex;
                min-width: 26px;
                justify-content: center;
                color: #d64545;
                font-size: 16px;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(overlay);

        let seconds = 10;

        const countdown = document.getElementById(
            'safePassLoginRestrictionCountdown'
        );

        const timer = window.setInterval(() => {
            seconds -= 1;

            if (countdown) {
                countdown.textContent = String(
                    Math.max(seconds, 0)
                );
            }

            if (seconds <= 0) {
                window.clearInterval(timer);
                window.location.replace('index.html');
            }
        }, 1000);
    };

    // ==========================================
    // Clear Login Session Only
    //
    // IMPORTANT:
    // Do NOT delete vault records here.
    // ==========================================

    const clearLocalLoginState = () => {
        localStorage.removeItem('safePassUser');
        localStorage.removeItem('user');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('savedUserIdNumber');
        localStorage.removeItem('activeTab');

        // Intentionally NOT removing:
        // vault_records
        // vault_records_<auth-user-id>
    };

    // ==========================================
    // Friendly Auth Error Mapping
    // ==========================================

    const getFriendlyAuthError = (error) => {
        const raw = String(
            error?.message ||
            error ||
            ''
        ).trim();

        const lower = raw.toLowerCase();

        if (
            lower.includes('invalid login credentials') ||
            lower.includes('invalid credentials')
        ) {
            return 'Incorrect password or login credentials. Please check your password and try again.';
        }

        if (lower.includes('email not confirmed')) {
            return 'Your email address has not been confirmed yet. Please check your email and confirm your account.';
        }

        if (lower.includes('too many requests')) {
            return 'Too many login attempts. Please wait a little while and try again.';
        }

        if (
            lower.includes('failed to fetch') ||
            lower.includes('network') ||
            lower.includes('fetch')
        ) {
            return 'Unable to connect to SafePass Vault. Please check your internet connection.';
        }

        if (lower.includes('user not found')) {
            return 'This account is not registered.';
        }

        return raw || 'Unable to sign in right now. Please try again.';
    };

    // ==========================================
    // Form Submission Handler
    // ==========================================

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (isUserIdVerified) {
                window.location.href = 'dashboard.html';
                return;
            }

            const identifier = identifierInput
                ? normalizeIdentifier(identifierInput.value)
                : '';

            const password = passwordInput
                ? passwordInput.value
                : '';

            if (!identifier || !password) {
                if (userIdGroup) {
                    userIdGroup.style.display = 'none';
                }

                showErrorModal(
                    'Login Failed!',
                    'Please provide both Email/Phone/User ID and Password.'
                );

                return;
            }

            if (!navigator.onLine) {
                showErrorModal(
                    'No Internet',
                    'Please check your internet connection and try again.'
                );
                return;
            }

            try {
                if (!supabase) {
                    throw new Error(
                        'Supabase client is not available. Please make sure the Supabase JS CDN is loaded.'
                    );
                }

                if (loginBtn) {
                    loginBtn.disabled = true;
                    loginBtn.innerText = 'Verifying...';
                }

                // ------------------------------------------
                // 1. Resolve User ID / phone / email to the
                //    registered account.
                // ------------------------------------------

                const rawUser =
                    await findUserByIdentifier(identifier);

                if (!rawUser) {
                    throw new Error(
                        'Account not found. Please check your Email, Phone Number or 10-digit User ID.'
                    );
                }

                // ------------------------------------------
                // 2. Read account status BEFORE Auth login.
                // ------------------------------------------

                const statusCandidates = [
                    rawUser.status,
                    rawUser.accountStatus,
                    rawUser.account_status,
                    rawUser.userStatus,
                    rawUser.user_status,
                    rawUser.state
                ];

                let currentStatus = '';

                for (const candidate of statusCandidates) {
                    if (
                        candidate !== null &&
                        candidate !== undefined &&
                        String(candidate).trim() !== ''
                    ) {
                        currentStatus = String(candidate).trim();
                        break;
                    }
                }

                const normalizedStatus = currentStatus
                    .toLowerCase()
                    .replace(/[\_-]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (
                    normalizedStatus === 'suspended' ||
                    normalizedStatus === 'blocked' ||
                    normalizedStatus === 'disabled' ||
                    normalizedStatus === 'disable'
                ) {
                    clearLocalLoginState();

                    if (userIdGroup) {
                        userIdGroup.style.display = 'none';
                    }

                    if (loginBtn) {
                        loginBtn.disabled = true;
                        loginBtn.innerText = 'Account Restricted';
                    }

                    showLoginRestrictionPopup(currentStatus);
                    return;
                }

                // ------------------------------------------
                // 3. Validate the SafePass 10-digit User ID.
                // ------------------------------------------

                const finalUserId = getSafePassUserId(rawUser);

                if (!/^\d{10}$/.test(finalUserId)) {
                    throw new Error(
                        'Your account has an invalid 10-digit User ID. Please contact SafePass Vault Admin.'
                    );
                }

                // ------------------------------------------
                // 4. Get the Auth email.
                //
                // lookup_login_account returns the registered
                // email. If the user typed phone/User ID,
                // this is what lets Supabase Auth perform the
                // actual password authentication.
                // ------------------------------------------

                const authEmail = String(
                    rawUser.authEmail ||
                    rawUser.email ||
                    ''
                ).trim().toLowerCase();

                if (!isValidEmail(authEmail)) {
                    throw new Error(
                        'This account does not have a valid registered email address. Please contact SafePass Vault Admin.'
                    );
                }

                // ------------------------------------------
                // 5. REAL password authentication:
                //    Supabase Auth.
                //
                // We intentionally DO NOT compare against
                // public.users.password in the browser.
                // ------------------------------------------

                const {
                    data: authData,
                    error: authError
                } = await supabase.auth.signInWithPassword({
                    email: authEmail,
                    password: String(password)
                });

                if (authError || !authData?.user) {
                    throw authError || new Error(
                        'Unable to authenticate this account.'
                    );
                }

                // ------------------------------------------
                // 6. Confirm the Auth email matches the
                //    account resolved from public.users.
                // ------------------------------------------

                const signedInEmail = String(
                    authData.user.email || ''
                ).trim().toLowerCase();

                if (
                    signedInEmail &&
                    signedInEmail !== authEmail
                ) {
                    await supabase.auth.signOut();

                    throw new Error(
                        'The authentication account does not match the SafePass account. Please contact Admin.'
                    );
                }

                // ------------------------------------------
                // 7. Securely claim/link the existing
                //    public.users profile to auth.uid().
                //
                // This also allows old vault records whose
                // owner_id is still NULL to be linked by the
                // server-side function.
                // ------------------------------------------

                const {
                    data: claimedProfile,
                    error: claimError
                } = await supabase.rpc(
                    'claim_current_user_profile',
                    {
                        p_user_id: finalUserId
                    }
                );

                if (claimError) {
                    console.error(
                        'claim_current_user_profile error:',
                        claimError
                    );

                    await supabase.auth.signOut();

                    throw new Error(
                        claimError.message ||
                        'Could not securely link your SafePass account.'
                    );
                }

                // Use the server-returned profile if available;
                // otherwise keep the already resolved public.users
                // profile.
                const profile =
                    Array.isArray(claimedProfile)
                        ? claimedProfile[0]
                        : claimedProfile;

                // The existing database function may return the full users row.
                // Use only non-secret profile fields from it.
                const claimedStatus = String(
                    profile?.status || currentStatus || ''
                ).trim();

                const normalizedClaimedStatus = claimedStatus
                    .toLowerCase()
                    .replace(/[\_-]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (
                    normalizedClaimedStatus === 'suspended' ||
                    normalizedClaimedStatus === 'blocked' ||
                    normalizedClaimedStatus === 'disabled' ||
                    normalizedClaimedStatus === 'disable'
                ) {
                    await supabase.auth.signOut();
                    clearLocalLoginState();

                    if (userIdGroup) {
                        userIdGroup.style.display = 'none';
                    }

                    if (loginBtn) {
                        loginBtn.disabled = true;
                        loginBtn.innerText = 'Account Restricted';
                    }

                    showLoginRestrictionPopup(claimedStatus);
                    return;
                }

                const standardizedUser = {
                    userId: finalUserId,
                    id: finalUserId,
                    _id:
                        rawUser._id ||
                        rawUser.id ||
                        finalUserId,

                    fullName:
                        profile?.fullName ||
                        rawUser.fullName ||
                        rawUser.userFullName ||
                        rawUser.userfullname ||
                        rawUser.name ||
                        rawUser.userName ||
                        'User',

                    email:
                        profile?.email ||
                        authEmail,

                    phoneNumber:
                        profile?.phoneNumber ||
                        rawUser.phoneNumber ||
                        rawUser.phone ||
                        rawUser.phonenumber ||
                        '',

                    status:
                        profile?.status ||
                        currentStatus,

                    accountStatus:
                        profile?.accountStatus ??
                        rawUser.accountStatus ??
                        rawUser.account_status ??
                        rawUser.status ??
                        currentStatus,

                    owner_id:
                        profile?.owner_id ??
                        rawUser.owner_id ??
                        rawUser.ownerId ??
                        authData.user.id,

                    auth_user_id:
                        authData.user.id
                };

                if (
                    autoGeneratedUserIdInput &&
                    userIdGroup
                ) {
                    autoGeneratedUserIdInput.value = finalUserId;
                    userIdGroup.style.display = 'block';
                }

                // ------------------------------------------
                // 8. Save only non-secret session/profile
                //    information locally.
                //
                // The Auth session itself is maintained by
                // Supabase Auth.
                // ------------------------------------------

                localStorage.setItem(
                    'isLoggedIn',
                    'true'
                );

                localStorage.setItem(
                    'safePassUser',
                    JSON.stringify(standardizedUser)
                );

                localStorage.setItem(
                    'user',
                    JSON.stringify(standardizedUser)
                );

                localStorage.setItem(
                    'currentUser',
                    JSON.stringify(standardizedUser)
                );

                localStorage.setItem(
                    'savedUserIdNumber',
                    finalUserId
                );

                isUserIdVerified = true;

                showToast(
                    'success',
                    'Login Successful',
                    `Welcome ${standardizedUser.fullName || 'User'}.`
                );

                // ------------------------------------------
                // 9. Preserve original 3-second redirect.
                // ------------------------------------------

                let secondsLeft = 3;

                if (loginBtn) {
                    loginBtn.innerText =
                        `Redirecting in ${secondsLeft}s...`;
                }

                const countdownInterval =
                    window.setInterval(() => {
                        secondsLeft -= 1;

                        if (secondsLeft > 0) {
                            if (loginBtn) {
                                loginBtn.innerText =
                                    `Redirecting in ${secondsLeft}s...`;
                            }
                        } else {
                            window.clearInterval(
                                countdownInterval
                            );

                            window.location.href =
                                'dashboard.html';
                        }
                    }, 1000);

            } catch (error) {
                console.error('Login Error:', error);

                if (userIdGroup) {
                    userIdGroup.style.display = 'none';
                }

                if (loginBtn) {
                    loginBtn.disabled = false;
                    loginBtn.innerText = 'Login';
                }

                showErrorModal(
                    'Login Failed!',
                    getFriendlyAuthError(error)
                );
            }
        });
    }
});
