let allQcms = [];
    let currentTab = 'public';

    document.addEventListener('DOMContentLoaded', () => {
      loadQcms();
      bindEvents();
      checkRoomEmptyNotice();
    });

    function checkRoomEmptyNotice() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('reason') !== 'no_players') return;
      window.history.replaceState({}, '', window.location.pathname);
      const overlay = document.getElementById('roomEmptyNotice');
      if (overlay) overlay.classList.add('open');
    }

    function closeRoomEmptyNotice() {
      document.getElementById('roomEmptyNotice')?.classList.remove('open');
    }

    function bindEvents() {
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentTab = btn.dataset.tab;
          renderQcms();
        });
      });
      document.getElementById('searchInput').addEventListener('input', renderQcms);
      document.getElementById('avaible-theme').addEventListener('change', renderQcms);
      document.getElementById('avaible-class').addEventListener('change', renderQcms);

      document.querySelectorAll('.modal-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentModalTab = btn.dataset.tab;
          renderModalList();
        });
      });
      document.getElementById('modalSearchInput').addEventListener('input', renderModalList);
      document.getElementById('modalThemeSelect').addEventListener('change', renderModalList);
      document.getElementById('modalClassSelect').addEventListener('change', renderModalList);
    }

    async function loadQcms() {
      try {
        const res = await fetch('/api/qcm/list');
        if (!res.ok) throw new Error('Erreur serveur');
        allQcms = await res.json();
        allQcms.sort((a, b) => b.filename.localeCompare(a.filename));
        populateThemes();
        renderQcms();
      } catch (err) {
        console.error(err);
        document.getElementById('qcmContainer').innerHTML = `
          <div class="empty-state">
            <div class="empty-icon-wrap"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <h3>Erreur de chargement</h3>
            <p>Impossible de récupérer les QCM depuis le serveur.</p>
          </div>`;
      }
    }

    function populateThemes() {
      const themes = [...new Set(allQcms.map(q => q.theme))].sort();
      [document.getElementById('avaible-theme'), document.getElementById('modalThemeSelect')].forEach(select => {
        themes.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t;
          opt.textContent = t;
          select.appendChild(opt);
        });
      });
    }

    function renderQcms() {
      const container = document.getElementById('qcmContainer');
      const search = document.getElementById('searchInput').value.toLowerCase().trim();
      const themeFilter = document.getElementById('avaible-theme').value;
      const classFilter = document.getElementById('avaible-class').value;

      let filtered = allQcms.filter(q =>
        currentTab === 'public' ? q.visibilite === true : q.visibilite === false
      );
      if (themeFilter !== 'all') filtered = filtered.filter(q => q.theme === themeFilter);
      if (classFilter !== 'all') filtered = filtered.filter(q => q.level === classFilter);
      if (search) {
        filtered = filtered.filter(q =>
          q.theme.toLowerCase().includes(search) ||
          q.auteur.toLowerCase().includes(search) ||
          q.filename.toLowerCase().includes(search) ||
          (q.qcm_name && q.qcm_name.toLowerCase().includes(search))
        );
      }

      if (filtered.length === 0) {
        const isSearch = search || themeFilter !== 'all';
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon-wrap"><i class="fa-regular fa-folder-open"></i></div>
            <h3>${isSearch ? 'Aucun résultat' : "Aucun QCM n'a été créé"}</h3>
            <p>${isSearch ? 'Essayez de modifier vos filtres.' : 'Commencez par créer votre premier questionnaire pour le voir apparaître ici.'}</p>
            ${!isSearch ? '<a href="/qcm" class="btn-empty"><i class="fa-solid fa-plus"></i> Créer mon premier QCM</a>' : ''}
          </div>`;
        return;
      }

      let html = '<div class="qcm-list">';
      filtered.forEach(qcm => {
        const badgeClass = qcm.visibilite ? 'public' : 'prive';
        const badgeText  = qcm.visibilite ? 'Public' : 'Privé';
        const editUrl    = '/qcm?file=' + encodeURIComponent(qcm.full_path);

        html += `
          <div class="qcm-card" onclick="launchClassroom('${qcm.full_path}')">
            <div class="qcm-card-info">
              <div class="qcm-card-title">${esc(qcm.qcm_name || qcm.theme)}</div>
              <div class="qcm-card-author">Par ${esc(qcm.auteur)} • ${esc(qcm.theme)}</div>
              <div class="qcm-card-meta">
                <span class="qcm-card-badge ${badgeClass}">${badgeText}</span>
                <span class="qcm-card-count">
                  <i class="fa-solid fa-list-check"></i>
                  ${qcm.nb_questions} question${qcm.nb_questions !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
            <div class="qcm-card-actions">
              <a href="javascript:void(0)" onclick="event.stopPropagation(); launchClassroom('${qcm.full_path}')" class="qcm-card-view">
                Lancer le QCM <i class="fa-solid fa-arrow-right"></i>
              </a>
              <a href="${editUrl}" class="qcm-card-edit" onclick="event.stopPropagation()">
                <i class="fa-solid fa-pen"></i> <span class="edit-label">Éditer</span>
              </a>
            </div>
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

    async function launchClassroom(qcmFilePath) {
      const liveBase = (window.APP_CONFIG?.liveApiBaseUrl || window.location.origin).replace(/\/$/, '');
      const waitOverlay = document.getElementById('serverWaitOverlay');
      const waitMessage = document.getElementById('serverWaitMessage');
      const waitStartedAt = Date.now();
      let waitTimer;

      const updateWaitMessage = () => {
        const elapsed = Math.floor((Date.now() - waitStartedAt) / 1000);
        waitMessage.textContent = elapsed > 45
          ? 'Le démarrage prend plus longtemps que prévu. La page continue de vérifier le serveur.'
          : `Le serveur de classe démarre… (${elapsed} s)`;
      };

      const waitForLiveServer = async () => {
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          try {
            const response = await fetch(`${liveBase}/health`, { cache: 'no-store', signal: controller.signal });
            if (response.ok) return;
          } catch (error) {
            // A sleeping instance may not answer until it has finished starting.
          } finally {
            clearTimeout(timeout);
          }
          updateWaitMessage();
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        throw new Error('Le serveur de classe ne répond pas après 3 minutes. Réessaie dans un instant.');
      };

      try {
        waitOverlay.hidden = false;
        updateWaitMessage();
        waitTimer = setInterval(updateWaitMessage, 1000);
        await waitForLiveServer();

        const tokenResponse = await fetch('/api/live-token');
        if (!tokenResponse.ok) throw new Error('Session expirée. Reconnecte-toi puis réessaie.');
        const { token } = await tokenResponse.json();
        const res = await fetch(`${liveBase}/api/create_room`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ qcm_file: qcmFilePath })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Erreur lors de la création de la salle.');
        window.location.href = `/classroom.html?code=${data.code}&role=prof`;
      } catch (error) {
        alert(error.message || 'Erreur de connexion au serveur lors de la création de la salle.');
        console.error(error);
      } finally {
        clearInterval(waitTimer);
        waitOverlay.hidden = true;
      }
    }

    let currentModalTab = 'public';

    function openLaunchModal() {
      document.getElementById('launchModalOverlay').classList.add('open');

      document.getElementById('modalSearchInput').value = '';
      document.getElementById('modalThemeSelect').value = 'all';
      document.getElementById('modalClassSelect').value = 'all';
      document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.modal-tab-btn[data-tab="public"]').classList.add('active');
      currentModalTab = 'public';
      renderModalList();
    }

    function closeLaunchModal() {
      document.getElementById('launchModalOverlay').classList.remove('open');
    }

    function closeOnOverlay(e) {
      if (e.target.id === 'launchModalOverlay') closeLaunchModal();
    }

    function renderModalList() {
      const container = document.getElementById('modalList');
      const search = document.getElementById('modalSearchInput').value.toLowerCase().trim();
      const themeFilter = document.getElementById('modalThemeSelect').value;
      const classFilter = document.getElementById('modalClassSelect').value;

      let filtered = allQcms.filter(q =>
        currentModalTab === 'public' ? q.visibilite === true : q.visibilite === false
      );
      if (themeFilter !== 'all') filtered = filtered.filter(q => q.theme === themeFilter);
      if (classFilter !== 'all') filtered = filtered.filter(q => q.level === classFilter);
      if (search) {
        filtered = filtered.filter(q =>
          q.theme.toLowerCase().includes(search) ||
          q.auteur.toLowerCase().includes(search) ||
          q.filename.toLowerCase().includes(search) ||
          (q.qcm_name && q.qcm_name.toLowerCase().includes(search))
        );
      }

      if (filtered.length === 0) {
        container.innerHTML = `
          <div class="modal-empty">
            <i class="fa-regular fa-folder-open"></i>
            <p>Aucun QCM ne correspond à votre recherche.</p>
          </div>`;
        return;
      }

      container.innerHTML = filtered.map(qcm => `
        <div class="modal-qcm-item" onclick="selectQcmFromModal('${qcm.full_path}')">
          <div class="modal-qcm-info">
            <div class="modal-qcm-title">${esc(qcm.qcm_name || qcm.theme)}</div>
            <div class="modal-qcm-sub">Par ${esc(qcm.auteur)} • ${esc(qcm.theme)}${qcm.level ? ' • ' + esc(qcm.level) : ''}</div>
          </div>
          <div class="modal-qcm-meta">
            <span class="modal-qcm-badge ${qcm.visibilite ? 'public' : 'prive'}">${qcm.visibilite ? 'Public' : 'Privé'}</span>
            <span class="modal-qcm-count">${qcm.nb_questions} question${qcm.nb_questions !== 1 ? 's' : ''}</span>
          </div>
        </div>
      `).join('');
    }

    function selectQcmFromModal(qcmFullPath) {
      closeLaunchModal();
      launchClassroom(qcmFullPath);
    }
