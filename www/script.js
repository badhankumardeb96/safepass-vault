/* ==========================================================================
   SafePass Vault - Login Management
   --------------------------------------------------------------------------
   Login with:
     1) 10-digit SafePass User ID
     2) Registered email address
     3) Registered Bangladeshi phone number

   Authentication:
     - Supabase Auth performs the real password authentication.
     - public.users is accessed through the secure lookup_login_account RPC.
     - Account/profile linking is performed through claim_current_user_profile.
     - Vault records are NOT deleted during logout.

   IMPORTANT:
     - Do NOT use supabase.from('users').select('*') on the login page.
     - Run the required Supabase RPC SQL before using this file:
         lookup_login_account
         claim_current_user_profile
   ========================================================================== */

(() => {
    'use strict';

    const SUPABASE_URL = 'https://vgjsoicsmmzahhsuworg.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';

    const REDIRECT_PAGE = 'dashboard.html';
    const LOGIN_PAGE = 'index.html';

    const LOGIN_TIMEOUT_MS = 15000;
    const LOOKUP_TIMEOUT_MS = 10000;
    const CLAIM_TIMEOUT_MS = 10000;

    let supabase = null;
    let isUserIdVerified = false;
    let redirectStarted = false;

    const $ = (id) => document.getElementById(id);

    /* ======================================================================
       Small utilities
       ====================================================================== */

    const safeString = (value) => String(value ?? '').trim();

    const normalizeIdentifier = (value) => safeString(value);

    const escapeHtml = (value) => safeString(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const isValidEmail = (email) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeString(email));

    const isValidBangladeshiPhone = (phone) =>
        /^01[3-9]\d{8}$/.test(safeString(phone).replace(/\s+/g, ''));

    const normalizePhone = (phone) =>
        safeString(phone).replace(/\s+/g, '');

    const getSafePassUserId = (rawUser) => safeString(
        rawUser?.userId ??
        rawUser?.userid ??
        rawUser?.user_id ??
        rawUser?.id ??
        ''
    );

    const normalizeStatus = (status) => safeString(status)
        .toLowerCase()
        .replace(/[\_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const isRestrictedStatus = (status) => {
        const normalized = normalizeStatus(status);
        return [
            'suspended',
            'blocked',
            'disabled',
            'disable'
        ].includes(normalized);
    };

    /* ======================================================================
       App splash/loading
       ====================================================================== */

    const injectAppLoader = () => {
        if (!document.body || $('appSplashLoader')) return;

        const loaderHTML = `
            <div id="appSplashLoader"
                 style="
                    position:fixed;
                    inset:0;
                    z-index:2147483646;
                    display:flex;
                    flex-direction:column;
                    align-items:center;
                    justify-content:center;
                    background:#ffffff;
                    transition:opacity .35s ease;
                 ">
                <div id="splashLogo"
                     style="
                        width:120px;
                        height:120px;
                        display:flex;
                        align-items:center;
                        justify-content:center;
                        margin-bottom:20px;
                     ">
                    <img src="assets/logo.png"
                         alt="SafePass Vault Logo"
                         style="
                            max-width:100%;
                            max-height:100%;
                            object-fit:contain;
                         "
                         onerror="this.style.display='none';" />
                </div>

                <div style="
                    width:34px;
                    height:34px;
                    border:3px solid #dbe5ef;
                    border-top-color:#2563eb;
                    border-radius:50%;
                    animation:safePassLoginSpin .8s linear infinite;
                 "></div>

                <p style="
                    margin:14px 0 0;
                    color:#52606d;
                    font:14px Arial,Helvetica,sans-serif;
                 ">Loading please wait</p>
            </div>
        `;

        if (!document.getElementById('safePassLoginLoaderStyle')) {
            const style = document.createElement('style');
            style.id = 'safePassLoginLoaderStyle';
            style.textContent = `
                @keyframes safePassLoginSpin {
                    from { transform:rotate(0deg); }
                    to { transform:rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.insertAdjacentHTML('afterbegin', loaderHTML);

        window.setTimeout(() => {
            const loader = $('appSplashLoader');
            if (!loader) return;

            loader.style.opacity = '0';

            window.setTimeout(() => {
                if (loader.isConnected) loader.remove();
            }, 400);
        }, 800);
    };

    /* ======================================================================
       Toast
       ====================================================================== */

    const showToast = (type, title, message) => {
        const oldToast = $('safePassLoginToast');
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

        if (!$('safePassLoginToastStyles')) {
            const style = document.createElement('style');
            style.id = 'safePassLoginToastStyles';
            style.textContent = `
                #safePassLoginToast {
                    position:fixed;
                    top:24px;
                    right:24px;
                    z-index:2147483647;
                    width:min(390px,calc(100vw - 48px));
                    display:flex;
                    gap:12px;
                    align-items:flex-start;
                    padding:14px 16px;
                    box-sizing:border-box;
                    border-radius:14px;
                    background:#fff;
                    border:1px solid #e2e8ee;
                    box-shadow:0 14px 40px rgba(0,0,0,.18);
                    font-family:Arial,Helvetica,sans-serif;
                    animation:safePassToastIn .22s ease-out;
                }

                #safePassLoginToast .safe-pass-login-toast-icon {
                    width:34px;
                    height:34px;
                    flex:0 0 34px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    border-radius:50%;
                    background:${color};
                    color:#fff;
                    font-size:19px;
                    font-weight:700;
                }

                #safePassLoginToast .safe-pass-login-toast-content {
                    min-width:0;
                    display:flex;
                    flex-direction:column;
                    gap:3px;
                }

                #safePassLoginToast strong {
                    color:#243746;
                    font-size:14px;
                }

                #safePassLoginToast span {
                    color:#5d6a74;
                    font-size:13px;
                    line-height:1.45;
                }

                @keyframes safePassToastIn {
                    from {
                        opacity:0;
                        transform:translateY(-8px);
                    }
                    to {
                        opacity:1;
                        transform:translateY(0);
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        window.setTimeout(() => {
            if (!toast.isConnected) return;

            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-8px)';
            toast.style.transition =
                'opacity .2s ease, transform .2s ease';

            window.setTimeout(() => {
                if (toast.isConnected) toast.remove();
            }, 220);
        }, 2800);
    };

    /* ======================================================================
       Error modal
       ====================================================================== */

    const showErrorModal = (title, msg) => {
        const errorTitle = $('errorTitle');
        const errorMessage = $('errorMessage');
        const errorModal = $('errorModal');

        if (errorTitle) {
            errorTitle.innerText = safeString(title) || 'Error';
        }

        if (errorMessage) {
            errorMessage.innerText = safeString(msg);
        }

        if (errorModal) {
            errorModal.style.display = 'flex';
        } else {
            window.alert(
                `${safeString(title) || 'Error'}\n\n${safeString(msg)}`
            );
        }
    };

    const closeErrorModal = () => {
        const errorModal = $('errorModal');
        if (errorModal) errorModal.style.display = 'none';
    };

    /* ======================================================================
       Supabase initialization
       ====================================================================== */

    const createSafePassSupabaseClient = () => {
        if (
            !window.supabase ||
            typeof window.supabase.createClient !== 'function'
        ) {
            console.error(
                'Supabase JS CDN is missing. Load supabase-js before script.js.'
            );
            return null;
        }

        if (window.SafePassSupabaseClient) {
            return window.SafePassSupabaseClient;
        }

        const storage = (() => {
            try {
                return window.localStorage;
            } catch (_) {
                return undefined;
            }
        })();

        const client = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    storage,
                    storageKey: 'safepass-vault-auth',
                    flowType: 'pkce'
                },
                global: {
                    headers: {
                        'x-client-info':
                            'safepass-vault-web-mobile'
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

    /* ======================================================================
       Promise timeout helper
       ====================================================================== */

    const withTimeout = (promise, timeoutMs, timeoutMessage) => {
        let timer = null;

        const timeoutPromise = new Promise((_, reject) => {
            timer = window.setTimeout(() => {
                reject(new Error(timeoutMessage));
            }, timeoutMs);
        });

        return Promise.race([
            Promise.resolve(promise).finally(() => {
                if (timer !== null) {
                    window.clearTimeout(timer);
                }
            }),
            timeoutPromise
        ]);
    };

    /* ======================================================================
       Login lookup RPC
       ====================================================================== */

    const findUserByIdentifier = async (identifier) => {
        const cleanIdentifier = normalizeIdentifier(identifier);

        if (!cleanIdentifier) return null;

        if (!supabase) {
            throw new Error(
                'Supabase client is not available. Please check the Supabase JS script.'
            );
        }

        /*
         * IMPORTANT:
         * Never call:
         *   supabase.from('users').select('*')
         *
         * The login page uses the secure RPC instead.
         */
        const rpcPromise = supabase.rpc(
            'lookup_login_account',
            {
                p_identifier: cleanIdentifier
            }
        );

        let result;

        try {
            result = await withTimeout(
                rpcPromise,
                LOOKUP_TIMEOUT_MS,
                'Account lookup timed out. Please check your internet connection and try again.'
            );
        } catch (error) {
            console.error('lookup_login_account failed:', error);

            const msg = safeString(error?.message).toLowerCase();

            if (
                msg.includes('function') &&
                msg.includes('does not exist')
            ) {
                throw new Error(
                    'Login service is not configured in Supabase. Please run supabase_login_lookup.sql in Supabase SQL Editor.'
                );
            }

            if (
                msg.includes('timed out') ||
                msg.includes('failed to fetch') ||
                msg.includes('network')
            ) {
                throw new Error(
                    'Unable to connect to SafePass Vault. Please check your internet connection and try again.'
                );
            }

            throw new Error(
                'Unable to verify the account right now. Please try again.'
            );
        }

        const { data, error } = result || {};

        if (error) {
            console.error('lookup_login_account error:', error);

            const msg = safeString(error.message).toLowerCase();

            if (
                msg.includes('function') &&
                msg.includes('does not exist')
            ) {
                throw new Error(
                    'Login service is not configured in Supabase. Please run supabase_login_lookup.sql in SQL Editor.'
                );
            }

            if (
                msg.includes('jwt') ||
                msg.includes('401') ||
                msg.includes('unauthorized')
            ) {
                throw new Error(
                    'SafePass login authorization is not configured correctly. Please check the Supabase RPC permissions.'
                );
            }

            throw new Error(
                'Unable to verify the account right now. Please try again.'
            );
        }

        if (!data) return null;

        const row = Array.isArray(data)
            ? (data[0] || null)
            : data;

        if (!row) return null;

        return {
            ...row,

            userId:
                row.userId ??
                row.user_id ??
                row.userid ??
                '',

            fullName:
                row.fullName ??
                row.full_name ??
                '',

            phoneNumber:
                row.phoneNumber ??
                row.phone_number ??
                '',

            email:
                row.email ??
                row.auth_email ??
                '',

            authEmail:
                row.authEmail ??
                row.auth_email ??
                row.email ??
                '',

            status:
                row.status ??
                ''
        };
    };

    /* ======================================================================
       Account restriction popup
       ====================================================================== */

    const showLoginRestrictionPopup = (status) => {
        const normalized = normalizeStatus(status);

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
        } else {
            message = 'Your account access is restricted.';
        }

        const oldPopup = $('safePassLoginRestrictionOverlay');
        if (oldPopup) oldPopup.remove();

        const oldStyle = $('safePassLoginRestrictionStyles');
        if (oldStyle) oldStyle.remove();

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

                <p class="safe-pass-login-status">
                    ${escapeHtml(message)}
                </p>

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
                position:fixed;
                inset:0;
                z-index:2147483647;
                display:flex;
                align-items:center;
                justify-content:center;
                padding:24px;
                box-sizing:border-box;
                background:rgba(10,18,30,.78);
                backdrop-filter:blur(4px);
                -webkit-backdrop-filter:blur(4px);
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-restriction-card {
                width:min(460px,100%);
                padding:30px 28px 28px;
                box-sizing:border-box;
                border-radius:16px;
                background:#fff;
                border:1px solid #e1e7ec;
                box-shadow:0 22px 60px rgba(0,0,0,.28);
                text-align:center;
                font-family:Arial,Helvetica,sans-serif;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-warning {
                width:68px;
                height:68px;
                margin:0 auto 16px;
                display:flex;
                align-items:center;
                justify-content:center;
                border-radius:50%;
                background:#fff4d6;
                color:#e59b00;
                border:2px solid #f0c45c;
                font-size:36px;
                font-weight:700;
            }

            #safePassLoginRestrictionOverlay h2 {
                margin:0 0 12px;
                color:#244b5d;
                font-size:21px;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-status {
                margin:0 0 10px;
                color:#d64545;
                font-size:17px;
                font-weight:700;
                line-height:1.5;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-contact {
                margin:0;
                color:#5f6b75;
                font-size:14px;
                line-height:1.5;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-countdown {
                margin:18px 0 0;
                padding-top:14px;
                border-top:1px solid #edf0f3;
                color:#6b7680;
                font-size:13px;
            }

            #safePassLoginRestrictionOverlay
            .safe-pass-login-countdown strong {
                display:inline-flex;
                min-width:26px;
                justify-content:center;
                color:#d64545;
                font-size:16px;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(overlay);

        let seconds = 10;
        const countdown = $('safePassLoginRestrictionCountdown');

        const timer = window.setInterval(() => {
            seconds -= 1;

            if (countdown) {
                countdown.textContent = String(
                    Math.max(seconds, 0)
                );
            }

            if (seconds <= 0) {
                window.clearInterval(timer);
                window.location.replace(LOGIN_PAGE);
            }
        }, 1000);
    };

    /* ======================================================================
       Local login state
       ====================================================================== */

    const clearLocalLoginState = () => {
        try {
            localStorage.removeItem('safePassUser');
            localStorage.removeItem('user');
            localStorage.removeItem('currentUser');
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('savedUserIdNumber');
            localStorage.removeItem('activeTab');

            /*
             * IMPORTANT:
             * Do not remove:
             *   vault_records
             *   vault_records_<auth-user-id>
             */
        } catch (error) {
            console.warn(
                'Could not clear local login state:',
                error
            );
        }
    };

    /* ======================================================================
       Friendly Auth errors
       ====================================================================== */

    const getFriendlyAuthError = (error) => {
        const raw = safeString(
            error?.message ||
            error ||
            ''
        );

        const lower = raw.toLowerCase();

        if (
            lower.includes('invalid login credentials') ||
            lower.includes('invalid credentials')
        ) {
            return (
                'Incorrect password or login credentials. ' +
                'Please check your password and try again.'
            );
        }

        if (lower.includes('email not confirmed')) {
            return (
                'Your email address has not been confirmed yet. ' +
                'Please check your email and confirm your account.'
            );
        }

        if (lower.includes('too many requests')) {
            return (
                'Too many login attempts. Please wait a little while and try again.'
            );
        }

        if (
            lower.includes('failed to fetch') ||
            lower.includes('network') ||
            lower.includes('fetch') ||
            lower.includes('timed out')
        ) {
            return (
                'Unable to connect to SafePass Vault. ' +
                'Please check your internet connection.'
            );
        }

        if (lower.includes('user not found')) {
            return 'This account is not registered.';
        }

        if (
            lower.includes('401') ||
            lower.includes('unauthorized') ||
            lower.includes('jwt')
        ) {
            return (
                'SafePass login authorization failed. ' +
                'Please check the Supabase login RPC permissions.'
            );
        }

        return raw ||
            'Unable to sign in right now. Please try again.';
    };

    /* ======================================================================
       Login page initialization
       ====================================================================== */

    const initializeLoginPage = () => {
        injectAppLoader();

        const loginForm = $('loginForm');
        const identifierInput = $('identifier');
        const passwordInput = $('password');
        const userIdGroup = $('userIdGroup');
        const autoGeneratedUserIdInput = $('autoGeneratedUserId');
        const loginBtn = $('loginBtn');

        const errorModal = $('errorModal');
        const closeModalBtn = $('closeModalBtn');

        const forgotPasswordLink = $('forgotPasswordLink');
        const forgotPromptModal = $('forgotPromptModal');
        const resetIdentifierInput = $('resetIdentifierInput');
        const submitForgotBtn = $('submitForgotBtn');
        const cancelForgotBtn = $('cancelForgotBtn');

        supabase = createSafePassSupabaseClient();

        if (!supabase) {
            showErrorModal(
                'Login Service Error',
                'Supabase could not be initialized. Please reload the application.'
            );
        }

        /*
         * Expose authenticated client for other SafePass pages / Capacitor.
         */
        window.getSafePassSupabase = () => supabase;

        /* ---------------------------------------------------------------
           Error modal close
           --------------------------------------------------------------- */

        if (closeModalBtn) {
            closeModalBtn.addEventListener(
                'click',
                closeErrorModal
            );
        }

        window.addEventListener('click', (event) => {
            if (
                errorModal &&
                event.target === errorModal
            ) {
                errorModal.style.display = 'none';
            }

            if (
                forgotPromptModal &&
                event.target === forgotPromptModal
            ) {
                forgotPromptModal.style.display = 'none';

                if (resetIdentifierInput) {
                    resetIdentifierInput.value = '';
                }
            }
        });

        window.addEventListener('keydown', (event) => {
            const isForgotOpen =
                forgotPromptModal &&
                getComputedStyle(
                    forgotPromptModal
                ).display !== 'none';

            const isErrorOpen =
                errorModal &&
                getComputedStyle(
                    errorModal
                ).display !== 'none';

            if (isForgotOpen) {
                if (event.key === 'Enter') {
                    event.preventDefault();

                    if (
                        document.activeElement ===
                        cancelForgotBtn
                    ) {
                        cancelForgotBtn?.click();
                    } else {
                        submitForgotBtn?.click();
                    }
                }

                if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelForgotBtn?.click();
                }
            }

            if (isErrorOpen) {
                if (
                    event.key === 'Enter' ||
                    event.key === 'Escape'
                ) {
                    event.preventDefault();
                    closeModalBtn?.click();
                }
            }
        });

        /* ---------------------------------------------------------------
           Password copy/paste restriction
           --------------------------------------------------------------- */

        if (passwordInput) {
            ['copy', 'paste', 'cut', 'drop'].forEach(
                (eventType) => {
                    passwordInput.addEventListener(
                        eventType,
                        (event) => {
                            event.preventDefault();

                            showErrorModal(
                                'Security Restriction',
                                'For security reasons, copy-pasting passwords is restricted. Please type manually.'
                            );
                        }
                    );
                }
            );
        }

        /* ---------------------------------------------------------------
           Forgot password
           --------------------------------------------------------------- */

        if (forgotPasswordLink) {
            forgotPasswordLink.addEventListener(
                'click',
                (event) => {
                    event.preventDefault();

                    if (!navigator.onLine) {
                        showErrorModal(
                            'No Internet',
                            'Please check your internet connection to reset your password.'
                        );
                        return;
                    }

                    if (forgotPromptModal) {
                        forgotPromptModal.style.display = 'flex';

                        window.setTimeout(() => {
                            resetIdentifierInput?.focus();
                        }, 100);
                    }
                }
            );
        }

        if (cancelForgotBtn) {
            cancelForgotBtn.addEventListener(
                'click',
                () => {
                    if (forgotPromptModal) {
                        forgotPromptModal.style.display = 'none';
                    }

                    if (resetIdentifierInput) {
                        resetIdentifierInput.value = '';
                    }

                    window.location.href = LOGIN_PAGE;
                }
            );
        }

        if (submitForgotBtn) {
            submitForgotBtn.addEventListener(
                'click',
                async () => {
                    const inputVal =
                        resetIdentifierInput
                            ? safeString(
                                resetIdentifierInput.value
                            )
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
                            forgotPromptModal.style.display =
                                'none';
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
                            await findUserByIdentifier(
                                inputVal
                            );

                        if (!existingUser) {
                            if (forgotPromptModal) {
                                forgotPromptModal.style.display =
                                    'none';
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

                        const authEmail = safeString(
                            existingUser.authEmail ||
                            existingUser.email
                        ).toLowerCase();

                        if (!isValidEmail(authEmail)) {
                            throw new Error(
                                'This account does not have a valid registered email address for password recovery.'
                            );
                        }

                        const redirectToUrl = new URL(
                            'reset-password.html',
                            window.location.href
                        ).href;

                        const result =
                            await withTimeout(
                                supabase.auth.resetPasswordForEmail(
                                    authEmail,
                                    {
                                        redirectTo:
                                            redirectToUrl
                                    }
                                ),
                                LOGIN_TIMEOUT_MS,
                                'Password reset request timed out. Please try again.'
                            );

                        const authError =
                            result?.error;

                        if (authError) {
                            throw new Error(
                                authError.message ||
                                'Unable to send password reset email.'
                            );
                        }

                        if (forgotPromptModal) {
                            forgotPromptModal.style.display =
                                'none';
                        }

                        if (resetIdentifierInput) {
                            resetIdentifierInput.value = '';
                        }

                        showErrorModal(
                            'Email Sent!',
                            'A password reset link has been sent successfully to your inbox.\nPlease check your email (and spam folder).'
                        );

                    } catch (error) {
                        console.error(
                            'Forgot password request error:',
                            error
                        );

                        showErrorModal(
                            'Error',
                            getFriendlyAuthError(error)
                        );

                    } finally {
                        submitForgotBtn.disabled = false;
                        submitForgotBtn.innerText =
                            'Submit Request';
                    }
                }
            );
        }

        /* ---------------------------------------------------------------
           Reconnect/session refresh
           --------------------------------------------------------------- */

        window.addEventListener('online', async () => {
            if (!supabase) return;

            try {
                await supabase.auth.getSession();
            } catch (error) {
                console.warn(
                    'Session refresh after reconnect failed:',
                    error
                );
            }
        });

        document.addEventListener(
            'visibilitychange',
            async () => {
                if (
                    document.visibilityState !==
                    'visible' ||
                    !supabase
                ) {
                    return;
                }

                try {
                    await supabase.auth.getSession();
                } catch (error) {
                    console.warn(
                        'Session check failed:',
                        error
                    );
                }
            }
        );

        /* ---------------------------------------------------------------
           Login submit
           --------------------------------------------------------------- */

        if (!loginForm) return;

        loginForm.addEventListener(
            'submit',
            async (event) => {
                event.preventDefault();

                if (redirectStarted) return;

                if (isUserIdVerified) {
                    window.location.href = REDIRECT_PAGE;
                    return;
                }

                const identifier = normalizeIdentifier(
                    identifierInput?.value
                );

                const password =
                    passwordInput?.value || '';

                if (!identifier || !password) {
                    if (userIdGroup) {
                        userIdGroup.style.display =
                            'none';
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

                if (!supabase) {
                    showErrorModal(
                        'Login Service Error',
                        'Supabase could not be initialized. Please reload the application.'
                    );
                    return;
                }

                let redirectTimer = null;

                try {
                    loginBtn?.setAttribute(
                        'data-login-running',
                        'true'
                    );

                    if (loginBtn) {
                        loginBtn.disabled = true;
                        loginBtn.innerText =
                            'Checking account status...';
                    }

                    /*
                     * STEP 1:
                     * Resolve email / phone / User ID through RPC.
                     *
                     * This fixes the old 401 problem caused by:
                     *   GET /rest/v1/users?select=*&limit=1
                     */
                    const rawUser =
                        await findUserByIdentifier(
                            identifier
                        );

                    if (!rawUser) {
                        throw new Error(
                            'Account not found. Please check your Email, Phone Number or 10-digit User ID.'
                        );
                    }

                    /*
                     * STEP 2:
                     * Check account status before password login.
                     */
                    const statusCandidates = [
                        rawUser.status,
                        rawUser.accountStatus,
                        rawUser.account_status,
                        rawUser.userStatus,
                        rawUser.user_status,
                        rawUser.state
                    ];

                    let currentStatus = '';

                    for (
                        const candidate
                        of statusCandidates
                    ) {
                        if (
                            candidate !== null &&
                            candidate !== undefined &&
                            safeString(candidate) !== ''
                        ) {
                            currentStatus =
                                safeString(candidate);
                            break;
                        }
                    }

                    if (
                        isRestrictedStatus(
                            currentStatus
                        )
                    ) {
                        clearLocalLoginState();

                        if (userIdGroup) {
                            userIdGroup.style.display =
                                'none';
                        }

                        if (loginBtn) {
                            loginBtn.disabled = true;
                            loginBtn.innerText =
                                'Account Restricted';
                        }

                        showLoginRestrictionPopup(
                            currentStatus
                        );

                        return;
                    }

                    /*
                     * STEP 3:
                     * Validate 10-digit SafePass User ID.
                     */
                    const finalUserId =
                        getSafePassUserId(rawUser);

                    if (!/^\d{10}$/.test(finalUserId)) {
                        throw new Error(
                            'Your account has an invalid 10-digit User ID. Please contact SafePass Vault Admin.'
                        );
                    }

                    /*
                     * STEP 4:
                     * Resolve registered Auth email.
                     */
                    const authEmail = safeString(
                        rawUser.authEmail ||
                        rawUser.email
                    ).toLowerCase();

                    if (!isValidEmail(authEmail)) {
                        throw new Error(
                            'This account does not have a valid registered email address. Please contact SafePass Vault Admin.'
                        );
                    }

                    /*
                     * STEP 5:
                     * REAL password authentication.
                     */
                    if (loginBtn) {
                        loginBtn.innerText =
                            'Signing in securely...';
                    }

                    const authResult =
                        await withTimeout(
                            supabase.auth.signInWithPassword(
                                {
                                    email: authEmail,
                                    password: String(
                                        password
                                    )
                                }
                            ),
                            LOGIN_TIMEOUT_MS,
                            'Login request timed out. Please check your internet connection and try again.'
                        );

                    const authData =
                        authResult?.data;

                    const authError =
                        authResult?.error;

                    if (
                        authError ||
                        !authData?.user
                    ) {
                        throw (
                            authError ||
                            new Error(
                                'Unable to authenticate this account.'
                            )
                        );
                    }

                    /*
                     * STEP 6:
                     * Verify Auth email matches lookup account.
                     */
                    const signedInEmail =
                        safeString(
                            authData.user.email
                        ).toLowerCase();

                    if (
                        signedInEmail &&
                        signedInEmail !== authEmail
                    ) {
                        await supabase.auth.signOut();

                        throw new Error(
                            'The authentication account does not match the SafePass account. Please contact Admin.'
                        );
                    }

                    /*
                     * STEP 7:
                     * Securely claim/link public.users profile.
                     */
                    if (loginBtn) {
                        loginBtn.innerText =
                            'Checking account status...';
                    }

                    const claimResult =
                        await withTimeout(
                            supabase.rpc(
                                'claim_current_user_profile',
                                {
                                    p_user_id:
                                        finalUserId
                                }
                            ),
                            CLAIM_TIMEOUT_MS,
                            'Account verification timed out. Please try again.'
                        );

                    const claimedProfile =
                        claimResult?.data;

                    const claimError =
                        claimResult?.error;

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

                    const profile =
                        Array.isArray(
                            claimedProfile
                        )
                            ? (
                                claimedProfile[0] ||
                                null
                            )
                            : claimedProfile;

                    /*
                     * STEP 8:
                     * Check status again after secure profile claim.
                     */
                    const claimedStatus =
                        safeString(
                            profile?.status ||
                            currentStatus
                        );

                    if (
                        isRestrictedStatus(
                            claimedStatus
                        )
                    ) {
                        await supabase.auth.signOut();

                        clearLocalLoginState();

                        if (userIdGroup) {
                            userIdGroup.style.display =
                                'none';
                        }

                        if (loginBtn) {
                            loginBtn.disabled = true;
                            loginBtn.innerText =
                                'Account Restricted';
                        }

                        showLoginRestrictionPopup(
                            claimedStatus
                        );

                        return;
                    }

                    /*
                     * STEP 9:
                     * Build the same SafePass profile shape.
                     */
                    const standardizedUser = {
                        userId: finalUserId,

                        id:
                            finalUserId,

                        _id:
                            rawUser._id ||
                            rawUser.id ||
                            finalUserId,

                        fullName:
                            profile?.fullName ||
                            profile?.full_name ||
                            rawUser.fullName ||
                            rawUser.userFullName ||
                            rawUser.userfullname ||
                            rawUser.name ||
                            rawUser.userName ||
                            'User',

                        email:
                            profile?.email ||
                            profile?.auth_email ||
                            authEmail,

                        phoneNumber:
                            profile?.phoneNumber ||
                            profile?.phone_number ||
                            rawUser.phoneNumber ||
                            rawUser.phone ||
                            rawUser.phonenumber ||
                            '',

                        status:
                            profile?.status ||
                            currentStatus,

                        accountStatus:
                            profile?.accountStatus ??
                            profile?.account_status ??
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
                        autoGeneratedUserIdInput.value =
                            finalUserId;

                        userIdGroup.style.display =
                            'block';
                    }

                    /*
                     * STEP 10:
                     * Save only non-secret local profile/session flags.
                     * Supabase Auth stores the actual Auth session.
                     */
                    localStorage.setItem(
                        'isLoggedIn',
                        'true'
                    );

                    localStorage.setItem(
                        'safePassUser',
                        JSON.stringify(
                            standardizedUser
                        )
                    );

                    localStorage.setItem(
                        'user',
                        JSON.stringify(
                            standardizedUser
                        )
                    );

                    localStorage.setItem(
                        'currentUser',
                        JSON.stringify(
                            standardizedUser
                        )
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

                    /*
                     * STEP 11:
                     * Redirect after 3 seconds.
                     */
                    let secondsLeft = 3;

                    if (loginBtn) {
                        loginBtn.innerText =
                            `Redirecting in ${secondsLeft}s...`;
                    }

                    redirectStarted = true;

                    redirectTimer =
                        window.setInterval(
                            () => {
                                secondsLeft -= 1;

                                if (
                                    secondsLeft > 0
                                ) {
                                    if (
                                        loginBtn
                                    ) {
                                        loginBtn.innerText =
                                            `Redirecting in ${secondsLeft}s...`;
                                    }
                                } else {
                                    window.clearInterval(
                                        redirectTimer
                                    );
                                    redirectTimer =
                                        null;

                                    window.location.replace(
                                        REDIRECT_PAGE
                                    );
                                }
                            },
                            1000
                        );

                } catch (error) {
                    if (redirectTimer) {
                        window.clearInterval(
                            redirectTimer
                        );
                        redirectTimer = null;
                    }

                    console.error(
                        'SafePass Login Error:',
                        error
                    );

                    if (userIdGroup) {
                        userIdGroup.style.display =
                            'none';
                    }

                    if (loginBtn) {
                        loginBtn.disabled = false;
                        loginBtn.innerText = 'Login';
                        loginBtn.removeAttribute(
                            'data-login-running'
                        );
                    }

                    showErrorModal(
                        'Login Failed!',
                        getFriendlyAuthError(
                            error
                        )
                    );
                }
            }
        );
    };

    /* ======================================================================
       DOM ready
       ====================================================================== */

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            initializeLoginPage,
            { once: true }
        );
    } else {
        initializeLoginPage();
    }
})();
