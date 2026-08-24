/* ==========================================
    Supabase Initialization with Auto-Fallback
    ========================================== */
document.addEventListener('DOMContentLoaded', async () => {
    const SUPABASE_URL = 'https://vgjsoicsmmzahhsuworg.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';
    
    let supabase = null;

    // Supabase ক্লাইন্ট ইনিশিয়ালাইজ করার ফাংশন
    const initSupabase = () => {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
        return null;
    };

    // প্রথমে চেক করা
    supabase = initSupabase();

    // যদি কোনো কারণে উইন্ডোতে সুপাবেস না পাওয়া যায় (মোবাইল WebView-এর জন্য বিশেষ ব্যবস্থা)
    if (!supabase) {
        console.warn("Supabase script not found initially. Attempting dynamic load...");
        
        // ডায়নামিকভাবে সিডিএন স্ক্রিপ্ট লোড করার চেষ্টা
        await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.async = true;
            script.onload = () => {
                supabase = initSupabase();
                resolve();
            };
            script.onerror = () => {
                console.error("Failed to load Supabase CDN dynamically.");
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    // DOM Elements - Modals & Container
    const rulesModal = document.getElementById('rulesModal');
    const registerContainer = document.getElementById('registerContainer');
    const cancelRulesBtn = document.getElementById('cancelRulesBtn');
    const confirmRulesBtn = document.getElementById('confirmRulesBtn');
    
    // DOM Elements - Form
    const registerForm = document.getElementById('registerForm');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');

    // DOM Elements - Success Modal
    const successModal = document.getElementById('successModal');
    const displayUserId = document.getElementById('displayUserId');
    const goToLoginBtn = document.getElementById('goToLoginBtn');

    // DOM Elements - Error Modal
    const errorModal = document.getElementById('errorModal');
    const errorTitle = document.getElementById('errorTitle');
    const errorMessage = document.getElementById('errorMessage');
    const closeModalBtn = document.getElementById('closeModalBtn');

    // Function to show custom error modal
    const showError = (title, message) => {
        if (errorTitle) errorTitle.innerText = title;
        if (errorMessage) errorMessage.innerText = message;
        if (errorModal) errorModal.style.display = 'flex';
    };

    // Close Error Modal
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (errorModal) errorModal.style.display = 'none';
        });
    }

    // Rules Modal Handling
    if (confirmRulesBtn) {
        confirmRulesBtn.addEventListener('click', () => {
            if (rulesModal) rulesModal.style.display = 'none';
            if (registerContainer) registerContainer.style.display = 'block';
        });
    }

    if (cancelRulesBtn) {
        cancelRulesBtn.addEventListener('click', () => {
            window.location.href = 'index.html';
        });
    }

    // Prevent Copy-Paste on Password Fields
    const preventCopyPaste = (element) => {
        if (!element) return;
        ['copy', 'paste', 'cut', 'drop'].forEach(eventType => {
            element.addEventListener(eventType, (e) => {
                e.preventDefault();
                showError("Security Alert", "For security reasons, copy-pasting passwords is restricted. Please type manually.");
            });
        });
    };

    preventCopyPaste(passwordInput);
    preventCopyPaste(confirmPasswordInput);

    // Helper: Generate Random Unique 10-Digit User ID
    const generateUniqueUserId = () => {
        return Math.floor(1000000000 + Math.random() * 9000000000).toString();
    };

    // Form Submission Handler (Supabase Registration & Auth)
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // সাবমিট করার সময়ও যদি সুপাবেস না থাকে আরেকবার চেক করা
            if (!supabase) {
                supabase = initSupabase();
            }

            if (!supabase) {
                showError("Configuration Error", "Supabase client is not initialized. Please check your internet connection.");
                return;
            }

            // Get all input values
            const fullName = document.getElementById('fullName').value.trim();
            const nidNumber = document.getElementById('nidNumber').value.trim();
            const phoneNumber = document.getElementById('phoneNumber').value.trim();
            const email = document.getElementById('email').value.trim();
            const gender = document.getElementById('gender').value;
            const dob = document.getElementById('dob').value;
            const bloodGroup = document.getElementById('bloodGroup').value;
            const address = document.getElementById('address').value.trim();
            const permanentAddress = document.getElementById('permanentAddress') ? document.getElementById('permanentAddress').value.trim() : '';
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;

            // 1. Bangladeshi Phone Number Validation
            const bdPhoneRegex = /^01[3-9]\d{8}$/;
            if (!bdPhoneRegex.test(phoneNumber)) {
                showError("Invalid Phone Number", "Please enter a valid 11-digit Bangladeshi phone number starting with '01' (e.g., 017XXXXXXXX).");
                return;
            }

            // 2. NID Validation
            const nidRegex = /^(\d{10}|\d{17})$/;
            if (!nidRegex.test(nidNumber)) {
                showError("Invalid NID Number", "Please enter a valid 10 or 17-digit NID number.");
                return;
            }

            // 3. Password Match Validation
            if (password !== confirmPassword) {
                showError("Password Mismatch", "New password and confirm password do not match! Please check again.");
                confirmPasswordInput.focus();
                return;
            }

            const submitRegBtn = document.getElementById('submitRegBtn');

            try {
                if (submitRegBtn) {
                    submitRegBtn.disabled = true;
                    submitRegBtn.innerText = "Registering...";
                }

                // Check Duplicate User in Supabase 'users' table
                const { data: existingUsers, error: checkError } = await supabase
                    .from('users')
                    .select('email, phoneNumber, nidNumber')
                    .or(`email.eq.${email},phoneNumber.eq.${phoneNumber},nidNumber.eq.${nidNumber}`);

                if (checkError) {
                    throw checkError;
                }

                if (existingUsers && existingUsers.length > 0) {
                    const match = existingUsers[0];
                    if (match.email === email) {
                        showError("Registration Failed", "This email address is already registered.");
                    } else if (match.phoneNumber === phoneNumber) {
                        showError("Registration Failed", "This phone number is already registered.");
                    } else if (match.nidNumber === nidNumber) {
                        showError("Registration Failed", "An account with this NID number already exists.");
                    } else {
                        showError("Registration Failed", "User already exists with these details.");
                    }
                    return;
                }

                // 4. Register User in Supabase Auth System (Required for Password Recovery/Reset Email)
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                });

                if (authError) {
                    console.warn("Supabase Auth sign up warning:", authError.message);
                    // যদি ইউজার অলরেডি auth-এ থেকে থাকে তবুও ডাটাবেজে রেজিস্ট্রেশন চালিয়ে যাওয়ার জন্য বা এরর দেখানোর জন্য হ্যান্ডেল করা যেতে পারে
                }

                // Generate 10-Digit Unique User Account ID
                const generatedUserId = generateUniqueUserId();

                // Prepare Data for Supabase Ingestion
                const userData = {
                    userId: generatedUserId,
                    fullName,
                    nidNumber,
                    phoneNumber,
                    email,
                    gender,
                    dob,
                    bloodGroup,
                    presentAddress: address,
                    permanentAddress,
                    password,
                    status: 'active',
                    resetRequested: false,
                    resetApproved: false
                };

                // Insert User Record into Supabase 'users' Table
                const { data, error: insertError } = await supabase
                    .from('users')
                    .insert([userData])
                    .select();

                if (insertError) {
                    throw insertError;
                }

                // Save Generated User ID to LocalStorage
                localStorage.setItem('savedUserIdNumber', generatedUserId);

                if (displayUserId) displayUserId.innerText = generatedUserId;
                if (registerContainer) registerContainer.style.display = 'none';
                if (successModal) successModal.style.display = 'flex';

            } catch (error) {
                console.error("Registration Request Error:", error);
                showError("Registration Failed", error.message || "Something went wrong during registration. Please check your Supabase connection.");
            } finally {
                if (submitRegBtn) {
                    submitRegBtn.disabled = false;
                    submitRegBtn.innerText = "Complete Registration";
                }
            }
        });
    }

    // Success Modal Redirect Button
    if (goToLoginBtn) {
        goToLoginBtn.addEventListener('click', () => {
            window.location.href = 'index.html';
        });
    }
});