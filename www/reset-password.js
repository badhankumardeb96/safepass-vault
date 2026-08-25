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

            const newPassword = newPasswordInput ? newPasswordInput.value : '';
            const confirmPassword = confirmNewPasswordInput ? confirmNewPasswordInput.value : '';

            আপনার দেওয়া কোডটির সকল তথ্য (Supabase URL, Anon Key এবং লজিক) সম্পূর্ণ ঠিক রেখে, কোডটিকে আরও পরিপাটি, সুন্দর এবং বাগ-মুক্ত (Robust) করে সম্পূর্ণ আপডেট কোড নিচে দেওয়া হলো। 

আপনি এই সম্পূর্ণ কোডটি কপি করে আপনার `reset-password.js` ফাইলে পেস্ট করে দিতে পারেন:

```javascript
document.addEventListener('DOMContentLoaded', async () => {
    const SUPABASE_URL = '[https://vgjsoicsmmzahhsuworg.supabase.co](https://vgjsoicsmmzahhsuworg.supabase.co)';
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