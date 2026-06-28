(function () {
  var p = location.pathname;
  if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
  if (p === '' || p === '/') return;

  var links = [
    { href: '/', label: 'YanaStocks Docs', cls: 'home' },
    { sep: true },
    { href: '/portfolio-api', label: 'Portfolio API' },
    { href: '/portfolio-service', label: 'Portfolio Service' },
    { href: '/profile-service', label: 'Profile Service' },
    { href: '/price-processor', label: 'Price Processor' },
    { href: '/auth-service', label: 'Auth Service' },
  ];

  function buildNav() {
    var nav = document.createElement('nav');
    nav.id = 'yn';
    links.forEach(function (l) {
      if (l.sep) {
        var d = document.createElement('div');
        d.className = 'sep';
        nav.appendChild(d);
        return;
      }
      var a = document.createElement('a');
      a.href = l.href;
      a.textContent = l.label;
      if (l.cls) a.className = l.cls;
      if (l.href === p || (p === '' && l.href === '/')) a.classList.add('cur');
      nav.appendChild(a);
    });
    document.body.insertBefore(nav, document.body.firstChild);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildNav);
  else buildNav();
})();
