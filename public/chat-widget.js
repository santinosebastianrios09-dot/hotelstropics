// mvp_AGENTS/src/web/public/chat-widget.js
(function () {
  document.body.classList.add('cw-docked');

  // Lanzador (interruptor)
  const launcher = document.createElement('button');
  launcher.id = 'cw-launcher';
  launcher.textContent = 'Asistente personal'; // ← texto solicitado
  document.body.appendChild(launcher);

  // Panel del chat
  const panel = document.createElement('div');
  panel.id = 'cw-panel';
  panel.innerHTML = `
    <div id="cw-head">
      <div id="cw-title">Asistente de Reservas</div>
      <button id="cw-close" title="Cerrar" aria-label="Cerrar">✕</button>
    </div>
    <div id="cw-body"></div>
    <div id="cw-foot">
      <input id="cw-text" type="text" placeholder="Escriba su mensaje..." />
      <button id="cw-send" title="Enviar">Enviar</button>
    </div>`;
  document.body.appendChild(panel);

  // Botón fijo lateral (único en todos los flujos)
  const stickyBack = document.createElement('button');
  stickyBack.id = 'cw-sticky-back';
  stickyBack.textContent = '← Volver';
  stickyBack.title = 'Volver';
  stickyBack.setAttribute('aria-label', 'Volver');
  stickyBack.style.display = 'none';
  stickyBack.addEventListener('click', () => showMainOptions());
  panel.appendChild(stickyBack);

  // ───── TEXTO GUÍA ─────
  const hint = document.createElement('div');
  hint.id = 'cw-hint';
  hint.style.cssText =
    'display:none;font-size:12px;color:#6b7280;padding:6px 10px;background:#fff;border-top:1px solid #eef2f7;';
  panel.appendChild(hint);
  function showHint(t){ hint.textContent = t; hint.style.display = 'block'; }
  function hideHint(){ hint.style.display = 'none'; }

  const body = panel.querySelector('#cw-body');
  const input = panel.querySelector('#cw-text');
  const sendBtn = panel.querySelector('#cw-send');
  const closeBtn = panel.querySelector('#cw-close');

  const API = location.origin;
  const state = { mode: 'idle', draft: {}, rooms: [], returnToEditHub: false };

  // --- Apertura/cierre ---
  function openPanel() {
    panel.classList.add('open');
    setTimeout(() => input && input.focus(), 50);
  }
  function closePanel() { panel.classList.remove('open'); }
  function togglePanel() { panel.classList.contains('open') ? closePanel() : openPanel(); }
  launcher.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) closePanel(); });

  // ───────────── Fechas/helpers ─────────────
  function parseToISO(dateStr) {
    const m = String(dateStr || '').trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!m) return null;
    const [, d, mth, y] = m;
    const day = String(d).padStart(2, '0');
    const month = String(mth).padStart(2, '0');
    return `${y}-${month}-${day}`;
  }
  function validDateDMY(s) { return /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.test(String(s||'').trim()); }
  function diffNightsISO(a, b) {
    if (!a || !b) return 0;
    const A = new Date(a + 'T00:00:00Z').getTime();
    const B = new Date(b + 'T00:00:00Z').getTime();
    const ms = B - A;
    return ms > 0 ? Math.round(ms / 86400000) : 0;
  }
  function formatISO(d){ return d.toISOString().slice(0,10); }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

  // ───────────── UI helpers ─────────────
  function clearBody(title) {
    body.innerHTML = '';
    if (title) {
      const head = document.createElement('div');
      head.className = 'cw-msg cw-bot';
      head.innerHTML = `<b>${title}</b>`;
      body.appendChild(head);
    }
    body.scrollTop = body.scrollHeight;
  }
  function chip(label, onClick) {
    const el = document.createElement('button');
    el.className = 'cw-chip';
    el.textContent = label;
    el.onclick = () => {
      if (typeof onClick === 'function') onClick();
      else { input.value = label; handleSend(); }
    };
    return el;
  }
  function pushBot(text, chips) {
    const b = document.createElement('div');
    b.className = 'cw-msg cw-bot';
    if (Array.isArray(chips) && chips.length) {
      const p = document.createElement('p');
      p.innerHTML = text;
      b.appendChild(p);
      const div = document.createElement('div');
      div.className = 'cw-chips';
      chips.forEach(c => div.appendChild(c));
      b.appendChild(div);
    } else b.innerHTML = text;
    body.appendChild(b);
    body.scrollTop = body.scrollHeight;
  }
  function pushUser(text) {
    const u = document.createElement('div');
    u.className = 'cw-msg cw-user';
    u.textContent = text;
    body.appendChild(u);
    body.scrollTop = body.scrollHeight;
  }
  function pushButton(label, onclick) {
    const wrap = document.createElement('div');
    wrap.className = 'cw-msg cw-bot';
    const btn = document.createElement('button');
    btn.className = 'cw-btn';
    btn.textContent = label;
    btn.onclick = onclick;
    wrap.appendChild(btn);
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }
  function card(html){ const div=document.createElement('div'); div.className='cw-card'; div.innerHTML=html; return div; }
  function htmlesc(x){ return String(x).replace(/[&<>"]/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }

  // ───────────── Helper: paso único (wizard) para reserva ─────────────
  function showStep(opts){
    // opts: { title?:string, html:string, chips?:HTMLElement[], actions?:HTMLElement[] }
    clearBody(opts.title || 'Hacer una reserva');
    const step = document.createElement('div');
    step.className = 'cw-card';
    step.id = 'cw-step';
    step.innerHTML = opts.html || '';
    body.appendChild(step);

    if (Array.isArray(opts.chips) && opts.chips.length){
      const chipsWrap = document.createElement('div');
      chipsWrap.className = 'cw-chips';
      opts.chips.forEach(c => chipsWrap.appendChild(c));
      body.appendChild(chipsWrap);
    }
    if (Array.isArray(opts.actions) && opts.actions.length){
      const actions = document.createElement('div');
      actions.className = 'cw-step-actions';
      opts.actions.forEach(a => actions.appendChild(a));
      body.appendChild(actions);
    }
    body.scrollTop = body.scrollHeight;
  }

  // ───────────── Hub de edición (nuevo): permite editar 1+ campos y confirmar
  function showEditItemsHub(){
    state.mode = 'edit_hub';
    showStep({
      title:'Editar datos',
      html: `
        <div style="font-size:14px;color:#374151;margin-bottom:8px">Seleccione qué desea cambiar:</div>
        <div class="cw-list">
          <button class="cw-btn" id="edit-nombre">Nombre: <b>${htmlesc(state.draft?.nombre||'(sin especificar)')}</b></button>
          <button class="cw-btn" id="edit-hab">Habitación: <b>${htmlesc(state.draft?.habitacion||'(a confirmar)')}</b></button>
          <button class="cw-btn" id="edit-fechas">Fechas: <b>${htmlesc(state.draft?.fechaEntrada||'—')} → ${htmlesc(state.draft?.fechaSalida||'—')}</b></button>
          <button class="cw-btn" id="edit-pax">Personas: <b>${htmlesc(state.draft?.pax||'(sin especificar)')}</b></button>
          <button class="cw-btn" id="edit-email">Email: <b>${htmlesc(state.draft?.email||'(sin especificar)')}</b></button>
          <button class="cw-btn" id="edit-tel">Teléfono: <b>${htmlesc(state.draft?.telefono||'(opcional)')}</b></button>
        </div>`
    });

    const actions = document.createElement('div');
    actions.className = 'cw-step-actions';
    const cancel = document.createElement('button');
    cancel.className = 'cw-btn';
    cancel.textContent = 'Cancelar';
    cancel.onclick = showConfirm;
    const ok = document.createElement('button');
    ok.className = 'cw-btn cw-prim';
    ok.textContent = 'Confirmar datos';
    ok.onclick = () => { state.returnToEditHub = false; showConfirm(); };
    actions.appendChild(cancel);
    actions.appendChild(ok);
    body.appendChild(actions);

    body.querySelector('#edit-nombre').onclick = () => { state.returnToEditHub = true; askReservaNombre(); };
    body.querySelector('#edit-hab').onclick    = () => { state.returnToEditHub = true; askReservaHabitacion(); };
    body.querySelector('#edit-fechas').onclick = () => { state.returnToEditHub = true; askReservaEntrada(); };
    body.querySelector('#edit-pax').onclick    = () => { state.returnToEditHub = true; askReservaPax(); };
    body.querySelector('#edit-email').onclick  = () => { state.returnToEditHub = true; askReservaEmail(); };
    body.querySelector('#edit-tel').onclick    = () => { state.returnToEditHub = true; askReservaTelefono(); };
  }

  // ───────────── Home (MENÚ PRINCIPAL) ─────────────
  function showMainOptions() {
    state.mode = 'idle';
    state.draft = {};
    state.returnToEditHub = false;
    hideHint();
    clearBody();
    stickyBack.style.display = 'none';
    pushBot('¿Qué le gustaría hacer?', [
      chip('🗨️ Hacer una consulta', () => openConsultaFlow()),
      chip('📅 Consultar disponibilidad', () => openDisponibilidadFlow()),
      chip('🛎️ Hacer una reserva', () => openReservaFlow()),
    ]);
  }

  // ───────────── Carga catálogo habitaciones ─────────────
  async function loadRooms() {
    try {
      const r = await fetch(API + '/api/web/rooms');
      const j = await r.json();
      state.rooms = j.rooms || [];
    } catch { state.rooms = []; }
  }

  // ───────────── FLUJO: CONSULTAS (relay TG) ─────────────
  function openConsultaFlow() {
    clearBody('Consultas');
    state.mode = 'post_qna';
    pushBot('¡Perfecto! Escriba su consulta y en un momento le responderemos.');
    showHint('Puede escribir sus preguntas libremente. Cuando finalice, utilice “← Volver” para regresar al menú.');
    stickyBack.style.display = 'block';
  }

  // === NUEVO: saludos + intención (disponibilidad / reserva) en una sola frase ===
  const RE_BOOK = /(\breservar\b|\bhacer una reserva\b|\bquiero reservar\b|\bquiero hacer una reserva\b|\bbooking\b|\bbook\b)/i;
  const RE_HOLA = /\b(hola|buenas|buen[oa]s?\s+(tardes?|noches?|d[ií]as?)|hello|hi)\b/i;
  const RE_COMOESTA = /(c[oó]mo\s+est[aá]s?\??|qu[eé]\s+tal\??)/i;
  const RE_AVAIL = /(que|qué)?\s*habitaciones?\s+(hay\s+)?disponibles?|ver\s+(la\s+)?disponibilidad|disponibilidad\s+de\s+habitaciones?/i;

  function buildGreetingResponse(text) {
    const t = (text || '').toLowerCase();
    const h = new Date().getHours();

    if (/buenas\s+noches/.test(t)) return '¡Buenas noches! ¿En qué puedo ayudarte?';
    if (/buenas\s+tardes/.test(t)) return '¡Buenas tardes! ¿En qué puedo ayudarte?';
    if (/buen[oa]s?\s+d[ií]as/.test(t)) return '¡Buenos días! ¿En qué puedo ayudarte?';

    if (RE_HOLA.test(t)) {
      if (h >= 19 || h < 6) return '¡Hola! ¡Buenas noches! ¿En qué puedo ayudarte?';
      if (h >= 12 && h < 19) return '¡Hola! ¡Buenas tardes! ¿En qué puedo ayudarte?';
      return '¡Hola! ¡Buenos días! ¿En qué puedo ayudarte?';
    }
    if (RE_COMOESTA.test(t)) return '¡Muy bien! Gracias por preguntar 😊 ¿En qué puedo ayudarte?';
    return null;
  }

  async function sendConsulta(text) {
    const t = String(text||'');
    const greet = buildGreetingResponse(t);
    const wantsAvail = RE_AVAIL.test(t);
    const wantsBook  = RE_BOOK.test(t);

    if (greet && (wantsAvail || wantsBook)) {
      pushBot(greet);
      if (wantsAvail) { openDisponibilidadFlow(); pushBot('Te llevo a "Consultar disponibilidad" para ver opciones y fechas.'); return; }
      if (wantsBook)  { openReservaFlow();        pushBot('Perfecto, te llevo a "Hacer una reserva".'); return; }
    }
    if (wantsAvail) {
      openDisponibilidadFlow();
      pushBot('Te llevo a "Consultar disponibilidad" para ver opciones y fechas.');
      return;
    }
    if (wantsBook) {
      openReservaFlow();
      pushBot('Perfecto, te llevo a "Hacer una reserva".');
      return;
    }
    if (greet) {
      pushBot(greet);
      return;
    }

    // Default
    pushBot('Por favor, aguarde un momento. En breve responderemos su consulta. Gracias.');
    try {
      const r = await fetch(API + '/api/web/consulta', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ pregunta: text })
      });
      const j = await r.json();
      if (j.respuesta) pushBot(j.respuesta);
      if (j.token) {
        let done = false;
        const poll = async () => {
          if (done) return;
          try {
            const rr = await fetch(API + '/api/web/consulta/wait?token=' + encodeURIComponent(j.token));
            if (rr.status === 200) {
              const jj = await rr.json();
              if (jj.respuesta) { pushBot(jj.respuesta); done = true; return; }
            }
            if (rr.status === 204) setTimeout(poll, 2000);
            else setTimeout(poll, 4000);
          } catch { setTimeout(poll, 4000); }
        };
        poll();
      } else {
        pushBot('Gracias. En breve le responderemos.');
      }
    } catch {
      try {
        const r = await fetch(API + '/api/web/rooms');
        const j = await r.json();
        const names = (j.rooms || []).map(r => '• ' + r.name).join('<br>');
        pushBot(names ? 'Habitaciones disponibles ahora:<br>' + names : 'No fue posible obtener las habitaciones disponibles en este momento.');
      } catch {
        pushBot('No fue posible enviar su consulta. Por favor, inténtelo nuevamente.');
      }
    }
  }

  // ───────────── FLUJO: DISPONIBILIDAD ─────────────
  function buildMonthGrid(baseDate){
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay()+6)%7)); // lunes
    const cells = [];
    for(let i=0;i<42;i++){ cells.push(addDays(start,i)); }
    return { year, month, cells };
  }

  function openDisponibilidadFlow() {
    clearBody('Consultar disponibilidad');
    hideHint();
    state.mode = 'disp';
    stickyBack.style.display = 'block';

    const wrap = document.createElement('div');
    wrap.className = 'cw-card';
    wrap.innerHTML = `
      <div class="cw-cal-head">
        <button id="cal-prev" class="cw-btn">‹</button>
        <div id="cal-title" style="font-weight:700"></div>
        <button id="cal-next" class="cw-btn">›</button>
      </div>
      <div class="cw-cal-grid" id="cal-grid"></div>
      <div class="cw-cal-foot"
           style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
        <div>Desde: <span id="sel-from">—</span> · Hasta: <span id="sel-to">—</span></div>
        <button id="cal-confirm" class="cw-btn" disabled>Ver disponibilidad</button>
      </div>
      <div id="disp-results" style="margin-top:10px;"></div>`;
    body.appendChild(wrap);

    const title = wrap.querySelector('#cal-title');
    const grid  = wrap.querySelector('#cal-grid');
    const selFrom = wrap.querySelector('#sel-from');
    const selTo   = wrap.querySelector('#sel-to');
    const confirm = wrap.querySelector('#cal-confirm');
    const results = wrap.querySelector('#disp-results');

    let viewDate = new Date();
    let from = null, to = null;

    function renderMonth(){
      const {year, month, cells} = buildMonthGrid(viewDate);
      title.textContent = new Date(year, month, 1).toLocaleDateString(undefined, { month:'long', year:'numeric' });
      grid.innerHTML = `<div class="cw-dow">L</div><div class="cw-dow">M</div><div class="cw-dow">M</div><div class="cw-dow">J</div><div class="cw-dow">V</div><div class="cw-dow">S</div><div class="cw-dow">D</div>`;
      cells.forEach(d => {
        const b = document.createElement('button');
        b.className = 'cw-day';
        b.textContent = String(d.getDate());
        if (d.getMonth() !== month) b.classList.add('cw-muted');
        if (from && sameDay(d, from)) b.classList.add('cw-sel-from');
        if (to && sameDay(d, to)) b.classList.add('cw-sel-to');
        if (from && to && d >= from && d <= to) b.classList.add('cw-in-range');
        b.onclick = () => {
          if(!from || (from && to)){ from = d; to = null; }
          else if (d < from) { to = from; from = d; }
          else { to = d; }
          selFrom.textContent = from ? formatISO(from) : '—';
          selTo.textContent   = to   ? formatISO(to)   : '—';
          confirm.disabled = !(from && to);
          renderMonth();
        };
        grid.appendChild(b);
      });
    }
    wrap.querySelector('#cal-prev').onclick = ()=>{ viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()-1, 1); renderMonth(); };
    wrap.querySelector('#cal-next').onclick = ()=>{ viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1); renderMonth(); };
    renderMonth();

    confirm.onclick = async () => {
      results.innerHTML = '';
      const loadingCard = card('Buscando habitaciones disponibles…');
      results.appendChild(loadingCard);
      try {
        const roomsRes = await fetch(API+'/api/web/rooms');
        const roomsJson = await roomsRes.json();
        const rooms = roomsJson.rooms || [];
        const fromISO = formatISO(from);
        const toISO   = formatISO(to);

        const available = [];
        for (const r of rooms) {
          try {
            const aRes = await fetch(API+'/api/web/availability', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ habitacion: r.id || r.name, fechaEntrada: fromISO, fechaSalida: toISO })
            });
            const aJson = await aRes.json();
            if (aJson && aJson.ok && aJson.disponible !== false) {
              available.push({ room: r, info: aJson });
            }
          } catch {}
        }
        loadingCard.remove();

        if (!available.length) {
          results.appendChild(card('No hay habitaciones disponibles para ese rango de fechas.'));
          return;
        }

        const list = document.createElement('div'); list.className='cw-list';
        available.forEach(it => {
          const r = it.room, j = it.info;
          const nightly = Number(j.nightly || r.precio || r.price || 0);
          const nights = Math.max(1, Number(j.nights || 0) || Math.round((new Date(toISO)-new Date(fromISO))/86400000));
          const total = nightly && nights ? nightly * nights : (j.total || 0);
          const html = `
            <div class="cw-room-item">
              <div class="cw-room-name">${htmlesc(r.name || r.id)}</div>
              <div class="cw-room-sub">${htmlesc(r.description || '')}</div>
              <div class="cw-room-meta">
                <span>${nights} noche(s)</span>
                <span><b>Total estimado:</b> ${htmlesc(String(total || 'consultar'))}</span>
              </div>
              <div class="cw-right"><button class="cw-btn cw-prim" data-room="${htmlesc(r.id || r.name)}">Reservar</button></div>
            </div>`;
          const c = card(html);
          c.querySelector('button').onclick = () => {
            state.draft = { habitacion: r.id || r.name, fechaEntrada: fromISO, fechaSalida: toISO, noches: nights };
            openReservaFlow(); // salto al flujo de reserva con datos pre-cargados
          };
          list.appendChild(c);
        });
        results.appendChild(list);
      } catch {
        loadingCard.remove();
        results.appendChild(card('No fue posible obtener la disponibilidad. Por favor, inténtelo nuevamente.'));
      }
    };
  }

  // ───────────── FLUJO: RESERVA (wizard) ─────────────
  function openReservaFlow() {
    clearBody('Hacer una reserva');
    hideHint();
    stickyBack.style.display = 'block';
    askReservaNombre(); // 1) Nombre y apellido
  }

  // ───────────── Pasos de reserva ─────────────
  function askReservaNombre() {
    state.mode = 'reserva_nombre';
    showStep({ title:'Hacer una reserva', html:'Para comenzar, ¿a nombre de quién registramos la reserva?' });
  }

  function askReservaHabitacion() {
    state.mode = 'reserva_habitacion';
    const chips = (state.rooms || []).slice(0,8).map(r => chip(r.name));
    showStep({
      title: 'Hacer una reserva',
      html: 'Seleccione el tipo de habitación:',
      chips: (chips.length ? chips : [chip('Doble estándar')])
    });
  }

  function askReservaEntrada() {
    state.mode = 'reserva_entrada';
    showDateRangeStep(onDatesPicked);
  }

  function askReservaPax() {
    state.mode = 'reserva_pax';
    showStep({ title:'Hacer una reserva', html:'¿Cuántas personas se hospedarán?' });
  }

  function askReservaEmail()  {
    state.mode = 'reserva_email';
    showStep({ title:'Hacer una reserva', html:'¡Envíenos su email de contacto para poder comunicarnos con usted!' });
  }

  function askReservaTelefono() {
    state.mode = 'reserva_telefono';
    showStep({ title:'Hacer una reserva', html:'Indique su número de teléfono de contacto (opcional). Puede escribir "no".' });
  }

  function askReservaSalidaONoches() {
    state.mode = 'reserva_salida_noches';
    showStep({ title:'Hacer una reserva', html:'Indique la fecha de check-out (DD-MM-AAAA) o la cantidad de noches:' });
  }

  function onDatesPicked(ciISO, coISO) {
    state.draft = state.draft || {};
    const d = state.draft;
    d.fechaEntrada = ciISO;
    d.fechaSalida  = coISO;
    d.noches = diffNightsISO(ciISO, coISO);
    if (state.returnToEditHub) { showEditItemsHub(); return; }
    askReservaPax();
  }

  // ───────────── Lógica de precios/disponibilidad ─────────────
  function inferNightlyFromRoom(room) {
    if (!room || typeof room !== 'object') return 0;
    const candidates = [
      'pricePerNight','price_night','nightly','price','basePrice',
      'minPrice','priceUSD','usd','usdNight','usd_per_night',
      'value','amount'
    ];
    for (const k of candidates) {
      const v = Number(room[k]);
      if (Number.isFinite(v) && v > 0) return v;
    }
    if (room.pricing && typeof room.pricing === 'object') {
      for (const k of candidates) {
        const v = Number(room.pricing[k]);
        if (Number.isFinite(v) && v > 0) return v;
      }
    }
    return 0;
  }

  // 🔒 Último chequeo de disponibilidad antes de confirmar
  async function ensureStillAvailable() {
    const d = state.draft || {};
    try {
      const r = await fetch(API + '/api/web/availability', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          habitacion: d.habitacion || (state.rooms[0]?.id || state.rooms[0]?.name || 'doble estandar'),
          fechaEntrada: d.fechaEntrada || (d.fechaEntradaDMY ? parseToISO(d.fechaEntradaDMY) : undefined),
          noches: d.noches,
          fechaSalida: d.fechaSalida || (d.fechaSalidaDMY ? parseToISO(d.fechaSalidaDMY) : undefined),
        })
      });
      const j = await r.json();
      return (r.ok && j && j.ok && j.disponible !== false);
    } catch {
      return false;
    }
  }

  async function checkAvailabilityAndShow() {
    const d = state.draft || {};
    try {
      const r = await fetch(API + '/api/web/availability', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          habitacion: d.habitacion || (state.rooms[0]?.id || state.rooms[0]?.name || 'doble estandar'),
          fechaEntrada: d.fechaEntrada || (d.fechaEntradaDMY ? parseToISO(d.fechaEntradaDMY) : undefined),
          noches: d.noches,
          fechaSalida: d.fechaSalida || (d.fechaSalidaDMY ? parseToISO(d.fechaSalidaDMY) : undefined),
        })
      });
      const j = await r.json();
      if (!j.ok) {
        showStep({ title:'Hacer una reserva', html:'No fue posible comprobar la disponibilidad. Por favor, inténtelo nuevamente.' });
        return;
      }

      const nights = d.noches || j.nights || 1;
      const backendNightly = Number(j.nightly || 0);
      const backendTotal   = Number(j.total || 0);
      const inferredNightly = inferNightlyFromRoom(j.room);

      let catalogNightly = 0;
      if (!inferredNightly && state.rooms && state.rooms.length) {
        const wanted = String(d.habitacion || '').toLowerCase();
        const fromCat =
          state.rooms.find(r => String(r.id).toLowerCase() === wanted) ||
          state.rooms.find(r => String(r.name).toLowerCase() === wanted);
        catalogNightly = inferNightlyFromRoom(fromCat);
      }

      const nightly = [backendNightly, inferredNightly, catalogNightly].find(v => Number.isFinite(v) && v > 0) || 0;

      let total = 0;
      if (Number.isFinite(backendTotal) && backendTotal > 0) total = backendTotal;
      else if (nightly > 0) total = nightly * nights;

      d.totalEstimado = total;
      d.moneda = (j.moneda || 'USD').toUpperCase();

      if (j.disponible !== false) {
        const monto = Number.isFinite(total) && total > 0 ? total : 0;
        showStep({
          title: 'Hacer una reserva',
          html: `Disponibilidad confirmada para <b>${htmlesc(d.habitacion)}</b>.<br>Estimación: <b>USD ${monto}</b>`
        });
        const cont = document.createElement('button');
        cont.className = 'cw-btn cw-prim';
        cont.textContent = 'Continuar';
        cont.onclick = showConfirm;
        const actions = document.createElement('div');
        actions.className = 'cw-step-actions';
        actions.appendChild(cont);
        body.appendChild(actions);
      } else {
        showStep({ title:'Hacer una reserva', html:'No hay disponibilidad para esas fechas.' });
        const choose = document.createElement('button');
        choose.className = 'cw-btn';
        choose.textContent = 'Elegir otra habitación';
        choose.onclick = askReservaHabitacion;
        const actions = document.createElement('div');
        actions.className = 'cw-step-actions';
        actions.appendChild(choose);
        body.appendChild(actions);
      }
    } catch {
      showStep({ title:'Hacer una reserva', html:'No fue posible comprobar la disponibilidad. Por favor, inténtelo nuevamente.' });
    }
  }

  // === Modal “Editar datos” (selección rápida de campo a editar)
  function openEditDataModal(){
    const overlay = document.createElement('div');
    overlay.className = 'cw-overlay';
    const box = document.createElement('div');
    box.className = 'cw-modal';
    box.innerHTML = `
      <div class="cw-modal-head">Editar datos de la reserva</div>
      <div class="cw-modal-body">
        <div style="font-size:14px;color:#374151;margin-bottom:8px">Seleccione qué desea editar:</div>
        <div class="cw-radio-list" role="group" aria-label="Campos de edición">
          ${['Nombre','Habitación','Fechas','Personas','Email','Teléfono'].map((label,i)=>(
            '<label class="cw-radio-item">' +
            '<input type="radio" name="edit-field" value="'+label.toLowerCase()+'" '+(i===2?'checked':'')+' />' +
            '<span>'+label+'</span></label>'
          )).join('')}
        </div>
      </div>
      <div class="cw-modal-foot">
        <button id="cw-edit-cancel" class="cw-btn">Cerrar</button>
        <button id="cw-edit-confirm" class="cw-btn cw-prim">Confirmar</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e)=>{ if (e.target===overlay) overlay.remove(); });
    box.querySelector('#cw-edit-cancel').onclick = ()=> overlay.remove();
    box.querySelector('#cw-edit-confirm').onclick = ()=> {
      const selected = box.querySelector('input[name="edit-field"]:checked');
      const val = (selected && selected.value) || '';
      overlay.remove();
      state.returnToEditHub = true; // tras editar volvemos al hub
      if (val==='fechas') { state.mode='reserva_entrada'; showDateRangeStep(onDatesPicked); return; }
      if (val==='personas') { askReservaPax(); return; }
      if (val==='email') { askReservaEmail(); return; }
      if (val==='teléfono' || val==='telefono') { askReservaTelefono(); return; }
      if (val==='habitación' || val==='habitacion') { askReservaHabitacion(); return; }
      if (val==='nombre') { askReservaNombre(); return; }
    };
  }

  function showConfirm() {
    const d = state.draft || {};
    if (!d.nombre || !String(d.nombre).trim()) return askReservaNombre();
    if (!d.habitacion) return askReservaHabitacion();
    const tieneFechas = (d.fechaEntrada && (d.fechaSalida || d.noches > 0));
    if (!tieneFechas) return askReservaEntrada();
    if (!(Number.isInteger(d.pax) && d.pax >= 1)) return askReservaPax();
    if (!d.email) return askReservaEmail();

    if (!(typeof d.totalEstimado === 'number') || d.totalEstimado <= 0) {
      return checkAvailabilityAndShow();
    }

    state.mode = 'confirm';
    const totalParaCobrar = d.totalEstimado || 0;

    const extraEmail = d.email ? `• Email: ${d.email}\n` : '';
    const extraTel   = d.telefono ? `• Teléfono: ${d.telefono}\n` : '';
    const extraPax   = Number.isInteger(d.pax) ? `• Personas: ${d.pax}\n` : '';
    const extraNoches = `• Total de noches: ${d.noches}\n`;

    const resumen =
      `Revise los datos:\n` +
      `• Nombre: ${d.nombre}\n` +
      `• Check-in: ${d.fechaEntrada}\n` +
      (d.fechaSalida ? `• Check-out: ${d.fechaSalida}\n` : `• Noches: ${d.noches}\n`) +
      `• Habitación: ${d.habitacion}\n` +
      extraNoches +
      extraEmail +
      extraTel +
      extraPax +
      `• Total: USD ${totalParaCobrar}\n\n` +
      `Si todo es correcto, confirmaremos la solicitud y un agente validará el pago.`;

    showStep({ title:'Hacer una reserva', html: htmlesc(resumen).replace(/\n/g,'<br>') });

    const actions = document.createElement('div');
    actions.className = 'cw-step-actions';

    const edit = document.createElement('button');
    edit.className = 'cw-btn';
    edit.textContent = 'Editar datos';
    edit.onclick = () => { state.returnToEditHub = false; openEditDataModal(); };

    const cancel = document.createElement('button');
    cancel.className = 'cw-btn';
    cancel.textContent = 'Cancelar';
    cancel.onclick = showMainOptions;

    const confirm = document.createElement('button');
    confirm.className = 'cw-btn cw-prim';
    confirm.textContent = 'Confirmar reserva';
    confirm.onclick = startCheckout;

    actions.appendChild(edit);
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    body.appendChild(actions);

    state.mode = 'post_qna';
    showHint('Puede escribir sus preguntas o confirmar cuando lo desee.');
  }

  // ───────────── Envío a checkout ─────────────
  async function startCheckout() {
    const d = state.draft || {};
    try {
      const okAvail = await ensureStillAvailable();
      if (!okAvail) {
        showStep({
          title:'Hacer una reserva',
          html:'Lo sentimos, la habitación ya no está disponible para esas fechas. Por favor, elija otra fecha u otra habitación.'
        });
        const actions = document.createElement('div');
        actions.className = 'cw-step-actions';
        const btnFechas = document.createElement('button');
        btnFechas.className = 'cw-btn';
        btnFechas.textContent = 'Cambiar fechas';
        btnFechas.onclick = () => { state.mode = 'reserva_entrada'; showDateRangeStep(onDatesPicked); };
        const btnHab = document.createElement('button');
        btnHab.className = 'cw-btn';
        btnHab.textContent = 'Elegir otra habitación';
        btnHab.onclick = askReservaHabitacion;
        actions.appendChild(btnFechas);
        actions.appendChild(btnHab);
        body.appendChild(actions);
        return;
      }

      const payload = {
        nombre: d.nombre || 'Huésped',
        email: d.email,
        telefono: d.telefono,
        checkin: d.fechaEntrada || (d.fechaEntradaDMY ? parseToISO(d.fechaEntradaDMY) : undefined),
        checkout: d.fechaSalida || (d.fechaSalidaDMY ? parseToISO(d.fechaSalidaDMY) : undefined),
        noches: d.noches,
        habitacion: d.habitacion || (state.rooms?.[0]?.name || 'doble estandar'),
        pax: d.pax || 1,
        total: (d.totalEstimado ?? 0),
        moneda: 'USD',
      };
      const r = await fetch(API + '/api/checkout', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
      });
      let ok = false; try { const j = await r.json(); ok = r.ok && j && j.ok; } catch { ok = r.ok; }
      if (!ok) throw new Error('fail');

      hideHint();
      showStep({ title:'Hacer una reserva', html:'¡Listo! Registramos su solicitud. Un agente validará el pago y le notificaremos por este canal o por correo electrónico.' });
      setTimeout(showMainOptions, 1500);
    } catch {
      hideHint();
      showStep({ title:'Hacer una reserva', html:'Su solicitud fue registrada. Un agente validará el pago y le notificaremos por este canal o por correo electrónico.' });
      setTimeout(showMainOptions, 1500);
    }
  }

  // ───────────── Reconocimiento de frases “somos dos personas” ─────────────
  const WORD_TO_NUM = {
    'una':1,'uno':1,'un':1,
    'dos':2,'tres':3,'cuatro':4,'cinco':5,'seis':6,'siete':7,'ocho':8,'nueve':9,'diez':10,
    'once':11,'doce':12,'trece':13,'catorce':14,'quince':15,'dieciseis':16,'dieciséis':16,
    'diecisiete':17,'dieciocho':18,'diecinueve':19,'veinte':20
  };
  function parsePaxFromText(s){
    const t = String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const m1 = t.match(/(\d{1,3})\s*(personas?|huesped(?:es)?|pax)?\b/);
    if (m1) {
      const n = parseInt(m1[1],10);
      if (Number.isInteger(n) && n>0) return n;
    }
    const m2 = t.match(/\b(una|uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte)\b/);
    if (m2 && WORD_TO_NUM[m2[1]]) return WORD_TO_NUM[m2[1]];
    return null;
  }

  // ───────────── Validaciones y manejo de entrada ─────────────
  function looksLikeEmail(s){
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s||'').trim());
  }

  // Abre el selector nativo de fecha de forma “pro”
  function openPicker(el){
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch {}
    }
    el.focus(); el.click();
  }

  async function handleSend() {
    const text = (input.value || '').trim();
    if (!text) return;

    const inReserva = state.mode && state.mode.indexOf('reserva_')===0;

    if (!inReserva) {
      pushUser(text);
    }
    input.value = '';

    if (state.mode === 'post_qna') {
      return sendConsulta(text);
    }

    if (state.mode === 'idle') {
      if (/reserva/i.test(text)) return openReservaFlow();
      return openConsultaFlow(), sendConsulta(text);
    }

    // Orden de reserva (wizard)
    if (state.mode === 'reserva_nombre') {
      state.draft.nombre = text;
      if (state.returnToEditHub) { showEditItemsHub(); return; }
      return askReservaHabitacion();
    }

    if (state.mode === 'reserva_habitacion') {
      state.draft.habitacion = text;
      if (state.returnToEditHub) { showEditItemsHub(); return; }
      return askReservaEntrada();
    }

    if (state.mode === 'reserva_entrada') {
      if (validDateDMY(text)) {
        state.draft.fechaEntradaDMY = text; state.draft.fechaEntrada = parseToISO(text);
        if (state.returnToEditHub) { showEditItemsHub(); return; }
        return askReservaSalidaONoches();
      }
      if (state.returnToEditHub) { showEditItemsHub(); return; }
      return askReservaSalidaONoches();
    }

    if (state.mode === 'reserva_salida_noches') {
      if (validDateDMY(text)) {
        state.draft.fechaSalidaDMY = text; state.draft.fechaSalida = parseToISO(text);
        state.draft.noches = diffNightsISO(state.draft.fechaEntrada, state.draft.fechaSalida);
        if (state.returnToEditHub) { showEditItemsHub(); return; }
        return askReservaPax();
      }
      const m = text.match(/^(\d{1,3})(?:\s*noches?)?$/i);
      if (m) { state.draft.noches = Number(m[1]); if (state.returnToEditHub) { showEditItemsHub(); return; } return askReservaPax(); }
      if (state.returnToEditHub) { showEditItemsHub(); return; }
      return askReservaPax();
    }

    if (state.mode === 'reserva_pax') {
      let pax = parseInt(text, 10);
      if (!Number.isInteger(pax) || pax < 1) {
        const parsed = parsePaxFromText(text);
        if (parsed && parsed >= 1) pax = parsed;
      }
      if (!Number.isInteger(pax) || pax < 1) {
        return askReservaPax();
      }
      state.draft.pax = pax;
      if (state.returnToEditHub) { showEditItemsHub(); return; }
      return askReservaEmail();
    }

    if (state.mode === 'reserva_email')  {
      if (!looksLikeEmail(text)) {
        return askReservaEmail();
      }
      state.draft.email = text.trim();
      if (state.returnToEditHub) { showEditItemsHub(); return; }
      return askReservaTelefono();
    }

    if (state.mode === 'reserva_telefono') {
      const tel = String(text).trim();
      state.draft.telefono = /^no$/i.test(tel) ? undefined : tel;
      if (state.returnToEditHub) { showEditItemsHub(); return; }
      return checkAvailabilityAndShow();
    }

    if (state.mode === 'confirm') {
      if (/confirmar/i.test(text)) return startCheckout();
      if (/editar.*fecha/i.test(text)) { state.mode = 'reserva_entrada'; return showDateRangeStep(onDatesPicked); }
      if (/cancelar/i.test(text)) { showMainOptions(); return; }
      return;
    }
  }

  sendBtn.addEventListener('click', handleSend);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSend(); });

  // ───────────── Saludo inicial ─────────────
  function greet() {
    hideHint();
    clearBody();
    stickyBack.style.display = 'none';
    pushBot('¡Hola! Soy su asistente de reservas. ¿En qué puedo ayudarle?', [
      chip('🗨️ Hacer una consulta', () => openConsultaFlow()),
      chip('📅 Consultar disponibilidad', () => openDisponibilidadFlow()),
      chip('🛎️ Hacer una reserva', () => openReservaFlow())
    ]);
  }

  loadRooms().then(greet);

  // ───────────── Selector de rango de fechas (wizard) ─────────────
  function showDateRangeStep(onDone) {
    state.mode = 'reserva_entrada';
    showStep({
      title:'Hacer una reserva',
      html: `
        <div style="margin-bottom:8px;">Seleccione las fechas:</div>
        <div style="display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
          <label class="cw-date-group">
            <div class="cw-date-label">Check-in</div>
            <div class="cw-sub">(entrada)</div>
            <div class="cw-date-row">
              <input type="date" id="cw-di">
              <button type="button" id="cw-di-btn" class="cw-icon-btn" title="Elegir fecha">📅</button>
            </div>
          </label>
          <label class="cw-date-group">
            <div class="cw-date-label">Check-out</div>
            <div class="cw-sub">(salida)</div>
            <div class="cw-date-row">
              <input type="date" id="cw-do">
              <button type="button" id="cw-do-btn" class="cw-icon-btn" title="Elegir fecha">📅</button>
            </div>
          </label>
          <div style="align-self:flex-end;">
            <button id="cw-apply" class="cw-btn cw-prim">Aceptar</button>
          </div>
        </div>
        <div style="margin-top:6px; font-size:12px; color:#6b7280;">También puede escribir manualmente en formato DD-MM-AAAA.</div>`
    });
    const di = body.querySelector('#cw-di');
    const dd = body.querySelector('#cw-do');
    const diBtn = body.querySelector('#cw-di-btn');
    const ddBtn = body.querySelector('#cw-do-btn');
    const apply = body.querySelector('#cw-apply');
    diBtn.addEventListener('click', () => openPicker(di));
    ddBtn.addEventListener('click', () => openPicker(dd));
    apply.addEventListener('click', () => {
      const ci = di.value; const co = dd.value;
      if (!ci || !co) { alert('Seleccione check-in y check-out.'); return; }
      onDone(ci, co);
    });
  }

  // ───────────── Selector de rango de fechas (original para otros flujos) ─────────────
  function showDateRangePicker(onDone) {
    const wrap = document.createElement('div');
    wrap.className = 'cw-msg cw-bot';
    wrap.innerHTML = `
      <div class="cw-card">
        <div style="margin-bottom:8px;">Seleccione las fechas:</div>
        <div style="display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
          <label class="cw-date-group">
            <div class="cw-date-label">Check-in</div>
            <div class="cw-sub">(entrada)</div>
            <div class="cw-date-row">
              <input type="date" id="cw-di">
              <button type="button" id="cw-di-btn" class="cw-icon-btn" title="Elegir fecha">📅</button>
            </div>
          </label>
          <label class="cw-date-group">
            <div class="cw-date-label">Check-out</div>
            <div class="cw-sub">(salida)</div>
            <div class="cw-date-row">
              <input type="date" id="cw-do">
              <button type="button" id="cw-do-btn" class="cw-icon-btn" title="Elegir fecha">📅</button>
            </div>
          </label>
          <div style="align-self:flex-end;">
            <button id="cw-apply" class="cw-btn cw-prim">Aceptar</button>
          </div>
        </div>
        <div style="margin-top:6px; font-size:12px; color:#6b7280;">También puede escribir manualmente en formato DD-MM-AAAA.</div>
      </div>`;
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
    const di = wrap.querySelector('#cw-di');
    const dd = wrap.querySelector('#cw-do');
    const diBtn = wrap.querySelector('#cw-di-btn');
    const ddBtn = wrap.querySelector('#cw-do-btn');
    const apply = wrap.querySelector('#cw-apply');
    diBtn.addEventListener('click', () => openPicker(di));
    ddBtn.addEventListener('click', () => openPicker(dd));
    apply.addEventListener('click', () => {
      const ci = di.value; const co = dd.value;
      if (!ci || !co) { alert('Seleccione check-in y check-out.'); return; }
      onDone(ci, co);
    });
  }

  // ───────────── Estilos ─────────────
  const style = document.createElement('style');
  style.textContent = `
    body.cw-docked { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    #cw-launcher { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; background: #0ea5e9; color: #fff; border: 0; padding: 12px 16px; border-radius: 999px; cursor: pointer; box-shadow: 0 6px 16px rgba(0,0,0,.15); font-weight:700; }
    #cw-panel { position: fixed; right: 16px; bottom: 80px; width: 360px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 120px); background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.18); display: none; flex-direction: column; overflow: hidden; z-index: 2147483000; transform: translateY(10px); opacity: 0; pointer-events: none; transition: .25s; }
    #cw-panel.open { display: flex; transform: translateY(0); opacity: 1; pointer-events: auto; }
    #cw-head { padding: 10px 12px; background: #0ea5e9; color: #fff; display: flex; align-items: center; justify-content: space-between; }
    #cw-title { font-weight: 700; }
    #cw-close { background: transparent; border: 0; color: #fff; font-size: 18px; cursor: pointer; }
    #cw-body { padding: 12px; flex: 1; overflow: auto; background: #f9fafb; display:flex; flex-direction:column; }
    #cw-foot { display: flex; gap: 8px; border-top: 1px solid #e5e7eb; padding: 8px; background:#fff; }
    #cw-text { flex: 1; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 10px; outline: none; }
    #cw-send { background: #0ea5e9; color: white; border: 0; padding: 10px 16px; border-radius: 10px; cursor: pointer; font-weight:700; }
    .cw-msg { margin: 8px 0; max-width: 90%; white-space: pre-wrap; }
    .cw-user { align-self: flex-end; background: #dbeafe; padding: 8px 10px; border-radius: 12px 12px 2px 12px; }
    .cw-bot { align-self: flex-start; background: #fff; padding: 8px 10px; border-radius: 12px 12px 12px 2px; border: 1px solid #e5e7eb; }
    .cw-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    .cw-chip, .cw-btn { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 999px; padding: 6px 10px; cursor: pointer; }
    .cw-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; }

    /* Calendario */
    .cw-cal-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
    .cw-cal-grid{ display:grid; grid-template-columns: repeat(7, 1fr); gap:6px; }
    .cw-dow{ text-align:center; font-weight:700; color:#6b7280; }
    .cw-day{ border:1px solid #e5e7eb; background:#fff; border-radius:8px; padding:8px 0; cursor:pointer; }
    .cw-day.cw-muted{ opacity:.35; }
    .cw-in-range{ background:#eef2ff; border-color:#c7d2fe; }
    .cw-sel-from, .cw-sel-to{ background:#1b5cff; color:#fff; border-color:#1b5cff; }

    .cw-list{ display:flex; flex-direction:column; gap:10px; margin-top:12px; }
    .cw-room-item{ display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center; }
    .cw-room-name{ font-weight:800; }
    .cw-room-sub{ color:#6b7280; font-size:12px; }
    .cw-room-meta{ display:flex; gap:12px; color:#374151; font-size:12px; }
    .cw-prim{ background:#1b5cff; color:#fff; border-color:#1b5cff; }

    /* Wizard */
    .cw-step-actions{ display:flex; gap:8px; margin-top:10px; }

    /* Grupo de fecha “prolijo” */
    .cw-date-group { display:flex; flex-direction:column; gap:6px; min-width: 142px; }
    .cw-date-label { font-weight:700; }
    .cw-sub { font-size:12px; color:#6b7280; margin-top:-4px; }
    .cw-date-row { display:flex; gap:6px; align-items:center; }
    .cw-date-row input[type="date"] { padding:8px 10px; border:1px solid #e5e7eb; border-radius:10px; }
    .cw-icon-btn { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:8px 10px; cursor:pointer; }
    .cw-icon-btn:hover { background:#f9fafb; }

    /* Botón fijo lateral (único y pequeño) */
    #cw-sticky-back {
      position: absolute;
      right: 8px;
      top: 58px;            /* debajo del header */
      z-index: 1;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 999px;
      padding: 4px 10px;    /* tamaño reducido */
      font-size: 12px;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,.06);
    }

    /* NUEVO: modal de edición */
    .cw-overlay{ position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:2147483647; }
    .cw-modal{ background:#fff; border-radius:12px; max-width:420px; width:90%; box-shadow:0 10px 30px rgba(0,0,0,.2); overflow:hidden; }
    .cw-modal-head{ padding:12px 16px; border-bottom:1px solid #eef2f7; font-weight:700; }
    .cw-modal-body{ padding:12px 16px; max-height:60vh; overflow:auto; }
    .cw-modal-foot{ display:flex; gap:8px; justify-content:flex-end; padding:12px 16px; border-top:1px solid #eef2f7; }
    .cw-radio-item{ display:flex; gap:8px; align-items:center; padding:6px 0; font-size:14px; cursor:pointer; }
  `;
  document.head.appendChild(style);
})();
