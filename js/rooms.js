// Rooms & Lessons management.

let allRooms = [];
let lessonCounts = {};       // room_id -> count
let currentRoomLessons = []; // lessons of the room open in the lessons modal
let currentRoomId = null;    // room whose lessons modal is open

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

// ── LOAD ──
async function loadRooms() {
    const container = document.getElementById('rooms-container');
    container.innerHTML = `<div class="loader">Loading rooms…</div>`;

    const [roomsRes, lessonsRes] = await Promise.all([
        db.from('rooms').select('id, name, slug, description, order_index').order('order_index', { ascending: true }),
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
                <h3>No rooms yet</h3>
                <p>Click "Add Room" to create your first subject.</p>
            </div>`;
        return;
    }

    container.innerHTML = `<div class="card-grid">${allRooms.map(r => {
        const count = lessonCounts[r.id] || 0;
        return `
            <div class="entity-card">
                <div class="ec-head">
                    <div class="ec-title">${escapeHtml(r.name)}</div>
                    <span class="count-pill">${count}</span>
                </div>
                <div class="ec-desc">${escapeHtml(r.description) || '<em style="color:var(--text-muted)">No description</em>'}</div>
                <span class="ec-meta">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    ${count} lesson${count === 1 ? '' : 's'}
                </span>
                <div class="ec-actions">
                    <button class="btn btn-primary btn-sm" onclick="openLessons('${r.id}')">Manage Lessons</button>
                    <button class="btn btn-ghost btn-sm" onclick="openRoomModal('${r.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteRoom('${r.id}', '${escapeHtml(r.name).replace(/'/g, "\\'")}')">Delete</button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

// ── ROOM CREATE / EDIT ──
function syncSlug() {
    const slugField = document.getElementById('room-slug');
    // Only auto-fill if the admin hasn't manually edited the slug.
    if (slugField.dataset.touched === 'true') return;
    slugField.value = slugify(document.getElementById('room-name').value);
}

function openRoomModal(id = null) {
    const alert = document.getElementById('room-alert');
    alert.style.display = 'none';
    const slugField = document.getElementById('room-slug');
    slugField.dataset.touched = id ? 'true' : 'false';
    slugField.oninput = () => { slugField.dataset.touched = 'true'; };

    if (id) {
        const r = allRooms.find(x => x.id === id);
        if (!r) return;
        document.getElementById('room-modal-title').textContent = 'Edit Room';
        document.getElementById('room-id').value = r.id;
        document.getElementById('room-name').value = r.name || '';
        document.getElementById('room-slug').value = r.slug || '';
        document.getElementById('room-desc').value = r.description || '';
        document.getElementById('room-order').value = r.order_index ?? 1;
    } else {
        const nextOrder = allRooms.length ? Math.max(...allRooms.map(r => r.order_index || 0)) + 1 : 1;
        document.getElementById('room-modal-title').textContent = 'Add Room';
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

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
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
        btn.disabled = false; btn.textContent = 'Save Room';
    }
}

async function deleteRoom(id, name) {
    const count = lessonCounts[id] || 0;
    let msg = `Delete the room "${name}"?`;
    if (count > 0) msg += `\n\nThis room has ${count} lesson(s). Deleting it will also remove those lessons and any recordings, materials and quizzes attached to them. This cannot be undone.`;
    if (!confirm(msg)) return;

    const { error } = await db.from('rooms').delete().eq('id', id);
    if (error) { alert(`Failed to delete room: ${error.message}`); return; }
    loadRooms();
}

// ── LESSONS ──
async function openLessons(roomId) {
    currentRoomId = roomId;
    const room = allRooms.find(r => r.id === roomId);
    document.getElementById('lessons-modal-title').textContent = `${room ? room.name : 'Room'} — Lessons`;
    document.getElementById('lessons-list').innerHTML = `<div class="loader">Loading lessons…</div>`;
    openModal('lessons-modal');
    await refreshLessons();
}

async function refreshLessons() {
    const { data, error } = await db
        .from('lessons')
        .select('id, title, description, image_url, order_index')
        .eq('room_id', currentRoomId)
        .order('order_index', { ascending: true });

    const list = document.getElementById('lessons-list');
    if (error) {
        list.innerHTML = `<div class="loader" style="color:var(--red)">Error: ${escapeHtml(error.message)}</div>`;
        return;
    }
    currentRoomLessons = data || [];
    renderLessonList();
}

function renderLessonList() {
    const list = document.getElementById('lessons-list');
    if (currentRoomLessons.length === 0) {
        list.innerHTML = `<div class="empty-state" style="padding:36px 24px;">
            <h3>No lessons yet</h3>
            <p>Click "Add Lesson" to create the first one.</p>
        </div>`;
        return;
    }

    list.innerHTML = `<div class="list-rows">${currentRoomLessons.map((l, i) => `
        <div class="list-row">
            <div class="lr-index">${i + 1}</div>
            <div class="lr-body">
                <div class="lr-title">${escapeHtml(l.title)}</div>
                ${l.description ? `<div class="lr-sub">${escapeHtml(l.description)}</div>` : ''}
            </div>
            <div class="lr-actions">
                <button class="btn btn-ghost btn-sm" onclick="moveLesson('${l.id}', -1)" ${i === 0 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move up">↑</button>
                <button class="btn btn-ghost btn-sm" onclick="moveLesson('${l.id}', 1)" ${i === currentRoomLessons.length - 1 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move down">↓</button>
                <button class="btn btn-ghost btn-sm" onclick="openLessonForm('${l.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteLesson('${l.id}')">Delete</button>
            </div>
        </div>
    `).join('')}</div>`;
}

function openLessonForm(id = null) {
    const alert = document.getElementById('lesson-alert');
    alert.style.display = 'none';
    if (id) {
        const l = currentRoomLessons.find(x => x.id === id);
        if (!l) return;
        document.getElementById('lesson-modal-title').textContent = 'Edit Lesson';
        document.getElementById('lesson-id').value = l.id;
        document.getElementById('lesson-title').value = l.title || '';
        document.getElementById('lesson-desc').value = l.description || '';
        document.getElementById('lesson-image').value = l.image_url || '';
    } else {
        document.getElementById('lesson-modal-title').textContent = 'Add Lesson';
        document.getElementById('lesson-id').value = '';
        document.getElementById('lesson-title').value = '';
        document.getElementById('lesson-desc').value = '';
        document.getElementById('lesson-image').value = '';
    }
    openModal('lesson-modal');
}

async function saveLesson(e) {
    e.preventDefault();
    const btn = document.getElementById('lesson-save-btn');
    const alert = document.getElementById('lesson-alert');
    alert.style.display = 'none';

    const id = document.getElementById('lesson-id').value;
    const title = document.getElementById('lesson-title').value.trim();
    if (!title) { showModalAlert(alert, 'Lesson title is required.', 'error'); return; }

    const payload = {
        title,
        description: document.getElementById('lesson-desc').value.trim() || null,
        image_url: document.getElementById('lesson-image').value.trim() || null
    };

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) {
            res = await db.from('lessons').update(payload).eq('id', id);
        } else {
            const nextOrder = currentRoomLessons.length
                ? Math.max(...currentRoomLessons.map(l => l.order_index || 0)) + 1 : 1;
            res = await db.from('lessons').insert({ ...payload, room_id: currentRoomId, order_index: nextOrder });
        }
        if (res.error) throw new Error(res.error.message);
        closeModal('lesson-modal');
        await refreshLessons();
        loadRooms(); // refresh lesson counts on the cards behind
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Lesson';
    }
}

async function deleteLesson(id) {
    const l = currentRoomLessons.find(x => x.id === id);
    if (!confirm(`Delete the lesson "${l ? l.title : ''}"? Any recordings, materials and quizzes attached to it will also be removed. This cannot be undone.`)) return;
    const { error } = await db.from('lessons').delete().eq('id', id);
    if (error) { alert(`Failed to delete lesson: ${error.message}`); return; }
    await refreshLessons();
    loadRooms();
}

// Swap order_index with the neighbouring lesson.
async function moveLesson(id, direction) {
    const idx = currentRoomLessons.findIndex(l => l.id === id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= currentRoomLessons.length) return;

    const a = currentRoomLessons[idx];
    const b = currentRoomLessons[target];

    // Swap their order_index values in the database.
    const [r1, r2] = await Promise.all([
        db.from('lessons').update({ order_index: b.order_index }).eq('id', a.id),
        db.from('lessons').update({ order_index: a.order_index }).eq('id', b.id)
    ]);
    if (r1.error || r2.error) {
        alert(`Failed to reorder: ${(r1.error || r2.error).message}`);
        return;
    }
    await refreshLessons();
}
