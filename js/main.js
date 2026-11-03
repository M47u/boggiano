/**
 * Fiambrería Boggiano — front-end behaviour.
 * Data comes from data/*.json; every value is inserted with textContent,
 * never innerHTML, so a typo in the JSON can't inject markup.
 */
(() => {
  'use strict';

  const DATA_URLS = {
    catalog: 'data/catalogo.json',
    branches: 'data/sucursales.json',
  };
  const CITY_FALLBACK = 'Formosa';
  const WHATSAPP_GREETING = 'Hola, les escribo desde la web de Fiambrería Boggiano.';
  const MAX_CV_BYTES = 2 * 1024 * 1024;
  const DESKTOP_QUERY = '(min-width: 60em)';

  /* ---------- Helpers ---------- */

  const $ = (selector, context = document) => context.querySelector(selector);

  /** Minimal element factory: el('a', { class: 'btn', href: '#' }, ['text']) */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    return response.json();
  }

  function showLoadError(container, message) {
    container.replaceChildren(el('p', { class: 'notice', text: message }));
  }

  const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');
  const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

  /**
   * Phones are stored as local numbers with area code and without 0/15
   * (e.g. "370 503-5029"). Argentine mobiles need 54 + 9 on WhatsApp.
   */
  function toWhatsAppUrl(phone, text = WHATSAPP_GREETING) {
    const digits = digitsOnly(phone);
    return digits ? `https://wa.me/549${digits}?text=${encodeURIComponent(text)}` : null;
  }

  function toTelHref(phone) {
    const digits = digitsOnly(phone);
    return digits ? `tel:+54${digits}` : null;
  }

  function toMapsUrl(branch) {
    const hasCoords = typeof branch.lat === 'number' && typeof branch.lng === 'number';
    const query = hasCoords
      ? `${branch.lat},${branch.lng}`
      : `${branch.direccion}, ${branch.ciudad || CITY_FALLBACK}, Argentina`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  const priceFormatter = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });

  /** Accepts a number (formatted as ARS) or free text such as "$ 9.500 el kg". */
  function formatPrice(price) {
    if (isBlank(price)) return null;
    return typeof price === 'number' ? priceFormatter.format(price) : String(price).trim();
  }

  /* ---------- Navigation ---------- */

  function initNav() {
    const toggle = $('.nav-toggle');
    const menu = $('#primary-nav');
    if (!toggle || !menu) return;

    const label = $('.visually-hidden', toggle);
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      label.textContent = open ? 'Cerrar menú' : 'Abrir menú';
      menu.classList.toggle('is-open', open);
      document.body.classList.toggle('nav-open', open);
    };

    toggle.addEventListener('click', () => setOpen(!isOpen()));

    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });

    window.matchMedia(DESKTOP_QUERY).addEventListener('change', (event) => {
      if (event.matches) setOpen(false);
    });
  }

  /* ---------- Catalog ---------- */

  function renderProduct(product) {
    const price = formatPrice(product.precio);
    return el('li', { class: 'product-card' }, [
      el('img', {
        src: product.imagen,
        alt: product.nombre,
        width: 400,
        height: 300,
        loading: 'lazy',
        decoding: 'async',
      }),
      el('div', { class: 'product-body' }, [
        el('h4', { class: 'product-name', text: product.nombre }),
        isBlank(product.descripcion) ? null : el('p', { class: 'product-desc', text: product.descripcion }),
        price ? el('p', { class: 'product-price', text: price }) : null,
      ]),
    ]);
  }

  function renderCatalog(data) {
    const container = $('#catalog');
    const filtersBox = $('#catalog-filters');
    const categories = Array.isArray(data.categorias) ? data.categorias : [];
    const products = Array.isArray(data.productos) ? data.productos : [];

    const groups = categories
      .map((category) => ({
        category,
        items: products.filter((product) => product.categoria === category.id),
      }))
      .filter((group) => group.items.length > 0);

    if (groups.length === 0) {
      showLoadError(container, 'Todavía no hay productos cargados.');
      return;
    }

    const groupNodes = groups.map(({ category, items }) => {
      const titleId = `cat-${category.id}`;
      return el('section', { class: 'catalog-group', 'data-category': category.id, 'aria-labelledby': titleId }, [
        el('h3', { class: 'catalog-group-title', id: titleId, text: category.nombre }),
        el('ul', { class: 'product-grid' }, items.map(renderProduct)),
      ]);
    });
    container.replaceChildren(...groupNodes);

    const filters = [{ id: 'all', nombre: 'Todos' }, ...groups.map((group) => group.category)];
    const buttons = filters.map((filter) =>
      el('button', {
        class: 'filter-btn',
        type: 'button',
        'data-filter': filter.id,
        'aria-pressed': String(filter.id === 'all'),
        'aria-controls': 'catalog',
        text: filter.nombre,
      })
    );
    filtersBox.replaceChildren(...buttons);

    filtersBox.addEventListener('click', (event) => {
      const button = event.target.closest('.filter-btn');
      if (!button) return;
      const selected = button.dataset.filter;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      groupNodes.forEach((node) => {
        node.hidden = selected !== 'all' && node.dataset.category !== selected;
      });
    });
  }

  async function initCatalog() {
    const container = $('#catalog');
    if (!container) return;
    try {
      renderCatalog(await fetchJSON(DATA_URLS.catalog));
    } catch (error) {
      console.error(error);
      showLoadError(container, 'No pudimos cargar el catálogo. Probá de nuevo en unos minutos.');
    }
  }

  /* ---------- Branches ---------- */

  function infoRow(label, content) {
    return [el('dt', { text: label }), el('dd', {}, content)];
  }

  function renderBranch(branch) {
    const telHref = toTelHref(branch.telefono);
    const whatsappUrl = branch.whatsapp !== false ? toWhatsAppUrl(branch.telefono) : null;
    const cityLine = branch.ciudad || CITY_FALLBACK;

    const info = [
      ...infoRow('Dirección', el('address', {}, [branch.direccion, el('br'), cityLine])),
      ...infoRow('Horarios', branch.horarios || 'A confirmar'),
    ];
    if (telHref) {
      info.push(...infoRow('Teléfono', el('a', { href: telHref, text: branch.telefono })));
    }

    const actions = [
      el('a', {
        class: 'btn btn-secondary btn-sm',
        href: toMapsUrl(branch),
        target: '_blank',
        rel: 'noopener',
      }, [
        'Cómo llegar',
        el('span', { class: 'visually-hidden', text: ` a la sucursal ${branch.nombre} (se abre Google Maps)` }),
      ]),
    ];
    if (whatsappUrl) {
      actions.push(el('a', {
        class: 'btn btn-whatsapp btn-sm',
        href: whatsappUrl,
        target: '_blank',
        rel: 'noopener',
      }, [
        'WhatsApp',
        el('span', { class: 'visually-hidden', text: ` de la sucursal ${branch.nombre} (se abre en una pestaña nueva)` }),
      ]));
    }

    return el('article', { class: 'branch-card' }, [
      el('h3', { class: 'branch-name', text: branch.nombre }),
      el('dl', { class: 'branch-info' }, info),
      el('div', { class: 'branch-actions' }, actions),
    ]);
  }

  function populateBranchSelect(branches) {
    const select = $('#sucursal');
    if (!select) return;
    branches.forEach((branch) => {
      select.append(el('option', { value: branch.id, text: branch.nombre }));
    });
  }

  function renderFooterPhones(branches) {
    const list = $('#footer-phones');
    if (!list) return;
    const items = branches
      .filter((branch) => toTelHref(branch.telefono))
      .map((branch) =>
        el('li', {}, [
          el('a', { href: toTelHref(branch.telefono), text: branch.telefono }),
          ` (${branch.nombre})`,
        ])
      );
    if (items.length) list.replaceChildren(...items);
  }

  async function initBranches() {
    const container = $('#branch-list');
    if (!container) return;
    try {
      const data = await fetchJSON(DATA_URLS.branches);
      const branches = Array.isArray(data.sucursales) ? data.sucursales : [];
      container.replaceChildren(...branches.map(renderBranch));
      populateBranchSelect(branches);
      renderFooterPhones(branches);
    } catch (error) {
      console.error(error);
      showLoadError(container, 'No pudimos cargar las sucursales. Probá de nuevo en unos minutos.');
    }
  }

  /* ---------- Careers form ---------- */

  const NAME_PATTERN = /^[\p{L}][\p{L}\s'.-]{1,59}$/u;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const validators = {
    nombre: (value) => (NAME_PATTERN.test(value) ? '' : 'Ingresá tu nombre (solo letras).'),
    apellido: (value) => (NAME_PATTERN.test(value) ? '' : 'Ingresá tu apellido (solo letras).'),
    dni: (value) => {
      const digits = value.replace(/\./g, '');
      return /^\d{7,8}$/.test(digits) ? '' : 'Ingresá un DNI válido: 7 u 8 números, sin puntos.';
    },
    telefono: (value) => {
      const digits = digitsOnly(value);
      return /^[\d\s()+-]+$/.test(value) && digits.length >= 8 && digits.length <= 15
        ? ''
        : 'Ingresá un teléfono válido con código de área.';
    },
    email: (value) => (EMAIL_PATTERN.test(value) ? '' : 'Ingresá un email válido.'),
    sucursal: (value) => (value ? '' : 'Elegí una sucursal.'),
    mensaje: (value) => (value.length <= 1000 ? '' : 'El mensaje puede tener hasta 1000 caracteres.'),
    cv: (_value, input) => {
      const file = input.files && input.files[0];
      if (!file) return 'Adjuntá tu CV en PDF.';
      const isPdfName = /\.pdf$/i.test(file.name);
      const isPdfType = file.type === '' || file.type === 'application/pdf';
      if (!isPdfName || !isPdfType) return 'El CV tiene que ser un archivo PDF.';
      if (file.size > MAX_CV_BYTES) return 'El archivo supera los 2 MB.';
      return '';
    },
  };

  function setFieldError(input, message) {
    const errorNode = document.getElementById(`${input.id}-error`);
    if (errorNode) errorNode.textContent = message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function validateField(input) {
    const validate = validators[input.name];
    if (!validate) return true;
    const message = validate(input.value.trim(), input);
    setFieldError(input, message);
    return message === '';
  }

  function initCareersForm() {
    const form = $('#cv-form');
    if (!form) return;

    const submitButton = $('#cv-submit', form);
    const status = $('#form-status', form);
    const fields = Object.keys(validators)
      .map((name) => form.elements.namedItem(name))
      .filter(Boolean);

    const setStatus = (type, message) => {
      status.className = `form-status${type ? ` is-${type}` : ''}`;
      status.textContent = message;
    };

    fields.forEach((input) => {
      // Validate on blur; once a field shows an error, re-check it while typing.
      input.addEventListener('blur', () => validateField(input));
      const liveEvent = input.type === 'file' || input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(liveEvent, () => {
        if (input.getAttribute('aria-invalid') === 'true' || liveEvent === 'change') validateField(input);
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus('', '');

      const invalid = fields.filter((input) => !validateField(input));
      if (invalid.length) {
        setStatus('error', 'Revisá los campos marcados.');
        invalid[0].focus();
        return;
      }

      const originalLabel = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = 'Enviando…';

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json' },
        });
        const result = await response.json().catch(() => ({}));

        if (response.ok && result.ok) {
          form.reset();
          fields.forEach((input) => setFieldError(input, ''));
          setStatus('success', result.message || '¡Gracias! Recibimos tu postulación.');
        } else {
          const serverErrors = result.errors || {};
          Object.entries(serverErrors).forEach(([name, message]) => {
            const input = form.elements.namedItem(name);
            if (input) setFieldError(input, message);
          });
          setStatus('error', result.message || 'No pudimos enviar tu postulación. Probá de nuevo.');
        }
      } catch (error) {
        console.error(error);
        setStatus('error', 'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.');
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
        status.focus();
      }
    });
  }

  /* ---------- Boot ---------- */

  function initYear() {
    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  initYear();
  initNav();
  initCatalog();
  initBranches();
  initCareersForm();
})();
