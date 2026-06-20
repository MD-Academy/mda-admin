// Personal Meetings (admin) — teacher creates a per-course meeting day with time slots.
// Admin can create / edit link / delete a meeting, and VIEW who booked each slot (read-only).
// Admin never books or changes a student's slot.

let CURRENT_UID = null;
let mtCourses = [];
let mtMeetings = [];          // [{id, course_id, meeting_date, start_time, end_time, slot_minutes, link}]
let mtBookings = {};          // meetingId -> { slotTime -> {student_id, student_name} }

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }
function fmtMtDate(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : ''; }
function hhmm(t) { return (t || '').slice(0, 5); }   // "14:00:00" -> "14:00"

// Generate slot start times that fully fit inside [start,end) in steps of `mins`.
function genSlots(start, end, mins) {
    const toMin = t => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + m; };
    const pad = n => String(n).padStart(2, '0');
    const fromMin = v => `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
    const s = toMin(start), e = toMin(end), out = [];
    for (let t = s; t + mins <= e; t += mins) out.push(fromMin(t));
    return out;
}
function slotLabel(start, mins) {
    const [h, m] = start.split(':').map(Number);
    const end = h * 60 + m + mins;
    const pad = n => String(n).padStart(2, '0');
    return `${start}–${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
}

// Allow any normal web link (Zoom/Meet/etc.) but block javascript:/data: injection.
function cleanLink(raw) {
    const v = (raw || '').trim();
    if (!v) return { ok: true, value: null };
    if (!/^https?:\/\//i.test(v)) return { ok: false, msg: 'Link must start with http:// or https://' };
    if (/[\s<>"']/.test(v)) return { ok: false, msg: 'Link contains invalid characters.' };
    return { ok: true, value: v };
}

async function loadCourses() {
    const { data } = await db.from('courses').select('id, name').order('created_at', { ascending: false });
    mtCourses = data || [];
    const sel = document.getElementById('m-course');
    if (sel) mtCourses.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); });
}

async function loadMeetings() {
    const container = document.getElementById('meetings-container');
    container.innerHTML = `<div class="loader">Loading meetings…</div>`;
    const { data, error } = await db.from('meetings')
        .select('id, course_id, meeting_date, start_time, end_time, slot_minutes, link')
        .order('meeting_date', { ascending: false });
    if (error) { container.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load meetings</h3><p>${escapeHtml(error.message)}</p></div>`; return; }
    mtMeetings = data || [];

    mtBookings = {};
    if (mtMeetings.length) {
        const ids = mtMeetings.map(m => m.id);
        const { data: bk } = await db.from('meeting_bookings').select('meeting_id, slot_time, student_id, student_name').in('meeting_id', ids);
        (bk || []).forEach(b => {
            if (!mtBookings[b.meeting_id]) mtBookings[b.meeting_id] = {};
            mtBookings[b.meeting_id][b.slot_time] = { student_id: b.student_id, student_name: b.student_name };
        });
    }
    renderMeetings();
}

function courseName(id) { const c = mtCourses.find(x => x.id === id); return c ? c.name : 'Course'; }

function renderMeetings() {
    const container = document.getElementById('meetings-container');
    if (mtMeetings.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No meetings yet</h3><p>Click <strong>Create Meeting</strong> to set a date, time window and slot length for a course.</p></div>`;
        return;
    }
    container.innerHTML = mtMeetings.map(m => {
        const slots = genSlots(m.start_time, m.end_time, m.slot_minutes);
        const booked = mtBookings[m.id] || {};
        const bookedCount = slots.filter(s => booked[s]).length;
        const grid = slots.map(s => {
            const b = booked[s];
            return `<div class="slot ${b ? '' : 'slot-open'}">
                <div class="slot-t">${slotLabel(s, m.slot_minutes)}</div>
                <div class="slot-n">${b ? escapeHtml(b.student_name || 'Booked') : 'Open'}</div>
            </div>`;
        }).join('');
        return `
            <div class="panel" style="padding:22px;margin-bottom:18px;">
                <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
                    <div>
                        <div class="section-title" style="margin-bottom:4px;">${escapeHtml(courseName(m.course_id))} · ${fmtMtDate(m.meeting_date)}</div>
                        <p class="hint" style="margin:0;">${hhmm(m.start_time)}–${hhmm(m.end_time)} · ${m.slot_minutes}-min slots · ${bookedCount}/${slots.length} booked</p>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn btn-ghost btn-sm" onclick="openEditModal('${m.id}')">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteMeeting('${m.id}')">Delete</button>
                    </div>
                </div>
                <div class="form-field" style="margin-top:16px;">
                    <label>Meeting link (Zoom, Google Meet, etc.) — students see this</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <input type="text" id="link-${m.id}" value="${escapeHtml(m.link || '')}" placeholder="https://…" style="flex:1;min-width:220px;">
                        <button class="btn btn-primary btn-sm" onclick="saveLink('${m.id}')">Save link</button>
                    </div>
                </div>
                <p class="hint" style="margin:16px 0 0;">Students booked these — view only; you can't change a student's slot here.</p>
                <div class="slot-grid">${grid}</div>
            </div>`;
    }).join('');
}

// ── CREATE / EDIT MEETING ──
function todayIso() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}

function openCreateModal() {
    document.getElementById('m-alert').style.display = 'none';
    document.getElementById('m-id').value = '';
    document.getElementById('m-modal-title').textContent = 'Create Meeting';
    document.getElementById('m-save-btn').textContent = 'Create Meeting';
    document.getElementById('m-course').value = '';
    const iso = todayIso();
    const d = document.getElementById('m-date'); d.value = iso; d.min = iso;
    document.getElementById('m-start').value = '09:00';
    document.getElementById('m-end').value = '22:00';
    document.getElementById('m-slot').value = '15';
    document.getElementById('m-link').value = '';
    openModal('create-modal');
}

function openEditModal(meetingId) {
    const m = mtMeetings.find(x => x.id === meetingId);
    if (!m) return;
    document.getElementById('m-alert').style.display = 'none';
    document.getElementById('m-id').value = m.id;
    document.getElementById('m-modal-title').textContent = 'Edit Meeting';
    document.getElementById('m-save-btn').textContent = 'Save Changes';
    document.getElementById('m-course').value = m.course_id;
    const d = document.getElementById('m-date');
    // Don't constrain the date on edit (the existing date may already be in the past).
    d.min = ''; d.value = m.meeting_date;
    document.getElementById('m-start').value = hhmm(m.start_time);
    document.getElementById('m-end').value = hhmm(m.end_time);
    document.getElementById('m-slot').value = String(m.slot_minutes);
    document.getElementById('m-link').value = m.link || '';
    openModal('create-modal');
}

async function submitMeeting(ev) {
    ev.preventDefault();
    const alert = document.getElementById('m-alert'); alert.style.display = 'none';
    const id = document.getElementById('m-id').value;
    const course_id = document.getElementById('m-course').value;
    const meeting_date = document.getElementById('m-date').value;
    const start_time = document.getElementById('m-start').value;
    const end_time = document.getElementById('m-end').value;
    const slot_minutes = parseInt(document.getElementById('m-slot').value, 10);
    const lk = cleanLink(document.getElementById('m-link').value);

    if (!course_id) { showModalAlert(alert, 'Choose a course for this meeting.', 'error'); return; }
    if (!meeting_date) { showModalAlert(alert, 'Pick a date.', 'error'); return; }
    if (!start_time || !end_time || start_time >= end_time) { showModalAlert(alert, 'End time must be after start time.', 'error'); return; }
    const newSlots = genSlots(start_time, end_time, slot_minutes);
    if (newSlots.length === 0) { showModalAlert(alert, 'That window is too short for even one slot.', 'error'); return; }
    if (!lk.ok) { showModalAlert(alert, lk.msg, 'error'); return; }

    const payload = { course_id, meeting_date, start_time, end_time, slot_minutes, link: lk.value };

    // ── EDIT: warn if the new window would drop existing student bookings ──
    if (id) {
        const booked = mtBookings[id] || {};
        const newSet = new Set(newSlots);
        const dropped = Object.keys(booked).filter(s => !newSet.has(s));
        if (dropped.length) {
            dropped.sort();
            const who = dropped.map(s => `• ${slotLabel(s, slot_minutes)} — ${booked[s].student_name || 'a student'}`).join('\n');
            const ok = await confirmDialog({
                title: 'Some bookings will be removed',
                message: `The new time window / slot length no longer includes ${dropped.length} slot${dropped.length === 1 ? '' : 's'} a student has already booked:\n\n${who}\n\nThose booking(s) will be permanently removed and the student(s) will need to rebook. Continue?`,
                confirmText: 'Save & remove bookings',
                danger: true
            });
            if (!ok) return;
        }

        const btn = document.getElementById('m-save-btn'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
            if (dropped.length) {
                const del = await db.from('meeting_bookings').delete().eq('meeting_id', id).in('slot_time', dropped);
                if (del.error) throw new Error(del.error.message);
            }
            const { error } = await db.from('meetings').update(payload).eq('id', id);
            if (error) throw new Error(error.message);
            closeModal('create-modal');
            loadMeetings();
        } catch (err) {
            showModalAlert(alert, err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Save Changes';
        }
        return;
    }

    // ── CREATE ──
    const btn = document.getElementById('m-save-btn'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
        const { error } = await db.from('meetings').insert({ ...payload, created_by: CURRENT_UID });
        if (error) throw new Error(error.message);
        closeModal('create-modal');
        loadMeetings();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Create Meeting';
    }
}

async function saveLink(meetingId) {
    const input = document.getElementById(`link-${meetingId}`);
    const lk = cleanLink(input.value);
    if (!lk.ok) { alert(lk.msg); return; }
    const { error } = await db.from('meetings').update({ link: lk.value }).eq('id', meetingId);
    if (error) { alert(`Couldn't save the link: ${error.message}`); return; }
    const m = mtMeetings.find(x => x.id === meetingId); if (m) m.link = lk.value;
    input.style.borderColor = '#15803d';
    setTimeout(() => { input.style.borderColor = ''; }, 1200);
}

async function deleteMeeting(meetingId) {
    const m = mtMeetings.find(x => x.id === meetingId);
    const bookedCount = Object.keys(mtBookings[meetingId] || {}).length;
    const bookedNote = bookedCount
        ? ` This includes ${bookedCount} student booking${bookedCount === 1 ? '' : 's'}.`
        : '';
    const ok = await confirmDialog({
        title: 'Delete this meeting?',
        message: `This permanently removes the meeting for ${courseName(m && m.course_id)} on ${fmtMtDate(m && m.meeting_date)} and ALL its student bookings.${bookedNote} This cannot be undone.`,
        confirmText: 'Delete meeting',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('meetings').delete().eq('id', meetingId);
    if (error) {
        await confirmDialog({ title: 'Could not delete', message: `Something went wrong: ${error.message}`, confirmText: 'OK', cancelText: 'Close' });
        return;
    }
    loadMeetings();
}
