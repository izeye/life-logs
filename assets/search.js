// Client-side search over every list item on the site.
// The index is built in the browser from the rendered pages, so it always
// matches what the site shows and needs no build step beyond Jekyll's.
(function () {
  var input = document.getElementById('search-input');
  var results = document.getElementById('search-results');
  var main = document.getElementById('content');
  var MAX_RESULTS = 200;
  var indexPromise = null;

  function normalize(s) {
    return s.normalize('NFC').toLowerCase();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The item's own text, without the text of nested sub-lists.
  function ownText(li) {
    var clone = li.cloneNode(true);
    clone.querySelectorAll('ul, ol').forEach(function (l) { l.remove(); });
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function indexPage(page, html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var root = doc.getElementById('content') || doc.body;
    var entries = [];
    var headings = [];
    root.querySelectorAll('h1, h2, h3, h4, h5, h6, li').forEach(function (el) {
      if (el.tagName === 'LI') {
        var text = ownText(el);
        if (!text) return;
        var parents = [];
        for (var p = el.parentElement.closest('li'); p; p = p.parentElement.closest('li')) {
          parents.unshift(ownText(p));
        }
        var last = headings[headings.length - 1];
        var context = headings.map(function (h) { return h.text; }).join(' › ');
        var link = el.querySelector(':scope > a, :scope > p > a');
        entries.push({
          text: text,
          parents: parents.join(' › '),
          context: context,
          url: page.url + (last && last.id ? '#' + last.id : ''),
          link: link ? link.getAttribute('href') : null,
          pageTitle: page.title,
          haystack: normalize([page.title, context, parents.join(' '), text].join(' '))
        });
      } else {
        var level = Number(el.tagName[1]);
        while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
        headings.push({ level: level, text: el.textContent.trim(), id: el.id });
      }
    });
    return entries;
  }

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(window.LIFE_LOGS_PAGES)
        .then(function (r) { return r.json(); })
        .then(function (pages) {
          return Promise.all(pages.map(function (page) {
            return fetch(page.url)
              .then(function (r) { return r.ok ? r.text() : ''; })
              .then(function (html) { return html ? indexPage(page, html) : []; })
              .catch(function () { return []; });
          }));
        })
        .then(function (lists) { return [].concat.apply([], lists); });
    }
    return indexPromise;
  }

  function highlight(text, terms) {
    var lower = normalize(text);
    var marks = new Array(text.length).fill(false);
    terms.forEach(function (t) {
      for (var i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + 1)) {
        for (var j = i; j < i + t.length; j++) marks[j] = true;
      }
    });
    var out = '';
    var open = false;
    for (var k = 0; k < text.length; k++) {
      if (marks[k] && !open) { out += '<mark>'; open = true; }
      if (!marks[k] && open) { out += '</mark>'; open = false; }
      out += escapeHtml(text[k]);
    }
    return out + (open ? '</mark>' : '');
  }

  function render(query, entries) {
    var terms = normalize(query).split(/\s+/).filter(Boolean);
    var hits = entries.filter(function (e) {
      return terms.every(function (t) { return e.haystack.indexOf(t) !== -1; });
    });
    var html = '<h2>검색 결과 <span class="meta">' + hits.length + '건</span></h2>';
    if (!hits.length) {
      html += '<p class="meta">결과가 없습니다. (No results.)</p>';
    } else {
      html += '<ul>';
      hits.slice(0, MAX_RESULTS).forEach(function (e) {
        var title = highlight(e.text, terms);
        if (e.link) title += ' <a href="' + escapeHtml(e.link) + '">↗</a>';
        var where = [e.context || e.pageTitle, e.parents].filter(Boolean).join(' › ');
        html += '<li>' + title + '<br><a class="meta" href="' + escapeHtml(e.url) + '">' +
          highlight(where, terms) + '</a></li>';
      });
      html += '</ul>';
      if (hits.length > MAX_RESULTS) {
        html += '<p class="meta">상위 ' + MAX_RESULTS + '건만 표시합니다.</p>';
      }
    }
    results.innerHTML = html;
  }

  function update() {
    var query = input.value.trim();
    var url = new URL(location.href);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
    if (!query) {
      results.hidden = true;
      main.hidden = false;
      return;
    }
    results.hidden = false;
    main.hidden = true;
    results.innerHTML = '<p class="meta">불러오는 중… (Loading…)</p>';
    loadIndex().then(function (entries) {
      if (input.value.trim() === query) render(query, entries);
    });
  }

  input.addEventListener('focus', loadIndex);
  input.addEventListener('input', update);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; update(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
  });

  var initial = new URLSearchParams(location.search).get('q');
  if (initial) { input.value = initial; update(); }
})();
