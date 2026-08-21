// Supabase Global Client Initialization
const supabaseUrl = 'https://vgjsoicsmmzahhsuworg.supabase.co';
const supabaseKey = 'sb_publishable_NkMibVnz7Vt6CAHuSTaQZw_zpUFGNsv';

// উইন্ডো অবজেক্টে supabase সেট করা যাতে অন্য যেকোনো ফাইল থেকে সরাসরি ব্যবহার করা যায়
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);