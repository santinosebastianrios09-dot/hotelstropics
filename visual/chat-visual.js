/* mvp_AGENTS/src/web/public/visual/chat-visual.js
   Solo DISEÑO: micro-interacciones sin tocar la lógica del chat.
*/
(function(){
  // Utilidad: ripple mínimo
  function ripple(el){
    el.style.position = el.style.position || 'relative';
    el.style.overflow = 'hidden';
    el.addEventListener('click', function(e){
      const rect = el.getBoundingClientRect();
      const r = document.createElement('span');
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size/2;
      const y = e.clientY - rect.top - size/2;
      r.style.position='absolute';
      r.style.left = x+'px';
      r.style.top = y+'px';
      r.style.width = r.style.height = size+'px';
      r.style.borderRadius='50%';
      r.style.background='rgba(255,255,255,.35)';
      r.style.pointerEvents='none';
      r.style.transform='scale(0)';
      r.style.opacity='0.9';
      r.style.transition='transform .45s ease, opacity .6s ease';
      el.appendChild(r);
      requestAnimationFrame(()=>{ r.style.transform='scale(1)'; r.style.opacity='0'; });
      setTimeout(()=> r.remove(), 600);
    }, {passive:true});
  }

  function ready(fn){ 
    if(document.readyState!=='loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function(){
    const launcher = document.getElementById('cw-launcher');
    const panel = document.getElementById('cw-panel');
    const closeBtn = document.getElementById('cw-close');
    const sendBtn = document.getElementById('cw-send');

    // Efectos ripple en botones clave
    [launcher, closeBtn, sendBtn].forEach(b => b && ripple(b));

    // Pulso suave en el launcher cuando el panel está oculto
    if (launcher){
      const pulse = () => { launcher.style.animation = 'tv-pulse 2.4s ease-in-out 1'; };
      document.addEventListener('click', () => launcher.style.animation='', {passive:true});
      setInterval(() => {
        const visible = panel && panel.offsetParent !== null;
        if(!visible) pulse();
      }, 5000);
    }

    // Animación de entrada del panel (clase utilitaria)
    if (panel){
      const show = () => { panel.style.animation = 'tv-pop .22s ease-out both'; };
      const head = document.getElementById('cw-head');
      if (head){
        head.addEventListener('click', show, {passive:true});
      }
      show();
    }
  });
})();
