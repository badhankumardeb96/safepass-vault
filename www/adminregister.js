/* ==========================================================================
   Admin Registration Script (Dynamic Supabase PIN Verification + Realtime Sync)
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    const pinModal = document.getElementById("pinModal");
    const verifyPinBtn = document.getElementById("verifyPinBtn");
    const cancelPinBtn = document.getElementById("cancelPinBtn");
    const secretPinInput = document.getElementById("secretPinInput");
    const pinErrorMsg = document.getElementById("pinErrorMsg");

    const SUPABASE_URL = "https://vgjsoicsmmzahhsuworg.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv"; 

    let supabaseClient = null;
    if (window.supabase && typeof window.supabase.createClient === 'function') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    const isPinVerified = sessionStorage.getItem("admin_pin_verified");

    if (isPinVerified === "true") {
        if (pinModal) pinModal.style.display = "none";
        initializeApp();
    } else {
        if (pinModal) pinModal.style.display = "flex";
        if (secretPinInput) secretPinInput.focus();
    }

    if (verifyPinBtn) {
        verifyPinBtn.addEventListener("click", async () => {
            const enteredPin = secretPinInput.value.trim();
            if (!enteredPin) return;

            try {
                if (!supabaseClient) throw new Error("Supabase client is not initialized.");

                const { data, error } = await supabaseClient
                    .from('settings')
                    .select('value')
                    .eq('key', 'admin_register_pin')
                    .single();

                if (error || !data) throw new Error("Could not fetch PIN from database.");

                const correctPin = String(data.value).trim();

                if (enteredPin === correctPin) {
                    sessionStorage.setItem("admin_pin_verified", "true");
                    if (pinModal) pinModal.style.display = "none";
                    if (pinErrorMsg) pinErrorMsg.style.display = "none";
                    initializeApp();
                } else {
                    if (pinErrorMsg) {
                        pinErrorMsg.innerText = "Invalid PIN! Try again.";
                        pinErrorMsg.style.display = "block";
                    }
                }
            } catch (err) {
                console.error("PIN Verification Error:", err);
                if (pinErrorMsg) {
                    pinErrorMsg.innerText = "Verification error or database connection failed!";
                    pinErrorMsg.style.display = "block";
                }
            }
        });
    }

    if (secretPinInput) {
        secretPinInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") if (verifyPinBtn) verifyPinBtn.click();
        });
    }

    if (cancelPinBtn) {
        cancelPinBtn.addEventListener("click", () => {
            window.location.href = "admin-login.html";
        });
    }

    function initializeApp() {
        const logoutBtn = document.getElementById('logoutBtn');
        const adminRegisterForm = document.getElementById('adminRegisterForm');
        const successPopup = document.getElementById('successPopup');
        const popupMessage = document.getElementById('popupMessage');
        const popupCloseBtn = document.getElementById('popupCloseBtn');

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                sessionStorage.removeItem('admin_pin_verified');
                window.location.href = 'admin-login.html';
            });
        }

        if (popupCloseBtn) {
            popupCloseBtn.addEventListener('click', () => {
                if (successPopup) successPopup.style.display = 'none';
            });
        }

        if (adminRegisterForm) {
            adminRegisterForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const formData = {
                    userId: Math.floor(1000000000 + Math.random() * 9000000000).toString(),
                    fullName: document.getElementById('fullName').value.trim(),
                    nidNumber: document.getElementById('nidNumber').value.trim(),
                    phoneNumber: document.getElementById('phoneNumber').value.trim(),
                    email: document.getElementById('email').value.trim(),
                    gender: document.getElementById('gender').value,
                    dob: document.getElementById('dob').value,
                    bloodGroup: document.getElementById('bloodGroup').value,
                    password: document.getElementById('password').value,
                    presentAddress: document.getElementById('presentAddress').value.trim(),
                    permanentAddress: document.getElementById('permanentAddress').value.trim(),
                    role: 'admin',
                    status: 'active'
                };

                try {
                    const { error } = await supabaseClient.from('users').insert([formData]);
                    if (error) throw error;

                    if (popupMessage) popupMessage.innerText = `User registered! ID: ${formData.userId}`;
                    if (successPopup) successPopup.style.display = 'flex';
                    adminRegisterForm.reset();
                } catch (error) {
                    alert('Registration Failed: ' + error.message);
                }
            });
        }

        // রিয়েল-টাইম সাবস্ক্রিপশন চালু করা
        supabaseClient
            .channel('public:users')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
                loadAllUsers();
            })
            .subscribe();

        loadAllUsers();
    }

    async function loadAllUsers() {
        const userTableBody = document.getElementById('userTableBody');
        if (!userTableBody) return;

        try {
            const { data: users, error } = await supabaseClient.from('users').select('*');
            if (error) throw error;

            userTableBody.innerHTML = '';
            if (!users || users.length === 0) {
                userTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No users found</td></tr>`;
                return;
            }

            users.forEach(user => {
                const tr = document.createElement('tr');
                const recordId = user.userId || user.id;
                tr.innerHTML = `
                    <td><a href="user.html?id=${recordId}" style="color: #4f46e5; font-weight: bold;">${recordId}</a></td>
                    <td><strong>${user.fullName || user.userName}</strong><br><small>NID: ${user.nidNumber || 'N/A'}</small></td>
                    <td>Phone: ${user.phoneNumber || 'N/A'}<br>Email: ${user.email || 'N/A'}</td>
                    <td>
                        <select class="status-select" data-userid="${recordId}">
                            <option value="active" ${user.status === 'active' ? 'selected' : ''}>Active</option>
                            <option value="block" ${user.status === 'block' ? 'selected' : ''}>Block</option>
                            <option value="disable" ${user.status === 'disable' ? 'selected' : ''}>Disable</option>
                            <option value="suspended" ${user.status === 'suspended' ? 'selected' : ''}>Suspended</option>
                            <option value="banned" ${user.status === 'banned' ? 'selected' : ''}>Banned</option>
                        </select>
                    </td>
                    <td><button class="action-btn delete-user-btn" data-userid="${recordId}"><i class="fa-solid fa-trash"></i></button></td>
                `;
                userTableBody.appendChild(tr);
            });

            document.querySelectorAll('.status-select').forEach(sel => sel.addEventListener('change', (e) => updateUserStatus(e.target.dataset.userid, e.target.value)));
            document.querySelectorAll('.delete-user-btn').forEach(btn => btn.addEventListener('click', (e) => {
                if (confirm('Delete this user?')) deleteUser(e.target.closest('button').dataset.userid);
            }));
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }

    async function updateUserStatus(userId, status) {
        await supabaseClient.from('users').update({ status }).eq('userId', userId);
    }

    async function deleteUser(userId) {
        await supabaseClient.from('users').delete().eq('userId', userId);
    }
});