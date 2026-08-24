/* ==========================================================================
    Dashboard JavaScript Logic (Supabase Direct Integration & Real-time Sync)
    ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // Supabase Configuration
    const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv"; 

    let supabaseClient = null;
    if (window.supabase && typeof window.supabase.createClient === 'function') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
    const dynamicFieldsContainer = document.getElementById('dynamicFieldsContainer');

    const serviceOptions = {
        'Social Media': [
            'Facebook', 'Instagram', 'Twitter (X)', 'WhatsApp', 
            'LinkedIn', 'TikTok', 'YouTube', 'Other Social Media'
        ],
        'Banking & Financial': [
            'Islami Bank Bangladesh', 'Dutch-Bangla Bank (DBBL)', 'BRAC Bank', 
            'The City Bank', 'Eastern Bank (EBL)', 'Sonali Bank', 'Janata Bank', 
            'Agrani Bank', 'Pubali Bank', 'United Commercial Bank (UCB)', 
            'Mutual Trust Bank (MTB)', 'Standard Chartered Bank', 'HSBC', 
            'Other Bank Account', 'bKash', 'Nagad', 'Rocket', 'Upay', 
            'CellFin', 'Tap', 'Credit / Debit Card', 'PayPal', 'Crypto Wallet'
        ],
        'Email & Messaging': [
            'Gmail / Google', 'Outlook / Hotmail', 'Yahoo Mail', 'Telegram'
        ],
        'Other Accounts': [
            'Website Membership', 'Wi-Fi Network', 'Software License', 'Custom Note'
        ]
    };

    if (categorySelect) {
        categorySelect.addEventListener('change', () => {
            const category = categorySelect.value;
            if (accountTypeSelect) {
                accountTypeSelect.innerHTML = '<option value="" disabled selected>Select Service</option>';
                if (serviceOptions[category]) {
                    serviceOptions[category].forEach(service => {
                        const opt = document.createElement('option');
                        opt.value = service;
                        opt.innerText = service;
                        accountTypeSelect.appendChild(opt);
                    });
                }
            }
            renderDynamicFields('');
        });
    }

    if (accountTypeSelect) {
        accountTypeSelect.addEventListener('change', () => {
            renderDynamicFields(categorySelect ? categorySelect.value : '');
        });
    }

    function renderDynamicFields(category, presetData = {}) {
        if (!dynamicFieldsContainer) return;
        dynamicFieldsContainer.innerHTML = '';

        if (category === 'Banking & Financial') {
            dynamicFieldsContainer.innerHTML = `
                <div class="form-group">
                    <label>Account Holder Name <span class="required">*</span></label>
                    <input type="text" id="fieldHolderName" required placeholder="Name on account/card" value="${presetData.holderName || ''}">
                </div>
                <div class="form-group">
                    <label>Account / Card / Phone Number <span class="required">*</span></label>
                    <input type="text" id="fieldAccountNo" required placeholder="Account or phone number" value="${presetData.identifier || presetData.accountIdentifier || ''}">
                </div>
                <div class="form-group">
                    <label>PIN / Password <span class="required">*</span></label>
                    <input type="password" class="secure-input" id="fieldSecret" required placeholder="******" value="${presetData.secret || presetData.password || ''}">
                </div>
                <div class="form-group">
                    <label>Branch / CVV / Extra Info</label>
                    <input type="text" id="fieldExtraDetail" placeholder="Branch name or details" value="${presetData.extraDetail || ''}">
                </div>
            `;
        } else {
            dynamicFieldsContainer.innerHTML = `
                <div class="form-group">
                    <label>Username / Email / Phone <span class="required">*</span></label>
                    <input type="text" id="fieldIdentifier" required placeholder="e.g., example@gmail.com or username" value="${presetData.identifier || presetData.accountIdentifier || ''}">
                </div>
                <div class="form-group">
                    <label>Account Password <span class="required">*</span></label>
                    <input type="password" class="secure-input" id="fieldSecret" required placeholder="******" value="${presetData.secret || presetData.password || ''}">
                </div>
            `;
        }

        document.querySelectorAll('.secure-input').forEach(input => {
            ['copy', 'paste', 'cut', 'drop'].forEach(evt => {
                input.addEventListener(evt, e => e.preventDefault());
            });
        });
    }

    // 4. Save Credential Form Submit (Direct Supabase)
    const saveCredentialForm = document.getElementById('saveCredentialForm');
    const formTitle = document.getElementById('formTitle');
    const submitFormBtn = document.getElementById('submitFormBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const editRecordIdInput = document.getElementById('editRecordId');

    if (saveCredentialForm) {
        saveCredentialForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const category = categorySelect ? categorySelect.value : '';
            const platform = accountTypeSelect ? accountTypeSelect.value : '';
            const editId = editRecordIdInput ? editRecordIdInput.value : '';
            const currentUserId = getUserIdentifier();
            const recordId = editId || 'rec-' + Date.now();

            let payloadData = {
                id: recordId,
                userId: currentUserId,
                userFullName: loggedInUser.fullName || loggedInUser.name || loggedInUser.userName || '',
                category: category,
                platform: platform,
                notes: document.getElementById('extraNotes') ? document.getElementById('extraNotes').value : '',
                holderName: '',
                identifier: '',
                secret: '',
                extraDetail: ''
            };

            if (category === 'Banking & Financial') {
                payloadData.holderName = document.getElementById('fieldHolderName') ? document.getElementById('fieldHolderName').value : '';
                payloadData.identifier = document.getElementById('fieldAccountNo') ? document.getElementById('fieldAccountNo').value : '';
                payloadData.secret = document.getElementById('fieldSecret') ? document.getElementById('fieldSecret').value : '';
                payloadData.extraDetail = document.getElementById('fieldExtraDetail') ? document.getElementById('fieldExtraDetail').value : '';
            } else {
                payloadData.identifier = document.getElementById('fieldIdentifier') ? document.getElementById('fieldIdentifier').value : '';
                payloadData.secret = document.getElementById('fieldSecret') ? document.getElementById('fieldSecret').value : '';
            }

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
        if (editRecordIdInput) editRecordIdInput.value = '';
        if (formTitle) formTitle.innerHTML = `<i class="fa-solid fa-key"></i> Store New Credential`;
        if (submitFormBtn) submitFormBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Save To Vault`;
        if (cancelEditBtn) cancelEditBtn.style.display = 'none';
        if (dynamicFieldsContainer) dynamicFieldsContainer.innerHTML = '';
    }

    if (cancelEditBtn) cancelEditBtn.addEventListener('click', resetFormState);

    // 5. Fetch Vault Records from Supabase & Local
    let allRecords = [];
    const activeTimers = {};
    let targetDeleteId = null;

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

    // Supabase Real-time Sync Setup (অন্য ব্রাউজারে সাথে সাথে আপডেট ও রিমুভ পাওয়ার জন্য)
    if (supabaseClient) {
        supabaseClient
            .channel('public:credentials_sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'credentials' }, (payload) => {
                // রিয়েল-টাইমে লোকাল স্টোরেজ ও স্ক্রিন আপডেট করা
                if (payload.eventType === 'DELETE') {
                    let localRecords = [];
                    try {
                        localRecords = JSON.parse(localStorage.getItem('vault_records') || '[]');
                    } catch(e) {}
                    
                    const deletedId = payload.old.id;
                    localRecords = localRecords.filter(r => r.id !== deletedId && r._id !== deletedId);
                    localStorage.setItem('vault_records', JSON.stringify(localRecords));
                }
                loadVaultRecords();
            })
            .subscribe();
    }

    function isMatchingUser(item, currentId, currentName) {
        if (!item) return false;
        
        const itemUserId = (item.userId || item.id || '').toString().trim();
        const itemUserName = (item.userFullName || item.name || '').toString().trim().toLowerCase();
        
        const uId = (loggedInUser.userId || '').toString().trim();
        const id = (loggedInUser.id || '').toString().trim();
        const email = (loggedInUser.email || '').toString().trim();
        const phone = (loggedInUser.phoneNumber || loggedInUser.phone || '').toString().trim();

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
            
            const realPassword = item.secret || item.password || 'N/A';
            const recordId = `pwd-${index}`;
            const itemUniqueId = item.id;

            card.innerHTML = `
                <span class="record-badge">${item.category || 'General'}</span>
                <div class="record-title">
                    <i class="fa-solid fa-shield-halved"></i> ${item.platform || 'Account'}
                </div>
                ${item.holderName ? `<div class="record-field"><strong>Holder:</strong> ${item.holderName}</div>` : ''}
                <div class="record-field"><strong>Identifier:</strong> ${item.identifier || item.accountIdentifier || 'N/A'}</div>
                ${item.extraDetail ? `<div class="record-field"><strong>Extra:</strong> ${item.extraDetail}</div>` : ''}
                
                <div class="record-field password-field-wrapper">
                    <strong>Password/PIN:</strong> 
                    <span id="${recordId}" class="password-masked" data-secret="${realPassword}">••••••••</span>
                    <button class="eye-toggle-btn" data-target="${recordId}" title="Show Password">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                </div>

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
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target');
                const pwdSpan = document.getElementById(targetId);
                const icon = btn.querySelector('i');
                const realSecret = pwdSpan.getAttribute('data-secret');

                if (pwdSpan.classList.contains('password-masked')) {
                    pwdSpan.innerText = realSecret;
                    pwdSpan.classList.remove('password-masked');
                    if (icon) icon.className = 'fa-solid fa-eye-slash';

                    if (activeTimers[targetId]) clearTimeout(activeTimers[targetId]);

                    activeTimers[targetId] = setTimeout(() => {
                        hidePassword(pwdSpan, icon);
                    }, 10000);

                } else {
                    hidePassword(pwdSpan, icon);
                    if (activeTimers[targetId]) clearTimeout(activeTimers[targetId]);
                }
            });
        });

        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const record = allRecords.find(r => r.id == id);
                if (record) populateEditForm(record);
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                targetDeleteId = btn.getAttribute('data-id');
                openDeleteModal();
            });
        });
    }

    function hidePassword(pwdSpan, icon) {
        if (pwdSpan) {
            pwdSpan.innerText = '••••••••';
            pwdSpan.classList.add('password-masked');
        }
        if (icon) icon.className = 'fa-solid fa-eye';
    }

    function populateEditForm(record) {
        switchToHome();
        
        if (editRecordIdInput) editRecordIdInput.value = record.id || '';
        if (categorySelect) categorySelect.value = record.category;
        
        const category = record.category;
        if (accountTypeSelect) {
            accountTypeSelect.innerHTML = '<option value="" disabled selected>Select Service</option>';
            if (serviceOptions[category]) {
                serviceOptions[category].forEach(service => {
                    const opt = document.createElement('option');
                    opt.value = service;
                    opt.innerText = service;
                    if (service === record.platform) opt.selected = true;
                    accountTypeSelect.appendChild(opt);
                });
            }
        }

        renderDynamicFields(category, record);

        const extraNotes = document.getElementById('extraNotes');
        if (extraNotes) extraNotes.value = record.notes || '';

        if (formTitle) formTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit Credential Details`;
        if (submitFormBtn) submitFormBtn.innerHTML = `<i class="fa-solid fa-pen"></i> Update Credential`;
        if (cancelEditBtn) cancelEditBtn.style.display = 'block';
    }

    // 6. Delete Warning Modal Logic
    const deleteModal = document.getElementById('deleteModal');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

    function openDeleteModal() {
        if (deleteModal) deleteModal.style.display = 'flex';
    }

    function closeDeleteModal() {
        if (deleteModal) deleteModal.style.display = 'none';
        targetDeleteId = null;
    }

    if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeDeleteModal);

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (!targetDeleteId) return;

            // ১. Supabase থেকে ডিলিট করা
            try {
                if (supabaseClient) {
                    const { error } = await supabaseClient
                        .from('credentials')
                        .delete()
                        .eq('id', targetDeleteId);
                    if (error) throw error;
                }
            } catch (err) {
                console.warn("Delete Supabase sync notice:", err);
            }

            // ২. LocalStorage থেকেও রেকর্ড রিমুভ করা
            let localRecords = [];
            try {
                localRecords = JSON.parse(localStorage.getItem('vault_records') || '[]');
            } catch(e) {}

            localRecords = localRecords.filter(r => r.id !== targetDeleteId && r._id !== targetDeleteId);
            localStorage.setItem('vault_records', JSON.stringify(localRecords));

            // ৩. সরাসরি গ্লোবাল অল-রেকর্ড থেকেও ফিল্টার করে দেওয়া
            allRecords = allRecords.filter(r => r.id !== targetDeleteId && r._id !== targetDeleteId);

            closeDeleteModal();
            renderRecords(allRecords); // পেজ ডেটা রি-রেন্ডার করা
        });
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const filtered = allRecords.filter(item => {
                return (item.platform && item.platform.toLowerCase().includes(query)) ||
                       (item.category && item.category.toLowerCase().includes(query)) ||
                       (item.identifier && item.identifier.toLowerCase().includes(query)) ||
                       (item.holderName && item.holderName.toLowerCase().includes(query)) ||
                       (item.notes && item.notes.toLowerCase().includes(query));
            });
            renderRecords(filtered);
        });
    }

    // 7. Real-time Account Status Check
    let isStatusModalShown = false;

    function triggerCustomStatusModal(statusText) {
        if (isStatusModalShown) return;
        isStatusModalShown = true;

        const statusModal = document.getElementById('statusAlertModal');
        const statusTitle = document.getElementById('statusAlertTitle');
        const statusMessage = document.getElementById('statusAlertMessage');
        const countdownElem = document.getElementById('countdownTimer');

        const formattedStatus = statusText.toUpperCase();

        if (statusTitle) statusTitle.innerText = `Account Alert: ${formattedStatus}`;
        if (statusMessage) statusMessage.innerText = `Your account status is "${formattedStatus}". You have been logged out.`;

        if (statusModal) statusModal.style.display = 'flex';

        localStorage.removeItem('safePassUser');
        localStorage.removeItem('user');
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('activeTab');
        sessionStorage.clear();

        let secondsRemaining = 5;
        const intervalId = setInterval(() => {
            secondsRemaining--;
            if (countdownElem) countdownElem.innerText = secondsRemaining;

            if (secondsRemaining <= 0) {
                clearInterval(intervalId);
                window.location.href = 'index.html';
            }
        }, 1000);
    }

    function startAccountStatusCheck() {
        const userIdVal = loggedInUser.userId || '';
        const idVal = loggedInUser.id || '';
        const emailVal = loggedInUser.email || '';
        const phoneVal = loggedInUser.phoneNumber || loggedInUser.phone || '';

        if (!userIdVal && !idVal && !emailVal && !phoneVal) return;

        setInterval(async () => {
            try {
                if (supabaseClient) {
                    let query = supabaseClient.from('users').select('status');
                    let conditions = [];
                    if (userIdVal) conditions.push(`userId.eq.${userIdVal}`);
                    if (idVal) conditions.push(`id.eq.${idVal}`);
                    if (emailVal) conditions.push(`email.eq.${emailVal}`);
                    if (phoneVal) conditions.push(`phoneNumber.eq.${phoneVal}`);

                    if (conditions.length > 0) {
                        query = query.or(conditions.join(','));
                    }

                    const { data, error } = await query.maybeSingle();

                    if (!error && data) {
                        const status = (data.status || '').toString().toLowerCase();
                        if (status && status !== 'active') {
                            triggerCustomStatusModal(status);
                        }
                    }
                }
            } catch (err) {
                console.warn("Live status check error:", err);
            }
        }, 3000);
    }

    startAccountStatusCheck();

});