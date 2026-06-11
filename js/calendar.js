// Calendar — class schedule entries across all subjects.

let allEntries = [];
let calRooms = [];

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
    return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
function roomName(id) {
    if (!id) return '<span class="badge badge-blue">General</span>';
    const r = calRooms.find(x => x.id === id);
    return r ? escapeHtml(r.name) : '<span class="badge badge-blue">General</span>';
}
function todayISO() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
}

// ── LOAD ──
async function loadEntries() {
    const tbody = document.getElementById('entry-tbody');
    tbody.innerHTML = `<tr><td colspan="5" class="loader">Loading schedule…</td></tr>`;

    const [eRes, roomsRes] = await Promise.all([
        db.from('schedule_entries').select('id, room_id, entry_date, topic, details').order('entry_date', { ascending: true }),
        db.from('rooms').select('id, name').order('order_index', { ascending: true })
    ]);

    if (eRes.error) {
        tbody.innerHTML = `<tr><td colspan="5" class="loader" style="color:var(--red)">Error loading schedule: ${escapeHtml(eRes.error.message)}</td></tr>`;
        return;
    }

    allEntries = eRes.data || [];
    calRooms = roomsRes.data || [];

    const filter = document.getElementById('room-filter');
    if (filter && filter.options.length <= 2) {
        calRooms.forEach(r => {
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
    const when = document.getElementById('when-filter')?.value || 'upcoming';
    const today = todayISO();

    let list = allEntries;
    if (roomId === '__none__') list = list.filter(e => !e.room_id);
    else if (roomId) list = list.filter(e => e.room_id === roomId);
    if (when === 'upcoming') list = list.filter(e => e.entry_date >= today);
    else if (when === 'past') list = list.filter(e => e.entry_date < today);
    if (q) list = list.filter(e => (e.topic || '').toLowerCase().includes(q));

    renderEntries(list);
}

function renderEntries(list) {
    const tbody = document.getElementById('entry-tbody');
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="loader">No schedule entries found. Click "Add Entry" to create one.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(e => `
        <tr>
            <td><strong>${formatDate(e.entry_date)}</strong></td>
            <td>${roomName(e.room_id)}</td>
            <td>${escapeHtml(e.topic)}</td>
            <td>${e.details ? escapeHtml(e.details) : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td class="row-actions">
                <button class="btn btn-ghost btn-sm" onclick="openEntryModal('${e.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEntry('${e.id}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

// ── ROOM SELECT ──
function fillRoomSelect(selectedRoomId = '') {
    const sel = document.getElementById('entry-room');
    sel.innerHTML = `<option value="" ${selectedRoomId ? '' : 'selected'}>— General (all students) —</option>` +
        calRooms.map(r => `<option value="${r.id}" ${r.id === selectedRoomId ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
}

// ── CREATE / EDIT ──
function openEntryModal(id = null) {
    const alert = document.getElementById('entry-alert');
    alert.style.display = 'none';

    if (id) {
        const e = allEntries.find(x => x.id === id);
        if (!e) return;
        document.getElementById('entry-modal-title').textContent = 'Edit Schedule Entry';
        document.getElementById('entry-id').value = e.id;
        fillRoomSelect(e.room_id);
        document.getElementById('entry-date').value = e.entry_date || '';
        document.getElementById('entry-topic').value = e.topic || '';
        document.getElementById('entry-details').value = e.details || '';
    } else {
        document.getElementById('entry-modal-title').textContent = 'Add Schedule Entry';
        document.getElementById('entry-id').value = '';
        fillRoomSelect('');
        document.getElementById('entry-date').value = '';
        document.getElementById('entry-topic').value = '';
        document.getElementById('entry-details').value = '';
    }
    openModal('entry-modal');
}

async function saveEntry(e) {
    e.preventDefault();
    const btn = document.getElementById('entry-save-btn');
    const alert = document.getElementById('entry-alert');
    alert.style.display = 'none';

    const id = document.getElementById('entry-id').value;
    const payload = {
        room_id: document.getElementById('entry-room').value || null,
        entry_date: document.getElementById('entry-date').value,
        topic: document.getElementById('entry-topic').value.trim(),
        details: document.getElementById('entry-details').value.trim() || null
    };

    if (!payload.entry_date || !payload.topic) { showModalAlert(alert, 'Date and topic are required.', 'error'); return; }
    if (!ensureSafe(alert, [['Topic', payload.topic], ['Details', payload.details]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) {
            res = await db.from('schedule_entries').update(payload).eq('id', id);
        } else {
            res = await db.from('schedule_entries').insert(payload);
        }
        if (res.error) throw new Error(res.error.message);
        closeModal('entry-modal');
        loadEntries();
        // Email subscribed students (new entries only). Mail failure must not affect the save.
        if (!id) {
            apiRequest('POST', '/admin/notify/schedule', {
                topic: payload.topic,
                entry_date: payload.entry_date,
                subject_name: payload.room_id ? roomName(payload.room_id) : null,
                details: payload.details
            })
                .then(r => console.log(`[calendar] notified ${r.sent}/${r.recipients} subscribers`))
                .catch(err => console.error('[calendar] notify failed:', err));
        }
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Entry';
    }
}

async function deleteEntry(id) {
    const e = allEntries.find(x => x.id === id);
    const ok = await confirmDialog({
        title: 'Delete entry?',
        message: `The schedule entry "${e ? e.topic : ''}" will be removed. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('schedule_entries').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    loadEntries();
}
