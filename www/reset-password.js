document.addEventListener('DOMContentLoaded', async () => {
    const SUPABASE_URL = 'https://vgjsoicsmmzahhsuworg.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';
    
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const resetPasswordForm = document.getElementById('resetPasswordForm');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmNewPasswordInput = document.getElementById('confirmNewPassword');
    const updateBtn = document.getElementById('updateBtn');
    const messageBox = document.getElementById('messageBox');

    const showMessage = (text, isError = false) => {
        messageBox.textContent = text;
        messageBox.classList.remove('hidden', 'text-green-400', 'text-red-400');
        messageBox.classList.add(isError ? 'text-red-400' : 'text-green-400');
    };

    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const newPassword = newPasswordInput.value;
            const confirmPassword = confirmNewPasswordInput.value;

            if (newPassword !== confirmPassword) {
                showMessage("New passwords do not match!", true);
                return;
            }

            if (newPassword.length < 6) {
                showMessage("Password must be at least 6 characters long.", true);
                return;
            }

            try {
                updateBtn.disabled = true;
                updateBtn.textContent = "Updating...";

                // ১. Supabase Auth-এ পাসওয়ার্ড আপডেট করা
                const { data: authData, error: authError } = await supabase.auth.updateUser({
                    password: newPassword
                });

                if (authError) throw authError;

                // ইউজার ইমেইল বের করা যিনি পাসওয়ার্ড পরিবর্তন করছেন
                const userEmail = authData.user?.email;

                if (userEmail) {
                    // ২. কাস্টম 'users' টেবিলে পাসওয়ার্ড আপডেট করা (যাতে admin.html এবং user.html এ লাইভ আপডেট থাকে)
                    const { error: dbError } = await supabase
                        .from('users')
                        .update({ password: newPassword })
                        .eq('email', userEmail);

                    if (dbError) {
                        console.error("Database table update error:", dbError.message);
                    }
                }

                showMessage("Password updated successfully! Redirecting to login...", false);

                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 2500);

            } catch (error) {
                console.error("Password reset error:", error);
                showMessage(error.message || "Failed to update password. Link might be expired.", true);
                updateBtn.disabled = false;
                updateBtn.textContent = "Update Password";
            }
        });
    }
});