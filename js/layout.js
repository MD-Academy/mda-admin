// Shared admin layout — renders sidebar + topbar, enforces admin auth.

const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    { id: 'students', label: 'Students', href: 'students.html', superadminOnly: true, icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { id: 'tuition', label: 'Program Tuition', href: 'tuition.html', superadminOnly: true, icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>' },
    { id: 'courses', label: 'Courses', href: 'courses.html', icon: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>' },
    { id: 'subjects', label: 'Subjects', href: 'subjects.html', icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
    { id: 'recordings', label: 'Zoom Recordings', href: 'recordings.html', icon: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>' },
    { id: 'booklets', label: 'Digital Booklets', href: 'booklets.html', icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/><line x1="12" y1="7" x2="12" y2="21"/>' },
    { id: 'exams', label: 'Exams', href: 'exams.html', icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>' },
    { id: 'gradebook', label: 'Gradebook', href: 'gradebook.html', icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h7"/>' },
    { id: 'attendance', label: 'Attendance', href: 'attendance.html', icon: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>' },
    { id: 'universities', label: 'University Selection', href: 'universities.html', icon: '<path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/>' },
    { id: 'meetings', label: 'Personal Meetings', href: 'meetings.html', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>' },
    { id: 'calendar', label: 'Calendar', href: 'calendar.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { id: 'announcements', label: 'Announcements', href: 'announcements.html', icon: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>' },
    { id: 'tickets', label: 'Student Tickets', href: 'tickets.html', icon: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' },
    { id: 'admins', label: 'Admins', href: 'admins.html', superadminOnly: true, icon: '<path d="M12 1l3 5 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 7l6-1z"/>' },
    { id: 'feedback', label: 'Feedback', href: 'feedback.html', superadminOnly: true, icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
    { id: 'appearance', label: 'Appearance', href: 'appearance.html', superadminOnly: true, icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>' },
    { id: 'work-hours', label: 'Work Hours', href: 'work-hours.html', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { id: 'staff', label: 'Staff', href: 'staff.html', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { id: 'guide', label: 'User Guide', href: 'guide.html', icon: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
    { id: 'profile', label: 'My Profile', href: 'profile.html', icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' }
];

function renderLayout(activeId, pageTitle, pageSub, profile) {
    const initials = (profile.full_name || 'A').trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();

    const isSuper = profile.role === 'superadmin';
    const navHtml = NAV_ITEMS.filter(item => !item.superadminOnly || isSuper).map(item => `
        <a href="${item.href}" class="nav-item ${item.id === activeId ? 'active' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>
            ${item.label}
        </a>
    `).join('');

    document.getElementById('app-layout').innerHTML = `
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-logo">
                <img src="assets/images/mda-logo.png" alt="MDA">
                <div class="brand-text">
                    <strong>MDA Admin</strong>
                    <span>Office Portal</span>
                </div>
            </div>
            <nav class="nav-menu">${navHtml}</nav>
            <div class="sidebar-footer">
                <button class="logout-btn" id="logout-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign Out
                </button>
            </div>
        </aside>
        <div class="main">
            <header class="topbar">
                <div>
                    <h1>${pageTitle}</h1>
                    ${pageSub ? `<div class="page-sub">${pageSub}</div>` : ''}
                </div>
                <div class="topbar-user">
                    <button class="topbar-bell" id="admin-bell" title="Notifications" onclick="openAdminNotifs()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                        <span class="notif-badge" id="admin-notif-badge" style="display:none;">0</span>
                    </button>
                    <div class="user-info">
                        <strong style="display:inline-flex;align-items:center;gap:7px;align-self:flex-start;margin-bottom:5px;background:linear-gradient(135deg,#b91c5c 0%,#7a2747 50%,#20262f 100%);color:#fff;font-weight:700;font-size:13.5px;padding:6px 13px;border-radius:10px;text-shadow:0 1px 2px rgba(0,0,0,.3);box-shadow:0 4px 12px rgba(185,28,92,.3),0 2px 4px rgba(32,38,47,.35),inset 0 1px 0 rgba(255,255,255,.28),inset 0 -2px 4px rgba(0,0,0,.25);">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            ${_layoutEsc(profile.full_name || 'Admin')}
                        </strong>
                        <span>${isSuper ? 'Super Administrator' : 'Administrator'}</span>
                    </div>
                    <span class="avatar-steth" aria-hidden="true" title="Medical Doctor Academy">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.3.3 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/></svg>
                    </span>
                    <button class="avatar avatar-btn" id="avatar-btn" title="Upload a photo">
                        <span class="avatar-inner" id="avatar-inner">${profile.avatar_url
                            ? `<img src="${_layoutEsc(profile.avatar_url)}" alt="">`
                            : initials}</span>
                        <span class="avatar-edit">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                        </span>
                    </button>
                    <input type="file" id="avatar-input" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none">
                </div>
            </header>
            <div class="content" id="page-content"></div>
            <footer style="text-align:center;padding:16px 24px;color:#64748b;font-size:12px;line-height:1.6;border-top:1px solid var(--border);">
                Your personal information is processed in accordance with our <a href="https://www.medicaldoctor-studies.com/privacy-policy/" target="_blank" rel="noopener" style="color:#475569;text-decoration:underline;">Privacy Policy</a>. By continuing to use this platform, you confirm that you have read, understood and agree to it.<br>
                This platform was made by Diego Ilan Tevelev · © Medical Doctor Academy 2026. All rights reserved.
            </footer>
        </div>
    `;

    document.getElementById('logout-btn').addEventListener('click', signOut);
    _setupAvatarUpload();
    _startAccountWatch();
    _initAdminNotifs(isSuper);
}

// ── NOTIFICATION BELL (student replies to feedback) ──────────
// Surfaces replies students post to feedback. A regular teacher sees replies
// to their OWN feedback; a super-admin sees them all. Read state is per-admin,
// tracked in notification_reads (its student_id column is really "who saw it").
let _adminNotifs = [];      // [{id, title, sub, student_id, date}]
let _adminUid = null;

function _adminNotifEsc(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function _adminNotifDate(d) { try { return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

async function _initAdminNotifs(isSuper) {
    try {
        const { data: { session } } = await db.auth.getSession();
        if (!session) return;
        _adminUid = session.user.id;

        // Unread student replies. Join to the parent note for author (whose feedback)
        // and student (who to open). Regular admins only see replies to their own feedback.
        let q = db.from('student_note_replies')
            .select('id, author_name, body, created_at, student_notes!inner(author_id, student_id)')
            .eq('author_role', 'student')
            .order('created_at', { ascending: false })
            .limit(100);
        if (!isSuper) q = q.eq('student_notes.author_id', _adminUid);

        const [repRes, readRes] = await Promise.all([
            q,
            db.from('notification_reads').select('ref_id').eq('student_id', _adminUid).eq('kind', 'reply')
        ]);
        const readSet = new Set((readRes.data || []).map(r => r.ref_id));

        _adminNotifs = [];
        (repRes.data || []).forEach(r => {
            if (readSet.has(r.id)) return;
            const note = r.student_notes || {};
            const snip = String(r.body || '').replace(/\s+/g, ' ').trim();
            _adminNotifs.push({
                id: r.id,
                student_id: note.student_id,
                title: snip.length > 110 ? snip.slice(0, 110) + '…' : snip,
                sub: `${r.author_name || 'A student'} replied · ` + _adminNotifDate(r.created_at),
                date: r.created_at
            });
        });
        _renderAdminBell();
    } catch (e) { /* notifications must never block the page */ }
}

function _renderAdminBell() {
    const badge = document.getElementById('admin-notif-badge');
    if (!badge) return;
    const n = _adminNotifs.length;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.style.display = n ? 'flex' : 'none';
    const ov = document.getElementById('admin-notif-overlay');
    if (ov && ov.classList.contains('open')) _renderAdminNotifList();
}

function _ensureAdminNotifModal() {
    if (document.getElementById('admin-notif-overlay')) return;
    const ov = document.createElement('div');
    ov.className = 'notif-overlay';
    ov.id = 'admin-notif-overlay';
    ov.innerHTML = `
        <div class="notif-box" role="dialog" aria-modal="true">
            <div class="notif-head"><h3>Notifications</h3>
                <button class="notif-close" onclick="closeAdminNotifs()" title="Close">&times;</button></div>
            <div class="notif-list" id="admin-notif-list"></div>
            <div class="notif-foot" id="admin-notif-foot"></div>
        </div>`;
    ov.addEventListener('click', e => { if (e.target === ov) closeAdminNotifs(); });
    document.body.appendChild(ov);
}

function openAdminNotifs() { _ensureAdminNotifModal(); _renderAdminNotifList(); document.getElementById('admin-notif-overlay').classList.add('open'); }
function closeAdminNotifs() { const ov = document.getElementById('admin-notif-overlay'); if (ov) ov.classList.remove('open'); }

function _renderAdminNotifList() {
    const list = document.getElementById('admin-notif-list');
    const foot = document.getElementById('admin-notif-foot');
    if (!list) return;
    if (_adminNotifs.length === 0) {
        list.innerHTML = `<div class="notif-empty">🎉 You're all caught up — no new replies.</div>`;
        foot.innerHTML = '';
        return;
    }
    const icon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    list.innerHTML = `<div class="notif-group-label">↩️ Replies from students</div>` + _adminNotifs.map(n => `
        <div class="notif-item fb" style="cursor:pointer;" onclick="openAdminReply('${n.id}','${n.student_id || ''}')">
            <span class="ni-icon">${icon}</span>
            <div class="ni-body"><div class="ni-title">${_adminNotifEsc(n.title)}</div><div class="ni-sub">${_adminNotifEsc(n.sub)}</div></div>
            <button class="ni-x" title="Dismiss" onclick="event.stopPropagation();dismissAdminNotif('${n.id}')">&times;</button>
        </div>`).join('');
    foot.innerHTML = `<span style="font-size:13px;color:var(--text-muted);">${_adminNotifs.length} new</span>
        <button class="btn btn-ghost btn-sm" onclick="markAllAdminNotifsRead()">Mark all as read</button>`;
}

async function _writeAdminReads(ids) {
    if (!_adminUid || !ids.length) return;
    const rows = ids.map(id => ({ student_id: _adminUid, kind: 'reply', ref_id: id }));
    try { await db.from('notification_reads').upsert(rows, { onConflict: 'student_id,kind,ref_id' }); } catch (e) { /* ignore */ }
}

function openAdminReply(replyId, studentId) {
    _writeAdminReads([replyId]);   // opening it counts as read
    if (studentId) window.location.href = `student-feedback.html?id=${encodeURIComponent(studentId)}`;
}

async function dismissAdminNotif(id) {
    _adminNotifs = _adminNotifs.filter(n => n.id !== id);
    _renderAdminBell();
    _renderAdminNotifList();
    await _writeAdminReads([id]);
}

async function markAllAdminNotifsRead() {
    const ids = _adminNotifs.map(n => n.id);
    _adminNotifs = [];
    _renderAdminBell();
    _renderAdminNotifList();
    await _writeAdminReads(ids);
}

// Poll every 60s: if this admin gets suspended or loses admin rights while
// logged in, sign them out immediately (they'll see the clear message on re-login).
let _accountWatchTimer = null;
function _startAccountWatch() {
    if (_accountWatchTimer) clearInterval(_accountWatchTimer);
    _accountWatchTimer = setInterval(async () => {
        try {
            const { data: { session } } = await db.auth.getSession();
            if (!session) { window.location.href = 'index.html'; return; }
            const { data: p, error: pErr } = await db.from('profiles').select('role, status').eq('id', session.user.id).single();
            if (pErr) { console.error('[layout] account watch check failed (will retry):', pErr); return; }  // transient — don't kick on a blip
            const ok = p && (p.role === 'admin' || p.role === 'superadmin') && p.status !== 'suspended';
            if (!ok) {
                Object.keys(sessionStorage).filter(k => k.startsWith('mda_profile_')).forEach(k => sessionStorage.removeItem(k));
                await db.auth.signOut();
                window.location.href = 'index.html';
            }
        } catch (e) { /* ignore transient network errors */ }
    }, 60000);
}

function _layoutEsc(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ── AVATAR / PROFILE PHOTO UPLOAD ──
const AVATAR_BUCKET = 'avatars';
const AVATAR_MAX_BYTES = 500 * 1024; // 500 KB
const AVATAR_ALLOWED = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

function _setupAvatarUpload() {
    const btn = document.getElementById('avatar-btn');
    const input = document.getElementById('avatar-input');
    if (!btn || !input) return;

    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        input.value = '';
        if (!file) return;

        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const isImage = file.type.startsWith('image/');
        if (!isImage || !AVATAR_ALLOWED.includes(ext)) {
            alert('Invalid file. Please use an image: PNG, JPG, JPEG, WEBP or GIF.');
            return;
        }
        if (file.size > AVATAR_MAX_BYTES) {
            alert(`Image is too large (${(file.size / 1024).toFixed(0)} KB). Maximum is 500 KB.`);
            return;
        }

        const inner = document.getElementById('avatar-inner');
        const prev = inner.innerHTML;
        inner.innerHTML = '…';
        try {
            const { data: { session } } = await db.auth.getSession();
            if (!session) throw new Error('Not signed in.');
            const userId = session.user.id;
            const path = `${userId}/avatar.${ext}`;

            const up = await db.storage.from(AVATAR_BUCKET).upload(path, file, {
                contentType: file.type, upsert: true
            });
            if (up.error) throw new Error(up.error.message);

            const { data: pub } = db.storage.from(AVATAR_BUCKET).getPublicUrl(path);
            // Cache-bust so the new image shows immediately.
            const url = `${pub.publicUrl}?t=${Date.now()}`;

            const upd = await db.from('profiles').update({ avatar_url: url }).eq('id', userId);
            if (upd.error) throw new Error(upd.error.message);

            inner.innerHTML = `<img src="${_layoutEsc(url)}" alt="">`;
            // Keep the cached profile in sync so the new photo shows instantly on the next page.
            try {
                const k = `mda_profile_${userId}`;
                const c = JSON.parse(sessionStorage.getItem(k) || '{}');
                c.avatar_url = url;
                sessionStorage.setItem(k, JSON.stringify(c));
            } catch (e) { /* ignore */ }
        } catch (err) {
            inner.innerHTML = prev;
            alert(`Could not upload photo: ${err.message}`);
        }
    });
}
