// Teacher feedback for one student — a running, dated log.
// Not tied to an exam, a quiz or an oral presentation: a teacher writes
// whenever they notice something worth telling the student.

let SF_STUDENT = null;      // {id, full_name, email}
let SF_NOTES = [];          // the CURRENT page only, newest first
let SF_COURSES = [];        // courses this student is enrolled in (optional tagging)
let SF_EDITING = null;      // note id being corrected
let SF_UID = null, SF_NAME = '', SF_SUPER = false;
let SF_PAGE = 1, SF_PAGE_SIZE = 25, SF_TOTAL = 0;   // only one page is ever fetched
let SF_REPLIES = {};        // note_id -> [replies], both sides

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function fmtStamp(iso) {
    return iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

async function initStudentFeedback(studentId, profile) {
    SF_UID = profile.id || null;
    SF_NAME = profile.full_name || 'Staff';
    SF_SUPER = profile.role === 'superadmin';

    const { data: p } = await db.from('profiles').select('id, full_name, email').eq('id', studentId).single();
    SF_STUDENT = p || { id: studentId, full_name: 'Student', email: '' };
    renderLayout('students', 'Teacher Feedback', SF_STUDENT.full_name || 'Student', profile);

    // Courses the student is on — lets a note optionally be tagged to one.
    const { data: enr } = await db.from('course_enrollments').select('course_id').eq('student_id', studentId);
    const ids = [...new Set((enr || []).map(r => r.course_id))];
    if (ids.length) {
        const { data: cs } = await db.from('courses').select('id, name').in('id', ids).order('name');
        SF_COURSES = cs || [];
    }

    document.getElementById('page-content').innerHTML = `
        <a class="back-link no-print" href="students.html">← Back to Students</a>

        <div class="panel no-print" style="padding:20px;margin-bottom:22px;">
            <div class="alert" id="sf-alert" style="display:none;"></div>
            <h3 style="margin:0 0 4px;font-size:17px;color:var(--navy-800);" id="sf-composer-title">Write feedback</h3>
            <p class="hint" style="margin:0 0 14px;">
                For anything you want the student to know — a weakness you noticed in class, advice on how to study, encouragement.
                It doesn't need an exam or a test behind it. The date and time are recorded automatically and the entry stays on record.
                The student is <strong>emailed the feedback straight away</strong> and sees it in their portal.
            </p>
            <form onsubmit="saveFeedbackNote(event)">
                <div class="form-field">
                    <textarea id="sf-body" rows="5" placeholder="e.g. I noticed in today's class that you're hesitating on the mechanics problems — you're reaching for the formula before setting the problem up. Try the exercises at the end of chapter 3 this week and bring your attempts to the next class, we'll go through them together."></textarea>
                </div>
                <div class="form-row" style="align-items:flex-end;">
                    <div class="form-field" style="margin-bottom:0;">
                        <label>About <span style="color:var(--text-muted);font-weight:400;">(optional)</span></label>
                        <select id="sf-course">
                            <option value="">General — not about one course</option>
                            ${SF_COURSES.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
                        </select>
                        <div class="hint">Tagging a course also shows the note on that course page, beside the student's grades.</div>
                    </div>
                    <div class="form-field" style="margin-bottom:0;">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:500;">
                            <input type="checkbox" id="sf-visible" checked style="width:16px;height:16px;">
                            Send to the student
                        </label>
                        <div class="hint">Untick to keep it an internal note — no email, no alert, the student never sees it.</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:16px;">
                    <button type="submit" class="btn btn-primary" id="sf-save-btn">Save feedback</button>
                    <button type="button" class="btn btn-ghost" id="sf-cancel-btn" onclick="cancelFeedbackEdit()" style="display:none;">Cancel edit</button>
                </div>
            </form>
        </div>

        <div id="sf-report">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                <div>
                    <div style="font-size:12px;font-weight:700;letter-spacing:.4px;color:var(--crimson);text-transform:uppercase;">Medical Doctor Academy — Feedback Record</div>
                    <h2 style="margin:4px 0 2px;font-size:21px;color:var(--navy-800);">${escapeHtml(SF_STUDENT.full_name || 'Student')}</h2>
                    <p style="margin:0;font-size:13px;color:var(--text-muted);" id="sf-count"></p>
                </div>
                <div style="display:flex;gap:8px;align-items:center;" class="no-print">
                    <select id="sf-page-size" class="filter-select" onchange="onSfPageSize()">
                        <option value="25">25 / page</option>
                        <option value="50">50 / page</option>
                        <option value="100">100 / page</option>
                    </select>
                    <button class="btn btn-ghost" onclick="window.print()">🖨 Print / Save as PDF</button>
                </div>
            </div>
            <div id="sf-list"><div class="loader">Loading feedback…</div></div>
            <div id="sf-pager" class="no-print" style="display:none;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;flex-wrap:wrap;">
                <div id="sf-pager-info" style="font-size:13px;color:var(--text-muted);"></div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button class="btn btn-ghost btn-sm" id="sf-prev" onclick="changeSfPage(-1)">← Newer</button>
                    <span id="sf-page-label" style="font-size:13px;color:var(--text);"></span>
                    <button class="btn btn-ghost btn-sm" id="sf-next" onclick="changeSfPage(1)">Older →</button>
                </div>
            </div>
        </div>`;

    await loadFeedbackNotes();
}

// Fetches ONE page. The record can grow for years, so we never pull it all.
async function loadFeedbackNotes() {
    const from = (SF_PAGE - 1) * SF_PAGE_SIZE, to = from + SF_PAGE_SIZE - 1;
    const { data, count, error } = await db.from('student_notes')
        .select('id, body, course_id, visible_to_student, author_id, author_name, created_at, edited_at, emailed_at',
                { count: 'exact' })
        .eq('student_id', SF_STUDENT.id)
        .order('created_at', { ascending: false })
        .range(from, to);
    if (error) {
        document.getElementById('sf-list').innerHTML =
            `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load the feedback</h3><p>${escapeHtml(error.message)}</p></div>`;
        return;
    }
    SF_NOTES = data || [];
    SF_TOTAL = count || 0;
    // Deleting the last entry on a page leaves it empty — step back a page.
    if (SF_NOTES.length === 0 && SF_PAGE > 1) { SF_PAGE--; return loadFeedbackNotes(); }

    // Reply threads for the notes on this page (both sides of the conversation).
    SF_REPLIES = {};
    const noteIds = SF_NOTES.map(n => n.id);
    if (noteIds.length) {
        const { data: reps } = await db.from('student_note_replies')
            .select('id, note_id, author_role, author_name, body, created_at, read_by_staff')
            .in('note_id', noteIds).order('created_at', { ascending: true });
        (reps || []).forEach(r => { (SF_REPLIES[r.note_id] = SF_REPLIES[r.note_id] || []).push(r); });
        // Mark any unread student replies now on screen as seen by staff.
        markStudentRepliesRead(reps || []);
    }

    renderFeedbackNotes();
    renderSfPager();
}

function renderSfPager() {
    const pager = document.getElementById('sf-pager');
    if (!pager) return;
    const totalPages = Math.max(1, Math.ceil(SF_TOTAL / SF_PAGE_SIZE));
    if (SF_TOTAL === 0) { pager.style.display = 'none'; return; }
    pager.style.display = 'flex';
    const start = (SF_PAGE - 1) * SF_PAGE_SIZE + 1, end = Math.min(SF_PAGE * SF_PAGE_SIZE, SF_TOTAL);
    document.getElementById('sf-pager-info').textContent = `Showing ${start}–${end} of ${SF_TOTAL} entries — newest first`;
    document.getElementById('sf-page-label').textContent = `Page ${SF_PAGE} of ${totalPages}`;
    const prev = document.getElementById('sf-prev'), next = document.getElementById('sf-next');
    prev.disabled = SF_PAGE <= 1; next.disabled = SF_PAGE >= totalPages;
    prev.style.opacity = prev.disabled ? '.4' : '1';
    next.style.opacity = next.disabled ? '.4' : '1';
}

function onSfPageSize() {
    SF_PAGE_SIZE = parseInt(document.getElementById('sf-page-size').value, 10) || 25;
    SF_PAGE = 1;
    loadFeedbackNotes();
}

function changeSfPage(delta) {
    const totalPages = Math.max(1, Math.ceil(SF_TOTAL / SF_PAGE_SIZE));
    const n = SF_PAGE + delta;
    if (n < 1 || n > totalPages) return;
    SF_PAGE = n;
    loadFeedbackNotes();
    document.getElementById('sf-report').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFeedbackNotes() {
    const el = document.getElementById('sf-list');
    const shown = SF_TOTAL > SF_PAGE_SIZE ? ` · showing ${SF_NOTES.length} of them` : '';
    document.getElementById('sf-count').textContent =
        `${SF_STUDENT.email || ''} · ${SF_TOTAL} entr${SF_TOTAL === 1 ? 'y' : 'ies'} on record${shown} · generated ${fmtStamp(new Date().toISOString())}`;

    if (!SF_NOTES.length) {
        el.innerHTML = `<div class="empty-state"><h3>No feedback yet</h3><p>Nothing has been written for this student. Use the box above — the first entry appears here, stamped with the date and time.</p></div>`;
        return;
    }

    const courseName = id => (SF_COURSES.find(c => c.id === id) || {}).name || 'a course';
    el.innerHTML = `<div class="list-rows">` + SF_NOTES.map(n => {
        const canEdit = n.author_id === SF_UID || SF_SUPER;
        const badge = n.visible_to_student
            ? `<span style="font-size:11px;font-weight:700;color:var(--green);">Sent to the student${n.emailed_at ? ` · emailed ${escapeHtml(fmtStamp(n.emailed_at))}` : ' · not emailed'}</span>`
            : `<span style="font-size:11px;font-weight:700;color:#b45309;">Internal — the student can't see this</span>`;
        const tag = n.course_id
            ? `<span style="font-size:11px;font-weight:600;color:var(--text-muted);">· about ${escapeHtml(courseName(n.course_id))}</span>` : '';
        const edited = n.edited_at ? ` · <em style="color:var(--text-muted);">corrected ${escapeHtml(fmtStamp(n.edited_at))}</em>` : '';
        const actions = [
            canEdit ? `<button class="btn btn-ghost btn-sm" onclick="startFeedbackEdit('${n.id}')">Edit</button>` : '',
            SF_SUPER ? `<button class="btn btn-danger btn-sm" onclick="deleteFeedbackNote('${n.id}')">Delete</button>` : ''
        ].filter(Boolean).join('');
        return `<div class="list-row" style="align-items:flex-start;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;gap:10px;width:100%;flex-wrap:wrap;align-items:baseline;">
                <div style="font-size:12px;color:var(--text-muted);">
                    <strong style="color:var(--navy-800);">${escapeHtml(fmtStamp(n.created_at))}</strong>
                    · ${escapeHtml(n.author_name || 'Staff')} ${tag}${edited}
                </div>
                ${badge}
            </div>
            <div style="font-size:14px;line-height:1.65;color:var(--text);white-space:pre-wrap;">${escapeHtml(n.body)}</div>
            ${actions ? `<div class="no-print" style="display:flex;gap:8px;">${actions}</div>` : ''}
            ${threadHtml(n)}
        </div>`;
    }).join('') + `</div>
    <p style="margin-top:14px;font-size:12px;color:var(--text-muted);line-height:1.6;">Feedback written by teaching staff for this student. Each entry keeps the date and time it was written; corrections are marked as such. Entries sent to the student appear in their portal and raise a notification.${SF_TOTAL > SF_PAGE_SIZE ? ` <span class="no-print">Printing produces the entries shown on this page — switch to 100 / page first if you need more of the record in one document.</span>` : ''}</p>`;
}

// The conversation under one feedback entry + a staff reply box.
// Only shared entries can have a conversation (internal notes never reach the student).
function threadHtml(n) {
    const replies = SF_REPLIES[n.id] || [];
    const unread = replies.filter(r => r.author_role === 'student' && !r.read_by_staff).length;

    const bubbles = replies.map(r => {
        const staff = r.author_role === 'staff';
        return `<div style="margin-top:9px;padding:10px 12px;border-radius:10px;
                background:${staff ? '#fdf0f6' : '#eef4ff'};
                border:1px solid ${staff ? '#f4d3e4' : '#d6e4ff'};
                ${staff ? 'margin-right:22px;' : 'margin-left:22px;'}">
            <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:3px;">
                <strong style="color:var(--navy-800);">${staff ? escapeHtml(r.author_name || 'Staff') : escapeHtml(r.author_name || 'Student') + ' (student)'}</strong>
                · ${escapeHtml(fmtStamp(r.created_at))}
            </div>
            <div style="font-size:13.5px;line-height:1.6;color:var(--text);white-space:pre-wrap;">${escapeHtml(r.body)}</div>
        </div>`;
    }).join('');

    // No reply box on internal notes — the student can't see or answer those.
    const box = n.visible_to_student ? `
        <div class="no-print" style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
            <textarea id="sf-reply-${n.id}" rows="2" placeholder="Reply to the student…"
                style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:10px;font-family:inherit;font-size:13.5px;resize:vertical;"></textarea>
            <div style="display:flex;align-items:center;gap:10px;">
                <button class="btn btn-primary btn-sm" onclick="sendStaffReply('${n.id}', this)">Send reply</button>
                <span id="sf-reply-msg-${n.id}" style="font-size:12px;"></span>
            </div>
        </div>` : '';

    if (!replies.length && !n.visible_to_student) return '';

    const header = replies.length
        ? `<div style="font-size:11px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--text-muted);margin-top:6px;">
             Conversation${unread ? ` <span style="color:var(--crimson);">· ${unread} new from the student</span>` : ''}
           </div>`
        : '';

    return `<div style="width:100%;border-top:1px dashed var(--border);margin-top:6px;padding-top:8px;">${header}${bubbles}${box}</div>`;
}

async function sendStaffReply(noteId, btn) {
    const ta = document.getElementById('sf-reply-' + noteId);
    const msg = document.getElementById('sf-reply-msg-' + noteId);
    const text = (ta.value || '').trim();
    msg.textContent = '';
    if (!text) { msg.style.color = 'var(--red)'; msg.textContent = 'Write your reply first.'; return; }
    if (!ensureSafe(null, [['Reply', text]])) { msg.style.color = 'var(--red)'; msg.textContent = 'Scripts or code are not allowed in a reply.'; return; }
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Sending…';
    try {
        const ins = await db.from('student_note_replies').insert({
            note_id: noteId, author_role: 'staff', author_id: SF_UID,
            author_name: SF_NAME, body: text
        }).select('id, note_id, author_role, author_name, body, created_at, read_by_staff').single();
        if (ins.error) throw new Error(ins.error.message);
        (SF_REPLIES[noteId] = SF_REPLIES[noteId] || []).push(ins.data);

        // Email the student (best-effort; the reply is already saved).
        let emailed = false;
        try {
            const r = await apiRequest('POST', '/admin/notify/feedback-reply', { reply_id: ins.data.id });
            emailed = !!(r && r.emailed);
        } catch (e) { /* saved anyway */ }

        ta.value = '';
        renderFeedbackNotes();
        const m2 = document.getElementById('sf-reply-msg-' + noteId);
        if (m2) { m2.style.color = 'var(--green)'; m2.textContent = emailed ? 'Sent — the student was emailed ✓' : 'Sent ✓'; setTimeout(() => { m2.textContent = ''; }, 4000); }
    } catch (err) {
        msg.style.color = 'var(--red)'; msg.textContent = err.message || 'Could not send.';
        btn.disabled = false; btn.textContent = label;
    }
}

// Once staff have seen student replies on screen, stop them counting as new.
async function markStudentRepliesRead(reps) {
    const studentReplyIds = reps.filter(r => r.author_role === 'student').map(r => r.id);
    const unread = reps.filter(r => r.author_role === 'student' && !r.read_by_staff).map(r => r.id);

    // Clear this admin's bell for every student reply now on screen (per-admin read).
    if (studentReplyIds.length && typeof _writeAdminReads === 'function') {
        _writeAdminReads(studentReplyIds);
        if (typeof _adminNotifs !== 'undefined') {
            const seen = new Set(studentReplyIds);
            _adminNotifs = _adminNotifs.filter(n => !seen.has(n.id));
            if (typeof _renderAdminBell === 'function') _renderAdminBell();
        }
    }

    if (!unread.length) return;
    try { await db.from('student_note_replies').update({ read_by_staff: true }).in('id', unread); } catch (e) { /* non-critical */ }
    unread.forEach(id => {
        for (const arr of Object.values(SF_REPLIES)) { const r = arr.find(x => x.id === id); if (r) r.read_by_staff = true; }
    });
}

function startFeedbackEdit(id) {
    const n = SF_NOTES.find(x => x.id === id);
    if (!n) return;
    SF_EDITING = id;
    document.getElementById('sf-body').value = n.body || '';
    document.getElementById('sf-course').value = n.course_id || '';
    document.getElementById('sf-visible').checked = !!n.visible_to_student;
    document.getElementById('sf-composer-title').textContent = `Correcting the entry of ${fmtStamp(n.created_at)}`;
    document.getElementById('sf-save-btn').textContent = 'Save correction';
    document.getElementById('sf-cancel-btn').style.display = 'inline-flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('sf-body').focus();
}

function cancelFeedbackEdit() {
    SF_EDITING = null;
    document.getElementById('sf-body').value = '';
    document.getElementById('sf-course').value = '';
    document.getElementById('sf-visible').checked = true;
    document.getElementById('sf-composer-title').textContent = 'Write feedback';
    document.getElementById('sf-save-btn').textContent = 'Save feedback';
    document.getElementById('sf-cancel-btn').style.display = 'none';
    document.getElementById('sf-alert').style.display = 'none';
}

async function saveFeedbackNote(ev) {
    ev.preventDefault();
    const alert = document.getElementById('sf-alert');
    const btn = document.getElementById('sf-save-btn');
    alert.style.display = 'none';

    const body = document.getElementById('sf-body').value.trim();
    const courseId = document.getElementById('sf-course').value || null;
    const visible = document.getElementById('sf-visible').checked;
    if (!body) { showAlert(alert, 'Write the feedback before saving.', 'error'); return; }
    if (!ensureSafe(alert, [['Feedback', body]])) return;

    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        if (SF_EDITING) {
            const edited_at = new Date().toISOString();
            const res = await db.from('student_notes')
                .update({ body, course_id: courseId, visible_to_student: visible, edited_at })
                .eq('id', SF_EDITING);
            if (res.error) throw new Error(res.error.message);
            const n = SF_NOTES.find(x => x.id === SF_EDITING);
            if (n) Object.assign(n, { body, course_id: courseId, visible_to_student: visible, edited_at });
            cancelFeedbackEdit();
            showAlert(alert, 'Correction saved.', 'success');
        } else {
            const res = await db.from('student_notes').insert({
                student_id: SF_STUDENT.id,
                course_id: courseId,
                body,
                visible_to_student: visible,
                author_id: SF_UID,
                author_name: SF_NAME
            }).select('id, body, course_id, visible_to_student, author_id, author_name, created_at, edited_at, emailed_at').single();
            if (res.error) throw new Error(res.error.message);
            SF_PAGE = 1;   // a new entry is the newest — always land back on page 1
            document.getElementById('sf-body').value = '';
            document.getElementById('sf-course').value = '';
            document.getElementById('sf-visible').checked = true;

            if (!visible) {
                showAlert(alert, 'Saved as an internal note — the student won\'t see it and no email was sent.', 'success');
            } else {
                // The feedback is already saved; emailing is a separate step that must never undo it.
                const who = SF_STUDENT.full_name || 'The student';
                showAlert(alert, `Saved. Emailing ${who}…`, 'success');
                try {
                    const r = await apiRequest('POST', '/admin/notify/feedback', { note_id: res.data.id });
                    if (r.emailed) {
                        showAlert(alert, `Saved and emailed to ${r.to}. ${who} will also see it in their portal and in their notifications.`, 'success');
                    } else {
                        showAlert(alert, `Saved — ${who} will see it in their portal and in their notifications. ${r.reason || 'No email was sent.'}`, 'warn');
                    }
                } catch (e) {
                    showAlert(alert, `Saved — ${who} will see it in their portal and in their notifications. The email could not be sent (${e.message}).`, 'warn');
                }
            }
        }
        await loadFeedbackNotes();
        setTimeout(() => { alert.style.display = 'none'; }, 8000);
    } catch (err) {
        showAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = SF_EDITING ? 'Save correction' : (label === 'Saving…' ? 'Save feedback' : label);
    }
}

async function deleteFeedbackNote(id) {
    const n = SF_NOTES.find(x => x.id === id);
    if (!n) return;
    const ok = await confirmDialog({
        title: 'Delete this feedback?',
        message: `The entry written on ${fmtStamp(n.created_at)} will be permanently removed from ${SF_STUDENT.full_name || 'the student'}'s record and can't be recovered. Feedback is normally kept as a record — delete only if it was written in error.`,
        confirmText: 'Delete permanently',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('student_notes').delete().eq('id', id);
    if (error) { showAlert(document.getElementById('sf-alert'), error.message, 'error'); return; }
    if (SF_EDITING === id) cancelFeedbackEdit();
    await loadFeedbackNotes();   // refill the page from the server
}

function showAlert(el, msg, type) {
    el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block';
}
