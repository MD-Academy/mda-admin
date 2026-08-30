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
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <button class="btn btn-primary" onclick="openAddQuestion()">＋ Add question</button>
                    <input type="file" id="qb-file" accept=".xml,text/xml,application/xml" style="display:none">
                    <button class="btn btn-ghost" id="qb-import-btn" onclick="document.getElementById('qb-file').click()">⬆ Import Moodle XML</button>
                </div>
            </div>
            <div class="alert" id="qb-import-alert" style="display:none;margin-top:12px;margin-bottom:0;"></div>
        </div>
        <datalist id="qb-cat-list"></datalist>

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
                <button class="btn btn-ghost btn-sm" onclick="openSetCat()">🏷️ Set category</button>
                <button class="btn btn-ghost btn-sm" onclick="clearQbSelection()">Clear selection</button>
                <span id="qb-add-msg" style="font-size:13px;"></span>
            </div>
        </div>

        <!-- Add-question modal -->
        <div class="modal-overlay" id="addq-modal">
            <div class="modal">
                <div class="modal-head"><h3>Add a question</h3><button class="modal-close" onclick="closeQbModal('addq-modal')">&times;</button></div>
                <form onsubmit="saveNewQuestion(event)">
                    <div class="modal-body">
                        <div class="alert" id="addq-alert" style="display:none;"></div>
                        <div class="form-field">
                            <label>Category</label>
                            <input type="text" id="addq-cat" list="qb-cat-list" placeholder="e.g. Chemistry, Physics, Biology, Anatomy & Physiology">
                            <div class="hint">Pick an existing category or type a new one to create it.</div>
                        </div>
                        <div class="form-field">
                            <label>Question</label>
                            <textarea id="addq-text" rows="3" placeholder="Type the question…" required></textarea>
                        </div>
                        <div class="form-field">
                            <label>Options <span style="color:var(--text-muted);font-weight:400;">(select the correct one)</span></label>
                            <div id="addq-options"></div>
                            <button type="button" class="btn btn-ghost btn-sm" onclick="addQbOptionRow()" style="margin-top:8px;">+ Add option</button>
                        </div>
                    </div>
                    <div class="modal-foot">
                        <button type="button" class="btn btn-ghost" onclick="closeQbModal('addq-modal')">Cancel</button>
                        <button type="submit" class="btn btn-primary" id="addq-save">Save question</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Set-category modal (bulk) -->
        <div class="modal-overlay" id="setcat-modal">
            <div class="modal">
                <div class="modal-head"><h3>Set category</h3><button class="modal-close" onclick="closeQbModal('setcat-modal')">&times;</button></div>
                <form onsubmit="applySetCat(event)">
                    <div class="modal-body">
                        <div class="alert" id="setcat-alert" style="display:none;"></div>
                        <p id="setcat-context" style="font-size:14px;color:var(--text-muted);margin-bottom:14px;"></p>
                        <div class="form-field">
                            <label>Category</label>
                            <input type="text" id="setcat-input" list="qb-cat-list" placeholder="e.g. Chemistry">
                            <div class="hint">Existing or new — the selected questions move into it.</div>
                        </div>
                    </div>
                    <div class="modal-foot">
                        <button type="button" class="btn btn-ghost" onclick="closeQbModal('setcat-modal')">Cancel</button>
                        <button type="submit" class="btn btn-primary" id="setcat-save">Move questions</button>
                    </div>
                </form>
            </div>
        </div>`;

    document.getElementById('qb-file').addEventListener('change', onQbFile);
    await Promise.all([loadQbCategories(), loadQbTargets()]);
    ['qb-cat', 'qb-size', 'qb-target'].forEach(id => enhanceSelect(document.getElementById(id)));
    await loadQbPage();
}

// Turn a native <select> into a themed dropdown (keeps the select working underneath).
function enhanceSelect(sel) {
    if (!sel || sel._csEnhanced) return;
    sel._csEnhanced = true;
    sel.style.display = 'none';
    const wrap = document.createElement('span'); wrap.className = 'cs-wrap';
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cs-btn';
    if (sel.style.minWidth) btn.style.minWidth = sel.style.minWidth;
    const lbl = document.createElement('span'); const chev = document.createElement('span'); chev.className = 'cs-chev'; chev.textContent = '▾';
    btn.appendChild(lbl); btn.appendChild(chev); wrap.appendChild(btn);
    const menu = document.createElement('div'); menu.className = 'cs-menu'; wrap.appendChild(menu);

    const sync = () => { const o = sel.options[sel.selectedIndex]; lbl.textContent = o ? o.textContent : ''; };
    const build = () => {
        menu.innerHTML = '';
        Array.from(sel.options).forEach((o, i) => {
            const d = document.createElement('div');
            d.className = 'cs-opt' + (i === sel.selectedIndex ? ' sel' : '');
            d.textContent = o.textContent;
            d.onclick = (e) => { e.stopPropagation(); sel.selectedIndex = i; sync(); wrap.classList.remove('open'); sel.dispatchEvent(new Event('change')); };
            menu.appendChild(d);
        });
    };
    btn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = wrap.classList.contains('open');
        document.querySelectorAll('.cs-wrap.open').forEach(w => w.classList.remove('open'));
        if (!isOpen) {
            build();
            // Open upward if there isn't room below (e.g. in the sticky bottom bar).
            const rect = btn.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            wrap.classList.toggle('up', spaceBelow < 300 && rect.top > spaceBelow);
            wrap.classList.add('open');
        }
    };
    document.addEventListener('click', () => wrap.classList.remove('open'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') wrap.classList.remove('open'); });
    sel._csSync = sync;   // call after options are rebuilt in code
    sync();
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
    if (sel._csSync) sel._csSync();
    // Feed the datalist used by the Add-question and Set-category inputs.
    const dl = document.getElementById('qb-cat-list');
    if (dl) dl.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
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
    if (sel) {
        sel.innerHTML = QB_TARGETS.length
            ? QB_TARGETS.map((t, i) => `<option value="${i}">${escapeHtml(t.label)}</option>`).join('')
            : `<option value="">No MCQ quizzes or exams yet</option>`;
        if (sel._csSync) sel._csSync();
    }
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

// ── MODAL HELPERS ──
function openQbModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'flex'; }
function closeQbModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'none'; }

// ── ADD A QUESTION MANUALLY ──
function addQbOptionRow(text, checked) {
    const list = document.getElementById('addq-options');
    const row = document.createElement('div');
    row.className = 'addq-opt-row';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    row.innerHTML = `
        <input type="radio" name="addq-correct" ${checked ? 'checked' : ''} title="Mark as the correct answer" style="width:17px;height:17px;flex-shrink:0;accent-color:var(--crimson);">
        <input type="text" class="addq-opt" value="${text ? escapeHtml(text) : ''}" placeholder="Answer option" style="flex:1;">
        <button type="button" class="btn btn-ghost btn-sm" onclick="this.closest('.addq-opt-row').remove()" title="Remove">✕</button>`;
    list.appendChild(row);
}

function openAddQuestion() {
    document.getElementById('addq-alert').style.display = 'none';
    document.getElementById('addq-cat').value = QB_CAT || '';   // default to the filtered category, if any
    document.getElementById('addq-text').value = '';
    document.getElementById('addq-options').innerHTML = '';
    addQbOptionRow('', true);   // first option marked correct by default
    addQbOptionRow('', false);
    addQbOptionRow('', false);
    addQbOptionRow('', false);
    openQbModal('addq-modal');
    setTimeout(() => document.getElementById('addq-text').focus(), 50);
}

async function saveNewQuestion(e) {
    e.preventDefault();
    const alert = document.getElementById('addq-alert');
    const btn = document.getElementById('addq-save');
    alert.style.display = 'none';

    const category = document.getElementById('addq-cat').value.trim();
    const question_text = document.getElementById('addq-text').value.trim();
    const rows = Array.from(document.querySelectorAll('#addq-options .addq-opt-row'));
    const options = rows.map(r => r.querySelector('.addq-opt').value.trim());
    const correctIdx = rows.findIndex(r => r.querySelector('input[type=radio]').checked);

    if (!question_text) { showModalAlert(alert, 'Enter the question.', 'error'); return; }
    if (options.length < 2) { showModalAlert(alert, 'Add at least two options.', 'error'); return; }
    if (options.some(o => !o)) { showModalAlert(alert, 'Fill in every option, or remove the empty ones.', 'error'); return; }
    if (correctIdx < 0) { showModalAlert(alert, 'Mark which option is correct.', 'error'); return; }
    if (!ensureSafe(alert, [['Question', question_text], ['Category', category], ...options.map((o, i) => [`Option ${i + 1}`, o])])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const { error } = await db.from('question_bank').insert({
            category: category || null, question_text, options_json: options,
            correct_answer_index: correctIdx, source: 'manual'
        });
        if (error) throw new Error(error.message);
        closeQbModal('addq-modal');
        QB_PAGE = 1;
        await loadQbCategories();
        await loadQbPage();
    } catch (err) {
        showModalAlert(alert, err.message || 'Could not save.', 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save question';
    }
}

// ── SET CATEGORY ON SELECTED (bulk) ──
function openSetCat() {
    if (!QB_SELECTED.size) return;
    document.getElementById('setcat-alert').style.display = 'none';
    document.getElementById('setcat-context').textContent = `Move ${QB_SELECTED.size} selected question${QB_SELECTED.size === 1 ? '' : 's'} into a category.`;
    document.getElementById('setcat-input').value = QB_CAT || '';
    openQbModal('setcat-modal');
    setTimeout(() => document.getElementById('setcat-input').focus(), 50);
}

async function applySetCat(e) {
    e.preventDefault();
    const alert = document.getElementById('setcat-alert');
    const btn = document.getElementById('setcat-save');
    alert.style.display = 'none';
    const cat = document.getElementById('setcat-input').value.trim();
    if (!ensureSafe(alert, [['Category', cat]])) return;
    const ids = [...QB_SELECTED];
    btn.disabled = true; btn.textContent = 'Moving…';
    try {
        const { error } = await db.from('question_bank').update({ category: cat || null }).in('id', ids);
        if (error) throw new Error(error.message);
        closeQbModal('setcat-modal');
        QB_SELECTED.clear();
        await loadQbCategories();
        await loadQbPage();
    } catch (err) {
        showModalAlert(alert, err.message || 'Could not move.', 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Move questions';
    }
}

// showModalAlert helper (matches other admin pages).
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }
