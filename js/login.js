const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginForm  = document.getElementById('login-form');
const emailInput = document.getElementById('email-input');
const pwInput    = document.getElementById('password-input');
const togglePw   = document.getElementById('toggle-pw');
const eyeShow    = document.getElementById('eye-show');
const eyeHide    = document.getElementById('eye-hide');
const signinBtn  = document.getElementById('signin-btn');
const btnText    = document.getElementById('btn-text');
const btnArrow   = document.getElementById('btn-arrow');
const alertBox   = document.getElementById('alert-box');

function showAlert(msg, type = 'error') {
    alertBox.className = `alert ${type}`;
    alertBox.textContent = msg;
    alertBox.style.display = 'block';
}

function setLoading(on) {
    signinBtn.disabled = on;
    btnText.textContent = on ? 'Signing in…' : 'Sign In';
    btnArrow.style.display = on ? 'none' : 'block';
}

togglePw.addEventListener('click', () => {
    const hide = pwInput.type === 'password';
    pwInput.type = hide ? 'text' : 'password';
    eyeShow.style.display = hide ? 'none' : 'block';
    eyeHide.style.display = hide ? 'block' : 'none';
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.style.display = 'none';

    const email    = emailInput.value.trim();
    const password = pwInput.value;

    if (!email || !password) { showAlert('Please enter your email and password.'); return; }

    setLoading(true);

    try {
        const { data, error } = await db.auth.signInWithPassword({ email, password });

        if (error) {
            showAlert('Incorrect email or password. Please try again.');
            setLoading(false);
            return;
        }

        const { data: profile } = await db
            .from('profiles')
            .select('role')
            .eq('id', data.user.id)
            .single();

        if (!profile || (profile.role !== 'admin' && profile.role !== 'superadmin')) {
            showAlert('Access denied. This portal is for administrators only.');
            await db.auth.signOut();
            setLoading(false);
            return;
        }

        window.location.href = 'dashboard.html';

    } catch (err) {
        showAlert('An unexpected error occurred. Please try again.');
        setLoading(false);
    }
});

(async () => {
    const { data: { session } } = await db.auth.getSession();
    if (session) {
        const { data: profile } = await db
            .from('profiles').select('role').eq('id', session.user.id).single();
        if (profile && (profile.role === 'admin' || profile.role === 'superadmin')) window.location.href = 'dashboard.html';
    }
})();
