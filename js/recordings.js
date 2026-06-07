// Zoom Recordings management.

let allRecordings = [];
let recRooms = [];     // [{id, name}]
let recLessons = [];   // [{id, room_id, title}]

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
function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDuration(seconds) {
    if (!seconds) return '—';
    const m = Math.round(seconds / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
}
function roomName(id) {
    const r = recRooms.find(x => x.id === id);
    return r ? r.name : '—';
}

// ── LOAD ──
async function loadRecordings() {
    const tbody = document.getElementById('rec-tbody');
    tbody.innerHTML = `<tr><td colspan="6" class="loader">Loading recordings…</td></tr>`;

    const [recRes, roomsRes, lessonsRes] = await Promise.all([
        db.from('recordings').select('id, room_id, lesson_id, title, professor, recorded_date, aws_url, duration_seconds').order('recorded_date', { ascending: false }),
        db.from('rooms').select('id, name').order('order_index', { ascending: true }),
        db.from('lessons').select('id, room_id, title').order('order_index', { ascending: true })
    ]);

    if (recRes.error) {
        tbody.innerHTML = `<tr><td colspan="6" class="loader" style="color:var(--red)">Error loading recordings: ${escapeHtml(recRes.error.message)}</td></tr>`;
        return;
    }

    allRecordings = recRes.data || [];
    recRooms = roomsRes.data || [];
    recLessons = lessonsRes.data || [];

    // Populate the room filter dropdown (once).
    const filter = document.getElementById('room-filter');
    if (filter && filter.options.length <= 1) {
        recRooms.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id; opt.textContent = r.name;
            filter.appendChild(opt);
        });
    }

    applyFilters();
}

function applyFilters() {
    const q = (document.getElementById('search-input')?.value || '').toLowerCase();
    const roomId = document.getElementById('room-filter')?.value || '';
    let list = allRecordings;
    if (roomId) list = list.filter(r => r.room_id === roomId);
    if (q) list = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.professor || '').toLowerCase().includes(q)
    );
    renderRecordings(list);
}

function renderRecordings(list) {
    const tbody = document.getElementById('rec-tbody');
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="loader">No recordings found. Click "Add Recording" to create one.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.title)}</strong></td>
            <td>${escapeHtml(roomName(r.room_id))}</td>
            <td>${escapeHtml(r.professor)}</td>
            <td>${formatDate(r.recorded_date)}</td>
            <td>${formatDuration(r.duration_seconds)}</td>
            <td class="row-actions">
                <a class="btn btn-ghost btn-sm" href="${escapeHtml(r.aws_url)}" target="_blank" rel="noopener">Preview</a>
                <button class="btn btn-ghost btn-sm" onclick="openRecModal('${r.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteRecording('${r.id}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

// ── ROOM/LESSON SELECTS IN MODAL ──
function fillRoomSelect(selectedRoomId = '') {
    const sel = document.getElementById('rec-room');
    sel.innerHTML = `<option value="" disabled ${selectedRoomId ? '' : 'selected'}>Select a room…</option>` +
        recRooms.map(r => `<option value="${r.id}" ${r.id === selectedRoomId ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
}

function fillLessonSelect(roomId, selectedLessonId = '') {
    const sel = document.getElementById('rec-lesson');
    const lessons = recLessons.filter(l => l.room_id === roomId);
    sel.innerHTML = `<option value="">— None —</option>` +
        lessons.map(l => `<option value="${l.id}" ${l.id === selectedLessonId ? 'selected' : ''}>${escapeHtml(l.title)}</option>`).join('');
}

function onRoomChange() {
    const roomId = document.getElementById('rec-room').value;
    fillLessonSelect(roomId);
}

// ── CREATE / EDIT ──
function openRecModal(id = null) {
    const alert = document.getElementById('rec-alert');
    alert.style.display = 'none';

    if (id) {
        const r = allRecordings.find(x => x.id === id);
        if (!r) return;
        document.getElementById('rec-modal-title').textContent = 'Edit Recording';
        document.getElementById('rec-id').value = r.id;
        document.getElementById('rec-title').value = r.title || '';
        fillRoomSelect(r.room_id);
        fillLessonSelect(r.room_id, r.lesson_id || '');
        document.getElementById('rec-professor').value = r.professor || '';
        document.getElementById('rec-date').value = r.recorded_date || '';
        document.getElementById('rec-url').value = r.aws_url || '';
        document.getElementById('rec-duration').value = r.duration_seconds ? Math.round(r.duration_seconds / 60) : '';
    } else {
        document.getElementById('rec-modal-title').textContent = 'Add Recording';
        document.getElementById('rec-id').value = '';
        document.getElementById('rec-title').value = '';
        fillRoomSelect('');
        fillLessonSelect('');
        document.getElementById('rec-professor').value = '';
        document.getElementById('rec-date').value = '';
        document.getElementById('rec-url').value = '';
        document.getElementById('rec-duration').value = '';
    }
    openModal('rec-modal');
}

async function saveRecording(e) {
    e.preventDefault();
    const btn = document.getElementById('rec-save-btn');
    const alert = document.getElementById('rec-alert');
    alert.style.display = 'none';

    const id = document.getElementById('rec-id').value;
    const room_id = document.getElementById('rec-room').value;
    const lesson_id = document.getElementById('rec-lesson').value || null;
    const durationMin = document.getElementById('rec-duration').value;

    if (!room_id) { showModalAlert(alert, 'Please select a room.', 'error'); return; }

    const payload = {
        title: document.getElementById('rec-title').value.trim(),
        room_id,
        lesson_id,
        professor: document.getElementById('rec-professor').value.trim(),
        recorded_date: document.getElementById('rec-date').value,
        aws_url: document.getElementById('rec-url').value.trim(),
        duration_seconds: durationMin ? parseInt(durationMin, 10) * 60 : null
    };

    if (!payload.title || !payload.professor || !payload.recorded_date || !payload.aws_url) {
        showModalAlert(alert, 'Please fill in all required fields.', 'error');
        return;
    }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) {
            res = await db.from('recordings').update(payload).eq('id', id);
        } else {
            res = await db.from('recordings').insert(payload);
        }
        if (res.error) throw new Error(res.error.message);
        closeModal('rec-modal');
        loadRecordings();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Recording';
    }
}

async function deleteRecording(id) {
    const r = allRecordings.find(x => x.id === id);
    if (!confirm(`Delete the recording "${r ? r.title : ''}"? This cannot be undone.`)) return;
    const { error } = await db.from('recordings').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    loadRecordings();
}
