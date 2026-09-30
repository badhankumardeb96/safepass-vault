/* ==========================================================================
    Dashboard JavaScript Logic (Supabase Direct Integration & Real-time Live Sync)
    ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // Supabase Configuration
    const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv"; 

    let supabaseClient = null;
    let dashboardRealtimeSub = null;

    if (window.supabase && typeof window.supabase.createClient === 'function') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            realtime: {
                params: {
                    eventsPerSecond: 10,
                },
            },
        });
    }

    // 1. Logged In User Check & Data Parsing
    const loggedInUserStr = localStorage.getItem('safePassUser') || localStorage.getItem('user');
    const isLoggedIn = localStorage.getItem('isLoggedIn');

    if (!loggedInUserStr && (!isLoggedIn || isLoggedIn === 'false')) {
        window.location.href = 'index.html';
        return;
    }

    let loggedInUser = {};
    try {
        loggedInUser = loggedInUserStr ? JSON.parse(loggedInUserStr) : {};
    } catch (e) {
        console.error("Error parsing user data from localStorage:", e);
    }

    // Display User Name Correctly
    const displayUserNameElem = document.getElementById('displayUserName');
    if (displayUserNameElem) {
        displayUserNameElem.innerText = 
            loggedInUser.fullName || 
            loggedInUser.name || 
            loggedInUser.userName || 
            loggedInUser.userFullName || 
            'User';
    }

    // Logout Functionality
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('safePassUser');
            localStorage.removeItem('user');
            localStorage.removeItem('isLoggedIn');
            localStorage.removeItem('activeTab');
            window.location.href = 'index.html';
        });
    }

    // Get User Unique Identification Key
    function getUserIdentifier() {
        return (
            loggedInUser.userId || 
            loggedInUser.id || 
            loggedInUser._id || 
            loggedInUser.email || 
            loggedInUser.phoneNumber || 
            ''
        ).toString().trim();
    }

    function getUserNameKey() {
        return (
            loggedInUser.fullName || 
            loggedInUser.name || 
            loggedInUser.userName || 
            loggedInUser.userFullName || 
            ''
        ).toString().trim().toLowerCase();
    }

    // 2. Navigation Tabs & Active Tab Retention
    const tabHomeBtn = document.getElementById('tabHomeBtn');
    const tabRecordsBtn = document.getElementById('tabRecordsBtn');
    const homeView = document.getElementById('homeView');
    const recordsView = document.getElementById('recordsView');
    const logoBtn = document.getElementById('logoBtn');

    function switchToHome() {
        if (tabHomeBtn) tabHomeBtn.classList.add('active');
        if (tabRecordsBtn) tabRecordsBtn.classList.remove('active');
        if (homeView) homeView.classList.add('active-view');
        if (recordsView) recordsView.classList.remove('active-view');
        localStorage.setItem('activeTab', 'home');
    }

    function switchToRecords() {
        if (tabRecordsBtn) tabRecordsBtn.classList.add('active');
        if (tabHomeBtn) tabHomeBtn.classList.remove('active');
        if (recordsView) recordsView.classList.add('active-view');
        if (homeView) homeView.classList.remove('active-view');
        localStorage.setItem('activeTab', 'records');
        loadVaultRecords();
    }

    if (tabHomeBtn) tabHomeBtn.addEventListener('click', switchToHome);
    if (tabRecordsBtn) tabRecordsBtn.addEventListener('click', switchToRecords);

    if (logoBtn) {
        logoBtn.addEventListener('click', () => {
            localStorage.setItem('activeTab', 'home');
            window.location.reload();
        });
    }

    const currentActiveTab = localStorage.getItem('activeTab') || 'home';
    if (currentActiveTab === 'records') {
        switchToRecords();
    } else {
        switchToHome();
    }

    // 3. Dynamic Service Dropdown & Input Rendering
    const categorySelect = document.getElementById('categorySelect');
    const accountTypeSelect = document.getElementById('accountTypeSelect');
    const platformQuickLink = document.getElementById('platformQuickLink');
    const dynamicFieldsContainer = document.getElementById('dynamicFieldsContainer');

    if (platformQuickLink) {
        platformQuickLink.style.display = 'none';
    }

    const serviceOptions = {
        'Social Media': [
            'Facebook', 'Instagram', 'Twitter (X)', 'WhatsApp', 
            'LinkedIn', 'TikTok', 'YouTube', 'Other Social Media'
        ],
        'Email & Messaging': [
            'Gmail / Google', 'Outlook / Hotmail', 'Yahoo Mail', 'Telegram'
        ],
        'Other Accounts': [
            'Website Membership', 'Wi-Fi Network', 'Software License', 'Custom Note'
        ]
    };

    const bankingSubTypes = ['Mobile Banking', 'Internet Banking', 'Card Banking', 'Crypto Wallet', 'PayPal'];

    const bankingPlatformOptions = {
        'Mobile Banking': ['bKash', 'Nagad', 'Rocket', 'Upay', 'CellFin', 'Tap', 'Other Mobile Wallet'],
        'Internet Banking': [
            'Islami Bank Bangladesh', 'Dutch-Bangla Bank (DBBL)', 'BRAC Bank', 
            'The City Bank', 'Eastern Bank (EBL)', 'Sonali Bank', 'Janata Bank', 
            'Agrani Bank', 'Pubali Bank', 'United Commercial Bank (UCB)', 
            'Mutual Trust Bank (MTB)', 'Standard Chartered Bank', 'HSBC', 'Other Bank'
        ],
        'Card Banking': ['Visa Card', 'Master Card', 'Debit Card', 'Credit Card', 'Gift Card', 'Other Card'],
        'Crypto Wallet': ['Binance', 'Coinbase', 'Trust Wallet', 'MetaMask', 'Other Crypto'],
        'PayPal': ['PayPal Account']
    };

    if (categorySelect) {
        categorySelect.addEventListener('change', () => {
            const category = categorySelect.value;
            
            const existingSubContainer = document.getElementById('bankingSubTypeContainer');
            if (existingSubContainer) {
                existingSubContainer.remove();
            }

            if (accountTypeSelect) {
                accountTypeSelect.innerHTML = '<option value="" disabled selected>Select Service</option>';
                
                if (category === 'Banking & Financial') {
                    createBankingTypeDropdown();
                } else if (serviceOptions[category]) {
                    serviceOptions[category].forEach(service => {
                        const opt = document.createElement('option');
                        opt.value = service;
                        opt.innerText = service;
                        accountTypeSelect.appendChild(opt);
                    });
                }
            }
            renderDynamicFields(category, '', '');
        });
    }

    function createBankingTypeDropdown(selectedSub = '', selectedPlatform = '') {
        let subContainer = document.getElementById('bankingSubTypeContainer');
        if (!subContainer) {
            subContainer = document.createElement('div');
            subContainer.id = 'bankingSubTypeContainer';
            subContainer.className = 'form-group';
            
            const accountTypeParent = accountTypeSelect ? accountTypeSelect.closest('.form-group') : null;
            if (accountTypeParent && accountTypeParent.parentNode) {
                accountTypeParent.parentNode.insertBefore(subContainer, accountTypeParent);
            }
        }

        subContainer.innerHTML = `
            <label>Banking Type <span class="required">*</span></label>
            <select id="bankingSubTypeSelect" class="form-control">
                <option value="" disabled ${!selectedSub ? 'selected' : ''}>Select Banking Type</option>
                ${bankingSubTypes.map(sub => `<option value="${sub}" ${sub === selectedSub ? 'selected' : ''}>${sub}</option>`).join('')}
            </select>
            <small class="error-msg" id="err-bankingSubTypeSelect" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
        `;

        const subTypeSelectElem = document.getElementById('bankingSubTypeSelect');
        if (subTypeSelectElem) {
            if (selectedSub) {
                populatePlatformsForBanking(selectedSub, selectedPlatform);
            }

            subTypeSelectElem.addEventListener('change', () => {
                const chosenSub = subTypeSelectElem.value;
                populatePlatformsForBanking(chosenSub, '');
                renderDynamicFields('Banking & Financial', chosenSub, '');
            });
        }
    }

    function populatePlatformsForBanking(subType, selectedPlatform = '') {
        if (!accountTypeSelect) return;
        accountTypeSelect.innerHTML = `<option value="" disabled ${!selectedPlatform ? 'selected' : ''}>Select ${subType} Provider</option>`;
        
        if (bankingPlatformOptions[subType]) {
            bankingPlatformOptions[subType].forEach(platform => {
                const opt = document.createElement('option');
                opt.value = platform;
                opt.innerText = platform;
                if (platform === selectedPlatform) opt.selected = true;
                accountTypeSelect.appendChild(opt);
            });
        }

        accountTypeSelect.onchange = function() {
            const subTypeSelectElem = document.getElementById('bankingSubTypeSelect');
            const currentSub = subTypeSelectElem ? subTypeSelectElem.value : '';
            renderDynamicFields('Banking & Financial', currentSub, accountTypeSelect.value);
        };
    }

    function renderDynamicFields(category, subType = '', specificPlatform = '', presetData = {}) {
        if (!dynamicFieldsContainer) return;
        dynamicFieldsContainer.innerHTML = '';

        if (category === 'Banking & Financial') {
            const isCardBanking = (subType === 'Card Banking' || bankingPlatformOptions['Card Banking']?.includes(specificPlatform));
            const isInternetBanking = (subType === 'Internet Banking');
            const isPayPal = (subType === 'PayPal' || specificPlatform === 'PayPal Account');
            const isMobileBanking = (subType === 'Mobile Banking');
            const isCryptoWallet = (subType === 'Crypto Wallet');

            let mainNumLabel = "Account / Card Number <span class='required'>*</span>";
            let mainNumPlaceholder = "Enter number";
            
            if (isCardBanking) {
                mainNumLabel = "Card Number <span class='required'>*</span>";
                mainNumPlaceholder = "Enter card number (numbers only)";
            } else if (isMobileBanking) {
                mainNumLabel = "Account Number <span class='required'>*</span>";
                mainNumPlaceholder = "Enter mobile account number";
            } else if (isInternetBanking) {
                mainNumLabel = "Account Number <span class='required'>*</span>";
                mainNumPlaceholder = "Enter bank account number";
            } else if (isCryptoWallet) {
                mainNumLabel = "Account / Wallet ID <span class='required'>*</span>";
                mainNumPlaceholder = "Enter crypto account or wallet ID";
            } else if (isPayPal) {
                mainNumLabel = "Account Number (Optional)";
                mainNumPlaceholder = "Enter account number (optional)";
            }

            const cardBankNameField = isCardBanking ? `
                <div class="form-group">
                    <label>Card Bank Name <span class="required">*</span></label>
                    <input type="text" id="fieldCardBankName" placeholder="e.g., EBL, City Bank" value="${presetData.cardBankName || presetData.cardbankname || ''}">
                    <small class="error-msg" id="err-fieldCardBankName" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
            ` : '';

            const cryptoFields = isCryptoWallet ? `
                <div class="form-group">
                    <label>Crypto Account (Optional)</label>
                    <input type="text" id="fieldCryptoAccount" placeholder="Enter crypto account (optional)" value="${presetData.cryptoAccount || presetData.cryptoaccount || ''}">
                    <small class="error-msg" id="err-fieldCryptoAccount" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
                <div class="form-group">
                    <label>Crypto Card (Optional)</label>
                    <input type="text" id="fieldCryptoCard" placeholder="Enter crypto card (optional)" value="${presetData.cryptoCard || presetData.cryptocard || ''}">
                    <small class="error-msg" id="err-fieldCryptoCard" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
            ` : '';

            const emailLabel = isPayPal ? 'Email Address <span class="required">*</span>' : 'Email Address (Optional)';
            const passwordLabel = isInternetBanking ? 'PIN / Password (Optional)' : 'PIN / Password <span class="required">*</span>';
            
            const expiryDateVal = presetData.expiryDate || presetData.expirydate || '';
            const cvvVal = presetData.extraDetail || presetData.extradetail || '';

            const expiryDateField = isCardBanking ? `
                <div class="form-group">
                    <label>Card Expiry Date <span class="required">*</span></label>
                    <input type="text" id="fieldExpiryDate" maxlength="7" placeholder="MM/YY (e.g., 12/28)" value="${expiryDateVal}">
                    <small class="error-msg" id="err-fieldExpiryDate" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
            ` : `
                <div class="form-group">
                    <label>Card Expiry Date (Optional)</label>
                    <input type="text" id="fieldExpiryDate" maxlength="7" placeholder="MM/YY" value="${expiryDateVal}">
                    <small class="error-msg" id="err-fieldExpiryDate" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
            `;

            const cvvLabel = isCardBanking ? 'CVV Code <span class="required">*</span>' : 'CVV Code (3 Digits) (Optional)';

            dynamicFieldsContainer.innerHTML = `
                <div class="form-group">
                    <label>Account Holder Name <span class="required">*</span></label>
                    <input type="text" id="fieldHolderName" placeholder="e.g., John Doe" value="${presetData.holderName || presetData.holdername || ''}">
                    <small class="error-msg" id="err-fieldHolderName" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
                ${cardBankNameField}
                ${cryptoFields}
                <div class="form-group">
                    <label>${mainNumLabel}</label>
                    <input type="text" id="fieldAccountNo" placeholder="${mainNumPlaceholder}" value="${presetData.identifier || ''}">
                    <small class="error-msg" id="err-fieldAccountNo" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
                <div class="form-group">
                    <label>Phone Number <span class="required">*</span></label>
                    <input type="text" id="fieldPhoneNumber" placeholder="Enter phone number" value="${presetData.phoneNumber || presetData.phonenumber || ''}">
                    <small class="error-msg" id="err-fieldPhoneNumber" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
                <div class="form-group">
                    <label>${emailLabel}</label>
                    <input type="email" id="fieldEmail" placeholder="e.g., user@example.com" value="${presetData.email || ''}">
                    <small class="error-msg" id="err-fieldEmail" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
                <div class="form-group">
                    <label>Profile / Visit Link (Optional)</label>
                    <input type="text" id="fieldProfileLink" placeholder="e.g., https://site.com" value="${presetData.profileLink || presetData.profilelink || ''}">
                    <small class="error-msg" id="err-fieldProfileLink" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
                <div class="form-group">
                    <label>${passwordLabel}</label>
                    <input type="password" class="secure-input" id="fieldSecret" placeholder="******" value="${presetData.secret || ''}">
                    <small class="error-msg" id="err-fieldSecret" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
                ${expiryDateField}
                <div class="form-group">
                    <label>${cvvLabel}</label>
                    <input type="text" id="fieldExtraDetail" maxlength="3" placeholder="3 digits (e.g., 123)" value="${cvvVal}">
                    <small class="error-msg" id="err-fieldExtraDetail" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
            `;

            const expiryInput = document.getElementById('fieldExpiryDate');
            if (expiryInput) {
                expiryInput.addEventListener('input', function(e) {
                    let val = this.value.replace(/\D/g, '');
                    if (val.length >= 2) {
                        let month = val.substring(0, 2);
                        if (parseInt(month) > 12) month = '12';
                        if (parseInt(month) < 1 && month.length === 2) month = '01';
                        val = month + '/' + val.substring(2, 6);
                    }
                    this.value = val;
                });
            }

        } else {
            dynamicFieldsContainer.innerHTML = `
                <div class="form-group">
                    <label>Username / Email / Phone <span class="required">*</span></label>
                    <input type="text" id="fieldIdentifier" placeholder="e.g., example@gmail.com" value="${presetData.identifier || ''}">
                    <small class="error-msg" id="err-fieldIdentifier" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
                <div class="form-group">
                    <label>Profile / Visit Link (Optional)</label>
                    <input type="text" id="fieldProfileLink" placeholder="e.g., https://instagram.com/profile" value="${presetData.profileLink || presetData.profilelink || ''}">
                    <small class="error-msg" id="err-fieldProfileLink" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
                <div class="form-group">
                    <label>Account Password <span class="required">*</span></label>
                    <input type="password" class="secure-input" id="fieldSecret" placeholder="******" value="${presetData.secret || ''}">
                    <small class="error-msg" id="err-fieldSecret" style="color: #e74c3c; display: none; margin-top: 4px; font-size: 12px;"></small>
                </div>
            `;
        }

        document.querySelectorAll('.secure-input').forEach(input => {
            ['copy', 'paste', 'cut', 'drop'].forEach(evt => {
                input.addEventListener(evt, e => e.preventDefault());
            });
        });
    }

    function showFieldError(fieldId, message) {
        const field = document.getElementById(fieldId);
        const errElem = document.getElementById(`err-${fieldId}`);
        if (field) {
            field.style.borderColor = '#e74c3c';
        }
        if (errElem) {
            errElem.innerText = message;
            errElem.style.display = 'block';
        }
    }

    function clearFieldErrors() {
        document.querySelectorAll('.form-group input, .form-group select').forEach(input => {
            input.style.borderColor = '';
        });
        document.querySelectorAll('.error-msg').forEach(err => {
            err.innerText = '';
            err.style.display = 'none';
        });
    }

    // 4. Save Credential Form Submit
    const saveCredentialForm = document.getElementById('saveCredentialForm');
    const formTitle = document.getElementById('formTitle');
    const submitFormBtn = document.getElementById('submitFormBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const editRecordIdInput = document.getElementById('editRecordId');

    if (saveCredentialForm) {
        saveCredentialForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearFieldErrors();

            const category = categorySelect ? categorySelect.value : '';
            const platform = accountTypeSelect ? accountTypeSelect.value : '';
            
            let hasError = false;

            if (!category) {
                alert("Please select a category.");
                return;
            }

            let bankingSubTypeVal = '';
            if (category === 'Banking & Financial') {
                const subTypeSelectElem = document.getElementById('bankingSubTypeSelect');
                bankingSubTypeVal = subTypeSelectElem ? subTypeSelectElem.value : '';
                if (!bankingSubTypeVal) {
                    showFieldError('bankingSubTypeSelect', 'Please select banking type.');
                    hasError = true;
                }
            }

            if (!platform) {
                alert("Please select a platform/service.");
                return;
            }

            let holderNameVal = '';
            let identifierVal = '';
            let phoneNumberVal = '';
            let emailVal = '';
            let cardBankNameVal = '';
            let cryptoAccountVal = '';
            let cryptoCardVal = '';
            let profileLinkVal = '';
            let secretVal = '';
            let expiryDateVal = '';
            let extraDetailVal = '';

            if (category === 'Banking & Financial') {
                holderNameVal = document.getElementById('fieldHolderName') ? document.getElementById('fieldHolderName').value.trim() : '';
                identifierVal = document.getElementById('fieldAccountNo') ? document.getElementById('fieldAccountNo').value.trim() : '';
                phoneNumberVal = document.getElementById('fieldPhoneNumber') ? document.getElementById('fieldPhoneNumber').value.trim() : '';
                emailVal = document.getElementById('fieldEmail') ? document.getElementById('fieldEmail').value.trim() : '';
                profileLinkVal = document.getElementById('fieldProfileLink') ? document.getElementById('fieldProfileLink').value.trim() : '';
                secretVal = document.getElementById('fieldSecret') ? document.getElementById('fieldSecret').value.trim() : '';
                
                const expiryDateElem = document.getElementById('fieldExpiryDate');
                if (expiryDateElem) {
                    expiryDateVal = expiryDateElem.value.trim();
                }

                const cvvElem = document.getElementById('fieldExtraDetail');
                if (cvvElem) {
                    extraDetailVal = cvvElem.value.trim();
                }
                
                const cardBankElem = document.getElementById('fieldCardBankName');
                if (cardBankElem) {
                    cardBankNameVal = cardBankElem.value.trim();
                }

                const cryptoAccElem = document.getElementById('fieldCryptoAccount');
                if (cryptoAccElem) {
                    cryptoAccountVal = cryptoAccElem.value.trim();
                }

                const cryptoCardElem = document.getElementById('fieldCryptoCard');
                if (cryptoCardElem) {
                    cryptoCardVal = cryptoCardElem.value.trim();
                }

                if (!holderNameVal) {
                    showFieldError('fieldHolderName', 'Account holder name is required.');
                    hasError = true;
                }

                const isCardBanking = (bankingSubTypeVal === 'Card Banking' || bankingPlatformOptions['Card Banking']?.includes(platform));
                if (isCardBanking && !cardBankNameVal) {
                    showFieldError('fieldCardBankName', 'Card bank name is required.');
                    hasError = true;
                }

                const isPayPal = (bankingSubTypeVal === 'PayPal' || platform === 'PayPal Account');
                
                if (!isPayPal) {
                    if (!identifierVal) {
                        showFieldError('fieldAccountNo', 'Account/Card number is required.');
                        hasError = true;
                    }
                }

                if (!phoneNumberVal) {
                    showFieldError('fieldPhoneNumber', 'Phone number is required.');
                    hasError = true;
                }

                if (isPayPal && !emailVal) {
                    showFieldError('fieldEmail', 'Email address is mandatory for PayPal.');
                    hasError = true;
                }

                const isInternetBanking = (bankingSubTypeVal === 'Internet Banking');
                if (!isInternetBanking && !secretVal) {
                    showFieldError('fieldSecret', 'PIN or password is required.');
                    hasError = true;
                }

                if (isCardBanking) {
                    if (!expiryDateVal) {
                        showFieldError('fieldExpiryDate', 'Expiry date is required.');
                        hasError = true;
                    } else {
                        const expiryRegex = /^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/;
                        if (!expiryRegex.test(expiryDateVal)) {
                            showFieldError('fieldExpiryDate', 'Invalid format. Use MM/YY with 2-digit month and 2 or 4-digit year.');
                            hasError = true;
                        }
                    }

                    if (!extraDetailVal) {
                        showFieldError('fieldExtraDetail', 'CVV is required.');
                        hasError = true;
                    } else if (!/^\d{3}$/.test(extraDetailVal)) {
                        showFieldError('fieldExtraDetail', 'CVV must be exactly 3 digits numbers only.');
                        hasError = true;
                    }
                } else {
                    if (expiryDateVal) {
                        const expiryRegex = /^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/;
                        if (!expiryRegex.test(expiryDateVal)) {
                            showFieldError('fieldExpiryDate', 'Invalid format. Use MM/YY with 2-digit month and 2 or 4-digit year.');
                            hasError = true;
                        }
                    }
                    if (extraDetailVal && !/^\d{3}$/.test(extraDetailVal)) {
                        showFieldError('fieldExtraDetail', 'CVV must be exactly 3 digits numbers only.');
                        hasError = true;
                    }
                }
            } else {
                identifierVal = document.getElementById('fieldIdentifier') ? document.getElementById('fieldIdentifier').value.trim() : '';
                profileLinkVal = document.getElementById('fieldProfileLink') ? document.getElementById('fieldProfileLink').value.trim() : '';
                secretVal = document.getElementById('fieldSecret') ? document.getElementById('fieldSecret').value.trim() : '';

                if (!identifierVal) {
                    showFieldError('fieldIdentifier', 'Username, email, or phone is required.');
                    hasError = true;
                }

                if (!secretVal) {
                    showFieldError('fieldSecret', 'Account password is required.');
                    hasError = true;
                }
            }

            if (hasError) {
                return;
            }

            const editId = editRecordIdInput ? editRecordIdInput.value : '';
            const currentUserId = getUserIdentifier();
            const recordId = editId || 'rec-' + Date.now();

            let payloadData = {
                id: recordId,
                userid: currentUserId,
                userfullname: loggedInUser.fullName || loggedInUser.name || loggedInUser.userName || '',
                category: category,
                bankingsubtype: bankingSubTypeVal,
                platform: platform,
                notes: document.getElementById('extraNotes') ? document.getElementById('extraNotes').value : '',
                holdername: holderNameVal,
                cardbankname: cardBankNameVal,
                cryptoaccount: cryptoAccountVal,
                cryptocard: cryptoCardVal,
                identifier: identifierVal,
                phonenumber: phoneNumberVal,
                email: emailVal,
                profilelink: profileLinkVal,
                secret: secretVal,
                expirydate: expiryDateVal,
                extradetail: extraDetailVal
            };

            try {
                if (supabaseClient) {
                    if (editId) {
                        const { error } = await supabaseClient
                            .from('credentials')
                            .update(payloadData)
                            .eq('id', editId);
                        if (error) throw error;
                    } else {
                        const { error } = await supabaseClient
                            .from('credentials')
                            .insert([payloadData]);
                        if (error) throw error;
                    }
                }
            } catch (err) {
                console.warn("Supabase save error, saving locally as fallback:", err);
            }

            let localRecords = [];
            try {
                localRecords = JSON.parse(localStorage.getItem('vault_records') || '[]');
            } catch(e) {}

            if (editId) {
                localRecords = localRecords.map(r => (r.id === editId || r._id === editId) ? payloadData : r);
            } else {
                localRecords.push(payloadData);
            }
            localStorage.setItem('vault_records', JSON.stringify(localRecords));

            alert(editId ? "Credential details updated successfully!" : "Credentials securely saved to vault!");
            resetFormState();
            switchToRecords();
        });
    }

    function resetFormState() {
        if (saveCredentialForm) saveCredentialForm.reset();
        clearFieldErrors();
        
        const subContainer = document.getElementById('bankingSubTypeContainer');
        if (subContainer) subContainer.remove();

        if (editRecordIdInput) editRecordIdInput.value = '';
        if (formTitle) formTitle.innerHTML = `<i class="fa-solid fa-key"></i> Store New Credential`;
        if (submitFormBtn) submitFormBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Save To Vault`;
        if (cancelEditBtn) cancelEditBtn.style.display = 'none';
        if (dynamicFieldsContainer) dynamicFieldsContainer.innerHTML = '';
        if (accountTypeSelect) accountTypeSelect.innerHTML = '<option value="" disabled selected>Select Service</option>';
    }

    if (cancelEditBtn) cancelEditBtn.addEventListener('click', resetFormState);

    // 5. Fetch Vault Records & Realtime Live Sync Setup
    let allRecords = [];
    const activeTimers = {};

    async function loadVaultRecords() {
        let currentUserId = getUserIdentifier();
        let currentNameKey = getUserNameKey();
        
        let serverData = [];
        try {
            if (supabaseClient) {
                const { data, error } = await supabaseClient
                    .from('credentials')
                    .select('*');
                if (!error && data) {
                    serverData = data;
                }
            }
        } catch (e) {
            console.warn("Could not fetch from Supabase, relying on local records.", e);
        }

        let localData = [];
        try {
            localData = JSON.parse(localStorage.getItem('vault_records') || '[]');
        } catch (e) {}

        if (serverData.length > 0) {
            localStorage.setItem('vault_records', JSON.stringify(serverData));
            localData = serverData;
        }

        let combined = [...serverData, ...localData];

        combined = combined.filter((v, index, self) =>
            index === self.findIndex(t => (t.id && t.id === v.id) || (t.platform === v.platform && t.secret === v.secret && t.identifier === v.identifier))
        );

        allRecords = combined.filter(item => isMatchingUser(item, currentUserId, currentNameKey));
        renderRecords(allRecords);
    }

    // Init Dashboard Supabase Real-Time Listener
    function initDashboardRealtime() {
        if (!supabaseClient) return;
        if (dashboardRealtimeSub) {
            supabaseClient.removeChannel(dashboardRealtimeSub);
        }

        dashboardRealtimeSub = supabaseClient
            .channel('dashboard-credentials-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'credentials' }, () => {
                loadVaultRecords();
            })
            .subscribe();
    }

    initDashboardRealtime();

    window.addEventListener('storage', () => {
        loadVaultRecords();
    });

    function isMatchingUser(item, currentId, currentName) {
        if (!item) return false;
        
        const itemUserId = (item.userId || item.userid || item.id || '').toString().trim();
        const itemUserName = (item.userFullName || item.userfullname || item.name || '').toString().trim().toLowerCase();
        
        const uId = (loggedInUser.userId || '').toString().trim();
        const id = (loggedInUser.id || '').toString().trim();
        const email = (loggedInUser.email || '').toString().trim();
        const phone = (loggedInUser.phoneNumber || loggedInUser.phonenumber || loggedInUser.phone || '').toString().trim();

        return (
            (itemUserId && (
                itemUserId === currentId ||
                (uId && itemUserId === uId) ||
                (id && itemUserId === id) ||
                (email && itemUserId.toLowerCase() === email.toLowerCase()) ||
                (phone && itemUserId === phone)
            )) ||
            (currentName && itemUserName && itemUserName.includes(currentName)) ||
            !itemUserId
        );
    }

    function renderRecords(records) {
        const grid = document.getElementById('recordsGrid');
        const noDataMsg = document.getElementById('noDataMessage');
        if (!grid) return;

        grid.innerHTML = '';

        if (!records || records.length === 0) {
            if (noDataMsg) noDataMsg.style.display = 'block';
            return;
        }
        if (noDataMsg) noDataMsg.style.display = 'none';

        records.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'record-card';
            
            const realPassword = item.secret || item.password || '';
            const realCvv = item.extraDetail || item.extradetail || '';
            const expiryDateVal = item.expiryDate || item.expirydate || '';
            
            const pwdId = `pwd-${index}-${Date.now()}`;
            const cvvId = `cvv-${index}-${Date.now()}`;
            const itemUniqueId = item.id;
            
            const identifierVal = item.identifier || 'N/A';
            const phoneVal = item.phoneNumber || item.phonenumber || '';
            const profileLinkVal = item.profileLink || item.profilelink || '';
            const subTypeVal = item.bankingSubType || item.bankingsubtype || '';
            const subTypeBadge = subTypeVal ? `<span class="record-badge" style="background:#2980b9; margin-left: 5px;">${subTypeVal}</span>` : '';

            const holderVal = item.holderName || item.holdername || '';
            const cardBankVal = item.cardBankName || item.cardbankname || '';
            const cryptoAccVal = item.cryptoAccount || item.cryptoaccount || '';
            const cryptoCardVal = item.cryptoCard || item.cryptocard || '';

            card.innerHTML = `
                <div>
                    <span class="record-badge">${item.category || 'General'}</span>
                    ${subTypeBadge}
                </div>
                <div class="record-title">
                    <i class="fa-solid fa-shield-halved"></i> ${item.platform || 'Account'}
                </div>
                ${holderVal ? `<div class="record-field"><strong>Holder:</strong> ${holderVal}</div>` : ''}
                ${cardBankVal ? `<div class="record-field"><strong>Card Bank:</strong> ${cardBankVal}</div>` : ''}
                ${cryptoAccVal ? `<div class="record-field"><strong>Crypto Account:</strong> ${cryptoAccVal}</div>` : ''}
                ${cryptoCardVal ? `<div class="record-field"><strong>Crypto Card:</strong> ${cryptoCardVal}</div>` : ''}
                <div class="record-field"><strong>Number/Identifier:</strong> ${identifierVal}</div>
                ${phoneVal ? `<div class="record-field"><strong>Phone Number:</strong> ${phoneVal}</div>` : ''}
                ${item.email ? `<div class="record-field"><strong>Email:</strong> ${item.email}</div>` : ''}
                ${expiryDateVal ? `<div class="record-field"><strong>Expiry Date:</strong> ${expiryDateVal}</div>` : ''}
                ${profileLinkVal ? `<div class="record-field"><strong>Profile Link:</strong> <a href="${profileLinkVal.startsWith('http') ? profileLinkVal : 'https://' + profileLinkVal}" target="_blank">${profileLinkVal}</a></div>` : ''}
                
                ${realCvv ? `
                    <div class="record-field password-field-wrapper">
                        <strong>CVV:</strong> 
                        <span id="${cvvId}" class="password-masked" data-secret="${realCvv}">•••</span>
                        <button class="eye-toggle-btn" data-target="${cvvId}" title="Show CVV">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                ` : ''}
                
                ${realPassword ? `
                    <div class="record-field password-field-wrapper">
                        <strong>Password/PIN:</strong> 
                        <span id="${pwdId}" class="password-masked" data-secret="${realPassword}">••••••••</span>
                        <button class="eye-toggle-btn" data-target="${pwdId}" title="Show Password">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                ` : ''}

                ${item.notes ? `<div class="record-field"><strong>Notes:</strong> ${item.notes}</div>` : ''}
                
                <div class="card-actions">
                    <button class="action-btn edit-btn" data-id="${itemUniqueId}">
                        <i class="fa-solid fa-pen-to-square"></i> Edit
                    </button>
                    <button class="action-btn delete-btn" data-id="${itemUniqueId}">
                        <i class="fa-solid fa-trash-can"></i> Delete
                    </button>
                </div>
            `;
            grid.appendChild(card);
        });

        document.querySelectorAll('.eye-toggle-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const targetId = this.getAttribute('data-target');
                const span = document.getElementById(targetId);
                const icon = this.querySelector('i');
                if (!span) return;

                const realSecret = span.getAttribute('data-secret');

                if (activeTimers[targetId]) {
                    clearTimeout(activeTimers[targetId]);
                    delete activeTimers[targetId];
                }

                if (span.innerText === '••••••••' || span.innerText === '•••') {
                    span.innerText = realSecret;
                    icon.classList.remove('fa-eye');
                    icon.classList.add('fa-eye-slash');

                    activeTimers[targetId] = setTimeout(() => {
                        span.innerText = span.getAttribute('data-secret').length === 3 ? '•••' : '••••••••';
                        icon.classList.remove('fa-eye-slash');
                        icon.classList.add('fa-eye');
                        delete activeTimers[targetId];
                    }, 10000);
                } else {
                    span.innerText = span.getAttribute('data-secret').length === 3 ? '•••' : '••••••••';
                    icon.classList.remove('fa-eye-slash');
                    icon.classList.add('fa-eye');
                }
            });
        });

        const deleteModal = document.getElementById('deleteModal') || document.querySelector('.modal-overlay') || document.querySelector('.custom-modal');
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn') || document.querySelector('.btn-danger') || document.querySelector('.yes-delete-btn');
        const cancelDeleteBtn = document.getElementById('cancelDeleteBtn') || document.querySelector('.btn-cancel') || document.querySelector('.cancel-btn');

        let recordToDeleteId = null;

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                recordToDeleteId = this.getAttribute('data-id');
                
                if (deleteModal) {
                    deleteModal.style.display = 'flex';
                    deleteModal.classList.add('active');
                } else {
                    const modals = document.querySelectorAll('.modal');
                    modals.forEach(m => m.style.display = 'flex');
                }
            });
        });

        if (cancelDeleteBtn) {
            cancelDeleteBtn.addEventListener('click', () => {
                recordToDeleteId = null;
                if (deleteModal) {
                    deleteModal.style.display = 'none';
                    deleteModal.classList.remove('active');
                } else {
                    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
                }
            });
        }

        if (confirmDeleteBtn) {
            const newConfirmBtn = confirmDeleteBtn.cloneNode(true);
            confirmDeleteBtn.parentNode.replaceChild(newConfirmBtn, confirmDeleteBtn);

            newConfirmBtn.addEventListener('click', async function() {
                if (!recordToDeleteId) return;

                try {
                    if (supabaseClient) {
                        const { error } = await supabaseClient
                            .from('credentials')
                            .delete()
                            .eq('id', recordToDeleteId);
                        if (error) console.error("Supabase delete error:", error);
                    }
                } catch (err) {
                    console.error("Delete exception:", err);
                }

                let localRecords = [];
                try {
                    localRecords = JSON.parse(localStorage.getItem('vault_records') || '[]');
                } catch (e) {}

                localRecords = localRecords.filter(r => r.id !== recordToDeleteId && r._id !== recordToDeleteId);
                localStorage.setItem('vault_records', JSON.stringify(localRecords));

                if (deleteModal) {
                    deleteModal.style.display = 'none';
                    deleteModal.classList.remove('active');
                } else {
                    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
                }

                recordToDeleteId = null;
                loadVaultRecords();
            });
        }

        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const recordId = this.getAttribute('data-id');
                const targetRecord = allRecords.find(r => r.id === recordId || r._id === recordId);
                
                if (!targetRecord) {
                    alert("Record not found for editing.");
                    return;
                }

                switchToHome();

                if (categorySelect) {
                    categorySelect.value = targetRecord.category || '';
                    categorySelect.dispatchEvent(new Event('change'));
                }

                const subTypeValToEdit = targetRecord.bankingSubType || targetRecord.bankingsubtype || '';

                if (targetRecord.category === 'Banking & Financial') {
                    setTimeout(() => {
                        const subTypeSelectElem = document.getElementById('bankingSubTypeSelect');
                        if (subTypeSelectElem) {
                            subTypeSelectElem.value = subTypeValToEdit;
                            subTypeSelectElem.dispatchEvent(new Event('change'));
                        }

                        setTimeout(() => {
                            if (accountTypeSelect) {
                                accountTypeSelect.value = targetRecord.platform || '';
                                accountTypeSelect.dispatchEvent(new Event('change'));
                            }
                            renderDynamicFields(targetRecord.category, subTypeValToEdit, targetRecord.platform, targetRecord);
                        }, 50);
                    }, 50);
                } else {
                    setTimeout(() => {
                        if (accountTypeSelect) {
                            accountTypeSelect.value = targetRecord.platform || '';
                        }
                        renderDynamicFields(targetRecord.category, '', targetRecord.platform, targetRecord);
                    }, 50);
                }

                if (editRecordIdInput) editRecordIdInput.value = targetRecord.id || recordId;
                if (formTitle) formTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit Credential Details`;
                if (submitFormBtn) submitFormBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update Vault Record`;
                if (cancelEditBtn) cancelEditBtn.style.display = 'inline-block';
                
                const notesElem = document.getElementById('extraNotes');
                if (notesElem) notesElem.value = targetRecord.notes || '';

                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    }

});