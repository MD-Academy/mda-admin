// Question Bank — a reusable pool of MCQs (imported from Moodle XML) that a
// super-admin ticks and adds into quizzes / exams. Super-admin only.

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

let QB_PAGE = 1, QB_SIZE = 25, QB_TOTAL = 0, QB_SEARCH = '', QB_CAT = '', QB_TIMER = null;
let QB_SELECTED = new Set();     // question ids selected across pages
let QB_TARGETS = [];             // [{kind:'quiz'|'exam', id, label}]

async function initQuestionBank(profile) {
    renderLayout('question-bank', 'Question Bank', 'Import and reuse questions across quizzes & exams', profile);

    document.getElementById('page-content').innerHTML = `
        <div class="panel" style="margin-bottom:18px;padding:18px 20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;">
                <div>
                    <div style="font-weight:700;color:var(--navy-800);font-size:15px;">Import questions</div>
                    <div class="hint" style="margin-top:3px;">Upload a <strong>Moodle XML</strong> export. Single-answer multiple-choice questions are imported; short-answer and image questions are skipped. Re-importing the same file won't create duplicates.</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input type="file" id="qb-file" accept=".xml,text/xml,application/xml" style="display:none">
                    <button class="btn btn-primary" id="qb-import-btn" onclick="document.getElementById('qb-file').click()">⬆ Import Moodle XML</button>
                </div>
            </div>
            <div class="alert" id="qb-import-alert" style="display:none;margin-top:12px;margin-bottom:0;"></div>
        </div>

        <div class="toolbar" style="flex-wrap:wrap;gap:10px;">
            <div class="search-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" id="qb-search" placeholder="Search questions…" oninput="onQbSearch()">
            </div>
            <select id="qb-cat" class="filter-select" onchange="onQbCat()"><option value="">All categories</option></select>
            <select id="qb-size" class="filter-select" onchange="onQbSize()">
                <option value="25">25 / page</option><option value="50">50 / page</option><option value="100">100 / page</option>
            </select>
        </div>

        <div id="qb-list"><div class="loader">Loading questions…</div></div>

        <div id="qb-pager" style="display:none;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap;">
            <div id="qb-pager-info" style="font-size:13px;color:var(--text-muted);"></div>
            <div style="display:flex;gap:8px;align-items:center;">
                <button class="btn btn-ghost btn-sm" id="qb-prev" onclick="changeQbPage(-1)">← Prev</button>
                <span id="qb-page-label" style="font-size:13px;"></span>
                <button class="btn btn-ghost btn-sm" id="qb-next" onclick="changeQbPage(1)">Next →</button>
            </div>
        </div>

        <!-- Sticky action bar when questions are selected -->
        <div id="qb-actionbar" style="display:none;position:sticky;bottom:0;margin-top:18px;background:#fff;border:1px solid var(--border);border-radius:12px;box-shadow:0 -4px 16px rgba(15,23,42,.08);padding:12px 16px;">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <strong id="qb-sel-count" style="color:var(--navy-800);"></strong>
                <span style="color:var(--text-muted);font-size:13px;">Add to:</span>
                <select id="qb-target" class="filter-select" style="min-width:260px;"></select>
                <button class="btn btn-primary" id="qb-add-btn" onclick="addSelectedToTarget()">Add to quiz / exam</button>
                <button class="btn btn-ghost btn-sm" onclick="clearQbSelection()">Clear selection</button>
                <span id="qb-add-msg" style="font-size:13px;"></span>
            </div>
        </div>`;

    document.getElementById('qb-file').addEventListener('change', onQbFile);
    await Promise.all([loadQbCategories(), loadQbTargets()]);
    await loadQbPage();
}

// ── IMPORT ──
function onQbFile(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const alert = document.getElementById('qb-import-alert');
    const btn = document.getElementById('qb-import-btn');
    const reader = new FileReader();
    reader.onload = async () => {
        const b64 = String(reader.result).split(',')[1] || '';
        btn.disabled = true; const label = btn.textContent; btn.textContent = 'Importing…';
        alert.style.display = 'block'; alert.className = 'alert'; alert.textContent = 'Reading and importing… this can take a moment for a large file.';
        try {
            const r = await apiRequest('POST', '/admin/import-question-bank', { xml_base64: b64 });
            alert.className = 'alert success';
            alert.innerHTML = `<strong>Imported ${r.imported} question${r.imported === 1 ? '' : 's'}.</strong> `
                + `Skipped: ${r.skipped_shortanswer} short-answer, ${r.skipped_image} with images, ${r.skipped_unsupported} unsupported, ${r.duplicates} already in the bank.`;
            QB_PAGE = 1;
            await loadQbCategories();
            await loadQbPage();
        } catch (err) {
            alert.className = 'alert error'; alert.textContent = err.message || 'Import failed.';
        } finally {
            btn.disabled = false; btn.textContent = label;
        }
    };
    reader.onerror = () => { alert.style.display = 'block'; alert.className = 'alert error'; alert.textContent = 'Could not read that file.'; };
    reader.readAsDataURL(file);
}

// ── FILTERS / PAGING ──
function onQbSearch() { clearTimeout(QB_TIMER); QB_TIMER = setTimeout(() => { QB_SEARCH = (document.getElementById('qb-search').value || '').trim(); QB_PAGE = 1; loadQbPage(); }, 300); }
function onQbCat() { QB_CAT = document.getElementById('qb-cat').value; QB_PAGE = 1; loadQbPage(); }
function onQbSize() { QB_SIZE = parseInt(document.getElementById('qb-size').value, 10) || 25; QB_PAGE = 1; loadQbPage(); }
function changeQbPage(d) { const tp = Math.max(1, Math.ceil(QB_TOTAL / QB_SIZE)); const n = QB_PAGE + d; if (n < 1 || n > tp) return; QB_PAGE = n; loadQbPage(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

async function loadQbCategories() {
    const sel = document.getElementById('qb-cat');
    const { data } = await db.from('question_bank').select('category').limit(5000);
    const cats = [...new Set((data || []).map(r => r.category).filter(Boolean))].sort();
    const cur = QB_CAT;
    sel.innerHTML = `<option value="">All categories</option>` + cats.map(c => `<option value="${escapeHtml(c)}" ${c === cur ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

async function loadQbPage() {
    const box = document.getElementById('qb-list');
    box.innerHTML = `<div class="loader">Loading questions…</div>`;
    const from = (QB_PAGE - 1) * QB_SIZE, to = from + QB_SIZE - 1;
    let q = db.from('question_bank').select('id, category, question_text, options_json, correct_answer_index', { count: 'exact' });
    if (QB_CAT) q = q.eq('category', QB_CAT);
    const term = QB_SEARCH.replace(/[%,()]/g, ' ').trim();
    if (term) q = q.ilike('question_text', `%${term}%`);
    q = q.order('created_at', { ascending: true }).range(from, to);
    const { data, count, error } = await q;
    if (error) { box.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load</h3><p>${escapeHtml(error.message)}</p></div>`; return; }
    QB_TOTAL = count || 0;
    const rows = data || [];
    if (QB_TOTAL === 0) {
        box.innerHTML = `<div class="empty-state"><h3>No questions yet</h3><p>${QB_SEARCH || QB_CAT ? 'Nothing matches your filter.' : 'Import a Moodle XML export above to fill the bank.'}</p></div>`;
        renderQbPager(); return;
    }

    box.innerHTML = `<div class="list-rows">` + rows.map(qq => {
        const opts = Array.isArray(qq.options_json) ? qq.options_json : [];
        const checked = QB_SELECTED.has(qq.id) ? 'checked' : '';
        const optHtml = opts.map((o, i) => `<span style="display:inline-block;margin:2px 8px 2px 0;padding:2px 9px;border-radius:8px;font-size:12.5px;${i === qq.correct_answer_index ? 'background:#dcfce7;color:#166534;font-weight:700;border:1px solid #86efac;' : 'background:#f1f5f9;color:var(--text-muted);'}">${i === qq.correct_answer_index ? '✓ ' : ''}${escapeHtml(o)}</span>`).join('');
        return `<label class="list-row" style="align-items:flex-start;gap:12px;cursor:pointer;">
            <input type="checkbox" ${checked} onchange="toggleQb('${qq.id}', this.checked)" style="margin-top:3px;width:17px;height:17px;flex-shrink:0;accent-color:var(--crimson);">
            <div style="flex:1;min-width:0;">
                ${qq.category ? `<span class="badge badge-blue" style="margin-bottom:6px;">${escapeHtml(qq.category)}</span>` : ''}
                <div style="font-size:14px;font-weight:600;color:var(--text);line-height:1.5;">${escapeHtml(qq.question_text)}</div>
                <div style="margin-top:6px;">${optHtml}</div>
            </div>
        </label>`;
    }).join('') + `</div>`;
    renderQbPager();
    updateQbActionBar();
}

function renderQbPager() {
    const pager = document.getElementById('qb-pager');
    if (QB_TOTAL <= QB_SIZE && QB_PAGE === 1) { pager.style.display = 'none'; return; }
    pager.style.display = 'flex';
    const tp = Math.max(1, Math.ceil(QB_TOTAL / QB_SIZE));
    const start = (QB_PAGE - 1) * QB_SIZE + 1, end = Math.min(QB_PAGE * QB_SIZE, QB_TOTAL);
    document.getElementById('qb-pager-info').textContent = `Showing ${start}–${end} of ${QB_TOTAL}`;
    document.getElementById('qb-page-label').textContent = `Page ${QB_PAGE} of ${tp}`;
    const prev = document.getElementById('qb-prev'), next = document.getElementById('qb-next');
    prev.disabled = QB_PAGE <= 1; next.disabled = QB_PAGE >= tp;
    prev.style.opacity = prev.disabled ? '.4' : '1'; next.style.opacity = next.disabled ? '.4' : '1';
}

// ── SELECTION ──
function toggleQb(id, on) { if (on) QB_SELECTED.add(id); else QB_SELECTED.delete(id); updateQbActionBar(); }
function clearQbSelection() { QB_SELECTED.clear(); document.querySelectorAll('#qb-list input[type=checkbox]').forEach(c => c.checked = false); updateQbActionBar(); }
function updateQbActionBar() {
    const bar = document.getElementById('qb-actionbar');
    const n = QB_SELECTED.size;
    bar.style.display = n ? 'block' : 'none';
    if (n) document.getElementById('qb-sel-count').textContent = `${n} question${n === 1 ? '' : 's'} selected`;
}

// ── TARGETS (quizzes + exams) ──
async function loadQbTargets() {
    const [exRes, qzRes, rmRes] = await Promise.all([
        db.from('exams').select('id, title, type').order('created_at', { ascending: false }),
        db.from('quizzes').select('id, title, room_id'),
        db.from('rooms').select('id, name'),
    ]);
    const roomName = {}; (rmRes.data || []).forEach(r => { roomName[r.id] = r.name; });
    QB_TARGETS = [];
    (qzRes.data || []).forEach(q => QB_TARGETS.push({ kind: 'quiz', id: q.id, label: `Quiz · ${q.title || 'Untitled'}${q.room_id && roomName[q.room_id] ? ' (' + roomName[q.room_id] + ')' : ''}` }));
    (exRes.data || []).filter(e => e.type !== 'pdf').forEach(e => QB_TARGETS.push({ kind: 'exam', id: e.id, label: `Exam · ${e.title || 'Untitled'}` }));

    const sel = document.getElementById('qb-target');
    if (sel) sel.innerHTML = QB_TARGETS.length
        ? QB_TARGETS.map((t, i) => `<option value="${i}">${escapeHtml(t.label)}</option>`).join('')
        : `<option value="">No MCQ quizzes or exams yet</option>`;
}

async function addSelectedToTarget() {
    const msg = document.getElementById('qb-add-msg');
    const btn = document.getElementById('qb-add-btn');
    const idx = document.getElementById('qb-target').value;
    msg.textContent = '';
    const target = QB_TARGETS[idx];
    if (!target) { msg.style.color = 'var(--red)'; msg.textContent = 'Pick a quiz or exam.'; return; }
    const ids = [...QB_SELECTED];
    if (!ids.length) return;

    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Adding…';
    try {
        const { data: qs, error } = await db.from('question_bank')
            .select('question_text, options_json, correct_answer_index').in('id', ids);
        if (error) throw new Error(error.message);

        const table = target.kind === 'quiz' ? 'quiz_questions' : 'exam_questions';
        const fk = target.kind === 'quiz' ? 'quiz_id' : 'exam_id';
        // Append after existing questions.
        const { data: ex } = await db.from(table).select('order_index').eq(fk, target.id);
        let next = (ex || []).reduce((m, r) => Math.max(m, r.order_index || 0), 0) + 1;
        const rows = (qs || []).map(q => ({
            [fk]: target.id, question_text: q.question_text,
            options_json: q.options_json, correct_answer_index: q.correct_answer_index,
            order_index: next++,
        }));
        // Insert in chunks.
        for (let i = 0; i < rows.length; i += 200) {
            const r = await db.from(table).insert(rows.slice(i, i + 200));
            if (r.error) throw new Error(r.error.message);
        }
        msg.style.color = 'var(--green)';
        msg.textContent = `Added ${rows.length} question${rows.length === 1 ? '' : 's'} to ${target.label}.`;
        QB_SELECTED.clear();
        document.querySelectorAll('#qb-list input[type=checkbox]').forEach(c => c.checked = false);
        updateQbActionBar();
        setTimeout(() => { msg.textContent = ''; }, 6000);
    } catch (err) {
        msg.style.color = 'var(--red)'; msg.textContent = err.message || 'Could not add.';
    } finally {
        btn.disabled = false; btn.textContent = label;
    }
}
