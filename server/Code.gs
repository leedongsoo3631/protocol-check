/**
 * 의전 체크 보드 — 공용 동기화 서버 (Google Apps Script)
 * 구글 시트 [확장 프로그램 > Apps Script]에 붙여넣고 웹 앱으로 배포하세요.
 */
const EDIT_PIN = '0000';        // ← 명단 편집 비밀번호 (반드시 바꾸세요)
const SHEET = '명단';
const LOGSHEET = '체크기록';
const CHATSHEET = '채팅';
const LOCSHEET = '위치';
const PLANSHEET = '일정';
const SEATSHEET = '좌석';
const ALBUMSHEET = '사진첩';
const ALB_CHUNKS = 10, ALB_CELL = 49000;   // 사진 1장 최대 49만 자(약 360KB)
const HEAD = ['id', 'ord', 'pos', 'name', 'checked', 'time', 'by', 'prev', 'photo', 'note'];
const NOTECOL = 10;

/* 보드 화면 제공 */
function doGet(e) {
  let t;
  try { t = HtmlService.createTemplateFromFile('Index'); }
  catch (err) { return HtmlService.createHtmlOutput('<p style="font:16px sans-serif;padding:24px">의전 체크 서버가 작동 중입니다. 이 주소를 앱의 설정 → 공유 서버 주소에 넣으세요.</p>').addMetaTag('viewport', 'width=device-width, initial-scale=1'); }
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
  if (q.a === 'state') { const on = pres_(q.dev, q.by); const s = state_(q.ver); s.on = on; return s; }
  if (q.a === 'photos') return photos_(q.ids || []);
  if (q.a === 'log') return { ok: true, log: log_() };
  if (q.a === 'planimg') return { ok: true, img: planSheet_().getRange(3, 2, 1, 10).getDisplayValues()[0].join('') };
  if (q.a === 'locs') return { ok: true, now: Date.now(), locs: locs_() };
  if (q.a === 'loc') return loc_(q);
  if (q.a === 'albumList') return albumList_();
  if (q.a === 'albumImg') return albumImg_(q.ids || []);
  if (q.a === 'pin') return String(q.pin) === String(EDIT_PIN) ? { ok: true } : { ok: false, error: 'pin' };

  const editOps = ['upsert', 'remove', 'reorder', 'bulk', 'meta', 'reset', 'clear', 'chatclear', 'vwkey', 'logclear', 'plan', 'seat'];
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
        if (u.note !== undefined) sh.getRange(m.r, NOTECOL).setValue(String(u.note || ''));
        if (u.photo !== undefined) sh.getRange(m.r, 8, 1, 2).setValues([[String(m.prev + 1), String(u.photo || '')]]);
      } else {
        const ord = data.reduce((a, o) => Math.max(a, o.ord), 0) + 1;
        sh.appendRow([String(u.id || Utilities.getUuid()), String(ord), String(u.pos || ''), String(u.name || ''),
          '', '', '', u.photo ? '1' : '0', String(u.photo || ''), String(u.note || '')]);
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
        u.checked ? String(u.by || '') : '', u.photo ? '1' : '0', String(u.photo || ''), String(u.note || '')]);
      if (list.length) sh.getRange(sh.getLastRow() + 1, 1, list.length, HEAD.length).setValues(list);

    } else if (q.a === 'reset') {
      if (data.length) sh.getRange(2, 5, data.length, 3).setValue('');
      logAdd_(q.time, q.actor || q.by, '전체', '체크 모두 해제');

    } else if (q.a === 'clear') {
      if (data.length) sh.deleteRows(2, data.length);

    } else if (q.a === 'chat') {
      const text = String(q.text || '').trim().slice(0, 300);
      if (!text) return { ok: false, error: '내용 없음' };
      const cs = chatSheet_();
      const p0 = PropertiesService.getScriptProperties();
      const seq = (Number(p0.getProperty('chatSeq')) || 0) + 1;
      p0.setProperty('chatSeq', String(seq));
      cs.appendRow([String(seq), String(q.time || ''), String(q.by || ''), text,
        Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')]);

    } else if (q.a === 'chatclear') {
      const cs = chatSheet_();
      if (cs.getLastRow() > 1) cs.deleteRows(2, cs.getLastRow() - 1);

    } else if (q.a === 'logclear') {
      const ls = logSheet_();
      if (ls.getLastRow() > 1) ls.deleteRows(2, ls.getLastRow() - 1);

    } else if (q.a === 'plan') {
      const ps = planSheet_();
      const sched = (q.sched || []).slice(0, 80).map(s => ({ t: String(s.t || '').slice(0, 5), x: String(s.x || '').slice(0, 120), n: String(s.n || '').slice(0, 80) }));
      ps.getRange('B1').setValue(String(q.memo || '').slice(0, 5000));
      ps.getRange('B2').setValue(JSON.stringify(sched));
      if (q.img !== undefined) {
        const img = String(q.img || '').slice(0, 490000), parts = [];
        for (let k = 0; k < 10; k++) parts.push(img.slice(k * 49000, (k + 1) * 49000));
        ps.getRange(3, 2, 1, 10).setValues([parts]);
        ps.getRange('B4').setValue(String((Number(ps.getRange('B4').getDisplayValue()) || 0) + 1));
      }

    } else if (q.a === 'seat') {
      const js = q.seat ? JSON.stringify(q.seat) : '';
      if (js.length > 45000) return { ok: false, error: '좌석 정보가 너무 큽니다' };
      seatSheet_().getRange('B1').setValue(js);

    } else if (q.a === 'albumAdd') {
      const as = albumSheet_();
      const id = String(q.id || Utilities.getUuid()).slice(0, 40);
      const n = as.getLastRow() - 1;
      const ids = n > 0 ? as.getRange(2, 1, n, 1).getDisplayValues().map(x => x[0]) : [];
      if (ids.indexOf(id) < 0) {   // 같은 사진을 다시 보내도 한 번만 저장
        const img = String(q.img || '');
        if (!/^data:image\/jpeg;base64,/.test(img)) return { ok: false, error: '사진 형식 오류' };
        if (img.length > ALB_CHUNKS * ALB_CELL) return { ok: false, error: '사진이 너무 큽니다' };
        const row = [id, String(Number(q.t) || Date.now()), String(q.time || ''), String(q.by || '').slice(0, 30),
          String(q.cap || '').slice(0, 200), String(q.thumb || '').slice(0, 45000), String(Math.ceil(img.length / ALB_CELL))];
        for (let k = 0; k < ALB_CHUNKS; k++) row.push(img.slice(k * ALB_CELL, (k + 1) * ALB_CELL));
        as.getRange(as.getLastRow() + 1, 1, 1, row.length).setValues([row]);
      }

    } else if (q.a === 'albumCap') {
      const r = albumRow_(q.id);
      if (!r) return { ok: false, error: '사진 없음' };
      albumSheet_().getRange(r, 5).setValue(String(q.cap || '').slice(0, 200));

    } else if (q.a === 'albumDel') {
      const r = albumRow_(q.id);
      if (!r) return { ok: false, error: '사진 없음' };
      const owner = albumSheet_().getRange(r, 4).getDisplayValue();
      if (String(q.pin) !== String(EDIT_PIN) && (!q.by || String(q.by) !== owner)) return { ok: false, error: 'pin' };
      albumSheet_().deleteRow(r);

    } else if (q.a === 'albumClear') {
      if (String(q.pin) !== String(EDIT_PIN)) return { ok: false, error: 'pin' };
      const as = albumSheet_();
      if (as.getLastRow() > 1) as.deleteRows(2, as.getLastRow() - 1);

    } else if (q.a === 'vwkey') {
      PropertiesService.getScriptProperties().setProperty('vwKey', String(q.key || '').trim());

    } else if (q.a === 'meta') {
      PropertiesService.getScriptProperties().setProperties({ title: String(q.title || ''), date: String(q.date || ''), time: String(q.time || ''), place: String(q.place || '') });

    } else {
      return { ok: false, error: '알 수 없는 요청' };
    }

    SpreadsheetApp.flush();
    const p = PropertiesService.getScriptProperties();
    p.setProperty('ver', String((Number(p.getProperty('ver')) || 1) + 1));
  } finally {
    lock.releaseLock();
  }
  return state_();
}

/* ---------- 내부 함수 ---------- */
/* 저장용 구글 시트: 처음 실행 때 내 드라이브에 '의전 체크 서버' 시트를 자동으로 만든다 */
function ss_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('sheetId');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  try { const a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; } catch (e) {}
  const s = SpreadsheetApp.create('의전 체크 서버');
  p.setProperty('sheetId', s.getId());
  return s;
}

/* 처음 한 번 실행: 권한 승인 + 저장용 시트 만들기 (편집기에서 ▶실행) */
function setup() {
  const s = ss_();
  sheet_(); logSheet_(); chatSheet_(); locSheet_(); planSheet_(); seatSheet_(); albumSheet_();
  Logger.log('준비 완료. 저장용 시트: ' + s.getUrl());
}

function sheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange('A:I').setNumberFormat('@');
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
    sh.setFrozenRows(1);
  }
  if (sh.getRange(1, NOTECOL).getDisplayValue() !== 'note') {
    sh.getRange('J:J').setNumberFormat('@');
    sh.getRange(1, NOTECOL).setValue('note');
  }
  return sh;
}

function rows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const notes = sh.getRange(2, NOTECOL, n, 1).getDisplayValues();
  return sh.getRange(2, 1, n, 8).getDisplayValues().map((x, i) => ({
    r: i + 2, id: x[0], ord: Number(x[1]) || 0, pos: x[2], name: x[3],
    checked: x[4] === 'Y', time: x[5], by: x[6], prev: Number(x[7]) || 0, note: notes[i][0] || ''
  })).filter(o => o.id);
}

function state_(ver) {
  const p = PropertiesService.getScriptProperties();
  const cur = p.getProperty('ver') || '1';
  if (ver && String(ver) === cur) return { ok: true, same: true, ver: cur };
  // 같은 버전은 여러 사람이 동시에 받아 가므로 5분간 캐시해 시트를 다시 읽지 않는다
  const cache = CacheService.getScriptCache(), key = 'st' + cur;
  const hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const members = rows_(sheet_()).sort((a, b) => a.ord - b.ord).map(o => ({
    id: o.id, pos: o.pos, name: o.name, note: o.note, checked: o.checked, time: o.time, by: o.by, prev: o.prev
  }));
  const s = { ok: true, ver: cur, chat: chat_(), plan: plan_(), seat: seat_(), album: albumSum_(), meta: { title: p.getProperty('title') || '', date: p.getProperty('date') || '', time: p.getProperty('time') || '', place: p.getProperty('place') || '', vw: p.getProperty('vwKey') || '' }, members: members };
  try { const js = JSON.stringify(s); if (js.length < 95000) cache.put(key, js, 300); } catch (e) {}
  return s;
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
  const ss = ss_();
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

function chatSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(CHATSHEET);
  if (!sh) {
    sh = ss.insertSheet(CHATSHEET);
    sh.getRange('A:E').setNumberFormat('@');
    sh.getRange(1, 1, 1, 5).setValues([['번호', '시각', '보낸사람', '내용', '서버기록']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* 최근 채팅 50개 */
function chat_() {
  const sh = chatSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const k = Math.min(n, 50);
  return sh.getRange(sh.getLastRow() - k + 1, 1, k, 4).getDisplayValues()
    .map(x => ({ s: Number(x[0]) || 0, t: x[1], by: x[2], x: x[3] }));
}

/* ---------- 위치 (사람마다 1줄, 최신 위치만 보관) ---------- */
function locSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(LOCSHEET);
  if (!sh) {
    sh = ss.insertSheet(LOCSHEET);
    sh.getRange('A:G').setNumberFormat('@');
    sh.getRange(1, 1, 1, 7).setValues([['기기', '이름', '위도', '경도', '정확도(m)', '시각(ms)', '서버기록']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function loc_(q) {
  const dev = String(q.dev || '').slice(0, 40);
  if (!dev) return { ok: false, error: '기기 없음' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = locSheet_();
    const name = String(q.by || '').slice(0, 30);
    const lim = Date.now() - 12 * 3600 * 1000;
    let n = sh.getLastRow() - 1;
    const rows = n > 0 ? sh.getRange(2, 1, n, 6).getDisplayValues() : [];
    // 오래된 위치, 같은 이름의 다른 기기(앱 재설치·이전 버전) 흔적은 지운다
    for (let k = rows.length - 1; k >= 0; k--) {
      const r = rows[k];
      const stale = (Number(r[5]) || 0) < lim;
      const sameName = r[0] !== dev && name && name !== '이름 없음' && r[1] === name;
      if (stale || sameName) sh.deleteRow(k + 2);
    }
    n = sh.getLastRow() - 1;
    const ids = n > 0 ? sh.getRange(2, 1, n, 1).getDisplayValues().map(x => x[0]) : [];
    const i = ids.indexOf(dev);
    if (q.off) {
      if (i >= 0) sh.deleteRow(i + 2);
      return { ok: true };
    }
    const lat = Number(q.lat), lng = Number(q.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: '좌표 없음' };
    const row = [dev, name, lat.toFixed(6), lng.toFixed(6),
      String(Math.round(Number(q.acc) || 0)), String(Date.now()),
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')];
    if (i >= 0) sh.getRange(i + 2, 1, 1, 7).setValues([row]);
    else sh.appendRow(row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* 최근 12시간 안에 보낸 위치만 */
function locs_() {
  const sh = locSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const lim = Date.now() - 12 * 3600 * 1000;
  return sh.getRange(2, 1, n, 6).getDisplayValues()
    .map(x => ({ dev: x[0], by: x[1], lat: Number(x[2]), lng: Number(x[3]), acc: Number(x[4]) || 0, t: Number(x[5]) || 0 }))
    .filter(o => o.t > lim && isFinite(o.lat) && isFinite(o.lng));
}

/* ---------- 메모·스케줄 (일정 시트 B1 메모, B2 스케줄 JSON, B3 식순 사진, B4 사진 번호) ---------- */
function planSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(PLANSHEET);
  if (!sh) {
    sh = ss.insertSheet(PLANSHEET);
    sh.getRange('A:B').setNumberFormat('@');
    sh.getRange(1, 1, 4, 2).setValues([['주요 메모', ''], ['스케줄(JSON)', '[]'], ['식순 사진', ''], ['사진 번호', '0']]);
  }
  return sh;
}

function plan_() {
  const v = planSheet_().getRange(1, 2, 4, 1).getDisplayValues();
  let sched = [];
  try { sched = JSON.parse(v[1][0] || '[]'); } catch (e) {}
  return { memo: v[0][0] || '', sched: sched, imgv: Number(v[3][0]) || 0, hasImg: !!v[2][0] };
}

/* ---------- 좌석배치 (좌석 시트 B1 JSON) ---------- */
function seatSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SEATSHEET);
  if (!sh) {
    sh = ss.insertSheet(SEATSHEET);
    sh.getRange('A:B').setNumberFormat('@');
    sh.getRange(1, 1, 1, 2).setValues([['배치(JSON)', '']]);
  }
  return sh;
}

function seat_() {
  const v = seatSheet_().getRange('B1').getDisplayValue();
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

/* ---------- 접속 중 (앱을 열어 둔 사람, 캐시에 60초 보관) ---------- */
function pres_(dev, by) {
  const c = CacheService.getScriptCache();
  let m = {};
  try { m = JSON.parse(c.get('pres') || '{}'); } catch (e) {}
  const now = Date.now();
  dev = String(dev || '').slice(0, 40);
  const name = String(by || '').slice(0, 30);
  if (dev) {
    const o = m[dev];
    if (!o || now - o.t > 15000 || o.n !== name) {
      m[dev] = { n: name, t: now };
      Object.keys(m).forEach(k => { if (now - m[k].t > 90000) delete m[k]; });
      c.put('pres', JSON.stringify(m), 600);
    }
  }
  return Object.keys(m).filter(k => now - m[k].t < 60000).map(k => ({ d: k, n: m[k].n }));
}

/* ---------- 현장 사진첩 (사진첩 시트: id, 시각ms, 시각, 촬영자, 설명, 썸네일, 조각 수, 사진 조각 10칸) ---------- */
function albumSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(ALBUMSHEET);
  if (!sh) {
    sh = ss.insertSheet(ALBUMSHEET);
    sh.getRange('A:Q').setNumberFormat('@');
    const head = ['id', '시각(ms)', '시각', '촬영자', '설명', '썸네일', '조각'];
    for (let k = 1; k <= ALB_CHUNKS; k++) head.push('사진' + k);
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function albumRow_(id) {
  const sh = albumSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const i = sh.getRange(2, 1, n, 1).getDisplayValues().map(x => x[0]).indexOf(String(id));
  return i < 0 ? 0 : i + 2;
}

function albumSum_() {
  const sh = albumSheet_();
  const n = Math.max(0, sh.getLastRow() - 1);
  return { n: n, last: n ? sh.getRange(sh.getLastRow(), 1).getDisplayValue() : '' };
}

function albumList_() {
  const sh = albumSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return { ok: true, items: [] };
  const items = sh.getRange(2, 1, n, 6).getDisplayValues()
    .map(x => ({ id: x[0], t: Number(x[1]) || 0, time: x[2], by: x[3], cap: x[4], thumb: x[5] }))
    .filter(o => o.id);
  return { ok: true, items: items };
}

function albumImg_(ids) {
  const sh = albumSheet_();
  const n = sh.getLastRow() - 1;
  const out = {};
  if (n < 1) return { ok: true, imgs: out };
  const all = sh.getRange(2, 1, n, 1).getDisplayValues().map(x => x[0]);
  ids.slice(0, 6).forEach(id => {
    const i = all.indexOf(String(id));
    if (i < 0) return;
    const v = sh.getRange(i + 2, 8, 1, ALB_CHUNKS).getDisplayValues()[0];
    out[id] = v.join('');
  });
  return { ok: true, imgs: out };
}
