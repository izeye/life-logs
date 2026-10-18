// Client-side search and per-category listing over every list item on the site.
// The index is built in the browser from the rendered pages, so it always
// matches what the site shows and needs no build step beyond Jekyll's.
(function () {
  var input = document.getElementById('search-input');
  var select = document.getElementById('search-category');
  var results = document.getElementById('search-results');
  var main = document.getElementById('content');
  var categoryList = document.querySelector('#category-list ul');
  var MAX_RESULTS = 500;
  var pagesPromise = null;
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

  // A category is a page; a folder's README stands for the whole folder.
  function toCategories(pages) {
    var cats = pages.map(function (p) {
      var isReadme = /(^|\/)README\.md$/i.test(p.path);
      var key = isReadme ? p.path.replace(/README\.md$/i, '') : p.path;
      var title = key === '' ? 'Home' : p.title.charAt(0).toUpperCase() + p.title.slice(1);
      return { url: p.url, key: key, title: title, isDir: isReadme && key !== '' };
    });
    cats.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    cats.forEach(function (c) {
      c.depth = cats.filter(function (d) {
        return d.isDir && d !== c && c.key.indexOf(d.key) === 0;
      }).length;
    });
    return cats;
  }

  function inCategory(entry, cat) {
    return cat.isDir ? entry.pageUrl.indexOf(cat.url) === 0 : entry.pageUrl === cat.url;
  }

  function loadPages() {
    if (!pagesPromise) {
      pagesPromise = fetch(window.LIFE_LOGS_PAGES)
        .then(function (r) { return r.json(); })
        .then(function (pages) { return { pages: pages, categories: toCategories(pages) }; });
    }
    return pagesPromise;
  }

  function indexPage(page, html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var root = doc.getElementById('content') || doc.body;
    var entries = [];
    var headings = [];
    root.querySelectorAll('h1, h2, h3, h4, h5, h6, li').forEach(function (el) {
      if (el.closest('#category-list')) return;
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
          context: context || page.title,
          url: page.url + (last && last.id ? '#' + last.id : ''),
          link: link ? link.getAttribute('href') : null,
          pageUrl: page.url,
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
      indexPromise = loadPages()
        .then(function (data) {
          return Promise.all(data.pages.map(function (page) {
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

  function render(query, cat, entries) {
    var terms = normalize(query).split(/\s+/).filter(Boolean);
    var hits = entries.filter(function (e) {
      if (cat && !inCategory(e, cat)) return false;
      // Listing a category without a query shows its top-level items only.
      if (!terms.length) return !e.parents;
      return terms.every(function (t) { return e.haystack.indexOf(t) !== -1; });
    });
    var heading = terms.length ? '검색 결과' : escapeHtml(cat.title);
    var html = '<h2>' + heading + ' <span class="meta">' + hits.length + '건' +
      (terms.length && cat ? ' · ' + escapeHtml(cat.title) : '') + '</span></h2>';
    if (!hits.length) {
      html += '<p class="meta">결과가 없습니다. (No results.)</p>';
    } else {
      // A category listing shows everything; only search results are capped.
      var limit = terms.length ? MAX_RESULTS : hits.length;
      var group = null;
      hits.slice(0, limit).forEach(function (e) {
        if (e.context !== group) {
          if (group !== null) html += '</ul>';
          group = e.context;
          html += '<h3><a href="' + escapeHtml(e.url) + '">' + highlight(e.context, terms) + '</a></h3><ul>';
        }
        html += '<li>' + highlight(e.text, terms);
        if (e.link) html += ' <a href="' + escapeHtml(e.link) + '">↗</a>';
        if (e.parents) html += '<br><span class="meta">' + highlight(e.parents, terms) + '</span>';
        html += '</li>';
      });
      html += '</ul>';
      if (hits.length > limit) {
        html += '<p class="meta">상위 ' + MAX_RESULTS + '건만 표시합니다.</p>';
      }
    }
    results.innerHTML = html;
  }

  function update() {
    var query = input.value.trim();
    var catUrl = select.value;
    var url = new URL(location.href);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    if (catUrl) url.searchParams.set('c', catUrl); else url.searchParams.delete('c');
    history.replaceState(null, '', url);
    if (!query && !catUrl) {
      results.hidden = true;
      main.hidden = false;
      return;
    }
    results.hidden = false;
    main.hidden = true;
    results.innerHTML = '<p class="meta">불러오는 중… (Loading…)</p>';
    Promise.all([loadPages(), loadIndex()]).then(function (r) {
      if (input.value.trim() !== query || select.value !== catUrl) return;
      var cat = r[0].categories.filter(function (c) { return c.url === catUrl; })[0] || null;
      render(query, cat, r[1]);
    });
  }

  function indent(depth) {
    return new Array(depth + 1).join('   ');
  }

  function fillCategories(cats) {
    cats.forEach(function (c) {
      var option = document.createElement('option');
      option.value = c.url;
      option.textContent = indent(c.depth) + c.title;
      select.appendChild(option);
    });
  }

  // The home page lists every category with its number of top-level items.
  function fillCategoryList(cats, entries) {
    categoryList.innerHTML = cats.map(function (c) {
      var count = entries.filter(function (e) { return !e.parents && inCategory(e, c); }).length;
      var listUrl = '?c=' + encodeURIComponent(c.url);
      return '<li>' + indent(c.depth) + '<a href="' + escapeHtml(c.url) + '">' + escapeHtml(c.title) +
        '</a> <a class="meta" href="' + escapeHtml(listUrl) + '">' + count + '</a></li>';
    }).join('');
  }

  input.addEventListener('focus', loadIndex);
  input.addEventListener('input', update);
  select.addEventListener('change', update);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; update(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
  });

  var params = new URLSearchParams(location.search);
  loadPages().then(function (data) {
    fillCategories(data.categories);
    select.value = params.get('c') || '';
    input.value = params.get('q') || '';
    if (input.value || select.value) update();
    if (categoryList) {
      loadIndex().then(function (entries) { fillCategoryList(data.categories, entries); });
    }
  });
})();
