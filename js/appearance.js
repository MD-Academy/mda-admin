// Global card banners for the student subject page (Presentations / Video Lectures / Quizzes).
// Stored in app_settings (key/value); the same image shows in every subject across every course.
function escapeHtml(s){ return s ? String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) : ''; }

const CARD_BUCKET = 'lesson-images';            // public bucket, same one used for course/subject covers
const ALLOWED_IMG = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const IMG_MAX = 500 * 1024;

// Icons + default gradients must match the student subject.html cards exactly.
const IC_PRES  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20v14H2z"/><path d="M8 21h8M12 17v4"/></svg>';
const IC_VIDEO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';
const IC_QUIZ  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

const BANNERS = [
    { key: 'banner_presentations', label: 'Presentations', sub: 'Slides, PDFs & notes',  grad: 'linear-gradient(135deg,#7c3aed,#a855f7)', icon: IC_PRES },
    { key: 'banner_lectures',      label: 'Video Lectures', sub: 'Recorded video lessons', grad: 'linear-gradient(135deg,#0d2a52,#4a90d9)', icon: IC_VIDEO },
    { key: 'banner_quizzes',       label: 'Quizzes',        sub: 'Test your knowledge',    grad: 'linear-gradient(135deg,#059669,#10b981)', icon: IC_QUIZ }
];

let CURRENT = {};   // key -> image url

async function uploadBannerImage(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!file.type.startsWith('image/') || !ALLOWED_IMG.includes(ext)) return { error: 'Please choose an image (PNG, JPG, WEBP or GIF).' };
    if (file.size > IMG_MAX) return { error: `Image too large (${(file.size / 1024).toFixed(0)} KB). Max 500 KB.` };
    const path = `banners/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const up = await db.storage.from(CARD_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) return { error: up.error.message };
    const { data } = db.storage.from(CARD_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl };
}

// Best-effort cleanup of a previous banner file so we don't orphan it in the bucket.
function storagePathFromUrl(url) {
    const marker = `/${CARD_BUCKET}/`;
    const i = url ? url.indexOf(marker) : -1;
    return i === -1 ? null : url.slice(i + marker.length);
}
async function removeOldFile(url) {
    const p = storagePathFromUrl(url);
    if (p) { try { await db.storage.from(CARD_BUCKET).remove([p]); } catch (e) { /* non-fatal */ } }
}

async function loadAppearance() {
    const box = document.getElementById('banner-grid');
    const { data, error } = await db.from('app_settings').select('key, value').in('key', BANNERS.map(b => b.key));
    if (error) {
        box.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load settings</h3><p>${escapeHtml(error.message)}</p></div>`;
        return;
    }
    CURRENT = {};
    (data || []).forEach(r => { if (r.value) CURRENT[r.key] = r.value; });
    box.innerHTML = BANNERS.map(renderBannerCard).join('');
}

function renderBannerCard(b) {
    const url = CURRENT[b.key];
    const preview = url
        ? `<div class="ap-preview" style="background:url('${escapeHtml(url)}') center/cover;"></div>`
        : `<div class="ap-preview" style="background:${b.grad}">${b.icon}</div>`;
    return `<div class="ap-card">
        ${preview}
        <div class="ap-body">
            <div class="ap-title">${b.label}</div>
            <div class="ap-sub">${b.sub}</div>
            <div class="ap-status" id="status-${b.key}">${url ? '✓ Custom image set' : 'Using default colour & icon'}</div>
            <div class="ap-actions">
                <label class="btn btn-primary" for="file-${b.key}">${url ? 'Replace image' : 'Upload image'}</label>
                <input type="file" id="file-${b.key}" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" onchange="onBannerPicked('${b.key}', event)">
                ${url ? `<button class="btn btn-ghost" onclick="removeBanner('${b.key}')">Remove</button>` : ''}
            </div>
        </div>
    </div>`;
}

async function onBannerPicked(key, e) {
    const file = e.target.files[0];
    e.target.value = '';   // allow re-picking the same file later
    if (!file) return;
    const status = document.getElementById('status-' + key);
    status.textContent = 'Uploading…'; status.style.color = 'var(--text-muted)';

    const up = await uploadBannerImage(file);
    if (up.error) { status.textContent = up.error; status.style.color = 'var(--red)'; return; }

    const old = CURRENT[key];
    const { error } = await db.from('app_settings').upsert(
        { key, value: up.url, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
    );
    if (error) { status.textContent = "Couldn't save: " + error.message; status.style.color = 'var(--red)'; return; }

    if (old && old !== up.url) removeOldFile(old);
    CURRENT[key] = up.url;
    await loadAppearance();
}

async function removeBanner(key) {
    const ok = await confirmDialog({
        title: 'Remove banner image?',
        message: 'This category will go back to the default colour and icon for every student, in all subjects.',
        confirmText: 'Remove',
        danger: true
    });
    if (!ok) return;

    const old = CURRENT[key];
    const { error } = await db.from('app_settings').upsert(
        { key, value: '', updated_at: new Date().toISOString() },
        { onConflict: 'key' }
    );
    if (error) {
        const status = document.getElementById('status-' + key);
        if (status) { status.textContent = "Couldn't remove: " + error.message; status.style.color = 'var(--red)'; }
        return;
    }
    if (old) removeOldFile(old);
    delete CURRENT[key];
    await loadAppearance();
}
