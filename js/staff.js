// Staff directory — read-only profile cards for the whole team, any admin can view.
// A super-admin can additionally set/replace anyone's photo — most staff never get
// around to uploading their own, and it shouldn't have to wait on them.

let IS_SUPER_STAFF = false;

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function staffInitials(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}

async function loadStaffDirectory(isSuper) {
    IS_SUPER_STAFF = !!isSuper;
    const wrap = document.getElementById('staff-wrap');
    let staff = [];
    try {
        const r = await apiRequest('GET', '/admin/staff-directory');
        staff = (r && r.staff) || [];
    } catch (e) {
        wrap.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load the team</h3><p>${escapeHtml(e.message || 'Please try again.')}</p></div>`;
        return;
    }
    if (!staff.length) {
        wrap.innerHTML = `<div class="empty-state"><h3>No staff yet</h3><p>Staff profiles appear here once accounts exist.</p></div>`;
        return;
    }

    const hint = IS_SUPER_STAFF
        ? `Everyone on the team. Each person fills in their own details under <strong>My Profile</strong>. Click a photo to enlarge it — hover a photo to <strong>upload or replace it</strong> for anyone (handy since most people never get around to it themselves).`
        : `Everyone on the team. Each person fills in their own details under <strong>My Profile</strong>. Click a photo to enlarge it.`;
    wrap.innerHTML = `
        <p class="hint" style="margin-bottom:18px;">${hint}</p>
        <div class="staff-grid">${staff.map(staffCard).join('')}</div>
        <input type="file" id="staff-photo-input" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none">`;
}

function photoOrInitials(s, big) {
    const initials = escapeHtml(staffInitials(s.full_name));
    const cls = 'staff-photo' + (big ? '' : ' sm');
    const editBtn = IS_SUPER_STAFF
        ? `<button type="button" class="staff-photo-edit" data-uid="${escapeHtml(s.id)}" data-name="${escapeHtml(s.full_name || 'Staff')}" title="Upload/replace ${escapeHtml(s.full_name || 'their')} photo">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
           </button>`
        : '';
    if (s.avatar_url) {
        return `<span class="${cls} has-photo" data-name="${escapeHtml(s.full_name || 'Staff')}" data-full="${escapeHtml(s.avatar_url)}"><img src="${escapeHtml(s.avatar_url)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('is-fallback');this.remove();">${editBtn}</span>`;
    }
    return `<span class="${cls} is-fallback" data-initials="${initials}">${editBtn}</span>`;
}

function staffCard(s) {
    const role = s.job_title ? `<div class="staff-role">${escapeHtml(s.job_title)}</div>` : '';
    const spec = s.specialty ? `<div class="staff-line"><span class="k">Specialty</span>${escapeHtml(s.specialty)}</div>` : '';
    const edu = s.education ? `<div class="staff-line"><span class="k">Education</span>${escapeHtml(s.education)}</div>` : '';
    const bio = s.bio ? `<p class="staff-bio">${escapeHtml(s.bio)}</p>` : '';
    const empty = (!s.job_title && !s.specialty && !s.education && !s.bio)
        ? `<p class="staff-bio" style="color:var(--text-muted);font-style:italic;">No profile details added yet.</p>` : '';
    return `
        <div class="staff-card">
            <div class="staff-card-head">
                ${photoOrInitials(s, true)}
                <div>
                    <div class="staff-name">${escapeHtml(s.full_name || 'Staff')}</div>
                    ${role}
                </div>
            </div>
            ${bio}
            ${spec}
            ${edu}
            ${empty}
        </div>`;
}

// ── SUPER-ADMIN: set/replace a staff member's photo ──
const STAFF_PHOTO_MAX_BYTES = 500 * 1024; // 500 KB
let _staffPhotoTargetUid = null;

document.addEventListener('click', e => {
    const btn = e.target.closest('.staff-photo-edit');
    if (!btn) return;
    e.stopPropagation();   // don't also trigger the lightbox
    _staffPhotoTargetUid = btn.dataset.uid;
    const input = document.getElementById('staff-photo-input');
    if (input) input.click();
});

document.addEventListener('change', async e => {
    if (e.target.id !== 'staff-photo-input') return;
    const input = e.target;
    const file = input.files[0];
    const uid = _staffPhotoTargetUid;
    input.value = '';
    if (!file || !uid) return;

    const isImage = file.type.startsWith('image/');
    if (!isImage) { alert('Invalid file. Please choose an image: PNG, JPG, WEBP or GIF.'); return; }
    if (file.size > STAFF_PHOTO_MAX_BYTES) {
        alert(`Image is too large (${(file.size / 1024).toFixed(0)} KB). Maximum is 500 KB.`);
        return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
        try {
            await apiRequest('POST', `/admin/set-staff-photo/${encodeURIComponent(uid)}`, { image_base64: reader.result });
            await loadStaffDirectory(IS_SUPER_STAFF);
        } catch (err) {
            alert(`Couldn't save that photo: ${err.message}`);
        }
    };
    reader.onerror = () => alert('Could not read that file. Please try another image.');
    reader.readAsDataURL(file);
});

// Click a photo to enlarge it (same lightbox behaviour as elsewhere) — except the
// upload/replace button sitting on top of it, which handles its own click above.
document.addEventListener('click', e => {
    if (e.target.closest('.staff-photo-edit')) return;
    const ph = e.target.closest('.staff-photo.has-photo');
    if (ph && ph.dataset.full) openPhotoLightbox(ph.dataset.full, ph.dataset.name);
});
function openPhotoLightbox(src, name) {
    let ov = document.getElementById('photo-lightbox');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'photo-lightbox';
        ov.className = 'photo-lightbox';
        ov.innerHTML = `<div class="pl-inner"><img id="pl-img" alt=""><div id="pl-name" class="pl-name"></div></div>`;
        ov.addEventListener('click', () => ov.classList.remove('open'));
        document.body.appendChild(ov);
    }
    document.getElementById('pl-img').src = src;
    document.getElementById('pl-name').textContent = name || '';
    ov.classList.add('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const ov = document.getElementById('photo-lightbox'); if (ov) ov.classList.remove('open'); } });
