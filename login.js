const COULEURS = ['#2563eb','#7c3aed','#0891b2','#16a34a','#d97706','#dc2626'];

  const $ = id => document.getElementById(id);
  const initiales = n => n.trim().slice(0,1).toUpperCase() || '?';

  const couleurPour = nom => {
    let hash = 0;
    for (let i = 0; i < nom.length; i++) hash = nom.charCodeAt(i) + ((hash << 5) - hash);
    return COULEURS[Math.abs(hash) % COULEURS.length];
  };

  function ouvrirModal() {
    const dernier = JSON.parse(localStorage.getItem('home_eleve_user') || 'null');
    const nomPrerempli = dernier ? dernier.nom : '';
    const couleur = dernier ? couleurPour(dernier.nom) : COULEURS[0];

    $('modalContent').innerHTML = `
      <h2>Qui joue ?</h2>
      <div class="avatar-preview" id="apercu" style="background:${couleur}">${initiales(nomPrerempli)}</div>
      <input type="text" id="champNom" placeholder="Votre prénom ou pseudo" maxlength="20" value="${nomPrerempli}" oninput="mettreAJourApercu()" />
      <div class="modal-actions">
        <button onclick="fermerModal()">Annuler</button>
        <button class="btn-valider" id="btnValider" onclick="confirmer()">Jouer</button>
      </div>`;

    $('overlay').classList.add('open');
    setTimeout(() => {
      const champ = $('champNom');
      if (champ) { champ.focus(); champ.select(); }
    }, 120);
  }

  function fermerModal() { $('overlay').classList.remove('open'); }
  function fermerSiDehors(e) { if (e.target === $('overlay')) fermerModal(); }

  function mettreAJourApercu() {
    const nom = $('champNom').value;
    const apercu = $('apercu');
    if (apercu) {
      apercu.textContent = initiales(nom) || '?';
      apercu.style.background = couleurPour(nom || '?');
    }
  }

  async function confirmer() {
    const nom = $('champNom').value.trim();
    if (!nom) { $('champNom') && $('champNom').focus(); return; }

    const btn = $('btnValider');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Connexion...';
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pseudo: nom })
      });

      if (!res.ok) throw new Error('Erreur serveur');
      const data = await res.json();

      localStorage.setItem('home_eleve_user', JSON.stringify({ nom, role: data.role }));

      fermerModal();
      rediriger(data.role);
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Jouer';
      }
      alert('Erreur de connexion. Veuillez réessayer.');
    }
  }

  function rediriger(role) {
    window.location.href = role === 'prof' ? '/dashboard_prof' : '/eleve_dashboard.html';
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') fermerModal();
    if (e.key === 'Enter' && $('overlay').classList.contains('open')) {
      if ($('champNom')) confirmer();
    }
  });

  window.addEventListener('load', () => {
    const playBtn = $('playBtn');
    playBtn.style.transform = 'translate(-50%, -50%) scale(0)';
    playBtn.style.opacity = '0';

    requestAnimationFrame(() => {
      setTimeout(() => {
        playBtn.style.opacity = '1';
        playBtn.style.transform = 'translate(-50%, -50%) scale(1)';
      }, 100);
    });

    setTimeout(() => $('haloBtn').classList.add('visible'), 250);

    const cards = [
      { el: $('cardTL'), delay: 320 },
      { el: $('cardTR'), delay: 400 },
      { el: $('cardBL'), delay: 480 },
      { el: $('cardBR'), delay: 560 },
    ];
    cards.forEach(({ el, delay }) => {
      setTimeout(() => el.classList.add('exploded'), delay);
    });

    $('blobBlue').classList.add('visible');
    $('blobPurple').classList.add('visible');
    $('blobCenter').classList.add('visible');

    const setupDot = (elId, ox, oy, delay) => {
      const el = $(elId);
      if (!el) return;
      el.style.setProperty('--ox', ox);
      el.style.setProperty('--oy', oy);
      setTimeout(() => { el.style.animation = `dotFloat 0.6s cubic-bezier(0.34,1.56,0.64,1) ${delay} forwards`; }, 500);
    };

    setupDot('dotPink', '80px', '80px', '0s');
    setupDot('dotYellow', '-60px', '60px', '80ms');
    setupDot('dotPurple', '0px', '-80px', '160ms');

    setTimeout(() => $('plusLeft').style.animation  = 'plusPop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards', 650);
    setTimeout(() => $('plusRight').style.animation = 'plusPop 0.5s cubic-bezier(0.34,1.56,0.64,1) 80ms forwards', 650);

    $('header').classList.add('visible');
    $('bottomHint').classList.add('visible');
  });
