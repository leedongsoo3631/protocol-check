/**
 * 의전 체크 보드 — 공용 동기화 서버 (Google Apps Script)
 * 구글 시트 [확장 프로그램 > Apps Script]에 붙여넣고 웹 앱으로 배포하세요.
 */
const EDIT_PIN = '0000';        // ← 명단 편집 비밀번호 (반드시 바꾸세요)
const SHEET = '명단';
const LOGSHEET = '체크기록';
const HEAD = ['id', 'ord', 'pos', 'name', 'checked', 'time', 'by', 'prev', 'photo'];

/* 보드 화면 제공 */
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.url = ScriptApp.getService().getUrl();
  return t.evaluate()
    .setTitle('의전 체크 보드')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-title', '의전체크')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* 보드 HTML 파일을 따로 열어 쓸 때(주소 입력 방식) */
function doPost(e) {
  let r;
  try { r = api(JSON.parse(e.postData.contents)); }
  catch (err) { r = { ok: false, error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

/* 공통 처리 */
function api(q) {
  q = q || {};
  if (q.a === 'state') return state_(q.ver);
  if (q.a === 'photos') return photos_(q.ids || []);
  if (q.a === 'log') return { ok: true, log: log_() };
  if (q.a === 'pin') return String(q.pin) === String(EDIT_PIN) ? { ok: true } : { ok: false, error: 'pin' };

  const editOps = ['upsert', 'remove', 'reorder', 'bulk', 'meta', 'reset', 'clear'];
  if (editOps.indexOf(q.a) >= 0 && String(q.pin) !== String(EDIT_PIN)) return { ok: false, error: 'pin' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const data = rows_(sh);
    const find = id => data.filter(o => o.id === String(id))[0];

    if (q.a === 'check') {
      const m = find(q.id);
      if (!m) return { ok: false, error: '대상 없음' };
      sh.getRange(m.r, 5, 1, 3).setValues([[q.checked ? 'Y' : '', q.checked ? String(q.time || '') : '', q.checked ? String(q.by || '') : '']]);
      logAdd_(q.time, q.actor || q.by, label_(m), q.checked ? '도착' : '체크 해제');

    } else if (q.a === 'upsert') {
      const u = q.member || {};
      const m = u.id ? find(u.id) : null;
      if (m) {
        if (u.pos !== undefined) sh.getRange(m.r, 3).setValue(String(u.pos));
        if (u.name !== undefined) sh.getRange(m.r, 4).setValue(String(u.name));
        if (u.photo !== undefined) sh.getRange(m.r, 8, 1, 2).setValues([[String(m.prev + 1), String(u.photo || '')]]);
      } else {
        const ord = data.reduce((a, o) => Math.max(a, o.ord), 0) + 1;
        sh.appendRow([String(u.id || Utilities.getUuid()), String(ord), String(u.pos || ''), String(u.name || ''),
          '', '', '', u.photo ? '1' : '0', String(u.photo || '')]);
      }

    } else if (q.a === 'remove') {
      const m = find(q.id);
      if (m) sh.deleteRow(m.r);

    } else if (q.a === 'reorder') {
      const idx = {};
      (q.ids || []).forEach((id, i) => idx[String(id)] = i + 1);
      if (data.length) sh.getRange(2, 2, data.length, 1).setValues(data.map(o => [String(idx[o.id] || o.ord)]));

    } else if (q.a === 'bulk') {
      let base = 0;
      if (q.replace) { if (data.length) sh.deleteRows(2, data.length); }
      else base = data.reduce((a, o) => Math.max(a, o.ord), 0);
      const list = (q.members || []).map((u, i) => [String(u.id || Utilities.getUuid()), String(base + i + 1),
        String(u.pos || ''), String(u.name || ''), u.checked ? 'Y' : '', u.checked ? String(u.time || '') : '',
        u.checked ? String(u.by || '') : '', u.photo ? '1' : '0', String(u.photo || '')]);
      if (list.length) sh.getRange(sh.getLastRow() + 1, 1, list.length, HEAD.length).setValues(list);

    } else if (q.a === 'reset') {
      if (data.length) sh.getRange(2, 5, data.length, 3).setValue('');
      logAdd_(q.time, q.actor || q.by, '전체', '체크 모두 해제');

    } else if (q.a === 'clear') {
      if (data.length) sh.deleteRows(2, data.length);

    } else if (q.a === 'meta') {
      PropertiesService.getScriptProperties().setProperties({ title: String(q.title || ''), date: String(q.date || ''), time: String(q.time || ''), place: String(q.place || '') });

    } else {
      return { ok: false, error: '알 수 없는 요청' };
    }

    const p = PropertiesService.getScriptProperties();
    p.setProperty('ver', String((Number(p.getProperty('ver')) || 1) + 1));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return state_();
}

/* ---------- 내부 함수 ---------- */
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange('A:I').setNumberFormat('@');
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 8).getDisplayValues().map((x, i) => ({
    r: i + 2, id: x[0], ord: Number(x[1]) || 0, pos: x[2], name: x[3],
    checked: x[4] === 'Y', time: x[5], by: x[6], prev: Number(x[7]) || 0
  })).filter(o => o.id);
}

function state_(ver) {
  const p = PropertiesService.getScriptProperties();
  const cur = p.getProperty('ver') || '1';
  if (ver && String(ver) === cur) return { ok: true, same: true, ver: cur };
  const members = rows_(sheet_()).sort((a, b) => a.ord - b.ord).map(o => ({
    id: o.id, pos: o.pos, name: o.name, checked: o.checked, time: o.time, by: o.by, prev: o.prev
  }));
  return { ok: true, ver: cur, meta: { title: p.getProperty('title') || '', date: p.getProperty('date') || '', time: p.getProperty('time') || '', place: p.getProperty('place') || '' }, members: members };
}

function photos_(ids) {
  const sh = sheet_();
  const want = {};
  ids.forEach(i => want[String(i)] = 1);
  const out = {};
  rows_(sh).forEach(o => {
    if (want[o.id]) out[o.id] = { p: o.prev, d: o.prev ? sh.getRange(o.r, 9).getDisplayValue() : '' };
  });
  return { ok: true, photos: out };
}

function label_(m) { return (m.pos ? m.pos + ' ' : '') + m.name; }

function logSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LOGSHEET);
  if (!sh) {
    sh = ss.insertSheet(LOGSHEET);
    sh.getRange('A:E').setNumberFormat('@');
    sh.getRange(1, 1, 1, 5).setValues([['체크시각', '체크자', '대상', '구분', '서버기록']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function logAdd_(time, by, target, kind) {
  logSheet_().appendRow([String(time || ''), String(by || ''), String(target || ''), kind,
    Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')]);
}

function log_() {
  const sh = logSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const k = Math.min(n, 100);
  return sh.getRange(sh.getLastRow() - k + 1, 1, k, 5).getDisplayValues().reverse();
}
