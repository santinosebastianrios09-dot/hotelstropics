// mvp_AGENTS/src/web/public/room-previews.js
(function(){
  const API = '';
  const ROOM_INFO = {
    "Doble estándar": { imageUrl: "/img/doble-estandar.jpg", amenities: ["1 cama doble grande","Wi-Fi gratis","Baño privado","Aire acondicionado"] },
    "Simple estándar": { imageUrl: "/img/simple-estandar-1.jpg", amenities: ["1 cama simple","Wi-Fi gratis","Baño privado","Aire acondicionado"] },
    "Suite premium": { imageUrl: "/img/suite-premium.jpg", amenities: ["Cama king","Wi-Fi gratis","Baño privado","Aire acondicionado","Vista"] }
  };
  const esc = (x)=>String(x).replace(/[&<>\"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const q = (sel,root=document)=>root.querySelector(sel);
  const ce = (tag, cls)=>{ const el=document.createElement(tag); if(cls) el.className=cls; return el; };
  const body = ()=> q('#cw-body');

  function normalizeKey(x){ return String(x||'').trim().toLowerCase(); }
  function decorateRoom(r){
    const roomsMapKey = Object.keys(ROOM_INFO).find(k => normalizeKey(k) === normalizeKey(r.name||r.id));
    const info = roomsMapKey ? ROOM_INFO[roomsMapKey] : {};
    let amenities = r.amenities;
    if (typeof amenities === 'string') amenities = amenities.split(/[,•\n]+/).map(s=>s.trim()).filter(Boolean);
    if (!Array.isArray(amenities)) amenities = info?.amenities || [];
    return {
      ...r,
      imageUrl: r.imageUrl || info?.imageUrl || '/img/hotel-1.jpg',
      amenities
    };
  }

  async function fetchRooms(){
    try{
      const r = await fetch(API + '/api/web/rooms'); 
      const j = await r.json();
      return (j.rooms||[]).map(decorateRoom);
    }catch{ return []; }
  }

  function openRoomModal(room){
    const r = decorateRoom(room||{});
    const ov = ce('div','cw-overlay');
    const box = ce('div','cw-modal cw-modal-room');
    const am = (r.amenities||[]).map(a=>`<li>${esc(a)}</li>`).join('') || '<li class="muted">Información próximamente</li>';
    box.innerHTML = `
      <div class="cw-modal-head">${esc(r.name||'Habitación')}</div>
      <div class="cw-modal-body">
        <img class="cw-room-img" src="${esc(r.imageUrl||'')}" alt="${esc(r.name||'Habitación')}" />
        <ul class="cw-amenities">${am}</ul>
      </div>
      <div class="cw-modal-actions">
        <button class="cw-btn" id="cw-room-close">Cerrar</button>
      </div>`;
    ov.appendChild(box);
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.addEventListener('click', (e)=>{ if (e.target===ov) close(); });
    q('#cw-room-close', box).onclick = close;
  }

  function injectViewButtons(node){
    if (!node || !node.classList) return;
    // objetivo: dentro de .cw-room-item agregar botón "Ver habitación" si no existe
    if (node.classList.contains('cw-room-item')){
      if (!q('.cw-view-room', node)){
        const actions = q('.cw-actions', node) || q('.cw-right', node) || node;
        const btn = ce('button','cw-btn cw-sec cw-view-room');
        btn.textContent = 'Ver habitación';
        const name = q('.cw-room-name', node)?.textContent || '';
        btn.addEventListener('click', async (e)=>{
          e.stopPropagation();
          const rooms = await fetchRooms();
          const r = rooms.find(x => normalizeKey(x.name) === normalizeKey(name)) || { name };
          openRoomModal(r);
        });
        actions.insertBefore(btn, actions.firstChild);
      }
    }
  }

  async function renderRoomsGridIfNeeded(){
    const b = body();
    if (!b) return;
    const title = q('#cw-title')?.textContent || '';
    // buscamos el paso "Hacer una reserva" con la pregunta de selección
    if (/Hacer una reserva/i.test(title) && /Seleccione el tipo de habitación/i.test(b.textContent||'')){
      if (q('.cw-room-grid', b)) return; // ya está
      const rooms = await fetchRooms();
      const grid = ce('div', 'cw-room-grid');
      rooms.slice(0,4).forEach(r => {
        const d = decorateRoom(r);
        const card = ce('div','cw-room-card');
        card.innerHTML = `
          <img src="${esc(d.imageUrl||'')}" alt="${esc(d.name)}" />
          <div class="cw-room-name">${esc(d.name)}</div>
          <button class="cw-btn cw-sec">Ver habitación</button>
        `;
        q('button', card).onclick = ()=> openRoomModal(d);
        grid.appendChild(card);
      });
      b.appendChild(grid);
    }
  }

  // Observador para inyectar en resultados de disponibilidad y pasos
  const obs = new MutationObserver((muts)=>{
    muts.forEach(m=>{
      m.addedNodes && m.addedNodes.forEach(n=>{
        if (n.nodeType===1){
          injectViewButtons(n);
          // También escanear descendientes
          n.querySelectorAll && n.querySelectorAll('.cw-room-item').forEach(injectViewButtons);
        }
      });
    });
    renderRoomsGridIfNeeded();
  });
  const startObserver = ()=>{ const b = body(); if (b) obs.observe(b, { childList:true, subtree:true }); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
