/* ==========================================
   SafePass Vault - Supabase Registration
   Updated for Supabase Auth + Secure RPC
   ------------------------------------------
   Validation:
     - All fields marked with * in the HTML are required.
     - Password: minimum 8 characters, with uppercase,
       lowercase, number, and special character.
     - Confirm password must match.
     - Phone must be a valid Bangladeshi mobile number.
     - Invalid fields show a warning directly underneath.
   ========================================== */

document.addEventListener('DOMContentLoaded', async () => {
    const SUPABASE_URL = 'https://vgjsoicsmmzahhsuworg.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';

    let supabase = null;

    // ==========================================
    // Supabase client initialization
    // ==========================================

    const initSupabase = () => {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            // Reuse the shared SafePass client when another script already
            // initialized it on the same page.
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
        }

        return null;
    };

    supabase = initSupabase();

    // Dynamic CDN fallback
    if (!supabase) {
        console.warn(
            'Supabase script not found initially. Attempting dynamic load...'
        );

        await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src =
                'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.async = true;

            script.onload = () => {
                supabase = initSupabase();
                resolve();
            };

            script.onerror = () => {
                console.error(
                    'Failed to load Supabase CDN dynamically.'
                );
                resolve();
            };

            document.head.appendChild(script);
        });
    }

    // ==========================================
    // DOM Elements - Rules Modal
    // ==========================================

    const rulesModal = document.getElementById('rulesModal');
    const registerContainer =
        document.getElementById('registerContainer');
    const cancelRulesBtn =
        document.getElementById('cancelRulesBtn');
    const confirmRulesBtn =
        document.getElementById('confirmRulesBtn');

    // ==========================================
    // DOM Elements - Form
    // ==========================================

    const registerForm = document.getElementById('registerForm');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput =
        document.getElementById('confirmPassword');

    // ==========================================
    // DOM Elements - Success Modal
    // ==========================================

    const successModal =
        document.getElementById('successModal');
    const displayUserId =
        document.getElementById('displayUserId');
    const goToLoginBtn =
        document.getElementById('goToLoginBtn');

    // ==========================================
    // DOM Elements - Error Modal
    // ==========================================

    const errorModal =
        document.getElementById('errorModal');
    const errorTitle =
        document.getElementById('errorTitle');
    const errorMessage =
        document.getElementById('errorMessage');
    const closeModalBtn =
        document.getElementById('closeModalBtn');

    // ==========================================
    // Validation helpers
    // ==========================================

    const getField = (id) => document.getElementById(id);

    const getFieldWrapper = (input) => {
        if (!input) return null;

        // Most SafePass registration layouts use .form-group.
        // If the input is not inside one, fall back to its parent.
        return (
            input.closest('.form-group') ||
            input.closest('.input-group') ||
            input.parentElement
        );
    };

    const getWarningElement = (input) => {
        if (!input) return null;

        return document.getElementById(
            `${input.id}ValidationMessage`
        );
    };

    const ensureValidationStyles = () => {
        const styleId = 'safePassRegisterValidationStyles';

        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;

        style.textContent = `
            .safe-pass-field-warning {
                display: block;
                width: 100%;
                box-sizing: border-box;
                margin: 7px 0 0;
                color: #c62828;
                font-size: 12.5px;
                line-height: 1.45;
                font-weight: 600;
                text-align: left;
            }

            .safe-pass-field-warning::before {
                content: "⚠ ";
            }

            .safe-pass-validation-error {
                border-color: #d64545 !important;
                outline: none !important;
                box-shadow: 0 0 0 2px rgba(214, 69, 69, .10) !important;
            }

            .safe-pass-validation-valid {
                border-color: #2e8b57 !important;
            }
        `;

        document.head.appendChild(style);
    };

    ensureValidationStyles();

    const setFieldWarning = (input, message) => {
        if (!input) return false;

        const wrapper = getFieldWrapper(input);
        if (!wrapper) return false;

        let warning = getWarningElement(input);

        if (!warning) {
            warning = document.createElement('div');
            warning.id = `${input.id}ValidationMessage`;
            warning.className = 'safe-pass-field-warning';

            // Keep warning immediately below the input/select/textarea.
            if (input.nextSibling) {
                wrapper.insertBefore(warning, input.nextSibling);
            } else {
                wrapper.appendChild(warning);
            }
        }

        warning.textContent = message || '';
        warning.style.display = message ? 'block' : 'none';

        input.classList.toggle(
            'safe-pass-validation-error',
            Boolean(message)
        );

        if (message) {
            input.classList.remove('safe-pass-validation-valid');
        }

        return Boolean(message);
    };

    const clearFieldWarning = (input) => {
        if (!input) return;

        const warning = getWarningElement(input);

        if (warning) {
            warning.textContent = '';
            warning.style.display = 'none';
        }

        input.classList.remove('safe-pass-validation-error');
        input.classList.remove('safe-pass-validation-valid');
    };

    const markFieldValid = (input) => {
        if (!input) return;

        clearFieldWarning(input);
        input.classList.add('safe-pass-validation-valid');
    };

    const showFirstInvalidField = (invalidInput) => {
        if (!invalidInput) return;

        try {
            invalidInput.focus({
                preventScroll: false
            });
        } catch (_) {
            invalidInput.focus();
        }

        try {
            invalidInput.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        } catch (_) {
            // Older WebViews may not support scrollIntoView options.
        }
    };

    const isValidBangladeshiPhone = (phone) => {
        const normalized = String(phone || '')
            .replace(/\s+/g, '')
            .trim();

        // Local Bangladesh mobile format: 01XXXXXXXXX
        return /^01[3-9]\d{8}$/.test(normalized);
    };

    const isValidEmail = (email) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            String(email || '').trim()
        );
    };

    const isValidPassword = (password) => {
        const value = String(password || '');

        return (
            value.length >= 8 &&
            /[a-z]/.test(value) &&
            /[A-Z]/.test(value) &&
            /\d/.test(value) &&
            /[^A-Za-z0-9]/.test(value)
        );
    };

    const getPasswordValidationMessage = (password) => {
        const value = String(password || '');

        if (!value) {
            return 'Password is required.';
        }

        if (value.length < 8) {
            return 'Password must contain at least 8 characters.';
        }

        if (!/[A-Z]/.test(value)) {
            return 'Password must contain at least one uppercase letter (A-Z).';
        }

        if (!/[a-z]/.test(value)) {
            return 'Password must contain at least one lowercase letter (a-z).';
        }

        if (!/\d/.test(value)) {
            return 'Password must contain at least one number (0-9).';
        }

        if (!/[^A-Za-z0-9]/.test(value)) {
            return 'Password must contain at least one special character (e.g. ! @ # $ %).';
        }

        return '';
    };

    const getRequiredFieldMessage = (label) => {
        return `${label} is required.`;
    };

    // ==========================================
    // Required field definitions
    // ==========================================

    const requiredFields = [
        {
            id: 'fullName',
            label: 'Full Name',
            validate: (value) =>
                value ? '' : getRequiredFieldMessage('Full Name')
        },
        {
            id: 'nidNumber',
            label: 'NID Number',
            validate: (value) => {
                if (!value) {
                    return getRequiredFieldMessage('NID Number');
                }

                if (!/^(\d{10}|\d{17})$/.test(value)) {
                    return 'NID number must contain exactly 10 or 17 digits.';
                }

                return '';
            }
        },
        {
            id: 'phoneNumber',
            label: 'Phone Number',
            validate: (value) => {
                if (!value) {
                    return getRequiredFieldMessage('Phone Number');
                }

                if (!isValidBangladeshiPhone(value)) {
                    return 'Enter a valid 11-digit Bangladeshi mobile number starting with 013-019.';
                }

                return '';
            }
        },
        {
            id: 'email',
            label: 'Email Address',
            validate: (value) => {
                if (!value) {
                    return getRequiredFieldMessage('Email Address');
                }

                if (!isValidEmail(value)) {
                    return 'Enter a valid email address.';
                }

                return '';
            }
        },
        {
            id: 'gender',
            label: 'Gender',
            validate: (value) =>
                value ? '' : getRequiredFieldMessage('Gender')
        },
        {
            id: 'dob',
            label: 'Date of Birth',
            validate: (value) =>
                value ? '' : getRequiredFieldMessage('Date of Birth')
        },
        // Blood Group is optional.
        // Do not block registration when it is empty.
        {
            id: 'bloodGroup',
            label: 'Blood Group',
            validate: () => ''
        },
        {
            id: 'address',
            label: 'Present Address',
            validate: (value) =>
                value ? '' : getRequiredFieldMessage('Present Address')
        },
        {
            id: 'permanentAddress',
            label: 'Permanent Address',
            validate: (value) =>
                value
                    ? ''
                    : getRequiredFieldMessage('Permanent Address')
        },
        {
            id: 'password',
            label: 'Password',
            validate: (value) =>
                getPasswordValidationMessage(value)
        },
        {
            id: 'confirmPassword',
            label: 'Confirm Password',
            validate: (value) => {
                if (!value) {
                    return 'Confirm Password is required.';
                }

                const password =
                    passwordInput?.value || '';

                if (password !== value) {
                    return 'Password and Confirm Password do not match.';
                }

                return '';
            }
        }
    ];

    const getFieldValue = (id) => {
        const field = getField(id);

        if (!field) return '';

        return String(field.value ?? '').trim();
    };

    const validateSingleField = (definition, options = {}) => {
        const input = getField(definition.id);

        // If an HTML field is absent, do not invent a validation error.
        // This keeps the JS compatible with the existing form markup while
        // still enforcing every field that actually exists and is marked *.
        if (!input) return true;

        const value = getFieldValue(definition.id);
        const message = definition.validate(value);

        if (message) {
            setFieldWarning(input, message);

            if (options.focusOnError) {
                showFirstInvalidField(input);
            }

            return false;
        }

        markFieldValid(input);
        return true;
    };

    const validateAllFields = (focusFirstError = true) => {
        let firstInvalid = null;
        let allValid = true;

        requiredFields.forEach((definition) => {
            const input = getField(definition.id);

            if (!input) return;

            const valid = validateSingleField(
                definition,
                { focusOnError: false }
            );

            if (!valid) {
                allValid = false;

                if (!firstInvalid) {
                    firstInvalid = input;
                }
            }
        });

        // Extra safeguard: if the HTML has required attributes, enforce
        // browser-native required validation too.
        if (
            registerForm &&
            typeof registerForm.checkValidity === 'function' &&
            !registerForm.checkValidity()
        ) {
            allValid = false;

            if (!firstInvalid) {
                firstInvalid = registerForm.querySelector(
                    ':invalid'
                );
            }
        }

        if (!allValid && focusFirstError) {
            showFirstInvalidField(firstInvalid);
        }

        return allValid;
    };

    // ==========================================
    // Live validation while user types/selects
    // ==========================================

    requiredFields.forEach((definition) => {
        const input = getField(definition.id);

        if (!input) return;

        const eventName =
            input.tagName === 'SELECT' ? 'change' : 'input';

        input.addEventListener(eventName, () => {
            validateSingleField(definition);

            // Changing password can make Confirm Password invalid.
            if (definition.id === 'password') {
                const confirmDefinition =
                    requiredFields.find(
                        (item) => item.id === 'confirmPassword'
                    );

                if (confirmDefinition && confirmPasswordInput) {
                    validateSingleField(confirmDefinition);
                }
            }
        });

        input.addEventListener('blur', () => {
            validateSingleField(definition);
        });
    });

    // ==========================================
    // Show custom error modal
    // ==========================================

    const showError = (title, message) => {
        if (errorTitle) {
            errorTitle.innerText = title;
        }

        if (errorMessage) {
            errorMessage.innerText = message;
        }

        if (errorModal) {
            errorModal.style.display = 'flex';
        } else {
            window.alert(`${title}\n\n${message}`);
        }
    };

    // Close Error Modal
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (errorModal) {
                errorModal.style.display = 'none';
            }
        });
    }

    // ==========================================
    // Rules Modal Handling
    // ==========================================

    if (confirmRulesBtn) {
        confirmRulesBtn.addEventListener('click', () => {
            if (rulesModal) {
                rulesModal.style.display = 'none';
            }

            if (registerContainer) {
                registerContainer.style.display = 'block';
            }
        });
    }

    if (cancelRulesBtn) {
        cancelRulesBtn.addEventListener('click', () => {
            window.location.href = 'index.html';
        });
    }

    // ==========================================
    // Prevent Copy-Paste on Password Fields
    // ==========================================

    const preventCopyPaste = (element) => {
        if (!element) return;

        ['copy', 'paste', 'cut', 'drop'].forEach(
            (eventType) => {
                element.addEventListener(
                    eventType,
                    (e) => {
                        e.preventDefault();

                        showError(
                            'Security Alert',
                            'For security reasons, copy-pasting passwords is restricted. Please type manually.'
                        );
                    }
                );
            }
        );
    };

    preventCopyPaste(passwordInput);
    preventCopyPaste(confirmPasswordInput);

    // ==========================================
    // Helper: Generate Random Unique 10-Digit User ID
    // ==========================================

    const generateUniqueUserId = () => {
        return Math.floor(
            1000000000 + Math.random() * 9000000000
        ).toString();
    };

    // ==========================================
    // Form Submission Handler
    // ==========================================

    if (registerForm) {
        registerForm.addEventListener(
            'submit',
            async (e) => {
                e.preventDefault();

                // Validate every required field first.
                // Warnings are shown underneath the corresponding field.
                if (!validateAllFields(true)) {
                    return;
                }

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
                const fullName =
                    getFieldValue('fullName');

                const nidNumber =
                    getFieldValue('nidNumber');

                const phoneNumber =
                    getFieldValue('phoneNumber');

                const email =
                    getFieldValue('email').toLowerCase();

                const gender =
                    getField('gender')?.value || '';

                const dob =
                    getField('dob')?.value || '';

                const bloodGroup =
                    getField('bloodGroup')?.value || '';

                const address =
                    getFieldValue('address');

                const permanentAddress =
                    getFieldValue('permanentAddress');

                const password =
                    passwordInput
                        ? passwordInput.value
                        : '';

                const confirmPassword =
                    confirmPasswordInput
                        ? confirmPasswordInput.value
                        : '';

                // Final validation immediately before database work.
                // This prevents invalid values from reaching Supabase.
                if (!isValidBangladeshiPhone(phoneNumber)) {
                    setFieldWarning(
                        getField('phoneNumber'),
                        'Enter a valid 11-digit Bangladeshi mobile number starting with 013-019.'
                    );

                    showFirstInvalidField(
                        getField('phoneNumber')
                    );

                    return;
                }

                const passwordMessage =
                    getPasswordValidationMessage(password);

                if (passwordMessage) {
                    setFieldWarning(
                        passwordInput,
                        passwordMessage
                    );

                    showFirstInvalidField(passwordInput);
                    return;
                }

                if (password !== confirmPassword) {
                    setFieldWarning(
                        confirmPasswordInput,
                        'Password and Confirm Password do not match.'
                    );

                    showFirstInvalidField(
                        confirmPasswordInput
                    );

                    return;
                }

                const submitRegBtn =
                    document.getElementById(
                        'submitRegBtn'
                    );

                try {
                    if (submitRegBtn) {
                        submitRegBtn.disabled = true;
                        submitRegBtn.innerText =
                            'Registering...';
                    }

                    // ------------------------------------------
                    // 1. Check duplicate Email / Phone / NID
                    //    through SECURITY DEFINER RPC
                    // ------------------------------------------

                    const {
                        data: duplicateType,
                        error: checkError
                    } = await supabase.rpc(
                        'check_registration_duplicate',
                        {
                            p_email: email,
                            p_phone: phoneNumber,
                            p_nid: nidNumber
                        }
                    );

                    if (checkError) {
                        throw new Error(
                            'Registration database setup is incomplete. Please make sure check_registration_duplicate() exists in Supabase. ' +
                            checkError.message
                        );
                    }

                    if (duplicateType) {
                        if (
                            duplicateType === 'email'
                        ) {
                            setFieldWarning(
                                getField('email'),
                                'This email address is already registered.'
                            );

                            showFirstInvalidField(
                                getField('email')
                            );
                        } else if (
                            duplicateType === 'phone'
                        ) {
                            setFieldWarning(
                                getField('phoneNumber'),
                                'This phone number is already registered.'
                            );

                            showFirstInvalidField(
                                getField('phoneNumber')
                            );
                        } else if (
                            duplicateType === 'nid'
                        ) {
                            setFieldWarning(
                                getField('nidNumber'),
                                'An account with this NID number already exists.'
                            );

                            showFirstInvalidField(
                                getField('nidNumber')
                            );
                        } else {
                            showError(
                                'Registration Failed',
                                'User already exists with these details.'
                            );
                        }

                        return;
                    }

                    // ------------------------------------------
                    // 2. Create the real Supabase Auth account
                    // ------------------------------------------

                    const {
                        data: authData,
                        error: authError
                    } = await supabase.auth.signUp({
                        email,
                        password,
                        options: {
                            data: {
                                fullName,
                                phoneNumber,
                                accountType: 'user'
                            }
                        }
                    });

                    if (
                        authError ||
                        !authData?.user
                    ) {
                        throw (
                            authError ||
                            new Error(
                                'Supabase Auth account could not be created.'
                            )
                        );
                    }

                    // Immediate session is required for this
                    // local/testing registration flow.
                    if (!authData.session) {
                        throw new Error(
                            'Registration created the Auth account, but no login session was returned. Please disable Email Confirmations in Supabase Authentication settings, or confirm the email before logging in.'
                        );
                    }

                    // ------------------------------------------
                    // 3. Generate 10-Digit SafePass User ID
                    // ------------------------------------------

                    const generatedUserId =
                        generateUniqueUserId();

                    // ------------------------------------------
                    // 4. Create public.users profile through
                    //    SECURITY DEFINER RPC.
                    // ------------------------------------------

                    const {
                        data: createdUser,
                        error: profileError
                    } = await supabase.rpc(
                        'create_registration_profile',
                        {
                            p_user_id:
                                generatedUserId,
                            p_full_name:
                                fullName,
                            p_nid_number:
                                nidNumber,
                            p_phone_number:
                                phoneNumber,
                            p_email:
                                email,
                            p_gender:
                                gender,
                            p_dob:
                                dob,
                            p_blood_group:
                                bloodGroup,
                            p_present_address:
                                address,
                            p_permanent_address:
                                permanentAddress,
                            p_status:
                                'active',
                            p_password:
                                password,
                            p_auth_user_id:
                                authData.user.id
                        }
                    );

                    if (profileError) {
                        console.error(
                            'Profile creation RPC error:',
                            profileError
                        );

                        await supabase.auth.signOut();

                        throw new Error(
                            'Auth account was created, but the SafePass profile could not be created. ' +
                            profileError.message
                        );
                    }

                    if (!createdUser) {
                        await supabase.auth.signOut();

                        throw new Error(
                            'Registration profile was not returned by Supabase.'
                        );
                    }

                    // ------------------------------------------
                    // 5. Save generated User ID and useful
                    //    identifiers locally
                    // ------------------------------------------

                    localStorage.setItem(
                        'savedUserIdNumber',
                        generatedUserId
                    );

                    localStorage.setItem(
                        'savedUserEmail',
                        email
                    );

                    localStorage.setItem(
                        'savedUserPhone',
                        phoneNumber
                    );

                    // ------------------------------------------
                    // 6. Show Success Modal
                    // ------------------------------------------

                    if (displayUserId) {
                        displayUserId.innerText =
                            generatedUserId;
                    }

                    if (registerContainer) {
                        registerContainer.style.display =
                            'none';
                    }

                    if (successModal) {
                        successModal.style.display =
                            'flex';
                    }
                } catch (error) {
                    console.error(
                        'Registration Request Error:',
                        error
                    );

                    showError(
                        'Registration Failed',
                        error?.message ||
                        'Something went wrong during registration. Please check your Supabase connection.'
                    );
                } finally {
                    if (submitRegBtn) {
                        submitRegBtn.disabled = false;
                        submitRegBtn.innerText =
                            'Complete Registration';
                    }
                }
            }
        );
    }

    // ==========================================
    // Success Modal Redirect Button
    // ==========================================

    if (goToLoginBtn) {
        goToLoginBtn.addEventListener(
            'click',
            () => {
                window.location.href =
                    'index.html';
            }
        );
    }
});
