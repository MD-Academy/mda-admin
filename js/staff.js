// Staff directory — read-only profile cards for the whole team, any admin can view.

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function staffInitials(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}

async function loadStaffDirectory() {
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

    wrap.innerHTML = `
        <p class="hint" style="margin-bottom:18px;">Everyone on the team. Each person fills in their own details under <strong>My Profile</strong>. Click a photo to enlarge it.</p>
        <div class="staff-grid">${staff.map(staffCard).join('')}</div>`;
}

function photoOrInitials(s, big) {
    const initials = escapeHtml(staffInitials(s.full_name));
    const cls = 'staff-photo' + (big ? '' : ' sm');
    if (s.avatar_url) {
        return `<span class="${cls} has-photo" data-name="${escapeHtml(s.full_name || 'Staff')}" data-full="${escapeHtml(s.avatar_url)}"><img src="${escapeHtml(s.avatar_url)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('is-fallback');this.remove();"></span>`;
    }
    return `<span class="${cls} is-fallback" data-initials="${initials}"></span>`;
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

// Click a photo to enlarge it (same lightbox behaviour as elsewhere).
document.addEventListener('click', e => {
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
