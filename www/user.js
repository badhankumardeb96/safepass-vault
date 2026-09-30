/* ==========================================================================
    User Details & Admin Control Logic (user.js) - Instant Live Sync, Styled Dynamic Edit Modal & Delete
    ========================================================================== */

// Supabase Configuration
const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv";

let supabaseClient = null;
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        realtime: {
            params: {
                eventsPerSecond: 10,
            },
        },
    });
}

const API_BASE_URL = '/api';
let currentUserId = null;
let userData = null;
let realtimeSubscription = null;

// Category & Service Options mapping for Dynamic Edit Modal
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

// DOM load hole URL theke User ID songroho kore process shuru kora
document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    currentUserId = urlParams.get('id') || urlParams.get('userId');

    if (!currentUserId) {
        showFlashPopup("No User ID found!", "error");
        setTimeout(() => { window.location.href = "admin.html"; }, 1500);
        return;
    }

    injectNotificationStyles();

    // 1. Prothom data fetch kora
    loadUserDetails();

    // 2. Event listener jukto kora
    setupEventListeners();

    // 3. Supabase real-time live update-er jonno instant connection setup
    initSupabaseRealtime();

    // 4. Local storage live sync listener
    window.addEventListener('storage', () => {
        loadUserDetails(true);
    });

    // 5. Page load-er somoy network status check
    updateNetworkStatusIndicator(navigator.onLine);
});

/* ==========================================================================
    Setup Event Listeners
    ========================================================================== */
function setupEventListeners() {
    const statusElem = document.getElementById("statusSelect") || document.getElementById("userStatusSelect");
    if (statusElem) {
        statusElem.addEventListener("change", updateUserStatus);
    }

    const updatePassBtn = document.getElementById("updatePasswordBtn");
    if (updatePassBtn) {
        updatePassBtn.addEventListener("click", updatePassword);
    }

    const deleteAccBtn = document.getElementById("deleteAccountBtn");
    if (deleteAccBtn) {
        deleteAccBtn.addEventListener("click", deleteAccount);
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", handleLogout);
    }
}

/* ==========================================================================
    Handle Logout Function
    ========================================================================== */
function handleLogout() {
    const existing = document.getElementById('customLogoutPopup');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'customLogoutPopup';
    overlay.className = 'flash-popup-overlay';
    overlay.innerHTML = `
        <div class="flash-popup-box">
            <div class="fa-solid fa-triangle-exclamation flash-popup-icon error warning-flash" style="color: #f59e0b;"></div>
            <div class="flash-popup-message">Are you sure you want to log out?</div>
            <div style="display: flex; gap: 12px; justify-content: center; margin-top: 15px;">
                <button id="confirmLogoutNo" class="flash-popup-btn" style="background: #475569; flex: 1;">Cancel</button>
                <button id="confirmLogoutYes" class="flash-popup-btn" style="background: #dc2626; flex: 1;">Yes, Logout</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('confirmLogoutYes').addEventListener('click', () => {
        localStorage.removeItem('admin_session');
        localStorage.removeItem('current_admin');
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('user_session');
        sessionStorage.clear();

        document.getElementById('customLogoutPopup').remove();
        
        showFlashPopup("Logged out successfully!", "success");
        setTimeout(() => {
            window.location.href = "admin-login.html";
        }, 1200);
    });

    document.getElementById('confirmLogoutNo').addEventListener('click', () => {
        document.getElementById('customLogoutPopup').remove();
    });
}

/* ==========================================================================
    Load User Information & Vault Records
    ========================================================================== */
async function loadUserDetails(isSilent = false) {
    try {
        let allUsers = [];

        if (supabaseClient) {
            const { data, error } = await supabaseClient.from('users').select('*');
            if (!error && data) {
                allUsers = data;
            }
        }

        if (allUsers.length === 0) {
            const localDataKeys = ['app_users_db', 'users', 'admin_users', 'all_users', 'registered_users', 'registeredUsers', 'safePassUser'];
            for (let key of localDataKeys) {
                const raw = localStorage.getItem(key);
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) {
                            allUsers = allUsers.concat(parsed);
                        } else if (parsed && typeof parsed === 'object') {
                            allUsers.push(parsed);
                        }
                    } catch (e) {}
                }
            }
        }

        const targetCleanId = String(currentUserId).trim();
        
        userData = allUsers.find(u => {
            const uId = String(u.userId || u.userid || u.id || '').trim();
            const uNid = String(u.nidNumber || u.nid || '').trim();
            const uPhone = String(u.phoneNumber || u.phonenumber || u.phone || '').trim();
            return uId === targetCleanId || uNid === targetCleanId || uPhone === targetCleanId;
        });

        if (!userData) {
            userData = {
                userId: targetCleanId,
                fullName: "User " + targetCleanId,
                email: "N/A",
                phoneNumber: "N/A",
                status: "active"
            };
        }

        let rawVaultData = [];

        if (supabaseClient) {
             try {
                 const { data: vData, error } = await supabaseClient
                     .from('credentials')
                     .select('*');

                 if (!error && vData) {
                     rawVaultData = vData.filter(item => {
                         const itemUid = String(item.userId || item.userid || item.id || '').trim();
                         return itemUid === targetCleanId || itemUid === String(userData.fullName || '').toLowerCase();
                     });
                 }
             } catch (e) {
                 console.error("Supabase credentials fetch error:", e);
             }
        }

        if (rawVaultData.length === 0) {
            const localVaultKeys = [
                'vault_records', 'user_vaults', 'vaults', 'saved_vaults', 
                'vault_data', 'passwords', 'user_vault_records', 'vaultList', 
                'credentials', 'vault', 'my_vault', 'vaultData'
            ];

            for (let vk of localVaultKeys) {
                  const vRaw = localStorage.getItem(vk);
                  if (vRaw) {
                      try {
                          const vParsed = JSON.parse(vRaw);
                          if (Array.isArray(vParsed)) {
                              vParsed.forEach(lv => {
                                  const lvUid = String(lv.userId || lv.userid || lv.user_id || lv.uid || '').trim();
                                  if (lvUid === targetCleanId || !lvUid) {
                                      rawVaultData.push(lv);
                                  }
                              });
                          } else if (vParsed && typeof vParsed === 'object') {
                              rawVaultData.push(vParsed);
                          }
                      } catch(e) {}
                  }
            }
        }

        const uniqueVaultMap = new Map();
        rawVaultData.forEach(item => {
            const uniqueKey = item.id || `${item.platform || item.service || 'p'}_${item.identifier || item.username || item.email || 'u'}_${item.secret || item.password || 's'}`;
            if (!uniqueVaultMap.has(uniqueKey)) {
                uniqueVaultMap.set(uniqueKey, item);
            }
        });

        userData.vaultRecords = Array.from(uniqueVaultMap.values());

        renderUserInfo(userData);

    } catch (err) {
        console.error("Error in loadUserDetails:", err);
        if (!isSilent) {
            userData = { userId: currentUserId, fullName: "User Profile", vaultRecords: [] };
            renderUserInfo(userData);
        }
    }
}

/* ==========================================================================
    Render User Information & Vault Cards with Edit & Delete Options
    ========================================================================== */
function renderUserInfo(user) {
    if (!user) return;

    const nameElem = document.getElementById("userNameDisplay") || document.getElementById("displayUserName");
    if (nameElem) {
        nameElem.innerText = user.fullName || user.userName || user.name || user.username || "User " + currentUserId;
        nameElem.style.color = "#ffffff";
        nameElem.style.textShadow = "0 2px 4px rgba(0,0,0,0.5)";
    }

    const idElem = document.getElementById("userIdDisplay") || document.getElementById("displayUserId");
    if (idElem) {
        idElem.innerText = user.userId || user.nidNumber || user.id || currentUserId;
        idElem.style.fontSize = "22px";
        idElem.style.padding = "4px 12px";
        idElem.style.letterSpacing = "1.2px";
        idElem.style.color = "#ffffff";
        idElem.style.fontWeight = "800";
    }

    const deleteAccBtn = document.getElementById("deleteAccountBtn");
    if (deleteAccBtn) {
        deleteAccBtn.style.background = "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)";
        deleteAccBtn.style.color = "#ffffff";
        deleteAccBtn.style.border = "none";
        deleteAccBtn.style.fontWeight = "700";
        deleteAccBtn.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.4)";

        const parentCard = deleteAccBtn.closest('.p-4, .card, div');
        if (parentCard) {
            parentCard.style.background = "linear-gradient(135deg, #1f1b24 0%, #111827 100%)";
            parentCard.style.border = "1px solid #7f1d1d";
        }
    }

    const statusElem = document.getElementById("statusSelect") || document.getElementById("userStatusSelect");
    if (statusElem && document.activeElement !== statusElem) {
        statusElem.value = (user.status || "active").toLowerCase();
    }

    const nidVal = user.nidNumber || user.nid || user.nidNo || user.nationalId || user.nid_number || "N/A";
    const emailVal = user.email || user.userEmail || user.mail || user.emailAddress || "N/A";
    const phoneVal = user.phoneNumber || user.phonenumber || user.phone || user.mobile || user.contact || "N/A";
    const genderVal = user.gender || user.sex || "N/A";
    const dobVal = user.dob || user.dateOfBirth || user.birthDate || user.birthday || user.date_of_birth || "N/A";
    const bloodVal = user.bloodGroup || user.blood || user.bg || user.blood_group || "N/A";
    
    const presentAddr = user.presentAddress || user.address || user.location || user.city || "N/A";
    const permanentAddr = user.permanentAddress || user.perAddress || user.permanent_address || presentAddr;

    if (document.getElementById("infoNid")) document.getElementById("infoNid").innerText = nidVal;
    if (document.getElementById("infoEmail")) document.getElementById("infoEmail").innerText = emailVal;
    if (document.getElementById("infoPhone")) document.getElementById("infoPhone").innerText = phoneVal;
    if (document.getElementById("infoGender")) document.getElementById("infoGender").innerText = genderVal;
    if (document.getElementById("infoDob")) document.getElementById("infoDob").innerText = dobVal;
    if (document.getElementById("infoBlood")) document.getElementById("infoBlood").innerText = bloodVal;
    
    if (document.getElementById("infoPresentAddress")) {
        document.getElementById("infoPresentAddress").innerText = presentAddr;
    }
    if (document.getElementById("infoPermanentAddress")) {
        document.getElementById("infoPermanentAddress").innerText = permanentAddr;
    }

    let displayPass = user.plainPassword || user.rawPassword || user.password || user.pass || user.userPassword || "";
    const passInput = document.getElementById("currentPasswordInput");
    if (passInput && document.activeElement !== passInput) {
        passInput.value = displayPass;
    }

    const vaultContainer = document.getElementById("userVaultContainer") || 
                           document.getElementById("vaultCardsGrid") || 
                           document.getElementById("vaultRecordsContainer") ||
                           document.querySelector(".vault-records-section");
                           
    if (!vaultContainer) return;

    vaultContainer.innerHTML = "";
    let records = user.vaultRecords || user.vaultData || [];

    if (!records || records.length === 0) {
        vaultContainer.innerHTML = `<div class="col-12 text-light text-center py-4 fs-5">No saved vault records found for this user.</div>`;
    } else {
        records.forEach((item) => {
            const recordId = item.id || item._id || '';
            const category = item.category || item.type || 'GENERAL';
            const subType = item.bankingSubType || item.bankingsubtype || '';
            const platform = item.platform || item.service || item.accountType || item.title || item.siteName || 'Account';
            const holder = item.holderName || item.holdername || item.holder || '';
            const cardBank = item.cardBankName || item.cardbankname || '';
            const identifier = item.identifier || item.username || item.email || item.phone || 'N/A';
            const phoneNumber = item.phoneNumber || item.phonenumber || '';
            const email = item.email || '';
            const expiryDate = item.expiryDate || item.expirydate || '';
            const pass = item.secret || item.password || item.pin || '••••••••';
            const cvv = item.extraDetail || item.extradetail || item.cvv || '';
            const profileLink = item.profileLink || item.profilelink || '';
            const notes = item.notes || item.securityNotes || '';

            const card = document.createElement("div");
            card.className = "col-md-4 col-sm-6 mb-4";

            card.innerHTML = `
                <div class="p-4 rounded shadow-lg h-100 d-flex flex-column justify-content-between" style="background: #111827 !important; border: 1px solid #374151 !important; color: #ffffff;">
                    <div>
                        <div style="font-size: 12px; font-weight: 700; color: #38bdf8; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
                            ${category} ${subType ? `<span style="background: #2980b9; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 5px; color: #fff;">${subType}</span>` : ''}
                        </div>
                        <div class="d-flex align-items-center mb-3">
                            <i class="fa-solid fa-shield-halved text-info fa-lg me-2"></i>
                            <h5 class="text-white fw-bold m-0" style="font-size: 17px;">${platform}</h5>
                        </div>
                        ${holder ? `<p class="mb-2 text-light" style="font-size: 14px;"><strong>Holder:</strong> <span style="color: #e2e8f0;">${holder}</span></p>` : ''}
                        ${cardBank ? `<p class="mb-2 text-light" style="font-size: 14px;"><strong>Card Bank:</strong> <span style="color: #e2e8f0;">${cardBank}</span></p>` : ''}
                        <p class="mb-2 text-light" style="font-size: 14px;"><strong>Number/Identifier:</strong> <span style="color: #f1f5f9; font-weight: 500;">${identifier}</span></p>
                        ${phoneNumber ? `<p class="mb-2 text-light" style="font-size: 14px;"><strong>Phone Number:</strong> <span style="color: #e2e8f0;">${phoneNumber}</span></p>` : ''}
                        ${email ? `<p class="mb-2 text-light" style="font-size: 14px;"><strong>Email:</strong> <span style="color: #e2e8f0;">${email}</span></p>` : ''}
                        ${expiryDate ? `<p class="mb-2 text-light" style="font-size: 14px;"><strong>Expiry Date:</strong> <span style="color: #38bdf8; font-weight: 600;">${expiryDate}</span></p>` : ''}
                        ${cvv ? `<p class="mb-2 text-light" style="font-size: 14px;"><strong>CVV:</strong> <span style="color: #fbbf24; font-weight: 600;">${cvv}</span></p>` : ''}
                        ${profileLink ? `<p class="mb-2 text-light" style="font-size: 14px;"><strong>Profile Link:</strong> <a href="${profileLink}" target="_blank" style="color: #38bdf8;">Link</a></p>` : ''}
                        
                        <p class="mb-2 text-light" style="font-size: 14px;">
                            <strong>Password/PIN:</strong> 
                            <span style="font-family: monospace; background: #1f2937; padding: 3px 10px; border-radius: 4px; color: #fbbf24; font-weight: bold; border: 1px solid #4b5563; margin-left: 8px;">${pass}</span>
                        </p>

                        ${notes ? `<p class="mb-0 text-light pt-2 mt-2" style="font-size: 13.5px; border-top: 1px dashed #374151;"><strong>Notes:</strong> <span style="color: #9ca3af;">${notes}</span></p>` : ''}
                    </div>

                    <div class="d-flex gap-2 mt-3 pt-3 border-top border-secondary">
                        <button class="btn btn-sm btn-outline-info flex-grow-1 edit-record-btn" data-id="${recordId}">
                            <i class="fa-solid fa-pen-to-square"></i> Edit
                        </button>
                        <button class="btn btn-sm btn-outline-danger flex-grow-1 delete-record-btn" data-id="${recordId}">
                            <i class="fa-solid fa-trash-can"></i> Delete
                        </button>
                    </div>
                </div>
            `;
            vaultContainer.appendChild(card);
        });

        document.querySelectorAll('.edit-record-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const recId = e.currentTarget.getAttribute('data-id');
                openDashboardStyleEditModal(recId, records);
            });
        });

        document.querySelectorAll('.delete-record-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const recId = e.currentTarget.getAttribute('data-id');
                deleteVaultRecord(recId);
            });
        });
   }
}

/* ==========================================================================
    Dashboard-Style Dynamic Edit Modal Functionality with Visible Dropdown Icons
    ========================================================================== */
function openDashboardStyleEditModal(recordId, records) {
    const record = records.find(r => String(r.id) === String(recordId));
    if (!record) {
        showFlashPopup("Record not found!", "error");
        return;
    }

    const existingModal = document.getElementById('dashboardStyleEditModal');
    if (existingModal) existingModal.remove();

    // Dropdown styling class to ensure native appearance & arrow indicators
    const dropdownStyle = `
        background-color: #0b0f19 !important; 
        color: #ffffff !important; 
        border: 1px solid #4b5563 !important; 
        padding: 10px 14px !important; 
        border-radius: 6px !important; 
        cursor: pointer !important;
        appearance: menulist !important;
        -webkit-appearance: menulist !important;
        -moz-appearance: menulist !important;
    `;

    const modal = document.createElement('div');
    modal.id = 'dashboardStyleEditModal';
    modal.className = 'flash-popup-overlay';
    modal.innerHTML = `
        <div class="flash-popup-box" style="max-width: 600px; text-align: left; background: #1f2937; color: #fff; max-height: 90vh; overflow-y: auto; padding: 25px; border: 1px solid #374151;">
            <h4 class="mb-4 text-info"><i class="fa-solid fa-pen-to-square"></i> Edit Vault Information (Dashboard Style)</h4>
            
            <!-- Category Selection -->
            <div class="mb-3">
                <label class="form-label text-light" style="font-size: 13px;">Category <span style="color:#ef4444">*</span></label>
                <select id="editCategorySelect" style="${dropdownStyle} width: 100%;">
                    <option value="" disabled>Select Category</option>
                    <option value="Banking & Financial" ${record.category === 'Banking & Financial' ? 'selected' : ''}>Banking & Financial</option>
                    <option value="Social Media" ${record.category === 'Social Media' ? 'selected' : ''}>Social Media</option>
                    <option value="Email & Messaging" ${record.category === 'Email & Messaging' ? 'selected' : ''}>Email & Messaging</option>
                    <option value="Other Accounts" ${record.category === 'Other Accounts' ? 'selected' : ''}>Other Accounts</option>
                </select>
            </div>

            <!-- Dynamic Banking SubType Container -->
            <div id="editBankingSubTypeContainer"></div>

            <!-- Platform / Service Selection -->
            <div class="mb-3">
                <label class="form-label text-light" style="font-size: 13px;">Platform / Service <span style="color:#ef4444">*</span></label>
                <select id="editPlatformSelect" style="${dropdownStyle} width: 100%;">
                    <option value="" disabled selected>Select Service</option>
                </select>
            </div>

            <!-- Dynamic Inputs Container -->
            <div id="editDynamicFieldsContainer"></div>

            <div class="d-flex gap-2 justify-content-end mt-4 pt-3 border-top border-secondary">
                <button id="cancelEditRecord" class="btn btn-secondary btn-sm px-4">Cancel</button>
                <button id="saveEditRecord" class="btn btn-primary btn-sm px-4">Save Changes</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const categorySelectElem = document.getElementById('editCategorySelect');
    const platformSelectElem = document.getElementById('editPlatformSelect');
    const subTypeContainerElem = document.getElementById('editBankingSubTypeContainer');
    const dynamicFieldsElem = document.getElementById('editDynamicFieldsContainer');

    function updateFormFields(cat, subT, plat, recData) {
        subTypeContainerElem.innerHTML = '';
        platformSelectElem.innerHTML = '<option value="" disabled>Select Service</option>';

        if (cat === 'Banking & Financial') {
            subTypeContainerElem.innerHTML = `
                <div class="mb-3">
                    <label class="form-label text-light" style="font-size: 13px;">Banking Type <span style="color:#ef4444">*</span></label>
                    <select id="editBankingSubTypeSelect" style="${dropdownStyle} width: 100%;">
                        <option value="" disabled ${!subT ? 'selected' : ''}>Select Banking Type</option>
                        ${bankingSubTypes.map(s => `<option value="${s}" ${s === subT ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
            `;

            const subTypeElem = document.getElementById('editBankingSubTypeSelect');
            if (subTypeElem) {
                subTypeElem.addEventListener('change', () => {
                    populatePlatforms(cat, subTypeElem.value, '');
                    renderInputs(cat, subTypeElem.value, '', recData);
                });
            }

            if (subT) {
                populatePlatforms(cat, subT, plat);
            }
        } else {
            if (serviceOptions[cat]) {
                serviceOptions[cat].forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s;
                    opt.innerText = s;
                    if (s === plat) opt.selected = true;
                    platformSelectElem.appendChild(opt);
                });
            }
        }

        renderInputs(cat, subT, plat, recData);
    }

    function populatePlatforms(cat, subT, selectedPlat) {
        platformSelectElem.innerHTML = `<option value="" disabled ${!selectedPlat ? 'selected' : ''}>Select ${subT} Provider</option>`;
        if (bankingPlatformOptions[subT]) {
            bankingPlatformOptions[subT].forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.innerText = p;
                if (p === selectedPlat) opt.selected = true;
                platformSelectElem.appendChild(opt);
            });
        }

        platformSelectElem.onchange = function() {
            const subElem = document.getElementById('editBankingSubTypeSelect');
            renderInputs(cat, subElem ? subElem.value : '', platformSelectElem.value, record);
        };
    }

    function renderInputs(cat, subT, plat, d) {
        dynamicFieldsElem.innerHTML = '';

        if (cat === 'Banking & Financial') {
            const isCard = (subT === 'Card Banking' || bankingPlatformOptions['Card Banking']?.includes(plat));
            const isInternet = (subT === 'Internet Banking');
            const isPayPal = (subT === 'PayPal' || plat === 'PayPal Account');

            dynamicFieldsElem.innerHTML = `
                <div class="mb-3">
                    <label class="form-label text-light" style="font-size: 13px;">Account Holder Name <span style="color:#ef4444">*</span></label>
                    <input type="text" id="editHolder" class="form-control bg-dark text-white border-secondary" value="${d.holderName || d.holdername || ''}">
                </div>
                ${isCard ? `
                    <div class="mb-3">
                        <label class="form-label text-light" style="font-size: 13px;">Card Bank Name <span style="color:#ef4444">*</span></label>
                        <input type="text" id="editCardBank" class="form-control bg-dark text-white border-secondary" value="${d.cardBankName || d.cardbankname || ''}">
                    </div>
                ` : ''}
                <div class="mb-3">
                    <label class="form-label text-light" style="font-size: 13px;">${isCard ? 'Card Number' : 'Account Number'} <span style="color:#ef4444">*</span></label>
                    <input type="text" id="editIdentifier" class="form-control bg-dark text-white border-secondary" value="${d.identifier || ''}">
                </div>
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-light" style="font-size: 13px;">Phone Number <span style="color:#ef4444">*</span></label>
                        <input type="text" id="editPhone" class="form-control bg-dark text-white border-secondary" value="${d.phoneNumber || d.phonenumber || ''}">
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label text-light" style="font-size: 13px;">Email Address ${isPayPal ? '<span style="color:#ef4444">*</span>' : '(Optional)'}</label>
                        <input type="email" id="editEmail" class="form-control bg-dark text-white border-secondary" value="${d.email || ''}">
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-light" style="font-size: 13px;">Password / PIN ${isInternet ? '(Optional)' : '<span style="color:#ef4444">*</span>'}</label>
                        <input type="text" id="editSecret" class="form-control bg-dark text-white border-secondary" value="${d.secret || d.password || ''}">
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-light" style="font-size: 13px;">Expiry Date (MM/YY)</label>
                        <input type="text" id="editExpiry" maxlength="7" class="form-control bg-dark text-white border-secondary" value="${d.expiryDate || d.expirydate || ''}">
                    </div>
                    <div class="col-md-4 mb-3">
                        <label class="form-label text-light" style="font-size: 13px;">CVV Code</label>
                        <input type="text" id="editCvv" maxlength="3" class="form-control bg-dark text-white border-secondary" value="${d.extraDetail || d.extradetail || ''}">
                    </div>
                </div>
                <div class="mb-3">
                    <label class="form-label text-light" style="font-size: 13px;">Profile / Visit Link (Optional)</label>
                    <input type="text" id="editProfileLink" class="form-control bg-dark text-white border-secondary" value="${d.profileLink || d.profilelink || ''}">
                </div>
                <div class="mb-3">
                    <label class="form-label text-light" style="font-size: 13px;">Security Notes (Optional)</label>
                    <textarea id="editNotes" class="form-control bg-dark text-white border-secondary" rows="2">${d.notes || ''}</textarea>
                </div>
            `;
        } else {
            dynamicFieldsElem.innerHTML = `
                <div class="mb-3">
                    <label class="form-label text-light" style="font-size: 13px;">Username / Email / Phone <span style="color:#ef4444">*</span></label>
                    <input type="text" id="editIdentifier" class="form-control bg-dark text-white border-secondary" value="${d.identifier || ''}">
                </div>
                <div class="mb-3">
                    <label class="form-label text-light" style="font-size: 13px;">Profile / Visit Link (Optional)</label>
                    <input type="text" id="editProfileLink" class="form-control bg-dark text-white border-secondary" value="${d.profileLink || d.profilelink || ''}">
                </div>
                <div class="mb-3">
                    <label class="form-label text-light" style="font-size: 13px;">Account Password <span style="color:#ef4444">*</span></label>
                    <input type="text" id="editSecret" class="form-control bg-dark text-white border-secondary" value="${d.secret || d.password || ''}">
                </div>
                <div class="mb-3">
                    <label class="form-label text-light" style="font-size: 13px;">Security Notes (Optional)</label>
                    <textarea id="editNotes" class="form-control bg-dark text-white border-secondary" rows="2">${d.notes || ''}</textarea>
                </div>
            `;
        }
    }

    categorySelectElem.addEventListener('change', () => {
        const cat = categorySelectElem.value;
        updateFormFields(cat, '', '', record);
    });

    const initialCat = record.category || 'Banking & Financial';
    const initialSub = record.bankingSubType || record.bankingsubtype || '';
    const initialPlat = record.platform || '';
    updateFormFields(initialCat, initialSub, initialPlat, record);

    document.getElementById('cancelEditRecord').addEventListener('click', () => modal.remove());

    document.getElementById('saveEditRecord').addEventListener('click', async () => {
        const catVal = categorySelectElem.value;
        const subElem = document.getElementById('editBankingSubTypeSelect');
        const subVal = subElem ? subElem.value : '';
        const platVal = platformSelectElem.value;

        if (!catVal || !platVal) {
            alert("Please select Category and Platform/Service!");
            return;
        }

        const holderVal = document.getElementById('editHolder') ? document.getElementById('editHolder').value.trim() : '';
        const cardBankVal = document.getElementById('editCardBank') ? document.getElementById('editCardBank').value.trim() : '';
        const identifierVal = document.getElementById('editIdentifier') ? document.getElementById('editIdentifier').value.trim() : '';
        const phoneVal = document.getElementById('editPhone') ? document.getElementById('editPhone').value.trim() : '';
        const emailVal = document.getElementById('editEmail') ? document.getElementById('editEmail').value.trim() : '';
        const secretVal = document.getElementById('editSecret') ? document.getElementById('editSecret').value.trim() : '';
        const expiryVal = document.getElementById('editExpiry') ? document.getElementById('editExpiry').value.trim() : '';
        const cvvVal = document.getElementById('editCvv') ? document.getElementById('editCvv').value.trim() : '';
        const profileLinkVal = document.getElementById('editProfileLink') ? document.getElementById('editProfileLink').value.trim() : '';
        const notesVal = document.getElementById('editNotes') ? document.getElementById('editNotes').value.trim() : '';

        let payloadData = {
            id: recordId,
            userid: currentUserId,
            userfullname: userData.fullName || userData.userName || '',
            category: catVal,
            bankingsubtype: subVal,
            platform: platVal,
            holdername: holderVal,
            cardbankname: cardBankVal,
            identifier: identifierVal,
            phonenumber: phoneVal,
            email: emailVal,
            secret: secretVal,
            expirydate: expiryVal,
            extradetail: cvvVal,
            profilelink: profileLinkVal,
            notes: notesVal
        };

        try {
            if (supabaseClient) {
                await supabaseClient
                    .from('credentials')
                    .update(payloadData)
                    .eq('id', recordId);
            }

            const localRaw = localStorage.getItem('vault_records') || '[]';
            let localArr = JSON.parse(localRaw);
            localArr = localArr.map(r => String(r.id) === String(recordId) ? payloadData : r);
            localStorage.setItem('vault_records', JSON.stringify(localArr));

            modal.remove();
            showFlashPopup("Vault record updated successfully!", "success");
            loadUserDetails(true);
        } catch (err) {
            console.error("Update error:", err);
            showFlashPopup("Failed to update record!", "error");
        }
    });
}

/* ==========================================================================
    Delete Vault Record Functionality
    ========================================================================== */
async function deleteVaultRecord(recordId) {
    if (confirm("Are you sure you want to delete this vault record?")) {
        try {
            if (supabaseClient) {
                await supabaseClient
                    .from('credentials')
                    .delete()
                    .eq('id', recordId);
            }

            const localRaw = localStorage.getItem('vault_records') || '[]';
            let localArr = JSON.parse(localRaw);
            localArr = localArr.filter(r => String(r.id) !== String(recordId));
            localStorage.setItem('vault_records', JSON.stringify(localArr));

            showFlashPopup("Vault record deleted successfully!", "success");
            loadUserDetails(true);
        } catch (err) {
            console.error("Delete error:", err);
            showFlashPopup("Failed to delete record!", "error");
        }
    }
}

/* ==========================================================================
    Update User Status
    ========================================================================== */
async function updateUserStatus() {
    const statusElem = document.getElementById("statusSelect") || document.getElementById("userStatusSelect");
    if (!statusElem) return;

    const newStatus = statusElem.value;
    try {
        if (supabaseClient) {
            await supabaseClient
                .from('users')
                .update({ status: newStatus })
                .or(`userId.eq.${currentUserId},id.eq.${currentUserId},nidNumber.eq.${currentUserId}`);
        }

        await fetch(`${API_BASE_URL}/admin/update-user/${currentUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        showFlashPopup(`Status successfully updated to '${newStatus.toUpperCase()}'!`, "success");
   } catch (e) {
        console.error(e);
        showFlashPopup("Failed to update status!", "error");
   }
}

/* ==========================================================================
    Update User Password
    ========================================================================== */
async function updatePassword() {
    const inputElem = document.getElementById("newPasswordInput") || document.getElementById("setNewPasswordInput");
    if (!inputElem) return;

    const newPass = inputElem.value.trim();
    if (!newPass) {
        showFlashPopup("Please enter a new password!", "error");
        return;
    }

    try {
        if (supabaseClient) {
            let targetAuthUid = currentUserId;
            if (userData && (userData.uid || userData.id)) {
                targetAuthUid = userData.uid || userData.id;
            }

            const { error: authError } = await supabaseClient.auth.admin.updateUserById(
                targetAuthUid,
                { password: newPass }
            );

            if (authError) {
                console.warn("Supabase Auth admin update notice:", authError.message);
            }

            await supabaseClient
                .from('users')
                .update({ password: newPass, plainPassword: newPass })
                .or(`userId.eq.${currentUserId},id.eq.${currentUserId},nidNumber.eq.${currentUserId}`);
        }

        await fetch(`${API_BASE_URL}/admin/update-user/${currentUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: newPass })
        });
        
        showFlashPopup("Password updated successfully!", "success");
        if (document.getElementById("currentPasswordInput")) {
            document.getElementById("currentPasswordInput").value = newPass;
        }
        inputElem.value = "";
   } catch (e) {
        console.error(e);
        showFlashPopup("Failed to update password!", "error");
   }
}

/* ==========================================================================
    Delete Account Permanently
    ========================================================================== */
async function deleteAccount() {
    if (confirm("Are you sure you want to permanently delete this user account?")) {
        try {
            if (supabaseClient) {
                await supabaseClient
                    .from('users')
                    .delete()
                    .or(`userId.eq.${currentUserId},id.eq.${currentUserId},nidNumber.eq.${currentUserId}`);
            }

            await fetch(`${API_BASE_URL}/admin/delete-user/${currentUserId}`, {
                method: 'DELETE'
            });
            
            showFlashPopup("Account deleted successfully!", "success");
            setTimeout(() => { window.location.href = "admin.html"; }, 1500);
        } catch (e) {
            console.error(e);
            showFlashPopup("Failed to delete account!", "error");
        }
   }
}

/* ==========================================================================
    Supabase Real-Time Instant Live Sync Integration
    ========================================================================== */
function initSupabaseRealtime() {
    if (!supabaseClient) return;

    if (realtimeSubscription) {
        supabaseClient.removeChannel(realtimeSubscription);
    }

    realtimeSubscription = supabaseClient
        .channel('user-detail-page-' + currentUserId)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'users' },
            (payload) => {
                if (payload.eventType === 'DELETE') {
                    const deletedId = payload.old.id || payload.old.userId || payload.old.nidNumber;
                    if (String(deletedId) === String(currentUserId)) {
                        showFlashPopup("This user account has been deleted!", "error");
                        setTimeout(() => { window.location.href = "admin.html"; }, 1500);
                        return;
                    }
                }
                loadUserDetails(true);
            }
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'credentials' }, (payload) => {
            const recordUserId = String(payload.new?.userId || payload.new?.userid || payload.old?.userId || payload.old?.userid || '').trim();
            if (!recordUserId || recordUserId === String(currentUserId).trim()) {
                loadUserDetails(true);
            }
        })
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                updateNetworkStatusIndicator(true);
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                updateNetworkStatusIndicator(false);
                setTimeout(() => {
                    if (document.visibilityState === 'visible') {
                        initSupabaseRealtime();
                    }
                }, 3000);
            }
        });
}

/* ==========================================================================
    Custom Flash Popup & Live Sync Indicator Styles
    ========================================================================== */
function injectNotificationStyles() {
    if (document.getElementById('flashPopupStyles')) return;
    const style = document.createElement('style');
    style.id = 'flashPopupStyles';
    style.innerHTML = `
        @keyframes flashGlow {
            0% { transform: scale(0.95); opacity: 0; box-shadow: 0 0 0 rgba(0,0,0,0); }
            50% { transform: scale(1.03); opacity: 1; box-shadow: 0 0 25px rgba(59, 130, 246, 0.6); }
            100% { transform: scale(1); opacity: 1; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
        }
        @keyframes iconFlashing {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.3; transform: scale(1.1); }
            100% { opacity: 1; transform: scale(1); }
        }
        .warning-flash {
            animation: iconFlashing 1s infinite ease-in-out;
        }
        .flash-popup-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center;
            z-index: 99999; backdrop-filter: blur(3px);
        }
        .flash-popup-box {
            background: #ffffff; padding: 25px 35px; border-radius: 12px; text-align: center;
            max-width: 400px; width: 90%; animation: flashGlow 0.4s ease-out forwards;
            font-family: inherit; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        .flash-popup-icon { font-size: 45px; margin-bottom: 15px; }
        .flash-popup-icon.success { color: #10b981; }
        .flash-popup-icon.error { color: #ef4444; }
        .flash-popup-message { font-size: 16px; color: #1e293b; font-weight: 600; margin-bottom: 20px; line-height: 1.5; }
        .flash-popup-btn {
            background: #2563eb; color: #ffffff; border: none; padding: 10px 24px;
            border-radius: 6px; font-weight: 600; cursor: pointer; transition: background 0.2s;
        }
        .flash-popup-btn:hover { background: #1d4ed8; }
    `;
    document.head.appendChild(style);
}

function showFlashPopup(message, type = 'success') {
    const existing = document.getElementById('customFlashPopup');
    if (existing) existing.remove();

    const iconClass = type === 'success' 
        ? 'fa-solid fa-circle-check flash-popup-icon success' 
        : 'fa-solid fa-circle-exclamation flash-popup-icon error';

    const overlay = document.createElement('div');
    overlay.id = 'customFlashPopup';
    overlay.className = 'flash-popup-overlay';
    overlay.innerHTML = `
        <div class="flash-popup-box">
            <div class="${iconClass}"></div>
            <div class="flash-popup-message">${message}</div>
            <button class="flash-popup-btn" onclick="document.getElementById('customFlashPopup').remove()">OK</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

window.addEventListener('online', () => { updateNetworkStatusIndicator(true); });
window.addEventListener('offline', () => { updateNetworkStatusIndicator(false); });

function updateNetworkStatusIndicator(isOnline) {
    let indicator = document.getElementById('liveSyncIndicator') || document.querySelector('.live-sync-badge');
    
    if (indicator) {
        if (isOnline && navigator.onLine) {
            indicator.className = "live-sync-badge online";
            indicator.innerHTML = `
                <div class="live-sync-dots">
                    <span class="dot dot-1"></span>
                    <span class="dot dot-2"></span>
                    <span class="dot dot-3"></span>
                </div>
                <span class="sync-text">Live Sync Active</span>
            `;
        } else {
            indicator.className = "live-sync-badge offline";
            indicator.innerHTML = `
                <div class="live-sync-dots">
                    <span class="dot dot-1"></span>
                    <span class="dot dot-2"></span>
                    <span class="dot dot-3"></span>
                </div>
                <span class="sync-text">Slow / Disconnected</span>
            `;
        }
    }
}