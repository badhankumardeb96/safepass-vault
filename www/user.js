/* ==========================================================================
   User Details & Admin Control Logic (user.js)
   Updated: User status control, realtime sync, vault edit/delete
   ========================================================================== */

const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv";

let supabaseClient = null;
if (typeof supabase !== "undefined") {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        realtime: { params: { eventsPerSecond: 10 } }
    });
}

const API_BASE_URL = "/api";
let currentUserId = null;
let userData = null;
let realtimeSubscription = null;

const serviceOptions = {
    "Social Media": ["Facebook","Instagram","Twitter (X)","WhatsApp","LinkedIn","TikTok","YouTube","Other Social Media"],
    "Email & Messaging": ["Gmail / Google","Outlook / Hotmail","Yahoo Mail","Telegram"],
    "Other Accounts": ["Website Membership","Wi-Fi Network","Software License","Custom Note"]
};

const bankingSubTypes = ["Mobile Banking","Internet Banking","Card Banking","Crypto Wallet","PayPal"];

const bankingPlatformOptions = {
    "Mobile Banking": ["bKash","Nagad","Rocket","Upay","CellFin","Tap","Other Mobile Wallet"],
    "Internet Banking": ["Islami Bank Bangladesh","Dutch-Bangla Bank (DBBL)","BRAC Bank","The City Bank","Eastern Bank (EBL)","Sonali Bank","Janata Bank","Agrani Bank","Pubali Bank","United Commercial Bank (UCB)","Mutual Trust Bank (MTB)","Standard Chartered Bank","HSBC","Other Bank"],
    "Card Banking": ["Visa Card","Master Card","Debit Card","Credit Card","Gift Card","Other Card"],
    "Crypto Wallet": ["Binance","Coinbase","Trust Wallet","MetaMask","Other Crypto"],
    "PayPal": ["PayPal Account"]
};

const ALLOWED_USER_STATUSES = ["active","suspended","blocked","disabled"];

function normalizeUserStatus(status) {
    const value = String(status || "active").trim().toLowerCase();
    return ALLOWED_USER_STATUSES.includes(value) ? value : "active";
}

function getStatusLabel(status) {
    return normalizeUserStatus(status).toUpperCase();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g,"&amp;").replace(/</g,"&lt;")
        .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
        .replace(/'/g,"&#039;");
}

function escapeAttribute(value) {
    return escapeHtml(value);
}

document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    currentUserId = params.get("id") || params.get("userId");

    if (!currentUserId) {
        injectNotificationStyles();
        showFlashPopup("No User ID found!","error");
        setTimeout(() => window.location.href = "admin.html",1500);
        return;
    }

    currentUserId = String(currentUserId).trim();
    injectNotificationStyles();
    loadUserDetails();
    setupEventListeners();
    initSupabaseRealtime();

    window.addEventListener("storage", () => loadUserDetails(true));
    updateNetworkStatusIndicator(navigator.onLine);
    window.addEventListener("online",() => updateNetworkStatusIndicator(true));
    window.addEventListener("offline",() => updateNetworkStatusIndicator(false));
});

function setupEventListeners() {
    const statusElem = document.getElementById("statusSelect") || document.getElementById("userStatusSelect");
    if (statusElem) statusElem.addEventListener("change",updateUserStatus);

    const updatePassBtn = document.getElementById("updatePasswordBtn");
    if (updatePassBtn) updatePassBtn.addEventListener("click",updatePassword);

    const deleteAccBtn = document.getElementById("deleteAccountBtn");
    if (deleteAccBtn) deleteAccBtn.addEventListener("click",deleteAccount);

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click",handleLogout);
}

function handleLogout() {
    const old = document.getElementById("customLogoutPopup");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "customLogoutPopup";
    overlay.className = "flash-popup-overlay";
    overlay.innerHTML = `
      <div class="flash-popup-box">
        <div class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;font-size:32px;margin-bottom:10px"></div>
        <div class="flash-popup-message">Are you sure you want to log out?</div>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:15px">
          <button id="confirmLogoutNo" class="flash-popup-btn" style="background:#475569;flex:1">Cancel</button>
          <button id="confirmLogoutYes" class="flash-popup-btn" style="background:#dc2626;flex:1">Yes, Logout</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById("confirmLogoutYes").addEventListener("click",() => {
        localStorage.removeItem("admin_session");
        localStorage.removeItem("current_admin");
        localStorage.removeItem("isLoggedIn");
        localStorage.removeItem("user_session");
        sessionStorage.clear();
        overlay.remove();
        showFlashPopup("Logged out successfully!","success");
        setTimeout(() => window.location.href="admin-login.html",1200);
    });
    document.getElementById("confirmLogoutNo").addEventListener("click",() => overlay.remove());
}

async function loadUserDetails(isSilent=false) {
    try {
        let allUsers = [];

        if (supabaseClient) {
            const {data,error} = await supabaseClient.from("users").select("*");
            if (!error && data) allUsers = data;
            else if (error) console.error("Supabase users fetch error:",error);
        }

        if (!allUsers.length) {
            const keys = ["app_users_db","users","admin_users","all_users","registered_users","registeredUsers","safePassUser"];
            for (const key of keys) {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) allUsers.push(...parsed);
                    else if (parsed && typeof parsed==="object") allUsers.push(parsed);
                } catch (_) {}
            }
        }

        const targetId = String(currentUserId).trim();
        userData = allUsers.find(u => {
            const id = String(u.userId ?? u.userid ?? u.id ?? "").trim();
            const nid = String(u.nidNumber ?? u.nid ?? "").trim();
            const phone = String(u.phoneNumber ?? u.phonenumber ?? u.phone ?? "").trim();
            return id===targetId || nid===targetId || phone===targetId;
        });

        if (!userData) {
            userData = {userId:targetId,fullName:"User "+targetId,email:"N/A",phoneNumber:"N/A",status:"active"};
        }
        userData.status = normalizeUserStatus(userData.status);

        let rawVaultData = [];
        if (supabaseClient) {
            try {
                const {data,error} = await supabaseClient.from("credentials").select("*");
                if (!error && data) {
                    rawVaultData = data.filter(item => {
                        const uid = String(item.userId ?? item.userid ?? item.user_id ?? item.uid ?? "").trim();
                        return uid===targetId || uid===String(userData.fullName||"").toLowerCase();
                    });
                } else if (error) console.error("Supabase credentials fetch error:",error);
            } catch (e) { console.error("Supabase credentials fetch error:",e); }
        }

        if (!rawVaultData.length) {
            const keys = ["vault_records","user_vaults","vaults","saved_vaults","vault_data","passwords","user_vault_records","vaultList","credentials","vault","my_vault","vaultData"];
            for (const key of keys) {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        parsed.forEach(v => {
                            const uid = String(v.userId ?? v.userid ?? v.user_id ?? v.uid ?? "").trim();
                            if (uid===targetId || !uid) rawVaultData.push(v);
                        });
                    } else if (parsed && typeof parsed==="object") rawVaultData.push(parsed);
                } catch (_) {}
            }
        }

        const unique = new Map();
        rawVaultData.forEach(item => {
            const key = item.id || `${item.platform||item.service||"p"}_${item.identifier||item.username||item.email||"u"}_${item.secret||item.password||"s"}`;
            if (!unique.has(key)) unique.set(key,item);
        });
        userData.vaultRecords = [...unique.values()];
        renderUserInfo(userData);
    } catch (err) {
        console.error("Error in loadUserDetails:",err);
        if (!isSilent) {
            userData={userId:currentUserId,fullName:"User Profile",status:"active",vaultRecords:[]};
            renderUserInfo(userData);
        }
    }
}

function renderUserInfo(user) {
    if (!user) return;
    user.status=normalizeUserStatus(user.status);

    const nameElem=document.getElementById("userNameDisplay")||document.getElementById("displayUserName");
    if (nameElem) {
        nameElem.innerText=user.fullName||user.userName||user.name||user.username||"User "+currentUserId;
        nameElem.style.color="#fff"; nameElem.style.textShadow="0 2px 4px rgba(0,0,0,.5)";
    }

    const idElem=document.getElementById("userIdDisplay")||document.getElementById("displayUserId");
    if (idElem) {
        idElem.innerText=user.userId||user.nidNumber||user.id||currentUserId;
        idElem.style.fontSize="22px"; idElem.style.padding="4px 12px"; idElem.style.letterSpacing="1.2px";
        idElem.style.color="#fff"; idElem.style.fontWeight="800";
    }

    const del=document.getElementById("deleteAccountBtn");
    if (del) {
        del.style.background="linear-gradient(135deg,#dc2626 0%,#991b1b 100%)";
        del.style.color="#fff"; del.style.border="none"; del.style.fontWeight="700";
        del.style.boxShadow="0 4px 12px rgba(220,38,38,.4)";
        const parent=del.closest(".p-4,.card,div");
        if(parent){parent.style.background="linear-gradient(135deg,#1f1b24 0%,#111827 100%)";parent.style.border="1px solid #7f1d1d";}
    }

    const statusElem=document.getElementById("statusSelect")||document.getElementById("userStatusSelect");
    if(statusElem && document.activeElement!==statusElem) statusElem.value=user.status;

    const vals={
      infoNid:user.nidNumber||user.nid||user.nidNo||user.nationalId||user.nid_number||"N/A",
      infoEmail:user.email||user.userEmail||user.mail||user.emailAddress||"N/A",
      infoPhone:user.phoneNumber||user.phonenumber||user.phone||user.mobile||user.contact||"N/A",
      infoGender:user.gender||user.sex||"N/A",
      infoDob:user.dob||user.dateOfBirth||user.birthDate||user.birthday||user.date_of_birth||"N/A",
      infoBlood:user.bloodGroup||user.blood||user.bg||user.blood_group||"N/A",
      infoPresentAddress:user.presentAddress||user.address||user.location||user.city||"N/A"
    };
    vals.infoPermanentAddress=user.permanentAddress||user.perAddress||user.permanent_address||vals.infoPresentAddress;
    Object.entries(vals).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.innerText=val;});

    const pass=user.plainPassword||user.rawPassword||user.password||user.pass||user.userPassword||"";
    const passInput=document.getElementById("currentPasswordInput");
    if(passInput && document.activeElement!==passInput) passInput.value=pass;

    const container=document.getElementById("userVaultContainer")||document.getElementById("vaultCardsGrid")||document.getElementById("vaultRecordsContainer")||document.querySelector(".vault-records-section");
    if(!container) return;
    container.innerHTML="";

    const records=user.vaultRecords||user.vaultData||[];
    if(!records.length){
        container.innerHTML='<div class="col-12 text-light text-center py-4 fs-5">No saved vault records found for this user.</div>';
        return;
    }

    records.forEach(item=>{
        const id=item.id||item._id||"";
        const category=item.category||item.type||"GENERAL";
        const sub=item.bankingSubType||item.bankingsubtype||"";
        const platform=item.platform||item.service||item.accountType||item.title||item.siteName||"Account";
        const holder=item.holderName||item.holdername||item.holder||"";
        const bank=item.cardBankName||item.cardbankname||"";
        const identifier=item.identifier||item.username||item.email||item.phone||"N/A";
        const phone=item.phoneNumber||item.phonenumber||"";
        const email=item.email||"";
        const expiry=item.expiryDate||item.expirydate||"";
        const secret=item.secret||item.password||item.pin||"••••••••";
        const cvv=item.extraDetail||item.extradetail||item.cvv||"";
        const link=item.profileLink||item.profilelink||"";
        const notes=item.notes||item.securityNotes||"";

        const card=document.createElement("div");
        card.className="col-md-4 col-sm-6 mb-4";
        card.innerHTML=`
        <div class="p-4 rounded shadow-lg h-100 d-flex flex-column justify-content-between" style="background:#111827!important;border:1px solid #374151!important;color:#fff">
          <div>
            <div style="font-size:12px;font-weight:700;color:#38bdf8;text-transform:uppercase;margin-bottom:6px;letter-spacing:.5px">
              ${escapeHtml(category)} ${sub?`<span style="background:#2980b9;padding:2px 6px;border-radius:3px;font-size:10px;margin-left:5px;color:#fff">${escapeHtml(sub)}</span>`:""}
            </div>
            <div class="d-flex align-items-center mb-3"><i class="fa-solid fa-shield-halved text-info fa-lg me-2"></i><h5 class="text-white fw-bold m-0" style="font-size:17px">${escapeHtml(platform)}</h5></div>
            ${holder?`<p class="mb-2 text-light" style="font-size:14px"><strong>Holder:</strong> <span style="color:#e2e8f0">${escapeHtml(holder)}</span></p>`:""}
            ${bank?`<p class="mb-2 text-light" style="font-size:14px"><strong>Card Bank:</strong> <span style="color:#e2e8f0">${escapeHtml(bank)}</span></p>`:""}
            <p class="mb-2 text-light" style="font-size:14px"><strong>Number/Identifier:</strong> <span style="color:#f1f5f9;font-weight:500">${escapeHtml(identifier)}</span></p>
            ${phone?`<p class="mb-2 text-light" style="font-size:14px"><strong>Phone Number:</strong> <span style="color:#e2e8f0">${escapeHtml(phone)}</span></p>`:""}
            ${email?`<p class="mb-2 text-light" style="font-size:14px"><strong>Email:</strong> <span style="color:#e2e8f0">${escapeHtml(email)}</span></p>`:""}
            ${expiry?`<p class="mb-2 text-light" style="font-size:14px"><strong>Expiry Date:</strong> <span style="color:#38bdf8;font-weight:600">${escapeHtml(expiry)}</span></p>`:""}
            ${cvv?`<p class="mb-2 text-light" style="font-size:14px"><strong>CVV:</strong> <span style="color:#fbbf24;font-weight:600">${escapeHtml(cvv)}</span></p>`:""}
            ${link?`<p class="mb-2 text-light" style="font-size:14px;word-break:break-all"><strong>Profile Link:</strong> <a href="${escapeAttribute(link)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:underline">${escapeHtml(link)}</a></p>`:""}
            <p class="mb-2 text-light" style="font-size:14px"><strong>Password/PIN:</strong> <span style="font-family:monospace;background:#1f2937;padding:3px 10px;border-radius:4px;color:#fbbf24;font-weight:bold;border:1px solid #4b5563;margin-left:8px">${escapeHtml(secret)}</span></p>
            ${notes?`<p class="mb-0 text-light pt-2 mt-2" style="font-size:13.5px;border-top:1px dashed #374151"><strong>Notes:</strong> <span style="color:#9ca3af">${escapeHtml(notes)}</span></p>`:""}
          </div>
          <div class="d-flex gap-2 mt-3 pt-3 border-top border-secondary">
            <button class="btn btn-sm btn-outline-info flex-grow-1 edit-record-btn" data-id="${escapeAttribute(id)}"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            <button class="btn btn-sm btn-outline-danger flex-grow-1 delete-record-btn" data-id="${escapeAttribute(id)}"><i class="fa-solid fa-trash-can"></i> Delete</button>
          </div>
        </div>`;
        container.appendChild(card);
    });

    container.querySelectorAll(".edit-record-btn").forEach(btn=>btn.addEventListener("click",e=>openDashboardStyleEditModal(e.currentTarget.dataset.id,records)));
    container.querySelectorAll(".delete-record-btn").forEach(btn=>btn.addEventListener("click",e=>deleteVaultRecord(e.currentTarget.dataset.id)));
}

function openDashboardStyleEditModal(recordId,records) {
    const record=records.find(r=>String(r.id)===String(recordId));
    if(!record){showFlashPopup("Record not found!","error");return;}

    const old=document.getElementById("dashboardStyleEditModal");
    if(old) old.remove();

    const ds=`background-color:#0b0f19!important;color:#fff!important;border:1px solid #4b5563!important;padding:10px 14px!important;border-radius:6px!important;cursor:pointer!important;appearance:menulist!important`;
    const modal=document.createElement("div");
    modal.id="dashboardStyleEditModal"; modal.className="flash-popup-overlay";
    modal.innerHTML=`
    <div class="flash-popup-box" style="max-width:600px;text-align:left;background:#1f2937;color:#fff;max-height:90vh;overflow-y:auto;padding:25px;border:1px solid #374151">
      <h4 class="mb-4 text-info"><i class="fa-solid fa-pen-to-square"></i> Edit Vault Information (Dashboard Style)</h4>
      <div class="mb-3"><label class="form-label text-light">Category <span style="color:#ef4444">*</span></label>
        <select id="editCategorySelect" style="${ds}width:100%">
          <option value="" disabled>Select Category</option>
          ${["Banking & Financial","Social Media","Email & Messaging","Other Accounts"].map(x=>`<option value="${escapeAttribute(x)}" ${record.category===x?"selected":""}>${escapeHtml(x)}</option>`).join("")}
        </select>
      </div>
      <div id="editBankingSubTypeContainer"></div>
      <div class="mb-3"><label class="form-label text-light">Platform / Service <span style="color:#ef4444">*</span></label>
        <select id="editPlatformSelect" style="${ds}width:100%"><option value="" disabled selected>Select Service</option></select>
      </div>
      <div id="editDynamicFieldsContainer"></div>
      <div class="d-flex gap-2 justify-content-end mt-4 pt-3 border-top border-secondary">
        <button id="cancelEditRecord" class="btn btn-secondary btn-sm px-4">Cancel</button>
        <button id="saveEditRecord" class="btn btn-primary btn-sm px-4">Save Changes</button>
      </div>
    </div>`;
    document.body.appendChild(modal);

    const cat=document.getElementById("editCategorySelect");
    const plat=document.getElementById("editPlatformSelect");
    const subBox=document.getElementById("editBankingSubTypeContainer");
    const fields=document.getElementById("editDynamicFieldsContainer");

    function renderInputs(category,sub,platform,d){
        const card=sub==="Card Banking" || bankingPlatformOptions["Card Banking"]?.includes(platform);
        const internet=sub==="Internet Banking";
        const paypal=sub==="PayPal" || platform==="PayPal Account";
        const v=(a,b="")=>escapeAttribute(d[a]||d[b]||"");
        fields.innerHTML=category==="Banking & Financial"?`
          <div class="mb-3"><label class="form-label text-light">Account Holder Name <span style="color:#ef4444">*</span></label><input id="editHolder" class="form-control bg-dark text-white border-secondary" value="${v("holderName","holdername")}"></div>
          ${card?`<div class="mb-3"><label class="form-label text-light">Card Bank Name <span style="color:#ef4444">*</span></label><input id="editCardBank" class="form-control bg-dark text-white border-secondary" value="${v("cardBankName","cardbankname")}"></div>`:""}
          <div class="mb-3"><label class="form-label text-light">${card?"Card Number":"Account Number"} <span style="color:#ef4444">*</span></label><input id="editIdentifier" class="form-control bg-dark text-white border-secondary" value="${v("identifier")}"></div>
          <div class="row"><div class="col-md-6 mb-3"><label class="form-label text-light">Phone Number <span style="color:#ef4444">*</span></label><input id="editPhone" class="form-control bg-dark text-white border-secondary" value="${v("phoneNumber","phonenumber")}"></div>
          <div class="col-md-6 mb-3"><label class="form-label text-light">Email Address ${paypal?'<span style="color:#ef4444">*</span>':"(Optional)"}</label><input id="editEmail" type="email" class="form-control bg-dark text-white border-secondary" value="${v("email")}"></div></div>
          <div class="row"><div class="col-md-4 mb-3"><label class="form-label text-light">Password / PIN ${internet?"(Optional)":'<span style="color:#ef4444">*</span>'}</label><input id="editSecret" class="form-control bg-dark text-white border-secondary" value="${v("secret","password")}"></div>
          <div class="col-md-4 mb-3"><label class="form-label text-light">Expiry Date (MM/YY)</label><input id="editExpiry" maxlength="7" class="form-control bg-dark text-white border-secondary" value="${v("expiryDate","expirydate")}"></div>
          <div class="col-md-4 mb-3"><label class="form-label text-light">CVV Code</label><input id="editCvv" maxlength="3" class="form-control bg-dark text-white border-secondary" value="${v("extraDetail","extradetail")}"></div></div>
          <div class="mb-3"><label class="form-label text-light">Profile / Visit Link (Optional)</label><input id="editProfileLink" class="form-control bg-dark text-white border-secondary" value="${v("profileLink","profilelink")}"></div>
          <div class="mb-3"><label class="form-label text-light">Security Notes (Optional)</label><textarea id="editNotes" class="form-control bg-dark text-white border-secondary" rows="2">${escapeHtml(d.notes||"")}</textarea></div>`
        :`
          <div class="mb-3"><label class="form-label text-light">Username / Email / Phone <span style="color:#ef4444">*</span></label><input id="editIdentifier" class="form-control bg-dark text-white border-secondary" value="${v("identifier")}"></div>
          <div class="mb-3"><label class="form-label text-light">Password / Secret <span style="color:#ef4444">*</span></label><input id="editSecret" class="form-control bg-dark text-white border-secondary" value="${v("secret","password")}"></div>
          <div class="mb-3"><label class="form-label text-light">Profile / Visit Link (Optional)</label><input id="editProfileLink" class="form-control bg-dark text-white border-secondary" value="${v("profileLink","profilelink")}"></div>
          <div class="mb-3"><label class="form-label text-light">Security Notes (Optional)</label><textarea id="editNotes" class="form-control bg-dark text-white border-secondary" rows="2">${escapeHtml(d.notes||"")}</textarea></div>`;
    }

    function populate(category,sub,selected){
        plat.innerHTML=`<option value="" disabled ${selected?"":"selected"}>Select ${escapeHtml(sub||"Service")} Provider</option>`;
        (bankingPlatformOptions[sub]||serviceOptions[category]||[]).forEach(x=>{
            const o=document.createElement("option");o.value=x;o.textContent=x;if(x===selected)o.selected=true;plat.appendChild(o);
        });
        plat.onchange=()=>renderInputs(category,sub,plat.value,record);
    }

    function update(category,sub,platform){
        subBox.innerHTML="";
        if(category==="Banking & Financial"){
            subBox.innerHTML=`<div class="mb-3"><label class="form-label text-light">Banking Type <span style="color:#ef4444">*</span></label><select id="editBankingSubTypeSelect" style="${ds}width:100%"><option value="" disabled ${sub?"":"selected"}>Select Banking Type</option>${bankingSubTypes.map(x=>`<option value="${escapeAttribute(x)}" ${x===sub?"selected":""}>${escapeHtml(x)}</option>`).join("")}</select></div>`;
            const s=document.getElementById("editBankingSubTypeSelect");
            s.addEventListener("change",()=>{populate(category,s.value,"");renderInputs(category,s.value,"",record);});
            if(sub) populate(category,sub,platform);
        } else populate(category,"",platform);
        renderInputs(category,sub,platform,record);
    }

    cat.addEventListener("change",()=>update(cat.value,"",""));
    update(record.category,record.bankingSubType||record.bankingsubtype||"",record.platform||record.service||"");

    document.getElementById("cancelEditRecord").addEventListener("click",()=>modal.remove());
    document.getElementById("saveEditRecord").addEventListener("click",async()=>{
        const get=id=>document.getElementById(id)?.value||"";
        const category=cat.value, sub=document.getElementById("editBankingSubTypeSelect")?.value||"", platform=plat.value, identifier=get("editIdentifier");
        if(!category||!platform||!identifier){showFlashPopup("Please fill in all required fields!","error");return;}

        record.category=category; record.bankingSubType=sub; record.platform=platform; record.identifier=identifier;
        record.secret=get("editSecret"); record.holderName=get("editHolder"); record.cardBankName=get("editCardBank");
        record.phoneNumber=get("editPhone"); record.email=get("editEmail"); record.expiryDate=get("editExpiry");
        record.extraDetail=get("editCvv"); record.profileLink=get("editProfileLink"); record.notes=get("editNotes");

        try{
            if(supabaseClient&&record.id){
                const {error}=await supabaseClient.from("credentials").update(record).eq("id",record.id);
                if(error) throw error;
            }
            localStorage.setItem("vault_records",JSON.stringify(userData.vaultRecords));
            showFlashPopup("Record updated successfully!","success");
            modal.remove(); renderUserInfo(userData);
        }catch(err){console.error("Error updating record:",err);showFlashPopup("Failed to update record.","error");}
    });
}

async function deleteVaultRecord(recordId){
    if(!confirm("Are you sure you want to delete this record?")) return;
    try{
        if(supabaseClient&&recordId){
            const {error}=await supabaseClient.from("credentials").delete().eq("id",recordId);
            if(error) throw error;
        }
        userData.vaultRecords=userData.vaultRecords.filter(r=>String(r.id)!==String(recordId));
        localStorage.setItem("vault_records",JSON.stringify(userData.vaultRecords));
        showFlashPopup("Record deleted successfully!","success");
        renderUserInfo(userData);
    }catch(err){console.error("Error deleting record:",err);showFlashPopup("Failed to delete record.","error");}
}

async function updateUserStatus(){
    const statusElem=document.getElementById("statusSelect")||document.getElementById("userStatusSelect");
    if(!statusElem||!userData||!currentUserId)return;

    const oldStatus=normalizeUserStatus(userData.status);
    const newStatus=normalizeUserStatus(statusElem.value);
    statusElem.value=newStatus;

    try{
        if(!supabaseClient) throw new Error("Supabase client is not initialized.");

        // Safe query matching both primary key types (UUID id or userId column)
        let {data, error} = await supabaseClient.from("users").update({status:newStatus}).eq("userId", currentUserId).select("*");
        if ((error || !data || !data.length) && currentUserId) {
            const res = await supabaseClient.from("users").update({status:newStatus}).eq("id", currentUserId).select("*");
            data = res.data;
            error = res.error;
        }

        if(error) throw error;
        if(!data||!data.length) throw new Error("No user record was updated. Check userId and Supabase RLS policy.");

        userData.status=newStatus;
        localStorage.setItem("app_users_db",JSON.stringify([userData]));
        showFlashPopup(`User status changed to ${getStatusLabel(newStatus)}.`,"success");
    }catch(err){
        console.error("Failed to update user status:",err);
        userData.status=oldStatus; statusElem.value=oldStatus;
        showFlashPopup("Failed to update user status. Check Supabase/RLS policy.","error");
        await loadUserDetails(true);
    }
}

async function updatePassword(){
    const input=document.getElementById("currentPasswordInput");
    if(!input||!userData||!currentUserId)return;
    try{
        if(!supabaseClient) throw new Error("Supabase client is not initialized.");
        let {error}=await supabaseClient.from("users").update({password:input.value}).eq("userId",currentUserId);
        if (error) {
            const res = await supabaseClient.from("users").update({password:input.value}).eq("id",currentUserId);
            error = res.error;
        }
        if(error)throw error;
        userData.plainPassword=input.value; userData.password=input.value;
        localStorage.setItem("app_users_db",JSON.stringify([userData]));
        showFlashPopup("Password updated successfully!","success");
    }catch(err){console.error("Failed to update password:",err);showFlashPopup("Failed to update password.","error");}
}

async function deleteAccount(){
    if(!confirm("Are you sure you want to delete this user account completely?"))return;
    try{
        if(!supabaseClient)throw new Error("Supabase client is not initialized.");
        let {error:userError}=await supabaseClient.from("users").delete().eq("userId",currentUserId);
        if (userError) {
            const res = await supabaseClient.from("users").delete().eq("id",currentUserId);
            userError = res.error;
        }
        if(userError)throw userError;
        const {error:credError}=await supabaseClient.from("credentials").delete().eq("userId",currentUserId);
        if(credError)console.warn("Credential deletion warning:",credError);
        showFlashPopup("Account deleted successfully!","success");
        setTimeout(()=>window.location.href="admin.html",1200);
    }catch(err){console.error("Failed to delete account:",err);showFlashPopup("Failed to delete account.","error");}
}

function initSupabaseRealtime(){
    if(!supabaseClient)return;

    if(realtimeSubscription){
        try{supabaseClient.removeChannel(realtimeSubscription);}catch(_){}
        realtimeSubscription=null;
    }

    realtimeSubscription=supabaseClient
      .channel(`admin-user-live-sync-${currentUserId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"credentials"},()=>loadUserDetails(true))
      .on("postgres_changes",{event:"*",schema:"public",table:"users",filter:`userId=eq.${currentUserId}`},()=>loadUserDetails(true))
      .subscribe(status=>console.log("Admin user realtime status:",status));
}

function updateNetworkStatusIndicator(isOnline){
    const el=document.getElementById("networkStatusIndicator");
    if(el){el.innerText=isOnline?"Online":"Offline";el.style.color=isOnline?"#22c55e":"#ef4444";}
}

function showFlashPopup(message,type="success"){
    const old=document.getElementById("flashPopupContainer");
    if(old)old.remove();
    const popup=document.createElement("div");
    popup.id="flashPopupContainer"; popup.className=`flash-popup-box ${type}`;
    popup.innerHTML=`<div class="flash-popup-message">${escapeHtml(message)}</div>`;
    document.body.appendChild(popup);
    setTimeout(()=>popup.remove(),2000);
}

function injectNotificationStyles(){
    if(document.getElementById("flashPopupStyles"))return;
    const style=document.createElement("style");
    style.id="flashPopupStyles";
    style.textContent=`
      .flash-popup-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999}
      .flash-popup-box{background:#1f2937;color:#fff;padding:20px 30px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,.5);text-align:center;border:1px solid #374151;animation:fadeInOut .3s ease}
      .flash-popup-btn{padding:8px 16px;border:none;border-radius:4px;color:#fff;cursor:pointer;font-weight:bold}
      @keyframes fadeInOut{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
    `;
    document.head.appendChild(style);
}