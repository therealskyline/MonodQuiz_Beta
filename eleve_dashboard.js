const inputs = document.querySelectorAll('.code-input');
    let allPublicQcms = [];

    document.addEventListener('DOMContentLoaded', () => {
      loadPublicQcms();
      bindPublicQcmEvents();
    });

    inputs.forEach((input, i) => {
      input.addEventListener('input', () => {
        input.value = input.value.toUpperCase();
        if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !input.value && i > 0) inputs[i - 1].focus();
      });
    });

    function bindPublicQcmEvents() {
      document.getElementById('searchInput').addEventListener('input', renderPublicQcms);
      document.getElementById('avaible-theme').addEventListener('change', renderPublicQcms);
      document.getElementById('avaible-class').addEventListener('change', renderPublicQcms);
    }

    async function loadPublicQcms() {
      try {
        const res = await fetch('/api/qcm/list');
        if (!res.ok) throw new Error('Erreur serveur');
        allPublicQcms = (await res.json()).filter(q => q.visibilite === true);
        allPublicQcms.sort((a, b) => b.filename.localeCompare(a.filename));
        populatePublicThemes();
        renderPublicQcms();
      } catch (err) {
        console.error(err);
        document.getElementById('qcmContainer').innerHTML = `
          <div class="empty-state">
            <div class="empty-icon-wrap"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <h3>Erreur de chargement</h3>
            <p>Impossible de récupérer les QCM publics depuis le serveur.</p>
          </div>`;
      }
    }

    function populatePublicThemes() {
      const select = document.getElementById('avaible-theme');
      const themes = [...new Set(allPublicQcms.map(q => q.theme))].filter(Boolean).sort();
      themes.forEach(theme => {
        const opt = document.createElement('option');
        opt.value = theme;
        opt.textContent = theme;
        select.appendChild(opt);
      });
    }

    function renderPublicQcms() {
      const container = document.getElementById('qcmContainer');
      const search = document.getElementById('searchInput').value.toLowerCase().trim();
      const themeFilter = document.getElementById('avaible-theme').value;
      const classFilter = document.getElementById('avaible-class').value;

      let filtered = [...allPublicQcms];
      if (themeFilter !== 'all') filtered = filtered.filter(q => q.theme === themeFilter);
      if (classFilter !== 'all') filtered = filtered.filter(q => q.level === classFilter);
      if (search) {
        filtered = filtered.filter(q =>
          String(q.theme || '').toLowerCase().includes(search) ||
          String(q.auteur || '').toLowerCase().includes(search) ||
          String(q.filename || '').toLowerCase().includes(search) ||
          String(q.qcm_name || '').toLowerCase().includes(search)
        );
      }

      if (filtered.length === 0) {
        const isSearch = search || themeFilter !== 'all' || classFilter !== 'all';
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon-wrap"><i class="fa-regular fa-folder-open"></i></div>
            <h3>${isSearch ? 'Aucun résultat' : 'Aucun QCM public disponible'}</h3>
            <p>${isSearch ? 'Essayez de modifier vos filtres.' : 'Aucun questionnaire public n\'est encore disponible.'}</p>
          </div>`;
        return;
      }

      let html = '<div class="qcm-list">';
      filtered.forEach(qcm => {
        const viewUrl = '/use_qcm.html?file=' + encodeURIComponent(qcm.full_path || qcm.filename || '');
        html += `
          <div class="qcm-card" onclick="goToQcm('${viewUrl}')">
            <div class="qcm-card-title">${esc(qcm.qcm_name || qcm.theme)}</div>
            <div class="qcm-card-author">Par ${esc(qcm.auteur)} • ${esc(qcm.theme)}</div>
            <div class="qcm-card-meta">
              <span class="qcm-card-count">
                <i class="fa-solid fa-list-check"></i>
                ${qcm.nb_questions} question${qcm.nb_questions !== 1 ? 's' : ''}
              </span>
            </div>
            <a href="${viewUrl}" class="qcm-card-view" style="margin-top: 10px;" onclick="event.stopPropagation()">
              Commencer <i class="fa-solid fa-arrow-right"></i>
            </a>
          </div>`;
      });
      html += '</div>';
      container.innerHTML = html;
    }

    function esc(str) {
      const d = document.createElement('div');
      d.textContent = str || '';
      return d.innerHTML;
    }

    function goToQcm(url) {
      window.location.href = url;
    }

    function rejoindre() {
      const code = [...inputs].map(i => i.value).join('');
      if (code.length < 4) { inputs[[...inputs].findIndex(i => !i.value)].focus(); return; }

      window.location.href = `/classroom.html?code=${code}&role=eleve`;
    }

    
    const modalInputs = document.querySelectorAll('.modal-code-input');

    modalInputs.forEach((input, i) => {
      input.addEventListener('input', () => {
        input.value = input.value.toUpperCase();
        if (input.value && i < modalInputs.length - 1) modalInputs[i + 1].focus();
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !input.value && i > 0) modalInputs[i - 1].focus();
      });
    });

    function openJoinModal() {
      document.getElementById('joinModalOverlay').classList.add('active');
      modalInputs[0].focus();
    }

    function closeJoinModal() {
      document.getElementById('joinModalOverlay').classList.remove('active');
      modalInputs.forEach(i => i.value = '');
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeJoinModal();
    });

    function rejoindreModal() {
      const code = [...modalInputs].map(i => i.value).join('');
      if (code.length < 4) { modalInputs[[...modalInputs].findIndex(i => !i.value)].focus(); return; }

      window.location.href = `/classroom.html?code=${code}&role=eleve`;
    }
