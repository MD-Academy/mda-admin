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
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) {
            showAlert('Incorrect email or password. Please try again.');
            setLoading(false);
            return;
        }
        // If the account has 2FA enabled, ask for the code before proceeding.
        if (await mfaNeeded()) { setLoading(false); promptMfa(); return; }
        await proceedAfterAuth();
    } catch (err) {
        showAlert('An unexpected error occurred. Please try again.');
        setLoading(false);
    }
});

async function proceedAfterAuth() {
    setLoading(true);
    try {
        const { data: { session } } = await db.auth.getSession();
        if (!session) { showAlert('Session error. Please try again.'); setLoading(false); return; }
        const { data: profile } = await db.from('profiles').select('role, status').eq('id', session.user.id).single();
        if (!profile || (profile.role !== 'admin' && profile.role !== 'superadmin')) {
            showAlert('Access denied. This portal is for administrators only.');
            await db.auth.signOut(); setLoading(false); return;
        }
        if (profile.status === 'suspended') {
            showAlert('Your account has been suspended. Please contact a superadmin.');
            await db.auth.signOut(); setLoading(false); return;
        }
        window.location.href = 'dashboard.html';
    } catch (err) {
        showAlert('An unexpected error occurred. Please try again.');
        setLoading(false);
    }
}

function promptMfa() {
    loginForm.style.display = 'none';
    alertBox.style.display = 'none';
    let step = document.getElementById('mfa-step');
    if (!step) {
        step = document.createElement('div');
        step.id = 'mfa-step';
        step.innerHTML = `
            <p style="font-size:14px;color:#374151;margin-bottom:12px;">Two-factor authentication is on. Enter the 6-digit code from your authenticator app.</p>
            <div class="input-row" style="margin-bottom:14px;"><input type="text" id="mfa-code" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code"></div>
            <button type="button" class="btn-signin" id="mfa-verify"><span>Verify</span></button>`;
        loginForm.parentNode.insertBefore(step, loginForm.nextSibling);
        document.getElementById('mfa-verify').addEventListener('click', async () => {
            const code = document.getElementById('mfa-code').value.trim();
            if (!/^\d{6}$/.test(code)) { showAlert('Enter the 6-digit code from your app.'); return; }
            const vbtn = document.getElementById('mfa-verify'); vbtn.disabled = true; vbtn.querySelector('span').textContent = 'Verifying…';
            try { await mfaVerifyCode(code); await proceedAfterAuth(); }
            catch (err) { showAlert(err.message); vbtn.disabled = false; vbtn.querySelector('span').textContent = 'Verify'; }
        });
    }
    step.style.display = 'block';
}

(async () => {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return;
    if (await mfaNeeded()) { promptMfa(); return; }
    const { data: profile } = await db.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile && (profile.role === 'admin' || profile.role === 'superadmin')) window.location.href = 'dashboard.html';
})();
