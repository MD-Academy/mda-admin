// Rooms list — entry point to each room's content hub (room.html).

let allRooms = [];
let lessonCounts = {}; // room_id -> count

// ── HELPERS ──
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) {
    el.className = `alert ${type}`;
    el.textContent = msg;
    el.style.display = 'block';
}
function slugify(s) {
    return s.toLowerCase().trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function visToggleHtml(id, isVisible) {
    return `<button class="vis-toggle ${isVisible ? 'visible' : 'hidden'}" onclick="toggleSubjectVis('${id}')" title="${isVisible ? 'Visible to students — click to hide the whole subject' : 'Hidden from students — click to show'}">${isVisible ? EYE : EYE_OFF}${isVisible ? 'Visible' : 'Hidden'}</button>`;
}

async function toggleSubjectVis(id) {
    const r = allRooms.find(x => x.id === id);
    if (!r) return;
    const { error } = await db.from('rooms').update({ is_visible: !r.is_visible }).eq('id', id);
    if (error) { alert(`Failed to update visibility: ${error.message}`); return; }
    r.is_visible = !r.is_visible;
    renderRooms();
}

// ── COVER IMAGE UPLOAD (public lesson-images bucket; images only, <=500KB) ──
const CARD_BUCKET = 'lesson-images';
const ALLOWED_IMG = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const IMG_MAX = 500 * 1024;
let pickedRoomImage = null;
function onRoomImagePicked(e) {
    const f = e.target.files[0];
    if (!f) return;
    pickedRoomImage = f;
    document.getElementById('room-image-text').textContent = f.name;
}
async function uploadCardImage(file, prefix) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!file.type.startsWith('image/') || !ALLOWED_IMG.includes(ext)) return { error: 'Please choose an image (PNG, JPG, WEBP or GIF).' };
    if (file.size > IMG_MAX) return { error: `Image too large (${(file.size / 1024).toFixed(0)} KB). Max 500 KB.` };
    const path = `${prefix}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const up = await db.storage.from(CARD_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) return { error: up.error.message };
    const { data } = db.storage.from(CARD_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl };
}

// ── LOAD ──
async function loadRooms() {
    const container = document.getElementById('rooms-container');
    container.innerHTML = `<div class="loader">Loading rooms…</div>`;

    const [roomsRes, lessonsRes] = await Promise.all([
        db.from('rooms').select('id, name, slug, description, order_index, is_visible, image_url').order('order_index', { ascending: true }),
        db.from('lessons').select('id, room_id')
    ]);

    if (roomsRes.error) {
        container.innerHTML = `<div class="loader" style="color:var(--red)">Error loading rooms: ${escapeHtml(roomsRes.error.message)}</div>`;
        return;
    }

    allRooms = roomsRes.data || [];
    lessonCounts = {};
    (lessonsRes.data || []).forEach(l => { lessonCounts[l.room_id] = (lessonCounts[l.room_id] || 0) + 1; });

    renderRooms();
}

function renderRooms() {
    const container = document.getElementById('rooms-container');

    if (allRooms.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                <h3>No subjects yet</h3>
                <p>Click "Add Subject" to create your first one.</p>
            </div>`;
        return;
    }

    container.innerHTML = `<div class="card-grid">${allRooms.map(r => {
        const count = lessonCounts[r.id] || 0;
        return `
            <div class="entity-card">
                ${r.image_url ? `<div style="height:88px;margin:-22px -22px 14px;border-radius:16px 16px 0 0;background:url('${escapeHtml(r.image_url)}') center/cover;"></div>` : ''}
                <div class="ec-head">
                    <div class="ec-title">${escapeHtml(r.name)}</div>
                    ${visToggleHtml(r.id, r.is_visible)}
                </div>
                <div class="ec-desc">${escapeHtml(r.description) || '<em style="color:var(--text-muted)">No description</em>'}</div>
                <span class="ec-meta">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    ${count} lesson${count === 1 ? '' : 's'}
                </span>
                <div class="ec-actions">
                    <button class="btn btn-primary btn-sm" onclick="openRoom('${r.id}')">Manage</button>
                    <button class="btn btn-ghost btn-sm" onclick="openRoomModal('${r.id}')">Edit details</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteRoom('${r.id}')">Delete</button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

function openRoom(id) {
    window.location.href = `subject.html?id=${encodeURIComponent(id)}`;
}

// ── ROOM CREATE / EDIT ──
function syncSlug() {
    const slugField = document.getElementById('room-slug');
    if (slugField.dataset.touched === 'true') return;
    slugField.value = slugify(document.getElementById('room-name').value);
}

function openRoomModal(id = null) {
    const alert = document.getElementById('room-alert');
    alert.style.display = 'none';
    pickedRoomImage = null;
    document.getElementById('room-image-file').value = '';
    document.getElementById('room-image-text').textContent = 'Click to choose an image';
    document.getElementById('room-image-current').textContent = '';
    const slugField = document.getElementById('room-slug');
    slugField.dataset.touched = id ? 'true' : 'false';
    slugField.oninput = () => { slugField.dataset.touched = 'true'; };

    if (id) {
        const r = allRooms.find(x => x.id === id);
        if (!r) return;
        document.getElementById('room-modal-title').textContent = 'Edit Subject Details';
        document.getElementById('room-id').value = r.id;
        document.getElementById('room-name').value = r.name || '';
        document.getElementById('room-slug').value = r.slug || '';
        document.getElementById('room-desc').value = r.description || '';
        document.getElementById('room-order').value = r.order_index ?? 1;
        if (r.image_url) document.getElementById('room-image-current').textContent = 'A cover image is set — choose a file to replace it.';
    } else {
        const nextOrder = allRooms.length ? Math.max(...allRooms.map(r => r.order_index || 0)) + 1 : 1;
        document.getElementById('room-modal-title').textContent = 'Add Subject';
        document.getElementById('room-id').value = '';
        document.getElementById('room-name').value = '';
        document.getElementById('room-slug').value = '';
        document.getElementById('room-desc').value = '';
        document.getElementById('room-order').value = nextOrder;
    }
    openModal('room-modal');
}

async function saveRoom(e) {
    e.preventDefault();
    const btn = document.getElementById('room-save-btn');
    const alert = document.getElementById('room-alert');
    alert.style.display = 'none';

    const id = document.getElementById('room-id').value;
    const payload = {
        name: document.getElementById('room-name').value.trim(),
        slug: slugify(document.getElementById('room-slug').value),
        description: document.getElementById('room-desc').value.trim() || null,
        order_index: parseInt(document.getElementById('room-order').value, 10) || 1
    };

    if (!payload.name || !payload.slug) {
        showModalAlert(alert, 'Name and slug are required.', 'error');
        return;
    }
    if (!ensureSafe(alert, [['Name', payload.name], ['Description', payload.description]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        if (pickedRoomImage) {
            const up = await uploadCardImage(pickedRoomImage, 'subjects');
            if (up.error) throw new Error(up.error);
            payload.image_url = up.url;
        }
        let res;
        if (id) {
            res = await db.from('rooms').update(payload).eq('id', id);
        } else {
            res = await db.from('rooms').insert(payload);
        }
        if (res.error) throw new Error(res.error.message);
        closeModal('room-modal');
        loadRooms();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Subject';
    }
}

async function deleteRoom(id) {
    const r = allRooms.find(x => x.id === id);
    const name = r ? (r.name || 'this subject') : 'this subject';
    const count = lessonCounts[id] || 0;
    let msg = 'This subject will be removed. This cannot be undone.';
    if (count > 0) msg = `This subject has ${count} lesson(s). Deleting it will also remove those lessons and any recordings, materials, notes and quizzes attached to them. This cannot be undone.`;
    const ok = await confirmDialog({
        title: `Delete "${name}"?`,
        message: msg,
        confirmText: 'Delete Subject',
        danger: true
    });
    if (!ok) return;

    // Remove material files in this room from storage BEFORE the row cascade,
    // otherwise the files would be orphaned in the bucket.
    const { data: mats, error: matErr } = await db.from('materials').select('storage_path').eq('room_id', id);
    if (matErr) { alert(`Could not check subject files: ${matErr.message}`); return; }
    if (mats && mats.length) {
        const { error: rmErr } = await db.storage.from('materials').remove(mats.map(m => m.storage_path));
        if (rmErr) { alert(`Could not remove subject files: ${rmErr.message}. Subject not deleted.`); return; }
    }

    // Remove this subject's video lectures (course content). Global Zoom
    // recordings are kept — deleting the subject just clears their tag.
    await db.from('recordings').delete().eq('room_id', id).eq('kind', 'lecture');

    const { error } = await db.from('rooms').delete().eq('id', id);
    if (error) { alert(`Failed to delete subject: ${error.message}`); return; }
    loadRooms();
}
