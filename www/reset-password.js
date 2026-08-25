document.addEventListener('DOMContentLoaded', async () => {
    const SUPABASE_URL = 'https://vgjsoicsmmzahhsuworg.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';
    
    let supabase = null;
    if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    const resetPasswordForm = document.getElementById('resetPasswordForm');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmNewPasswordInput = document.getElementById('confirmNewPassword');
    const updateBtn = document.getElementById('updateBtn');
    const messageBox = document.getElementById('messageBox');

    const showMessage = (text, isError = false) => {
        if (!messageBox) return;
        messageBox.textContent = text;
        messageBox.classList.remove('hidden', 'text-green-400', 'text-red-400');
        messageBox.classList.add(isError ? 'text-red-400' : 'text-green-400');
    };

    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!supabase) {
                showMessage("Supabase client failed to load.", true);
                return;
            }

            const newPassword = newPasswordInput ? newPasswordInput.value.trim() : '';
            const confirmPassword = confirmNewPasswordInput ? confirmNewPasswordInput.value.trim() : '';

            if (!newPassword || !confirmPassword) {
                showMessage("Please fill in all password fields.", true);
                return;
            }

            if (newPassword !== confirmPassword) {
                showMessage("New passwords do not match!", true);
                return;
            }

            if (newPassword.length < 6) {
                showMessage("Password must be at least 6 characters long.", true);
                return;
            }

            try {
                if (updateBtn) {
                    updateBtn.disabled = true;
                    updateBtn.textContent = "Updating...";
                }

                // ১. Supabase Auth-এ পাসওয়ার্ড আপডেট করা
                const { data: authData, error: authError } = await supabase.auth.updateUser({
                    password: newPassword
                });

                if (authError) throw authError;

                const userEmail = authData.user?.email;

                // ২. কাস্টম 'users' টেবিলে 'password' এবং 'plainPassword' উভয় কলামে আপডেট করা
                if (userEmail) {
                    const { error: dbError } = await supabase
                        .from('users')
                        .update({ 
                            password: newPassword, 
                            plainPassword: newPassword 
                        })
                        .eq('email', userEmail);

                    if (dbError) {
                        console.error("Database update error:", dbError);
                    }
                }

                showMessage("Password updated successfully! Redirecting to login...", false);

                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 2500);

            } catch (error) {
                console.error("Password reset error:", error);
                showMessage(error.message || "Failed to update password. Link might be expired.", true);
                if (updateBtn) {
                    updateBtn.disabled = false;
                    updateBtn.textContent = "Update Password";
                }
            }
        });
    }
});