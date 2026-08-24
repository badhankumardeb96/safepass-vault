const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vgjsoicsmmzahhsuworg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = { supabase };