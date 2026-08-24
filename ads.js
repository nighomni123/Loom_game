'use strict';

/* ============================================================
   LOOM — ad slots
   Fills every [data-ad-slot] container on the page.

   Until an ad network is configured, each slot renders a quiet
   "house" placeholder, so the reserved space (and the revenue
   layout) is real from day one — with zero third-party requests.

   To go live with Google AdSense:
     1. Get approved and create display ad units.
     2. Set ADSENSE_CLIENT to your 'ca-pub-…' publisher id below.
     3. Put each unit's numeric id into SLOTS.
     4. Uncomment the record in ads.txt (same pub id) and deploy.
   The AdSense loader is injected only once ADSENSE_CLIENT is set,
   so the unconfigured site stays tracker-free and works offline.

   Ads must NEVER break gameplay: everything here is isolated from
   app.js and wrapped in try/catch.
   ============================================================ */

(function () {
    // ---- Configuration -------------------------------------------------

    // Your AdSense publisher id, e.g. 'ca-pub-1234567890123456'.
    const ADSENSE_CLIENT = '';

    // Numeric ad-unit ids from your AdSense account, per slot.
    const SLOTS = {
        footer:    '', // leaderboard under the console
        intro:     '', // banner at the foot of the welcome modal
        win:       '', // banner at the foot of the win modal
        railLeft:  '', // 160x600 skyscraper in the left margin (wide screens)
        railRight: '', // 160x600 skyscraper in the right margin (wide screens)
    };

    // Fixed-size slots; every other slot is a responsive unit that fills
    // the space reserved for it in style.css (.ad-* rules).
    const FIXED = {
        railLeft:  { w: 160, h: 600 },
        railRight: { w: 160, h: 600 },
    };

    // ---- House placeholders --------------------------------------------

    const HOUSE_CREATIVES = [
        { title: 'Keep LOOM free', sub: 'This space will carry small sponsor messages that keep the loom running.' },
        { title: 'Woven by hand', sub: 'No trackers on your cloth — just warp, weft and a little math.' },
        { title: 'Tell a friend', sub: 'The best gift for a puzzle mind is a puzzle they haven\u2019t solved yet.' },
    ];

    // Deterministic pick so screenshots and repeats stay stable.
    function creativeFor(key) {
        let hash = 0;
        for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
        return HOUSE_CREATIVES[hash % HOUSE_CREATIVES.length];
    }

    function buildHouseCreative(key) {
        const c = creativeFor(key);
        const wrap = document.createElement('div');
        wrap.className = 'house-ad';

        const stripes = document.createElement('span');
        stripes.className = 'ha-stripes';
        stripes.setAttribute('aria-hidden', 'true');
        wrap.appendChild(stripes);

        const title = document.createElement('span');
        title.className = 'ha-title';
        title.textContent = c.title;
        wrap.appendChild(title);

        if (c.sub) {
            const sub = document.createElement('span');
            sub.className = 'ha-sub';
            sub.textContent = c.sub;
            wrap.appendChild(sub);
        }
        return wrap;
    }

    // ---- AdSense mounting -----------------------------------------------

    function injectAdsenseLoader() {
        if (document.getElementById('loom-adsense-loader')) return;
        const script = document.createElement('script');
        script.id = 'loom-adsense-loader';
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
            encodeURIComponent(ADSENSE_CLIENT);
        document.head.appendChild(script);
    }

    function mountAdsense(body, key) {
        injectAdsenseLoader();
        const ins = document.createElement('ins');
        ins.className = 'adsbygoogle';
        ins.style.display = 'block';
        const fixed = FIXED[key];
        if (fixed) {
            ins.style.width = fixed.w + 'px';
            ins.style.height = fixed.h + 'px';
        } else {
            ins.setAttribute('data-ad-format', 'auto');
            ins.setAttribute('data-full-width-responsive', 'true');
        }
        ins.setAttribute('data-ad-client', ADSENSE_CLIENT);
        ins.setAttribute('data-ad-slot', SLOTS[key] || '');
        body.appendChild(ins);
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blockers etc. */ }
    }

    // ---- Slot filling -----------------------------------------------------

    function fillSlot(container) {
        if (container.dataset.adReady === 'true') return;
        container.dataset.adReady = 'true';

        const key = container.dataset.adSlot;

        const label = document.createElement('span');
        label.className = 'ad-label';
        label.textContent = 'Advertisement';

        const body = document.createElement('div');
        body.className = 'ad-body';

        container.appendChild(label);
        container.appendChild(body);

        if (ADSENSE_CLIENT && SLOTS[key]) {
            mountAdsense(body, key);
        } else {
            body.appendChild(buildHouseCreative(key));
        }

        // Side rails ship `hidden` so no empty box flashes before this runs;
        // CSS still hides them below 1420px viewports.
        if (container.classList.contains('ad-rail')) container.hidden = false;
    }

    function init() {
        try {
            document.querySelectorAll('[data-ad-slot]').forEach(fillSlot);
        } catch (e) { /* ads must never break the game */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
