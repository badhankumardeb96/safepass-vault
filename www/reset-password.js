/* ==========================================================================\n   SafePass Vault - Secure Password Recovery\n   --------------------------------------------------------------------------\n   Flow:\n     1. index.html calls auth.resetPasswordForEmail(...).\n     2. Supabase opens this page with the recovery session in the URL.\n     3. This page verifies the session.\n     4. auth.updateUser({ password }) updates the real Supabase Auth password.\n     5. public.users.password is synchronized on a best-effort basis for the\n        existing SafePass legacy/admin compatibility layer.\n   ========================================================================== */

(() => {
    'use strict';

    const SUPABASE_URL = 'https://vgjsoicsmmzahhsuworg.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';

    const client = window.supabase?.createClient
        ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        })
        : null;

    const form = document.getElementById('resetPasswordForm');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const button = document.getElementById('resetPasswordBtn');
    const message = document.getElementById('message');
    const status = document.getElementById('status');

    function showMessage(text, type) {
        message.textContent = String(text || '');
        message.className = `message ${type || ''}`;
    }

    function setStatus(text) {
        status.textContent = String(text || '');
    }

    function friendlyError(error) {
        const msg = String(error?.message || error || '').trim();
        const lower = msg.toLowerCase();
        if (lower.includes('password should be at least')) return 'Password must be at least 6 characters long.';
        if (lower.includes('same password')) return 'Please choose a different password from your previous password.';
        if (lower.includes('expired') || lower.includes('invalid') || lower.includes('otp')) return 'This password reset link is invalid or has expired. Please request a new reset link.';
        return msg || 'Unable to reset your password. Please request a new reset link.';
    }

    async function getRecoverySession() {
        if (!client) throw new Error('Supabase client is not available.');

        // Supabase may need a moment to exchange the recovery token from the URL.
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (data?.session?.user) return data.session;

        return await new Promise((resolve, reject) => {
            let finished = false;
            const timeout = setTimeout(() => {
                if (!finished) {
                    finished = true;
                    reject(new Error('Password reset session was not found. The link may be expired or already used.'));
                }
            }, 7000);

            const { data: listener } = client.auth.onAuthStateChange((event, session) => {
                if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
                    if (session?.user) {
                        clearTimeout(timeout);
                        if (!finished) {
                            finished = true;
                            listener?.subscription?.unsubscribe();
                            resolve(session);
                        }
                    }
                }
            });
        });
    }

    async function syncLegacyPassword(session, password) {
        const user = session?.user;
        if (!user?.id) return { synced: false, skipped: true };

        // This is only a compatibility mirror for the existing public.users table.
        // Supabase Auth remains the authoritative password store.
        let result = await client
            .from('users')
            .update({ password })
            .eq('auth_user_id', user.id)
            .select('userId')
            .limit(1);

        if (!result.error && Array.isArray(result.data) && result.data.length) {
            return { synced: true };
        }

        // Older rows may not yet have auth_user_id linked. Fall back to email.
        const email = String(user.email || '').trim().toLowerCase();
        if (email) {
            result = await client
                .from('users')
                .update({ password })
                .eq('email', email)
                .select('userId')
                .limit(1);

            if (!result.error && Array.isArray(result.data) && result.data.length) {
                return { synced: true };
            }
        }

        console.warn('Legacy public.users password sync was not completed:', result.error || result.data);
        return { synced: false, skipped: false, error: result.error || null };
    }

    async function initialize() {
        try {
            if (!client) throw new Error('Supabase client is not available.');
            setStatus('Checking secure recovery link...');

            const session = await getRecoverySession();
            if (!session?.user) throw new Error('No valid password recovery session was found.');

            setStatus(`Recovery verified for ${session.user.email || 'your account'}.`);
            form.classList.remove('hidden');
        } catch (error) {
            console.error('Password recovery session error:', error);
            form.classList.add('hidden');
            setStatus('');
            showMessage(friendlyError(error), 'error');
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        showMessage('', '');

        const password = newPasswordInput.value;
        const confirmation = confirmPasswordInput.value;

        if (password.length < 6) {
            showMessage('Password must be at least 6 characters long.', 'error');
            newPasswordInput.focus();
            return;
        }

        if (password !== confirmation) {
            showMessage('New password and confirmation password do not match.', 'error');
            confirmPasswordInput.focus();
            return;
        }

        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';
        setStatus('Updating your Supabase Auth password...');

        try {
            const { data: sessionData, error: sessionError } = await client.auth.getSession();
            if (sessionError) throw sessionError;
            const session = sessionData?.session;
            if (!session?.user) throw new Error('Your recovery session has expired. Please request a new reset link.');

            // THIS is the important operation: it changes the actual Supabase Auth password.
            const { data: updatedUser, error: authError } = await client.auth.updateUser({
                password
            });

            if (authError) throw authError;
            if (!updatedUser?.user) throw new Error('Supabase did not confirm the password update.');

            const legacySync = await syncLegacyPassword(session, password);

            newPasswordInput.value = '';
            confirmPasswordInput.value = '';
            form.classList.add('hidden');

            if (legacySync.synced) {
                showMessage('Password updated successfully in Supabase Auth and your SafePass profile.', 'success');
            } else {
                showMessage('Password updated successfully in Supabase Auth. The legacy profile password mirror could not be updated, but login now uses Supabase Auth.', 'success');
            }

            setStatus('Password reset completed. Redirecting to login...');

            // Sign out the recovery session so the user returns to a clean login state.
            await client.auth.signOut();

            setTimeout(() => {
                window.location.replace('index.html');
            }, 2200);
        } catch (error) {
            console.error('Password update error:', error);
            showMessage(friendlyError(error), 'error');
            setStatus('Password was not changed.');
            button.disabled = false;
            button.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Update Password';
        }
    });

    initialize();
})();
