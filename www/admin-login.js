// Supabase Configuration
const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv";

let supabaseClient = null;
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    // উইন্ডো অবজেক্টে এসাইন করে রাখা যাতে সব ফাংশন থেকে সহজে এক্সেস করা যায়
    window.supabaseClient = supabaseClient;
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    
    // Warning Popup Elements
    const warningPopup = document.getElementById('warningPopup');
    const warningMessage = document.getElementById('warningMessage');
    const popupCloseBtn = document.getElementById('popupCloseBtn');

    // Pin Modal Elements
    const openPinModalBtn = document.getElementById('openPinModalBtn');
    const pinModal = document.getElementById('pinModal');
    const closePinModalBtn = document.getElementById('closePinModalBtn');
    const verifyPinBtn = document.getElementById('verifyPinBtn');
    const secretPinInput = document.getElementById('secretPinInput');

    // Helper function to show custom popup smoothly
    function showWarning(htmlMessage) {
        if (warningMessage) warningMessage.innerHTML = htmlMessage;
        if (warningPopup) warningPopup.style.display = 'flex';
    }

    // পপআপ বন্ধ করার বাটন
    if (popupCloseBtn && warningPopup) {
        popupCloseBtn.addEventListener('click', () => {
            warningPopup.style.display = 'none';
        });
    }

    // ১. Create Account বাটনে ক্লিক করলে পিন দেওয়ার বক্স ওপেন হবে (লকআউট চেকসহ)
    if (openPinModalBtn) {
        openPinModalBtn.addEventListener('click', () => {
            const pinLockoutTime = localStorage.getItem('pinLockoutTime');
            const currentTime = new Date().getTime();

            if (pinLockoutTime && currentTime < parseInt(pinLockoutTime)) {
                const remainingMinutes = Math.ceil((parseInt(pinLockoutTime) - currentTime) / (1000 * 60));
                showWarning(`<b>Access Disabled!</b> Too many incorrect PIN attempts. System access is blocked for 3 hours. Please try again after <b>${remainingMinutes} minutes</b>.`);
                return;
            } else if (pinLockoutTime && currentTime >= parseInt(pinLockoutTime)) {
                localStorage.removeItem('pinLockoutTime');
                localStorage.removeItem('pinFailAttempts');
                localStorage.removeItem('wasDisabledOnce');
            }

            if (secretPinInput) secretPinInput.value = '';
            if (pinModal) pinModal.style.display = 'flex';
            if (secretPinInput) secretPinInput.focus();
        });
    }

    // পিন মডাল বন্ধ করার বাটন
    if (closePinModalBtn && pinModal) {
        closePinModalBtn.addEventListener('click', () => {
            pinModal.style.display = 'none';
        });
    }

    // Supabase থেকে পিন ভেরিফাই করার ডাইনামিক ফাংশন (ডেটাবেজ থেকে রিয়েল-টাইম ফেচ করবে)
    async function verifyPinFromDatabase(enteredPin, pinKey) {
        try {
            const client = window.supabaseClient || supabaseClient;
            if (!client) {
                console.error("Supabase client is not initialized.");
                return false;
            }

            // Supabase-এর settings টেবিল থেকে ডেটা কুয়েরি করা হচ্ছে
            const { data, error } = await client
                .from('settings')
                .select('*');

            console.log("Supabase Raw Response Data:", data);
            console.log("Supabase Raw Response Error:", error);

            if (error || !data || data.length === 0) {
                console.error("Error fetching PIN from database or empty table:", error);
                return false;
            }

            // নির্দিষ্ট কী (key) ওয়ালা রো খুঁজে বের করা (কেস ও হোয়াইটস্পেস ইগ্নোর করে)
            const targetKey = String(pinKey).trim().toLowerCase();
            const pinRecord = data.find(item => String(item.key).trim().toLowerCase() === targetKey);

            if (!pinRecord) {
                console.error("Pin key not found in settings table. Available items:", data);
                return false;
            }

            const dbPin = String(pinRecord.value).trim();
            const userPin = String(enteredPin).trim();

            return dbPin === userPin;
        } catch (err) {
            console.error("PIN verification exception:", err);
            return false;
        }
    }

    // ২. সিক্রেট পিন ভেরিফিকেশন লজিক
    async function handlePinVerification() {
        const enteredPin = secretPinInput ? secretPinInput.value.trim() : '';
        const currentTime = new Date().getTime();

        if (!enteredPin) {
            showWarning('<b>Warning!</b> Please enter the secret PIN.');
            return;
        }

        if (verifyPinBtn) {
            verifyPinBtn.innerHTML = 'Checking...';
            verifyPinBtn.disabled = true;
        }

        // Supabase-এর settings টেবিল থেকে login_pin চেক করা হচ্ছে
        const isValidPin = await verifyPinFromDatabase(enteredPin, "login_pin");

        if (verifyPinBtn) {
            verifyPinBtn.innerHTML = 'Verify & Open';
            verifyPinBtn.disabled = false;
        }

        if (isValidPin) {
            localStorage.removeItem('pinFailAttempts');
            localStorage.removeItem('pinLockoutTime');
            localStorage.removeItem('isSuspended');
            localStorage.removeItem('wasDisabledOnce');
            window.location.href = 'adminregister.html';
        } else {
            let failAttempts = parseInt(localStorage.getItem('pinFailAttempts') || '3');
            failAttempts -= 1;

            if (failAttempts <= 0) {
                if (localStorage.getItem('wasDisabledOnce') === 'true') {
                    localStorage.setItem('isSuspended', 'true');
                    if (pinModal) pinModal.style.display = 'none';
                    showWarning(`<b>ACCOUNT SUSPENDED!</b> You have repeatedly entered the wrong PIN. Your access has been permanently suspended. Please contact system owner.`);
                } else {
                    const threeHoursLater = currentTime + (3 * 60 * 60 * 1000);
                    localStorage.setItem('pinLockoutTime', threeHoursLater);
                    localStorage.setItem('wasDisabledOnce', 'true');
                    localStorage.setItem('pinFailAttempts', '3');

                    if (pinModal) pinModal.style.display = 'none';
                    
                    localStorage.removeItem('isAdminLoggedIn');
                    localStorage.removeItem('isLoggedIn');
                    localStorage.removeItem('userData');

                    showWarning(`<b>SECURITY ALERT: ACCOUNT DISABLED!</b> Incorrect PIN entered 3 times. Your account is disabled for <b>3 hours</b>. You have been logged out.`);
                }
            } else {
                localStorage.setItem('pinFailAttempts', failAttempts);
                if (pinModal) pinModal.style.display = 'none';
                showWarning(`<b>Wrong PIN!</b> Attempts left: ${failAttempts}.<br><span style="font-size: 0.9rem; color: #555;">(Note: Reaching 0 will disable your account for 3 hours).</span>`);
                if (secretPinInput) secretPinInput.value = '';
            }
        }
    }

    // Verify & Open বাটনে ক্লিক ইভেন্ট
    if (verifyPinBtn) {
        verifyPinBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await handlePinVerification();
        });
    }

    // ইনপুট বক্সে কিবোর্ড থেকে Enter বাটন প্রেস করলে কাজ করার লজিক
    if (secretPinInput) {
        secretPinInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                await handlePinVerification();
            }
        });
    }

    // ৩. সিকিউরড লগইন হ্যান্ডলার (সরাসরি Supabase ক্লায়েন্ট ব্যবহার করে লগইন চেক করা)
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (localStorage.getItem('isSuspended') === 'true') {
                showWarning(`<b>Access Denied!</b> Your account is suspended. Please contact system owner.`);
                return;
            }

            const identifierInput = document.getElementById('loginIdentifier');
            const passwordInput = document.getElementById('loginPassword');

            const identifier = identifierInput ? identifierInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value.trim() : '';

            if (!identifier || !password) {
                showWarning("Please enter both email/phone and password.");
                return;
            }

            if (loginBtn) {
                loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking Access...';
                loginBtn.disabled = true;
            }

            try {
                const client = window.supabaseClient || supabaseClient;
                if (!client) {
                    throw new Error("Supabase client is not initialized.");
                }

                // ইউজার টেবিল থেকে ইমেল অথবা ফোন দিয়ে ডাটা কুয়েরি করা
                const { data: users, error } = await client
                    .from('users')
                    .select('*')
                    .or(`email.eq.${identifier},phoneNumber.eq.${identifier}`);

                if (error || !users || users.length === 0) {
                    showWarning("Account not found or incorrect credentials.");
                    resetLoginButton();
                    return;
                }

                let matchedUser = null;
                const specificAdminEmails = ['badhandeb725@gmail.com'];

                for (const userRecord of users) {
                    const isPasswordCorrect = (String(userRecord.password).trim() === password || String(userRecord.plainPassword).trim() === password);
                    if (isPasswordCorrect) {
                        const roleVal = String(userRecord.role || userRecord.userType || userRecord.type || '').toLowerCase().trim();
                        const isAdmin = (
                            roleVal === 'admin' || 
                            roleVal === 'superadmin' || 
                            roleVal === 'super_admin' || 
                            roleVal === 'administrator' || 
                            userRecord.isAdmin === true || 
                            userRecord.is_admin === true ||
                            specificAdminEmails.includes(String(userRecord.email || '').toLowerCase().trim())
                        );

                        if (isAdmin) {
                            matchedUser = userRecord;
                            break;
                        } else if (!matchedUser) {
                            matchedUser = userRecord;
                        }
                    }
                }

                if (!matchedUser) {
                    showWarning("Incorrect password or account not found! Please try again.");
                    resetLoginButton();
                    return;
                }

                const roleVal = String(matchedUser.role || matchedUser.userType || matchedUser.type || '').toLowerCase().trim();
                const isAdmin = (
                    roleVal === 'admin' || 
                    roleVal === 'superadmin' || 
                    roleVal === 'super_admin' || 
                    roleVal === 'administrator' || 
                    matchedUser.isAdmin === true || 
                    matchedUser.is_admin === true ||
                    specificAdminEmails.includes(String(matchedUser.email || '').toLowerCase().trim())
                );

                if (!isAdmin) {
                    showWarning(`<b>Access Denied!</b> You are a registered user, not an admin. Regular users cannot access the Admin Panel.`);
                    resetLoginButton();
                    return;
                }

                // শুধুমাত্র রেজিস্টার্ড অ্যাডমিনদের জন্যই সেশন সেট করে admin.html এ পাঠানো হবে
                localStorage.setItem('isAdminLoggedIn', 'true');
                localStorage.setItem('isLoggedIn', 'true');
                localStorage.setItem('userData', JSON.stringify(matchedUser));
                localStorage.setItem('adminEmail', matchedUser.email || '');
                localStorage.setItem('adminPhone', matchedUser.phoneNumber || '');
                localStorage.setItem('adminName', matchedUser.fullName || matchedUser.userName || matchedUser.name || 'Super Admin');
                
                window.location.href = 'admin.html';

            } catch (error) {
                console.error('Login Error:', error);
                showWarning(`<b>Connection Error!</b> Unable to verify account. Please check your internet or Supabase configuration.`);
                resetLoginButton();
            }
        });
    }

    function resetLoginButton() {
        if (loginBtn) {
            loginBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Login to Dashboard';
            loginBtn.disabled = false;
        }
    }
});