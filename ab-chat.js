/* エージェントベスト 全サイト共通「チャットで相談」（右下）。
   正本は C:\Users\user\site-network\ab-chat.js。直したら `node apply-chat.mjs` で各リポジトリへ写す（各サイトの /ab-chat.js）。
   元は agentbest-lp の ChatConsult.astro と jobsite の assets/chat.js（この2つは別に持っている。見た目・文面を変えるなら3か所）。

   リアルタイムのやり取りはしない。答えを集めて送るだけで、返信は担当者がメールで送る。
   - mode=seeker / student / freelance … 相談フォームと同じ Apps Script 直送（kind: consultation_form → メール・控えシート・Airtable「求職者（HP）」・Slack）
   - mode=business … コーポレート /contact と同じ Google フォーム（会社名／お名前／メール／お問い合わせ内容）。末尾に「お問い合わせ元：〇〇（チャット）」
   読み込み：<script src="/ab-chat.js" defer data-ab-chat data-site="pm" data-mode="seeker" data-label="PM転職LP"></script> */
(function () {
  if (document.getElementById('abchat')) return;
  var me = document.currentScript || document.querySelector('script[data-ab-chat]');
  var cfg = (me && me.dataset) || {};
  var MODE = cfg.mode || 'seeker';
  var SITE = cfg.site || location.hostname;
  var LABEL = cfg.label || location.hostname;
  var BIZ = MODE === 'business';

  var NOTIFY_URL = 'https://script.google.com/macros/s/AKfycbwSPDbvJuwN8zgP4tRW-VDP9WRbJ2mybZo43BxYdobpc6rts8t0WMh-sQ2Ivgq0mqYK/exec';
  var FORM_ACTION = 'https://docs.google.com/forms/d/e/1FAIpQLSd8Zk9Rxsg292K8R_ttnRYa5d4uXMBkSFrnlEVTFts6feRx6g/formResponse';
  var FORM_ENTRY = { company: 'entry.1620407772', name: 'entry.2140471957', email: 'entry.417521654', message: 'entry.1952858857' };
  var PRIVACY_URL = 'https://jobs.agent-best.net/privacy.html';
  var MAIL = 'r_matsuoka@agent-best.net';

  /* /consultation/ の選択肢と同じ文字列（Airtable の単一選択に入る）。表示の言い回しだけモードで変える */
  var T = ['すぐにでも転職したい（1ヶ月以内）', '3ヶ月以内には決めたい', '半年以内をめどに検討中',
    '1年以内に良い求人があれば', '時期は未定（良い求人があれば）', 'まずは情報収集・相談から'];

  var M = {
    seeker: {
      title: '転職のご相談', what: '転職のご相談',
      topics: ['転職を考えている', '求人を紹介してほしい', '年収・キャリアの相談', '書類・面接の相談', 'その他'],
      detailPh: '例）今は法人営業3年目。年収を上げたいがどこを受ければいいか分からない',
      whenAsk: '転職の時期はいつ頃をお考えですか？',
      when: T.map(function (t) { return [t, t]; }),
      scoutAsk: 'あなたに合う求人が見つかったときに、ご案内をお送りしてもよいですか？'
    },
    student: {
      title: '就活・インターンのご相談', what: '就活・インターンのご相談',
      topics: ['就活の進め方を相談したい', '長期インターンを探したい', '新卒の求人を紹介してほしい', 'ES・面接の相談', 'その他'],
      detailPh: '例）大学3年・文系。IT業界に興味があるが、何から始めればいいか分からない',
      whenAsk: '卒業予定はいつですか？',
      /* 新卒は「転職の時期」が無いので、Airtable には「まずは情報収集・相談から」で入れ、卒業予定は本文に書く */
      when: [['2027年3月卒', T[5]], ['2028年3月卒', T[5]], ['2029年3月卒以降', T[5]], ['既卒・その他', T[5]]],
      scoutAsk: 'あなたに合う求人・インターンが見つかったときに、ご案内をお送りしてもよいですか？'
    },
    freelance: {
      title: '案件・転職のご相談', what: 'フリーランス案件・転職のご相談',
      topics: ['案件を紹介してほしい', '単価・条件の相談', '正社員への転職も考えている', 'その他'],
      detailPh: '例）Javaのバックエンド5年。週4・リモート中心の案件を探している',
      whenAsk: '稼働（参画）できる時期はいつ頃ですか？',
      when: [['すぐ（1ヶ月以内）', T[0]], ['3ヶ月以内', T[1]], ['半年以内', T[2]], ['未定・まずは情報収集', T[5]]],
      scoutAsk: 'あなたに合う案件・求人が見つかったときに、ご案内をお送りしてもよいですか？'
    },
    business: {
      title: '採用のご相談', what: '採用・サービスのお問い合わせ',
      topics: ['サービスの内容を詳しく聞きたい', '料金・お見積りを知りたい', '採用の課題を相談したい', 'その他'],
      detailPh: '例）エンジニアを年内に2名採用したい。今はスカウト媒体を自社で運用している'
    }
  }[MODE] || null;
  if (!M) return;
  var SCOUTS = [['ご案内も受け取る', '希望する'], ['このご相談の返信だけ', '希望しない（このご相談に関する連絡のみ）']];

  var CSS = '.abchat{--abc-acc:#2A4CAE;--abc-acc2:#1E3A8A;--abc-ink:#161A26;--abc-ink2:#4A5261;--abc-paper:#F5F7FA;--abc-surf:#fff;--abc-line:#DDE2EA;position:fixed;right:16px;bottom:16px;z-index:2147483000;font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",Meiryo,system-ui,sans-serif;line-height:1.5;text-align:left;letter-spacing:normal}'
    + '.abchat *{box-sizing:border-box}'
    + '.abchat__launcher{display:inline-flex;align-items:center;gap:8px;border:0;margin:0;cursor:pointer;background:var(--abc-acc);color:#fff;padding:12px 18px;border-radius:999px;font:500 14px/1.2 inherit;font-family:inherit;letter-spacing:.02em;box-shadow:0 6px 20px rgba(22,32,46,.22);transition:background .15s,transform .15s}'
    + '.abchat__launcher:hover{background:var(--abc-acc2);transform:translateY(-1px)}'
    + '.abchat__launcher svg{flex:none}'
    + '.abchat[data-open="true"] .abchat__launcher{display:none}'
    + '.abchat__panel{width:min(380px,calc(100vw - 32px));height:min(600px,calc(100dvh - 32px));display:flex;flex-direction:column;background:var(--abc-paper);border:1px solid var(--abc-line);border-radius:16px;overflow:hidden;box-shadow:0 16px 48px rgba(22,32,46,.24);color:var(--abc-ink)}'
    + '.abchat__panel[hidden]{display:none}'
    + '.abchat__head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 16px;background:#161A26;color:#fff}'
    + '.abchat__title{margin:0;font-size:15px;font-weight:700;color:#fff}'
    + '.abchat__sub{margin:2px 0 0;font-size:11.5px;color:rgba(255,255,255,.72)}'
    + '.abchat__close{background:none;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:0 4px;margin:0}'
    + '.abchat__log{flex:1;overflow-y:auto;padding:16px 14px 8px;display:flex;flex-direction:column;gap:8px}'
    + '.abchat__msg{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word;margin:0}'
    + '.abchat__msg--bot{align-self:flex-start;background:var(--abc-surf);color:var(--abc-ink);border:1px solid var(--abc-line);border-bottom-left-radius:4px}'
    + '.abchat__msg--me{align-self:flex-end;background:var(--abc-acc);color:#fff;border-bottom-right-radius:4px}'
    + '.abchat__msg a,.abchat__err a,.abchat__consent a{color:inherit;text-decoration:underline}'
    + '.abchat__typing{align-self:flex-start;color:#6E7686;font-size:13px;padding:4px 6px}'
    + '.abchat__input{border-top:1px solid var(--abc-line);padding:10px 12px 12px;background:var(--abc-surf)}'
    + '.abchat__input:empty{display:none}'
    + '.abchat__chips{display:flex;flex-wrap:wrap;gap:6px}'
    + '.abchat__chip{border:1px solid var(--abc-acc2);color:var(--abc-acc2);background:var(--abc-surf);border-radius:999px;padding:7px 12px;margin:0;font-size:13px;line-height:1.4;cursor:pointer;text-align:left;font-family:inherit}'
    + '.abchat__chip:hover{background:var(--abc-acc);color:#fff}'
    + '.abchat__row{display:flex;gap:8px;align-items:flex-end}'
    + '.abchat__field{flex:1;min-width:0;width:auto;border:1px solid var(--abc-line);border-radius:10px;padding:9px 11px;margin:0;font-size:16px;line-height:1.5;font-family:inherit;color:var(--abc-ink);background:var(--abc-paper);resize:none;box-shadow:none}'
    + '.abchat__field:focus{outline:2px solid var(--abc-acc2);outline-offset:-1px}'
    + '.abchat__send{border:0;background:var(--abc-acc);color:#fff;border-radius:10px;padding:10px 14px;margin:0;font-size:14px;line-height:1.3;cursor:pointer;white-space:nowrap;font-family:inherit}'
    + '.abchat__send:disabled{opacity:.5;cursor:default}'
    + '.abchat__skip{display:inline-block;margin:6px 0 0;background:none;border:0;color:var(--abc-ink2);font-size:12.5px;text-decoration:underline;cursor:pointer;padding:0;font-family:inherit}'
    + '.abchat__err{margin:6px 0 0;font-size:12.5px;color:#B3261E}'
    + '.abchat__consent{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--abc-ink);margin:0 0 10px;line-height:1.6}'
    + '.abchat__consent input{margin-top:4px}'
    + '.abchat__note{margin:0 0 10px;font-size:12px;color:var(--abc-ink2);line-height:1.6}'
    + '.abchat__hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}'
    + '@media (max-width:480px){.abchat{right:12px;bottom:12px}.abchat[data-open="true"]{left:0;right:0;bottom:0!important;top:0}.abchat[data-open="true"] .abchat__panel{width:100vw;height:100dvh;border-radius:0;border:0}.abchat__launcher{padding:11px 15px;font-size:13px}}'
    + '@media print{.abchat{display:none}}';

  function init() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="abchat" id="abchat" data-open="false">'
      + '<button type="button" class="abchat__launcher" id="abchat-launcher" aria-controls="abchat-panel" aria-expanded="false">'
      + '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4.6 3.5A.9.9 0 0 1 3 20.8V6a2 2 0 0 1 1-2Zm3 6.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"/></svg>'
      + '<span>チャットで相談</span></button>'
      + '<section class="abchat__panel" id="abchat-panel" role="dialog" aria-label="チャットで' + M.title + '" hidden>'
      + '<header class="abchat__head"><div><p class="abchat__title">' + M.title + '</p>'
      + '<p class="abchat__sub">お返事はメールでお届けします（原則2営業日以内）</p></div>'
      + '<button type="button" class="abchat__close" id="abchat-close" aria-label="閉じる">×</button></header>'
      + '<div class="abchat__log" id="abchat-log" aria-live="polite"></div>'
      + '<div class="abchat__input" id="abchat-input"></div>'
      + '<input type="text" id="abchat-site" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="abchat__hp" />'
      + '</section></div>';
    document.body.appendChild(wrap.firstChild);
    run();
  }

  function run() {
    var root = document.getElementById('abchat');
    var panel = document.getElementById('abchat-panel');
    var launcher = document.getElementById('abchat-launcher');
    var closeBtn = document.getElementById('abchat-close');
    var log = document.getElementById('abchat-log');
    var box = document.getElementById('abchat-input');
    var KEY = 'abchat-v2-' + MODE;

    var a = {}, step = 0, done = false, started = false, sending = false;

    function track(name, params) {
      try {
        params = params || {}; params.chat_site = SITE; params.chat_mode = MODE;
        if (typeof window.gtag === 'function') window.gtag('event', name, params);
      } catch (e) {}
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify({ a: a, step: step, done: done })); } catch (e) {} }
    function load() {
      try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.a) { a = d.a; step = d.step || 0; done = !!d.done; } } catch (e) {}
    }
    function clearSaved() { try { localStorage.removeItem(KEY); } catch (e) {} }
    function scroll() { log.scrollTop = log.scrollHeight; }
    function bubble(text, who, html) {
      var el = document.createElement('div');
      el.className = 'abchat__msg abchat__msg--' + who;
      if (html) el.innerHTML = text; else el.textContent = text;
      log.appendChild(el); scroll();
      return el;
    }
    function say(text, instant) {
      return new Promise(function (resolve) {
        if (instant) { bubble(text, 'bot'); resolve(); return; }
        var t = document.createElement('div');
        t.className = 'abchat__typing'; t.textContent = '入力中…';
        log.appendChild(t); scroll();
        setTimeout(function () { t.parentNode && t.parentNode.removeChild(t); bubble(text, 'bot'); resolve(); }, 550);
      });
    }
    function clearInput() { box.innerHTML = ''; }
    try { new MutationObserver(scroll).observe(box, { childList: true, subtree: true }); } catch (e) {}

    function chips(list, onPick) {
      clearInput();
      var w = document.createElement('div'); w.className = 'abchat__chips';
      list.forEach(function (item) {
        var label = Array.isArray(item) ? item[0] : item;
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'abchat__chip'; b.textContent = label;
        b.addEventListener('click', function () { onPick(item, label); });
        w.appendChild(b);
      });
      box.appendChild(w);
    }
    function textInput(opts, onSend) {
      clearInput();
      var row = document.createElement('div'); row.className = 'abchat__row';
      var f = document.createElement(opts.multi ? 'textarea' : 'input');
      f.className = 'abchat__field';
      if (opts.multi) f.rows = 3; else f.type = opts.type || 'text';
      if (opts.autocomplete) f.autocomplete = opts.autocomplete;
      if (opts.inputmode) f.inputMode = opts.inputmode;
      f.placeholder = opts.placeholder || '';
      f.maxLength = opts.max || 200;
      var s = document.createElement('button');
      s.type = 'button'; s.className = 'abchat__send'; s.textContent = '送る';
      var err = document.createElement('p'); err.className = 'abchat__err'; err.hidden = true;
      function go() {
        var v = String(f.value || '').trim();
        var msg = opts.check ? opts.check(v) : (v ? '' : '入力してください');
        if (msg) { err.textContent = msg; err.hidden = false; f.focus(); return; }
        onSend(v);
      }
      s.addEventListener('click', go);
      f.addEventListener('keydown', function (e) {
        /* 1行の欄は Enter で送る。複数行は Ctrl/⌘+Enter。日本語変換中の Enter は無視 */
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        if (opts.multi && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault(); go();
      });
      row.appendChild(f); row.appendChild(s);
      box.appendChild(row); box.appendChild(err);
      if (opts.skip) {
        var k = document.createElement('button');
        k.type = 'button'; k.className = 'abchat__skip'; k.textContent = opts.skip;
        k.addEventListener('click', function () { onSend(''); });
        box.appendChild(k);
      }
      setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) {} }, 30);
    }
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    /* ---------- 質問の流れ（key, 聞き方, 入力） ---------- */
    var Q = [];
    Q.push({ key: 'topic', ask: BIZ ? 'どのようなご用件ですか？' : 'どんなご相談ですか？',
      show: function (next) { chips(M.topics, function (v) { next(v, v); }); } });
    Q.push({ key: 'detail', ask: BIZ ? 'よろしければ、もう少し詳しく教えてください。\n（採用したい職種・人数・時期など）' : 'よろしければ、もう少し詳しく教えてください。\n（今の状況、気になっていること、希望など何でも）',
      show: function (next) {
        textInput({ multi: true, max: 2000, placeholder: M.detailPh, skip: 'スキップする', check: function () { return ''; } },
          function (v) { next(v, v || '（スキップ）'); });
      } });
    if (!BIZ) {
      Q.push({ key: 'when', ask: M.whenAsk,
        show: function (next) { chips(M.when, function (item) { next(item[0], item[0]); }); } });
    } else {
      Q.push({ key: 'company', ask: '貴社名を教えてください。',
        show: function (next) {
          textInput({ autocomplete: 'organization', max: 200, placeholder: '例）株式会社〇〇',
            check: function (v) { return v ? '' : '貴社名を入力してください'; } }, function (v) { next(v, v); });
        } });
    }
    Q.push({ key: 'name', ask: 'お名前を教えてください。',
      show: function (next) {
        textInput({ autocomplete: 'name', max: 100, placeholder: '例）山田 太郎',
          check: function (v) { return v ? '' : 'お名前を入力してください'; } }, function (v) { next(v, v); });
      } });
    Q.push({ key: 'email', ask: 'お返事をお届けするメールアドレスを教えてください。\n※チャット画面ではなく、メールでご返信します。',
      show: function (next) {
        textInput({ type: 'email', autocomplete: 'email', inputmode: 'email', max: 200, placeholder: BIZ ? '例）saiyo@example.co.jp' : '例）taro@example.com',
          check: function (v) { return EMAIL_RE.test(v) ? '' : 'メールアドレスの形式をご確認ください'; } }, function (v) { next(v, v); });
      } });
    if (!BIZ) {
      Q.push({ key: 'scout', ask: M.scoutAsk,
        show: function (next) { chips(SCOUTS, function (item) { next(item[1], item[0]); }); } });
    }

    function shown(i) {
      var k = Q[i].key, v = a[k];
      if (k === 'detail') return v || '（スキップ）';
      if (k === 'scout') { var hit = SCOUTS.filter(function (s) { return s[1] === v; })[0]; return hit ? hit[0] : v; }
      return v;
    }
    function ask(i, instant) {
      if (i >= Q.length) { confirmStep(instant); return; }
      say(Q[i].ask, instant).then(function () {
        Q[i].show(function (value, shownText) {
          a[Q[i].key] = value; step = i + 1; save();
          clearInput(); bubble(shownText, 'me');
          track('chat_step', { step: step });
          ask(i + 1);
        });
      });
    }

    function confirmStep(instant) {
      var who = (BIZ ? a.company + '\n' : '') + a.name + ' 様\n' + a.email;
      say('ありがとうございます。この内容で送信します。\n\n' + who + '\n\n送信後、担当者から上記のアドレスにメールでご連絡します。', instant).then(function () {
        clearInput();
        var cb = null;
        if (BIZ) {
          var n = document.createElement('p'); n.className = 'abchat__note';
          n.textContent = '送信いただいた情報は、お問い合わせ対応の目的にのみ利用いたします。';
          box.appendChild(n);
        } else {
          var lab = document.createElement('label'); lab.className = 'abchat__consent';
          cb = document.createElement('input'); cb.type = 'checkbox';
          var sp = document.createElement('span');
          sp.innerHTML = '<a href="' + PRIVACY_URL + '" target="_blank" rel="noopener">個人情報の取り扱い</a>に同意します';
          lab.appendChild(cb); lab.appendChild(sp); box.appendChild(lab);
        }
        var row = document.createElement('div'); row.className = 'abchat__row';
        var s = document.createElement('button'); s.type = 'button'; s.className = 'abchat__send'; s.textContent = '送信する'; s.style.flex = '1';
        var redo = document.createElement('button'); redo.type = 'button'; redo.className = 'abchat__skip'; redo.textContent = '最初からやり直す';
        var err = document.createElement('p'); err.className = 'abchat__err'; err.hidden = true;
        s.addEventListener('click', function () {
          if (cb && !cb.checked) { err.textContent = '個人情報の取り扱いへの同意にチェックを入れてください'; err.hidden = false; return; }
          submit(s, err);
        });
        redo.addEventListener('click', restart);
        row.appendChild(s);
        box.appendChild(row); box.appendChild(err); box.appendChild(redo);
      });
    }

    function pageLine() {
      var ref = ''; try { ref = sessionStorage.getItem('ab_ref') || ''; } catch (e) {}
      return '（送信ページ：' + location.host + location.pathname + '／' + document.title.slice(0, 80) + (ref ? '／流入元：' + ref : '') + '）';
    }

    function submit(btn, err) {
      if (sending) return;
      var hp = document.getElementById('abchat-site');
      sending = true; btn.disabled = true; btn.textContent = '送信中…'; err.hidden = true;
      var p = BIZ ? sendBusiness(hp) : sendSeeker(hp);
      p.then(function () {
        done = true; save();
        track('chat_send', { topic: a.topic || '' });
        clearInput(); finished(false);
      }).catch(function (e) {
        sending = false; btn.disabled = false; btn.textContent = '送信する';
        err.innerHTML = '送信できませんでした。時間をおいてもう一度お試しいただくか、'
          + (BIZ ? '<a href="https://www.agent-best.net/contact/">お問い合わせフォーム</a>' : '<a href="https://www.agent-best.net/consultation/">相談フォーム</a>')
          + 'または <a href="mailto:' + MAIL + '">' + MAIL + '</a> へご連絡ください。';
        err.hidden = false;
        track('chat_error', { detail: String(e && e.message || '') });
      });
    }

    function sendSeeker(hp) {
      var whenItem = M.when.filter(function (w) { return w[0] === a.when; })[0];
      var lines = ['【サイトのチャットから】' + LABEL, '相談テーマ：' + (a.topic || '')];
      if (MODE !== 'seeker') lines.push(M.whenAsk.replace(/？$/, '') + '：' + (a.when || ''));
      if (a.detail) lines.push('', a.detail);
      lines.push('', pageLine());
      var record = {
        full_name: a.name, email: a.email,
        timing: whenItem ? whenItem[1] : T[5],
        message: lines.join('\n'),
        scout_consent: a.scout || null,
        consent: true,
        source: SITE + '-chat',
        page_path: location.host + location.pathname,
        website: hp ? hp.value : ''
      };
      /* ヘッダーを付けない＝text/plain の単純リクエスト（Apps Script はプリフライトに応えないため） */
      return fetch(NOTIFY_URL, { method: 'POST', body: JSON.stringify({ kind: 'consultation_form', record: record }) })
        .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
        .then(function (j) { if (!j || !/^ok/.test(String(j.result || ''))) throw new Error(String(j && j.result || 'bad reply')); });
    }

    function sendBusiness(hp) {
      if (hp && hp.value) return Promise.resolve();  // bot は成功したふり
      var msg = ['【サイトのチャットから】ご用件：' + (a.topic || '')];
      if (a.detail) msg.push('', a.detail);
      msg.push('', 'お問い合わせ元：' + LABEL + '（チャット）', pageLine());
      var body = new URLSearchParams();
      body.append(FORM_ENTRY.company, a.company || '');
      body.append(FORM_ENTRY.name, a.name || '');
      body.append(FORM_ENTRY.email, a.email || '');
      body.append(FORM_ENTRY.message, msg.join('\n'));
      /* Google フォームは応答を読ませない（no-cors）。ネットワークが通れば受け付けとみなす＝/contact と同じ */
      return fetch(FORM_ACTION, { method: 'POST', mode: 'no-cors', body: body });
    }

    function finished(instant) {
      say('受け付けました。' + (BIZ ? 'お問い合わせ' : 'ご相談') + 'ありがとうございます。\n担当者から ' + a.email + ' あてに、原則2営業日以内にメールでご連絡します。\n\n迷惑メールフォルダに入ることがあるので、届かないときはそちらもご確認ください。', instant).then(function () {
        clearInput();
        var k = document.createElement('button');
        k.type = 'button'; k.className = 'abchat__skip'; k.textContent = BIZ ? '別のお問い合わせを送る' : '別のご相談を送る';
        k.addEventListener('click', restart);
        box.appendChild(k);
      });
    }
    function restart() {
      a = {}; step = 0; done = false; sending = false;
      clearSaved(); log.innerHTML = ''; clearInput();
      greet(false);
    }
    var HELLO = 'こんにちは、エージェントベストです。\n' + M.what + 'を、このチャットで受け付けています。';
    function greet(instant) {
      return say(HELLO + 'いくつか質問にお答えいただくだけで、1〜2分で終わります。', instant)
        .then(function () { ask(0, instant); });
    }
    function start() {
      if (started) return;
      started = true; load();
      if (step === 0 && !done) { greet(false); return; }
      say(HELLO, true);
      for (var i = 0; i < Math.min(step, Q.length); i++) { bubble(Q[i].ask, 'bot'); bubble(shown(i), 'me'); }
      if (done) { finished(true); return; }
      if (step < Q.length) ask(step, true); else confirmStep(true);
    }
    function open() {
      panel.hidden = false;
      root.setAttribute('data-open', 'true');
      if (window.matchMedia('(max-width: 480px)').matches) document.documentElement.style.overflow = 'hidden';
      launcher.setAttribute('aria-expanded', 'true');
      track('chat_open', { page_path: location.pathname });
      start();
    }
    function close() {
      panel.hidden = true;
      root.setAttribute('data-open', 'false');
      document.documentElement.style.overflow = '';
      launcher.setAttribute('aria-expanded', 'false');
      launcher.focus();
    }

    /* 画面下に固定のバー（求人サイトの応募バー・メディアの追従CTAなど）が出ていたら、その上に載せる */
    var AVOID = '.applybar, .sticky-cta, .sticky, .sp-cta, .fixed-cta, .mobile-cta';
    function lift() {
      var h = 0, vh = window.innerHeight;
      try {
        document.querySelectorAll(AVOID).forEach(function (el) {
          if (root.contains(el)) return;
          var cs = getComputedStyle(el);
          if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
          var r = el.getBoundingClientRect();
          if (r.height > 0 && r.bottom > vh - 40 && r.top < vh && r.right > window.innerWidth - 200) h = Math.max(h, vh - r.top);
        });
      } catch (e) {}
      root.style.bottom = h ? Math.round(h + 10) + 'px' : '';
    }
    lift();
    window.addEventListener('resize', lift);
    window.addEventListener('scroll', function () { if (!lift._t) lift._t = setTimeout(function () { lift._t = 0; lift(); }, 150); }, { passive: true });
    try { new MutationObserver(lift).observe(document.body, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
    launcher.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) close(); });
    /* ページ内のリンクから開ける（例：<a href="#chat">チャットで相談</a>） */
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-open-chat], a[href="#chat"]');
      if (t) { e.preventDefault(); open(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
