const headerEl = document.querySelector('.header');
    const profMode = document.getElementById('profMode');
    const eleveMode = document.getElementById('eleveMode');
    const quizView = document.getElementById('quizView');
    const studentListEl = document.getElementById('studentList');
    const connectedTitle = document.getElementById('connectedTitle');
    const startBtn = document.getElementById('startBtn');
    const validateBtn = document.getElementById('validateBtn');
    const multiAnswerSubmit = document.getElementById('multiAnswerSubmit');
    const questionPhaseEl = document.getElementById('questionPhase');
    const revealPhaseEl = document.getElementById('revealPhase');
    const leaderboardPhaseEl = document.getElementById('leaderboardPhase');
    const finishedPhaseEl = document.getElementById('finishedPhase');

    const LETTERS = ['A', 'B', 'C', 'D'];
    let connectedStudents = [];
    let hasAnsweredCurrent = false;
    let selectedAnswerIndices = [];
    let currentQuestionMultiple = false;
    let timerInterval = null;
    let nextInterval = null;
    let lastRanking = [];
    let lastParticipantsCount = 0;
    let isIntentionalLogout = false;

    let role = 'eleve';
    let name = 'Élève';
    let code = '';
    let ws = null;

    const AVATAR_COLORS = ['#8B5CF6', '#D946EF', '#A855F7', '#14B8A6', '#EAB308', '#3B82F6', '#F97316', '#EC4899'];
    function colorForStudent(studentName) {
      let hash = 0;
      for (let i = 0; i < studentName.length; i++) hash = (hash * 31 + studentName.charCodeAt(i)) >>> 0;
      return AVATAR_COLORS[hash % AVATAR_COLORS.length];
    }

    async function initialize() {
        const params = new URLSearchParams(window.location.search);
        code = (params.get('code') || '').toUpperCase();
        const studentNameFromUrl = params.get('name');

        try {
            const res = await fetch('/api/check-role');
            const data = await res.json();
            if (!data.authenticated || !data.role) {
                window.location.href = '/';
                return;
            }
            role = data.role;
        } catch (e) {
            window.location.href = '/';
            return;
        }

        if (!code) {
            window.location.href = (role === 'prof') ? '/prof_dashboard.html' : '/eleve_dashboard.html';
            return;
        }

        if (role === 'prof') {
            name = 'Professeur';
        } else {

            const userDataStr = localStorage.getItem('home_eleve_user');
            const storedName = userDataStr ? JSON.parse(userDataStr).nom : null;
            name = studentNameFromUrl || storedName || 'Élève';
        }

        document.body.classList.add(role === 'prof' ? 'role-prof' : 'role-eleve');
        document.getElementById('codeValueProf').textContent = code;
        document.getElementById('roomCodeDisplay').textContent = code;
        document.getElementById('studentName').textContent = name;

        if (role === 'prof') { profMode.classList.remove('hidden'); eleveMode.classList.remove('active'); }
        else { profMode.classList.add('hidden'); eleveMode.classList.add('active'); }

        initWebSocket();
    }

    async function initWebSocket() {
      try {
        const tokenResponse = await fetch('/api/live-token');
        if (!tokenResponse.ok) throw new Error('La session a expiré. Reconnecte-toi pour rejoindre cette salle.');
        const { token } = await tokenResponse.json();
        const liveUrl = new URL(window.APP_CONFIG?.liveApiBaseUrl || window.location.origin);
        liveUrl.protocol = liveUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        liveUrl.pathname = `/ws/${encodeURIComponent(code)}`;
        liveUrl.search = '';
        liveUrl.searchParams.set('role', role);
        liveUrl.searchParams.set('name', name);
        liveUrl.searchParams.set('ticket', token);
        ws = new WebSocket(liveUrl);
      } catch (error) {
        showAlert(error.message || 'Impossible de se connecter au serveur de classe.', () => {
          window.location.href = role === 'prof' ? '/prof_dashboard.html' : '/eleve_dashboard.html';
        });
        return;
      }

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'student_list': connectedStudents = data.students || []; lastParticipantsCount = connectedStudents.length; renderStudentList(connectedStudents); break;
          case 'room_empty':
            isIntentionalLogout = true;
            window.location.href = '/prof_dashboard.html?reason=no_players';
            break;
          case 'question': handleQuestion(data); break;
          case 'responses_update': document.getElementById('responsesCount').textContent = `Réponses reçues : ${data.received}/${data.total}`; break;
          case 'reveal': handleReveal(data); break;
          case 'leaderboard': handleLeaderboard(data); break;
          case 'quiz_finished': case 'quiz_finished_prof': handleQuizFinished(data); break;
          case 'error':
            isIntentionalLogout = true;
            showAlert(data.message, () => { 
                window.location.href = (role === 'prof') ? '/prof_dashboard.html' : '/eleve_dashboard.html'; 
            });
            break;
        }
      };
      
      ws.onclose = () => {
        if (!isIntentionalLogout) {
          showAlert("La connexion avec le serveur a été perdue ou la salle a été fermée.", () => {
            window.location.href = (role === 'prof') ? '/prof_dashboard.html' : '/eleve_dashboard.html';
          });
        }
      };
    }

    function showAlert(message, onClose) {
        const modal = document.getElementById('customModal');
        document.getElementById('customModalMessage').textContent = message;
        document.getElementById('customModalCancel').style.display = 'none';
        document.getElementById('customModalConfirm').style.display = 'none';
        document.getElementById('customModalOk').style.display = 'inline-block';
        modal.classList.add('active');
        document.getElementById('customModalOk').onclick = () => { modal.classList.remove('active'); if (onClose) onClose(); };
    }
    function showConfirm(message, onConfirm) {
        const modal = document.getElementById('customModal');
        document.getElementById('customModalMessage').textContent = message;
        document.getElementById('customModalOk').style.display = 'none';
        document.getElementById('customModalCancel').style.display = 'inline-block';
        document.getElementById('customModalConfirm').style.display = 'inline-block';
        modal.classList.add('active');
        document.getElementById('customModalConfirm').onclick = () => { modal.classList.remove('active'); if (onConfirm) onConfirm(); };
        document.getElementById('customModalCancel').onclick = () => { modal.classList.remove('active'); };
    }
    function handleLogout() {
        let msg = "Êtes-vous sûr de vouloir quitter ?";
        if (role === 'prof') msg = "Êtes-vous sûr de vouloir quitter ? La salle sera fermée pour tous les élèves.";
        showConfirm(msg, () => {
            isIntentionalLogout = true;
            if (ws && ws.readyState === WebSocket.OPEN) ws.close();
            window.location.href = (role === 'prof') ? '/prof_dashboard.html' : '/eleve_dashboard.html';
        });
    }

    function renderStudentList(students) {
      connectedTitle.textContent = `Élèves connectés : ${students.length}`;
      studentListEl.innerHTML = '';
      if (students.length === 0) { studentListEl.innerHTML = '<p class="student-empty">En attente d\'élèves...</p>'; return; }
      students.forEach((studentName) => {
        const item = document.createElement('div'); item.className = 'student-item';
        const avatar = document.createElement('div'); avatar.className = 'student-avatar'; avatar.style.backgroundColor = colorForStudent(studentName); avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
        const label = document.createElement('span'); label.className = 'student-name'; label.textContent = studentName;
        item.append(avatar, label); studentListEl.appendChild(item);
      });
    }

    startBtn.addEventListener('click', () => ws.send(JSON.stringify({ action: 'start_quiz' })));
    validateBtn.addEventListener('click', () => ws.send(JSON.stringify({ action: 'validate_question' })));
    multiAnswerSubmit.addEventListener('click', submitMultipleAnswer);

    function enterQuizView() {
      profMode.classList.add('hidden'); eleveMode.classList.remove('active'); quizView.classList.add('active'); document.body.classList.remove('score-mode');
      if (headerEl && headerEl.parentElement !== document.body) document.body.insertBefore(headerEl, document.body.firstChild);
    }
    function showPhase(phase) {
      questionPhaseEl.style.display = phase === 'question' ? 'flex' : 'none';
      revealPhaseEl.style.display = phase === 'reveal' ? 'flex' : 'none';
      leaderboardPhaseEl.style.display = phase === 'leaderboard' ? 'flex' : 'none';
      finishedPhaseEl.style.display = phase === 'finished' ? 'flex' : 'none';
    }

    function handleQuestion(msg) {
      clearInterval(timerInterval); clearInterval(nextInterval); hasAnsweredCurrent = false;
      selectedAnswerIndices = [];
      currentQuestionMultiple = msg.multiple === true || msg.multiple === 1 || msg.multiple === 'true';
      enterQuizView(); showPhase('question');
      document.getElementById('multipleQuestionBadge').classList.toggle('is-visible', currentQuestionMultiple);
      document.getElementById('quizProgressText').textContent = `Question ${msg.index + 1}/${msg.total}`;
      document.getElementById('questionTitle').textContent = msg.question;
      renderAnswers(msg.answers, currentQuestionMultiple);
      document.getElementById('responsesCount').textContent = `Réponses reçues : 0/${connectedStudents.length}`;
      startTimer(msg.duration, msg.full_duration || msg.duration);
    }
    function renderAnswers(answersArr, multiple = false) {
      const grid = document.getElementById('answersGrid'); grid.innerHTML = '';
      multiAnswerSubmit.style.display = multiple && role === 'eleve' ? 'inline-block' : 'none';
      answersArr.forEach((text, idx) => {
        const letter = LETTERS[idx]; const btn = document.createElement('button'); btn.className = `answer-btn ${letter.toLowerCase()}`;
        const letterEl = document.createElement('div'); letterEl.className = 'answer-letter'; letterEl.textContent = letter;
        const textEl = document.createElement('div'); textEl.className = 'answer-text'; textEl.textContent = text;
        btn.append(letterEl, textEl);
        if (multiple) btn.classList.add('multi-answer');
        if (role === 'eleve') btn.addEventListener('click', () => selectAnswer(idx, btn));
        else btn.classList.add('readonly');
        grid.appendChild(btn);
      });
    }
    function selectAnswer(answerIndex, btn) {
      if (hasAnsweredCurrent) return;
      if (currentQuestionMultiple) {
        const selected = selectedAnswerIndices.indexOf(answerIndex);
        if (selected === -1) {
          selectedAnswerIndices.push(answerIndex);
          btn.classList.add('selected');
        } else {
          selectedAnswerIndices.splice(selected, 1);
          btn.classList.remove('selected');
        }
        multiAnswerSubmit.disabled = selectedAnswerIndices.length === 0;
        return;
      }
      hasAnsweredCurrent = true;
      document.querySelectorAll('#answersGrid .answer-btn').forEach((b) => b.classList.add('locked'));
      btn.classList.add('selected');
      ws.send(JSON.stringify({ action: 'answer', answer_index: answerIndex }));
    }
    function submitMultipleAnswer() {
      if (hasAnsweredCurrent || selectedAnswerIndices.length === 0) return;
      hasAnsweredCurrent = true;
      document.querySelectorAll('#answersGrid .answer-btn').forEach((b) => b.classList.add('locked'));
      multiAnswerSubmit.style.display = 'none';
      ws.send(JSON.stringify({ action: 'answer', answer_index: selectedAnswerIndices }));
    }
    function startTimer(duration, fullDuration) {
      clearInterval(timerInterval);
      let remaining = duration; const total = fullDuration || duration;
      const timerText = document.getElementById('timerText'); const timerFill = document.getElementById('timerBarFill');
      timerText.textContent = `${remaining} sec`; timerFill.style.width = `${Math.max(0, Math.min(100, (remaining / total) * 100))}%`;
      timerInterval = setInterval(() => {
        remaining -= 1; if (remaining < 0) { clearInterval(timerInterval); return; }
        timerText.textContent = `${remaining} sec`; timerFill.style.width = `${Math.max(0, Math.min(100, (remaining / total) * 100))}%`;
      }, 1000);
    }

    function handleReveal(msg) {
      clearInterval(timerInterval); enterQuizView(); showPhase('reveal');
      document.getElementById('multipleQuestionBadge').classList.remove('is-visible');
      document.getElementById('revealProgressText').textContent = `Question ${msg.index + 1}/${msg.total}`;
      const correctIndices = msg.correct_indices || [msg.correct_index];
      const banner = document.getElementById('revealBanner');
      const correctColors = { A: '#D32837', B: '#2A6ACB', C: '#359B40', D: '#E2A707' };
      const correctLabels = correctIndices.map(idx => {
        const letter = LETTERS[idx];
        const text = escapeHtml(msg.answers[idx] || '');
        return `<span class="correct-answer-label" style="color: ${correctColors[letter] || '#FFFFFF'};">${letter} - ${text}</span>`;
      });
      banner.innerHTML = `Réponse${correctIndices.length > 1 ? 's' : ''} correcte${correctIndices.length > 1 ? 's' : ''} : ${correctLabels.join(' <span class="correct-answer-separator">;</span> ')}`;
      const barsContainer = document.getElementById('revealBars'); barsContainer.innerHTML = '';
      LETTERS.forEach((letter, idx) => {
        const row = document.createElement('div'); row.className = 'reveal-row';
        const letterEl = document.createElement('div'); letterEl.className = `reveal-letter ${letter.toLowerCase()}`; letterEl.textContent = letter;
        const countEl = document.createElement('div'); countEl.className = `reveal-count`; countEl.textContent = msg.counts[idx];
        const track = document.createElement('div'); track.className = 'reveal-track'; const fill = document.createElement('div'); fill.className = `reveal-fill ${letter.toLowerCase()}`; track.appendChild(fill);
        const percentEl = document.createElement('div'); percentEl.className = 'reveal-percent'; percentEl.textContent = `${msg.percents[idx]}%`;
        row.append(letterEl, countEl, track, percentEl); barsContainer.appendChild(row);
        requestAnimationFrame(() => { fill.style.width = `${msg.percents[idx]}%`; });
      });
      let secondsLeft = msg.next_delay; const nextEl = document.getElementById('revealNext');
      const updateNextText = () => { nextEl.textContent = msg.is_last ? `Résultats finaux dans ${secondsLeft} sec...` : `Passage à la question suivante dans ${secondsLeft} sec...`; };
      updateNextText(); clearInterval(nextInterval);
      nextInterval = setInterval(() => { secondsLeft -= 1; if (secondsLeft < 0) { clearInterval(nextInterval); return; } updateNextText(); }, 1000);
    }

    function handleLeaderboard(msg) {
      enterQuizView(); showPhase('leaderboard');
      if (msg.ranking && Array.isArray(msg.ranking)) { lastRanking = msg.ranking; lastParticipantsCount = msg.ranking.length || lastParticipantsCount; }
      document.getElementById('leaderboardProgressText').textContent = `Question ${msg.index + 1}/${msg.total}`;
      const listEl = document.getElementById('leaderboardList'); listEl.innerHTML = '';

      if (msg.ranking) {
        const top5 = msg.ranking.slice(0, 5);
        top5.forEach((entry, i) => {
          const row = document.createElement('div'); 
          row.className = 'leaderboard-row';
          
          let displayName = entry.name;
          if (role === 'eleve' && entry.name === name) {
            row.classList.add('own-score');
            displayName += ' (Vous)';
          }

          const rankEl = document.createElement('div'); rankEl.className = 'leaderboard-rank'; rankEl.textContent = i + 1;
          const avatar = document.createElement('div'); avatar.className = 'student-avatar'; avatar.style.background = colorForStudent(entry.name); avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
          const nameEl = document.createElement('div'); nameEl.className = 'leaderboard-name'; nameEl.textContent = displayName;
          const pointsEl = document.createElement('div'); pointsEl.className = 'leaderboard-points'; pointsEl.textContent = `${entry.points || 0} pts`;
          row.append(rankEl, avatar, nameEl, pointsEl); listEl.append(row);
        });

        if (role === 'eleve') {
          const userRankIndex = msg.ranking.findIndex(entry => entry.name === name);
          if (userRankIndex >= 5) {
            const userEntry = msg.ranking[userRankIndex];
            const userRow = document.createElement('div'); userRow.className = 'leaderboard-row own-score';
            const userRankEl = document.createElement('div'); userRankEl.className = 'leaderboard-rank'; userRankEl.textContent = userRankIndex + 1;
            const userAvatar = document.createElement('div'); userAvatar.className = 'student-avatar'; userAvatar.style.background = colorForStudent(name); userAvatar.innerHTML = '<i class="fa-solid fa-user"></i>';
            const userNameEl = document.createElement('div'); userNameEl.className = 'leaderboard-name'; userNameEl.textContent = name + ' (Vous)'
            const userPointsEl = document.createElement('div'); userPointsEl.className = 'leaderboard-points'; userPointsEl.textContent = `${userEntry.points || 0} pts`;
            userRow.append(userRankEl, userAvatar, userNameEl, userPointsEl); listEl.append(userRow);
          }
        }
      }

      let secondsLeft = msg.next_delay; const nextEl = document.getElementById('leaderboardNext');
      const updateNextText = () => { nextEl.textContent = msg.is_last ? `Résultats finaux dans ${secondsLeft} sec...` : `Question suivante dans ${secondsLeft} sec...`; };
      updateNextText(); clearInterval(nextInterval);
      nextInterval = setInterval(() => { secondsLeft -= 1; if (secondsLeft < 0) { clearInterval(nextInterval); return; } updateNextText(); }, 1000);
    }

    const QUIZ_LABEL = 'Mathématiques - Priorités';
    function handleQuizFinished(msg) {
      enterQuizView(); showPhase('finished'); document.body.classList.add('score-mode');
      let ranking = [];
      if (msg.points && typeof msg.points === 'object') { ranking = Object.keys(msg.points).map(n => ({ name: n, points: msg.points[n] || 0 })).sort((a, b) => (b.points || 0) - (a.points || 0)); }
      else if (msg.ranking && Array.isArray(msg.ranking)) { ranking = [...msg.ranking].sort((a, b) => (b.points || 0) - (a.points || 0)); }
      else if (lastRanking.length > 0) { ranking = [...lastRanking].sort((a, b) => (b.points || 0) - (a.points || 0)); }

      const participantCount = msg.participants || lastParticipantsCount || ranking.length;
      const podiumOrder = [ranking[1], ranking[0], ranking[2]];
      const podiumClasses = ['silver', 'gold', 'bronze']; const podiumRanks = [2, 1, 3];
      let stageHtml = '';
      podiumOrder.forEach((entry, i) => {
        if (!entry) return;
        stageHtml += `<div class="podium-column"><div class="podium-trophy ${podiumClasses[i]}"><i class="fa-solid fa-trophy"></i></div><div class="podium-avatar" style="background-color:${colorForStudent(entry.name)};"><i class="fa-solid fa-user"></i></div><div class="podium-block ${podiumClasses[i]}"><div class="podium-rank">${podiumRanks[i]}</div><div class="podium-name">${escapeHtml(entry.name)}</div><div class="podium-pts">${entry.points || 0} pts</div></div></div>`;
      });
      const stageOrEmpty = ranking.length > 0 ? `<div class="podium-stage">${stageHtml}</div>` : '<p class="podium-empty">Aucune réponse enregistrée.</p>';
      let ownScoreHtml = '';
      if (role === 'eleve' && msg.score !== undefined) { ownScoreHtml = `<div class="student-own-score"><i class="fa-solid fa-star"></i> Votre score : ${msg.score} / ${msg.total}</div>`; }

      let actionsHtml = '';
      if (role === 'prof') { actionsHtml = `<a class="podium-btn primary" href="/prof_dashboard.html"><i class="fa-solid fa-house"></i> Retour au tableau de bord</a>`; }
      else { actionsHtml = `<a class="podium-btn primary" href="/eleve_dashboard.html"><i class="fa-solid fa-arrow-right"></i> Continuer</a>`; }
      
      finishedPhaseEl.innerHTML = `<div class="podium-card" id="podiumCard"><div class="podium-top-bar" id="podiumTopBar"><div class="podium-participants"><i class="fa-solid fa-users"></i><div class="podium-participants-text"><span class="ppt-label">Participants</span><span class="ppt-value">${participantCount}</span></div></div></div><h1 class="podium-title"><span class="podium-emoji">🎉</span>Quiz terminé !</h1><p class="podium-subtitle">${escapeHtml(QUIZ_LABEL)}</p>${stageOrEmpty}${ownScoreHtml}<hr class="podium-divider"><div class="podium-footer-note"><p class="footer-title">⭐ Super participation !</p><p class="footer-sub">Bravo à tous les participants pour leurs efforts.</p></div><div class="podium-actions">${actionsHtml}</div></div>`;
      const topBarEl = document.getElementById('podiumTopBar');
      if (topBarEl && headerEl) topBarEl.insertBefore(headerEl, topBarEl.firstChild);
      
      if (ranking.length > 0) launchConfetti('podiumCard');
    }

    function launchConfetti(wrapId) {
      const wrap = document.getElementById(wrapId); if (!wrap) return;
      const colors = ['#6F4DF2', '#2DBA6F', '#E2A707', '#D32837', '#2A6ACB'];
      for (let i = 0; i < 80; i++) {
        const piece = document.createElement('div'); piece.className = 'confetti-piece';
        const baseSize = 5 + Math.random() * 7; const isLong = Math.random() > 0.5;
        piece.style.width = isLong ? (baseSize * 1.6) + 'px' : baseSize + 'px';
        piece.style.height = isLong ? (baseSize * 0.6) + 'px' : baseSize + 'px';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDuration = (1.8 + Math.random() * 2.2) + 's'; piece.style.animationDelay = (Math.random() * 0.8) + 's';
        const xEnd = (Math.random() * 160 - 80) + 'px'; const rotX = (Math.random() * 360 + 360) + 'deg'; const rotY = (Math.random() * 360 + 360) + 'deg'; const rotZ = (Math.random() * 180 - 90) + 'deg';
        piece.style.setProperty('--x-end', xEnd); piece.style.setProperty('--rot-x', rotX); piece.style.setProperty('--rot-y', rotY); piece.style.setProperty('--rot-z', rotZ);
        wrap.appendChild(piece); setTimeout(() => piece.remove(), 4800);
      }
    }
    function escapeHtml(text) { const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }; return String(text || '').replace(/[&<>"']/g, (m) => map[m]); }

    initialize();
