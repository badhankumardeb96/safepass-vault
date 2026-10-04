/* ==========================================
   SafePass Vault - Supabase Registration
   Updated for Supabase Auth + Secure RPC
   ========================================== */

document.addEventListener('DOMContentLoaded', async () => {
    const SUPABASE_URL = 'https://vgjsoicsmmzahhsuworg.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';

    let supabase = null;

    // Supabase client initialization
    const initSupabase = () => {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            return window.supabase.createClient(
                SUPABASE_URL,
                SUPABASE_ANON_KEY,
                {
                    auth: {
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: true
                    }
                }
            );
        }
        return null;
    };

    supabase = initSupabase();

    // Dynamic CDN fallback
    if (!supabase) {
        console.warn('Supabase script not found initially. Attempting dynamic load...');

        await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.async = true;

            script.onload = () => {
                supabase = initSupabase();
                resolve();
            };

            script.onerror = () => {
                console.error('Failed to load Supabase CDN dynamically.');
                resolve();
            };

            document.head.appendChild(script);
        });
    }

    // DOM Elements - Rules Modal
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

    // Show custom error modal
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

        ['copy', 'paste', 'cut', 'drop'].forEach((eventType) => {
            element.addEventListener(eventType, (e) => {
                e.preventDefault();
                showError(
                    'Security Alert',
                    'For security reasons, copy-pasting passwords is restricted. Please type manually.'
                );
            });
        });
    };

    preventCopyPaste(passwordInput);
    preventCopyPaste(confirmPasswordInput);

    // Helper: Generate Random Unique 10-Digit User ID
    const generateUniqueUserId = () => {
        return Math.floor(1000000000 + Math.random() * 9000000000).toString();
    };

    // Form Submission Handler
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!supabase) {
                supabase = initSupabase();
            }

            if (!supabase) {
                showError(
                    'Configuration Error',
                    'Supabase client is not initialized. Please check your internet connection.'
                );
                return;
            }

            // Get all original form values
            const fullName = document.getElementById('fullName')?.value.trim() || '';
            const nidNumber = document.getElementById('nidNumber')?.value.trim() || '';
            const phoneNumber = document.getElementById('phoneNumber')?.value.trim() || '';
            const email = document.getElementById('email')?.value.trim() || '';
            const gender = document.getElementById('gender')?.value || '';
            const dob = document.getElementById('dob')?.value || '';
            const bloodGroup = document.getElementById('bloodGroup')?.value || '';
            const address = document.getElementById('address')?.value.trim() || '';
            const permanentAddress = document.getElementById('permanentAddress')?.value.trim() || '';
            const password = passwordInput ? passwordInput.value : '';
            const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';

            // 1. Bangladeshi Phone Number Validation
            const bdPhoneRegex = /^01[3-9]\d{8}$/;
            if (!bdPhoneRegex.test(phoneNumber)) {
                showError(
                    'Invalid Phone Number',
                    "Please enter a valid 11-digit Bangladeshi phone number starting with '01' (e.g., 017XXXXXXXX)."
                );
                return;
            }

            // 2. NID Validation
            const nidRegex = /^(\d{10}|\d{17})$/;
            if (!nidRegex.test(nidNumber)) {
                showError(
                    'Invalid NID Number',
                    'Please enter a valid 10 or 17-digit NID number.'
                );
                return;
            }

            // 3. Password Match Validation
            if (password !== confirmPassword) {
                showError(
                    'Password Mismatch',
                    'New password and confirm password do not match! Please check again.'
                );
                if (confirmPasswordInput) confirmPasswordInput.focus();
                return;
            }

            if (!password) {
                showError('Invalid Password', 'Please enter a password.');
                return;
            }

            const submitRegBtn = document.getElementById('submitRegBtn');

            try {
                if (submitRegBtn) {
                    submitRegBtn.disabled = true;
                    submitRegBtn.innerText = 'Registering...';
                }

                // 4. Check duplicate Email / Phone / NID through SECURITY DEFINER RPC
                const { data: duplicateType, error: checkError } =
                    await supabase.rpc('check_registration_duplicate', {
                        p_email: email.toLowerCase(),
                        p_phone: phoneNumber,
                        p_nid: nidNumber
                    });

                if (checkError) {
                    throw new Error(
                        'Registration database setup is incomplete. Please make sure check_registration_duplicate() exists in Supabase. ' +
                        checkError.message
                    );
                }

                if (duplicateType) {
                    if (duplicateType === 'email') {
                        showError('Registration Failed', 'This email address is already registered.');
                    } else if (duplicateType === 'phone') {
                        showError('Registration Failed', 'This phone number is already registered.');
                    } else if (duplicateType === 'nid') {
                        showError('Registration Failed', 'An account with this NID number already exists.');
                    } else {
                        showError('Registration Failed', 'User already exists with these details.');
                    }
                    return;
                }

                // 5. Create the real Supabase Auth account first
                const { data: authData, error: authError } =
                    await supabase.auth.signUp({
                        email: email.toLowerCase(),
                        password: password,
                        options: {
                            data: {
                                fullName: fullName,
                                phoneNumber: phoneNumber,
                                accountType: 'user'
                            }
                        }
                    });

                if (authError || !authData?.user) {
                    throw authError || new Error('Supabase Auth account could not be created.');
                }

                // Immediate session is required for this local/testing registration flow.
                if (!authData.session) {
                    throw new Error(
                        'Registration created the Auth account, but no login session was returned. Please disable Email Confirmations in Supabase Authentication settings, or confirm the email before logging in.'
                    );
                }

                // 6. Generate 10-Digit SafePass User ID
                const generatedUserId = generateUniqueUserId();

                // 7. Create public.users profile through the SECURITY DEFINER RPC.
                // This replaces the old direct .from('users').insert() call.
                const { data: createdUser, error: profileError } =
                    await supabase.rpc('create_registration_profile', {
                        p_user_id: generatedUserId,
                        p_full_name: fullName,
                        p_nid_number: nidNumber,
                        p_phone_number: phoneNumber,
                        p_email: email.toLowerCase(),
                        p_gender: gender,
                        p_dob: dob,
                        p_blood_group: bloodGroup,
                        p_present_address: address,
                        p_permanent_address: permanentAddress,
                        p_status: 'active',
                        p_password: password,
                        p_auth_user_id: authData.user.id
                    });

                if (profileError) {
                    console.error('Profile creation RPC error:', profileError);
                    await supabase.auth.signOut();
                    throw new Error(
                        'Auth account was created, but the SafePass profile could not be created. ' +
                        profileError.message
                    );
                }

                if (!createdUser) {
                    await supabase.auth.signOut();
                    throw new Error('Registration profile was not returned by Supabase.');
                }

                // 8. Save generated User ID and useful identifiers locally
                localStorage.setItem('savedUserIdNumber', generatedUserId);
                localStorage.setItem('savedUserEmail', email.toLowerCase());
                localStorage.setItem('savedUserPhone', phoneNumber);

                // 9. Show Success Modal
                if (displayUserId) displayUserId.innerText = generatedUserId;
                if (registerContainer) registerContainer.style.display = 'none';
                if (successModal) successModal.style.display = 'flex';

            } catch (error) {
                console.error('Registration Request Error:', error);
                showError(
                    'Registration Failed',
                    error?.message ||
                    'Something went wrong during registration. Please check your Supabase connection.'
                );
            } finally {
                if (submitRegBtn) {
                    submitRegBtn.disabled = false;
                    submitRegBtn.innerText = 'Complete Registration';
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
