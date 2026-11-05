let questions = [];   // [{ id, text, answers: [{letter, text, correct}] }]
    let currentPreviewIndex = 0;
    let userAnswers = []; // selected answer index for each question or null
    let nextQuestionId = 1;
    const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
    const PREVIEW_ANSWER_COLORS = ['#D32837', '#2A6ACB', '#359B40', '#E2A707', '#8B5CF6', '#14B8A6', '#F97316', '#0EA5E9', '#9333EA', '#047857'];
    let qcmMetadata = null;  // Métadonnées du QCM chargé (auteur, thème, niveau, visibilité)
    let activeImportTab = 'ai';   // Onglet actif : 'manual' ou 'ai'
    let aiHasGenerated = false;   // true une fois qu'une génération IA a réussi
    let aiFiles = [];

    function createQuestion(text, answers) {
        return { id: nextQuestionId++, text, answers, multiple: false };
    }

    const aiPromptInput = document.getElementById('ai-prompt-input');
    const aiPromptCounter = document.getElementById('ai-prompt-counter');
    aiPromptInput.addEventListener('input', () => {
        aiPromptCounter.textContent = `${aiPromptInput.value.length} / 1000`;
    });

    function switchImportTab(tab) {
        activeImportTab = tab;
        document.getElementById('tab-manual').classList.toggle('active', tab === 'manual');
        document.getElementById('tab-ai').classList.toggle('active', tab === 'ai');

        const paneManual = document.getElementById('pane-manual');
        const paneAi = document.getElementById('pane-ai');

        if (tab === 'manual') {
            paneManual.classList.add('active');
            paneAi.classList.remove('active');
            if (questions.length === 0) {
                addQuestion();
                return; // addQuestion() appelle déjà renderEdition()/renderPreview()
            }

            renderEdition();
        } else {
            paneManual.classList.remove('active');
            paneAi.classList.add('active');
        }
        renderPreview();
    }

    function fileIconFor(file) {
        if (file.type.startsWith('image/')) return 'ti-photo';
        if (file.type === 'application/pdf') return 'ti-file-type-pdf';
        return 'ti-file';
    }

    function renderAiFiles() {
        const list = document.getElementById('ai-files-list');
        list.innerHTML = '';
        aiFiles.forEach((file, i) => {
            const chip = document.createElement('div');
            chip.className = 'ai-file-chip';
            chip.innerHTML = `
                <i class="ti ${fileIconFor(file)} file-icon"></i>
                <span class="file-name">${escapeHtmlAi(file.name)}</span>
                <button type="button" class="file-remove" title="Retirer"><i class="ti ti-x"></i></button>
            `;
            chip.querySelector('.file-remove').onclick = () => {
                aiFiles.splice(i, 1);
                renderAiFiles();
            };
            list.appendChild(chip);
        });
    }

    function escapeHtmlAi(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text || '').replace(/[&<>"']/g, m => map[m]);
    }

    document.getElementById('ai-file-input').addEventListener('change', (e) => {
        aiFiles.push(...Array.from(e.target.files));
        renderAiFiles();
        e.target.value = '';
    });

    const aiDropzone = document.getElementById('ai-dropzone');
    ['dragover', 'dragenter'].forEach(evt => {
        aiDropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            aiDropzone.classList.add('dragover');
        });
    });
    ['dragleave', 'dragend'].forEach(evt => {
        aiDropzone.addEventListener(evt, () => aiDropzone.classList.remove('dragover'));
    });
    aiDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        aiDropzone.classList.remove('dragover');
        aiFiles.push(...Array.from(e.dataTransfer.files));
        renderAiFiles();
    });

    async function generateWithAI() {
        const prompt = document.getElementById('ai-prompt-input').value.trim();
        
        if (!prompt && aiFiles.length === 0) {
            alert('Décris ton QCM ou ajoute au moins un fichier.');
            return;
        }
        
        if (!prompt) {
            alert('Décris ton QCM pour que l\'IA puisse le générer.');
            return;
        }

        const generateBtn = document.getElementById('ai-generate-btn');
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="ti ti-loader-2" style="animation: spin 1s linear infinite;"></i> Génération en cours...';
        
        try {

            const formData = new FormData();
            formData.append('user_prompt', prompt);

            aiFiles.forEach(file => {
                formData.append('files', file);
            });

            const response = await fetch('/api/generate-qcm', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Erreur lors de la génération');
            }
            
            const qcmData = await response.json();

            if (!qcmData.questions || !Array.isArray(qcmData.questions)) {
                throw new Error('Format de réponse invalide: pas de tableau "questions"');
            }

            nextQuestionId = 1;
            questions = qcmData.questions.map(q => ({
                id: nextQuestionId++,
                text: q.text || '',
                multiple: !!q.multiple,
                answers: (q.answers || []).map(a => ({
                    letter: a.letter || '',
                    text: a.text || '',
                    correct: a.correct || false
                }))
            }));

            currentPreviewIndex = 0;
            userAnswers = questions.map(() => null);
            aiHasGenerated = true;

            const infoBanner = document.querySelector('.info-banner');
            if (infoBanner) {
                infoBanner.style.display = 'none';
            }

            switchImportTab('manual');

            showToast('QCM généré avec succès !');
            
        } catch (error) {
            console.error('Erreur lors de la génération IA:', error);
            alert(`Erreur: ${error.message}`);
        } finally {

            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="ti ti-sparkles"></i> Générer le QCM avec l\'IA';
        }
    }

    async function loadQCMFromFile() {
        const params = new URLSearchParams(window.location.search);
        const filePath = params.get('file');
        
        if (!filePath) return; // Pas de fichier à charger, mode création
        
        try {
            const response = await fetch(`/api/qcm/read/${encodeURIComponent(filePath)}`);
            if (!response.ok) {
                console.error('Erreur lors du chargement du QCM:', response.status);
                return;
            }
            
            const data = await response.json();

            qcmMetadata = {
                qcm_name: data.qcm_name || '',
                auteur: data.auteur || '',
                theme: data.theme || '',
                visibilite: data.visibilite || false,
                level: data.level || '',
                sourceFile: data._source_file || null
            };

            if (data.questions && Array.isArray(data.questions)) {
                nextQuestionId = 1;
                questions = data.questions.map(q => ({
                    id: nextQuestionId++,
                    text: q.text || '',
                    multiple: !!q.multiple,
                    answers: (q.answers || []).map(a => ({
                        letter: a.letter || '',
                        text: a.text || '',
                        correct: a.correct || false
                    }))
                }));
                nextQuestionId++;
                
                currentPreviewIndex = 0;
                userAnswers = questions.map(() => null);

                switchImportTab('manual');
                const infoBanner = document.querySelector('.info-banner');
                if (infoBanner) {
                    infoBanner.style.display = 'none';
                }
                
                renderEdition();
                renderPreview();
            }
        } catch (error) {
            console.error('Erreur lors du chargement du QCM:', error);
        }
    }

    function parseQCM(raw) {
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const result = [];
        let current = null;

        lines.forEach(line => {

            const qMatch = line.match(/^(?:Q?\d+[.)\]]\s*)(.+)/i);

            const aMatch = line.match(/^([A-F])[.)\]]\s*(.+)/i);

            if (qMatch && !aMatch) {
                if (current && current.answers.length > 0) {
                    result.push(current);
                }
                current = createQuestion(qMatch[1].trim(), []);
            } else if (aMatch && current) {
                const rawAnswer = aMatch[2];
                const correct = rawAnswer.includes('*');
                current.answers.push({
                    letter: aMatch[1].toUpperCase(),
                    text: rawAnswer.replace('*', '').trim(),
                    correct
                });
            }
        });

        if (current && current.answers.length > 0) {
            result.push(current);
        }

        return result;
    }

    function importQCM() {
        const raw = document.getElementById('qcm-input').value;
        if (!raw.trim()) return;

        questions = parseQCM(raw);
        const hasValidQuestions = questions.length > 0;
        const hasCorrectAnswer = questions.some(q => q.answers.some(a => a.correct));

        if (!hasValidQuestions) {
            alert('Format non reconnu. Vérifiez que chaque question contient au moins une réponse.');
            return;
        }
        if (!hasCorrectAnswer) {
            alert('Ajoutez au moins une réponse marquée avec * pour indiquer la bonne réponse.');
            return;
        }

        currentPreviewIndex = 0;
        userAnswers = questions.map(() => null);
        switchImportTab('manual');
        const infoBanner = document.querySelector('.info-banner');
        if (infoBanner) {
            infoBanner.style.display = 'none';
        }

        renderEdition();
        renderPreview();
    }

    function renderEdition() {
        const list = document.getElementById('questions-list');
        const prevRects = new Map();
        list.querySelectorAll('.question-card').forEach(card => {
            prevRects.set(card.dataset.id, card.getBoundingClientRect());
        });

        list.innerHTML = '';
        questions.forEach((q, qi) => {
            list.appendChild(buildQuestionCard(q, qi));
        });

        list.querySelectorAll('.question-card').forEach(card => {
            const prevRect = prevRects.get(card.dataset.id);
            if (!prevRect) return;
            const newRect = card.getBoundingClientRect();
            const dx = prevRect.left - newRect.left;
            const dy = prevRect.top - newRect.top;
            if (dx || dy) {
                card.style.transform = `translate(${dx}px, ${dy}px)`;
                card.style.transition = 'transform 0s';
                requestAnimationFrame(() => {
                    card.style.transition = 'transform 200ms ease';
                    card.style.transform = '';
                });
            }
        });
    }

    function buildQuestionCard(q, qi) {
        const card = document.createElement('div');
        card.className = 'question-card' + (q.multiple ? ' question-multiple' : '');
        card.dataset.qi = qi;
        card.dataset.id = q.id;

        const top = document.createElement('div');
        top.className = 'question-top';

        const drag = document.createElement('span');
        drag.className = 'drag-handle';
        drag.innerHTML = '<i class="ti ti-grip-vertical"></i>';

        drag.addEventListener('pointerdown', e => startDrag(e, card, qi));

        const badge = document.createElement('span');
        badge.className = 'q-badge';
        badge.textContent = `Q${qi + 1}`;

        const titleInput = document.createElement('input');
        titleInput.className = 'q-title-input';
        titleInput.value = q.text;
        titleInput.addEventListener('input', () => {
            questions[qi].text = titleInput.value;
            renderPreview();
        });

        const actions = document.createElement('div');
        actions.className = 'q-actions';

        const expandQuestionBtn = createTextExpandButton('question', qi);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-copy';
        copyBtn.innerHTML = '<i class="ti ti-copy"></i>';
        copyBtn.title = 'Dupliquer';
        copyBtn.onclick = () => {
            const clone = JSON.parse(JSON.stringify(questions[qi]));
            clone.id = nextQuestionId++;
            questions.splice(qi + 1, 0, clone);
            userAnswers.splice(qi + 1, 0, null);
            renderEdition(); renderPreview();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete';
        delBtn.innerHTML = '<i class="ti ti-trash"></i>';
        delBtn.title = 'Supprimer';
        delBtn.onclick = () => {
            questions.splice(qi, 1);
            userAnswers.splice(qi, 1);
            if (currentPreviewIndex >= questions.length) {
                currentPreviewIndex = Math.max(0, questions.length - 1);
            }
            renderEdition(); renderPreview();
        };

        if (needsTextEditor(q.text, 'question')) actions.append(expandQuestionBtn);
        actions.append(copyBtn, delBtn);
        top.append(drag, badge, titleInput, actions);

        const grid = document.createElement('div');
        grid.className = 'answers-grid';
        q.answers.forEach((ans, ai) => {
            grid.appendChild(buildAnswerItem(ans, qi, ai));
        });

        const footer = document.createElement('div');
        footer.className = 'question-footer';
        footer.style.justifyContent = 'space-between';

        const toggle = document.createElement('div');
        toggle.className = 'choice-toggle';
        [2, 4].forEach(n => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-toggle-btn' + (q.answers.length === n ? ' active' : '');
            btn.textContent = `${n} choix`;
            btn.onclick = () => setAnswerCount(qi, n);
            toggle.appendChild(btn);
        });

        const multipleLabel = document.createElement('label');
        multipleLabel.className = 'multiple-toggle';
        const multipleInput = document.createElement('input');
        multipleInput.type = 'checkbox';
        multipleInput.checked = !!q.multiple;
        multipleInput.addEventListener('change', () => setMultipleChoice(qi, multipleInput.checked));
        const multipleText = document.createElement('span');
        multipleText.textContent = 'Multi-réponse';
        multipleLabel.append(multipleInput, multipleText);

        footer.append(toggle, multipleLabel);
        card.append(top, grid, footer);
        return card;
    }

    function setAnswerCount(qi, n) {
        const q = questions[qi];
        if (!q._hiddenAnswers) q._hiddenAnswers = [];

        if (n > q.answers.length) {
            while (q.answers.length < n) {
                const restored = q._hiddenAnswers.shift();
                q.answers.push(restored || { letter: LETTERS[q.answers.length] || '?', text: '', correct: false });
            }
        } else if (n < q.answers.length) {
            const removed = q.answers.slice(n);
            q._hiddenAnswers = removed.concat(q._hiddenAnswers);
            q.answers = q.answers.slice(0, n);
            if (!q.answers.some(a => a.correct)) q.answers[0].correct = true;
        }
        questions[qi].answers = q.answers;
        renderEdition();
        renderPreview();
    }

    function setMultipleChoice(qi, enabled) {
        const question = questions[qi];
        question.multiple = enabled;
        if (!enabled) {
            const firstCorrect = question.answers.findIndex(answer => answer.correct);
            question.answers.forEach((answer, index) => {
                answer.correct = index === (firstCorrect >= 0 ? firstCorrect : 0);
            });
        }
        renderEdition();
        renderPreview();
    }

    function buildAnswerItem(ans, qi, ai) {
        const item = document.createElement('div');
        item.className = 'answer-item' + (ans.correct ? ' correct' : '');

        const letter = document.createElement('span');
        letter.className = 'answer-letter';
        letter.textContent = ans.letter;

        const input = document.createElement('input');
        input.className = 'answer-input';
        input.value = ans.text;
        input.addEventListener('input', () => {
            questions[qi].answers[ai].text = input.value;
            renderPreview();
        });

        const expandAnswerBtn = createTextExpandButton('answer', qi, ai);

        const radio = document.createElement('div');
        radio.className = 'answer-radio';
        radio.style.cursor = 'pointer';
        radio.onclick = () => {

            if (questions[qi].multiple) {
                questions[qi].answers[ai].correct = !questions[qi].answers[ai].correct;
                if (!questions[qi].answers.some(answer => answer.correct)) {
                    questions[qi].answers[ai].correct = true;
                }
            } else {
                questions[qi].answers.forEach((a, i) => a.correct = (i === ai));
            }
            renderEdition(); renderPreview();
        };

        item.append(letter, input);
        if (needsTextEditor(ans.text, 'answer')) item.append(expandAnswerBtn);
        item.append(radio);
        return item;
    }

    function needsTextEditor(text, type) {
        const limit = type === 'question' ? 48 : 28;
        return String(text || '').length > limit;
    }

    function createTextExpandButton(type, qi, ai = null) {
        const button = document.createElement('button');
        button.className = type === 'question' ? 'btn-expand' : 'answer-expand';
        button.type = 'button';
        button.innerHTML = '<i class="ti ti-maximize"></i>';
        button.title = 'Modifier en grand';
        button.onclick = () => openTextEditor(type, qi, ai);
        return button;
    }

    function openTextEditor(type, qi, ai = null) {
        const modal = document.getElementById('text-editor-modal');
        const input = document.getElementById('text-editor-input');
        const title = document.getElementById('text-editor-title');
        const value = type === 'question' ? questions[qi].text : questions[qi].answers[ai].text;

        modal.dataset.type = type;
        modal.dataset.qi = qi;
        modal.dataset.ai = ai === null ? '' : ai;
        title.textContent = type === 'question' ? 'Modifier la question' : 'Modifier la réponse';
        input.value = value;
        modal.classList.add('open');
        input.focus();
    }

    function closeTextEditor(event) {
        const modal = document.getElementById('text-editor-modal');
        if (event && event.target !== modal) return;
        modal.classList.remove('open');
    }

    function saveTextEditor() {
        const modal = document.getElementById('text-editor-modal');
        const input = document.getElementById('text-editor-input');
        const qi = Number(modal.dataset.qi);
        const ai = modal.dataset.ai === '' ? null : Number(modal.dataset.ai);

        if (modal.dataset.type === 'question') {
            questions[qi].text = input.value;
        } else {
            questions[qi].answers[ai].text = input.value;
        }

        modal.classList.remove('open');
        renderEdition();
        renderPreview();
    }

    function renderPreview() {
        const box = document.getElementById('preview-box');
        const previewPanel = document.querySelector('.panel-right');
        const nextBtn = document.getElementById('next-question-btn');
        const prevBtn = document.getElementById('prev-question-btn');
        const showEmpty = !questions.length || (activeImportTab === 'ai' && !aiHasGenerated);
        previewPanel.classList.toggle('is-empty', showEmpty);
        if (showEmpty) {
            box.classList.remove('preview-dark');
            box.innerHTML = `
            <div class="preview-empty" style="padding: 40px 20px;">
                <div class="relative m-1" style="transform: scale(1.5); transform-origin: center; margin-bottom: 50px;">
                    <div class="w-40 h-32 rounded-3xl bg-gradient-to-br from-violet-50 via-white to-violet-100 shadow-xl border border-violet-100 p-5">
                        <div class="flex items-center gap-3 mb-4">
                            <div class="w-4 h-4 rounded-md bg-violet-500"></div>
                            <div class="space-y-1">
                                <div class="w-14 h-2 rounded-full bg-violet-300"></div>
                                <div class="w-10 h-2 rounded-full bg-violet-200"></div>
                            </div>
                        </div>
                        <div class="flex items-center gap-3 mb-3">
                            <div class="w-4 h-4 rounded-full bg-violet-500"></div>
                            <div class="space-y-1">
                                <div class="w-24 h-2 rounded-full bg-violet-300"></div>
                                <div class="w-18 h-2 rounded-full bg-violet-200"></div>
                            </div>
                        </div>
                        <div class="flex items-center gap-3 mb-2 opacity-70">
                            <div class="w-3 h-3 rounded-full border-2 border-violet-300"></div>
                            <div class="w-18 h-2 rounded-full bg-violet-200"></div>
                        </div>
                        <div class="flex items-center gap-3 opacity-50">
                            <div class="w-3 h-3 rounded-full border-2 border-violet-300"></div>
                            <div class="w-14 h-2 rounded-full bg-violet-200"></div>
                        </div>
                    </div>
                    <div class="absolute inset-0 rounded-3xl blur-2xl bg-violet-300/20 -z-10"></div>
                    <div class="absolute -bottom-3 -right-3 w-16 h-16 rounded-full bg-white border border-violet-100 shadow-xl flex items-center justify-center">
                        <div class="absolute inset-0 rounded-full bg-gradient-to-br from-violet-200 to-violet-100 opacity-70"></div>
                        <span class="relative text-violet-500 font-bold text-4xl">?</span>
                    </div>
                </div>
                <h4 style="position: relative; z-index: 10; margin-top: 1px; opacity: 0.6;">Aucun QCM généré pour le moment</h4>
            </div>`;
            nextBtn.disabled = true;
            prevBtn.disabled = true;
            return;
        }
        if (currentPreviewIndex >= questions.length) {
            currentPreviewIndex = questions.length - 1;
        }

        const q = questions[currentPreviewIndex];
        const answeredIndex = userAnswers[currentPreviewIndex];
        const hasAnswered = answeredIndex !== null && answeredIndex !== undefined;

        box.classList.add('preview-dark');
        box.innerHTML = '';

        const div = document.createElement('div');
        div.className = 'preview-question';

        const num = document.createElement('div');
        num.className = 'preview-q-num';
        num.textContent = `Question ${currentPreviewIndex + 1} / ${questions.length}`;

        const text = document.createElement('div');
        text.className = 'preview-q-text';
        text.textContent = q.text;

        div.append(num, text);

        const answersGrid = document.createElement('div');
        answersGrid.className = 'preview-answers-grid';
        answersGrid.style.gridTemplateColumns = '1fr 1fr';

        const letters = ['A', 'B', 'C', 'D'];

        q.answers.forEach((ans, ai) => {
            const isCorrect = !!ans.correct;
            const isSelected = answeredIndex === ai;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `answer-btn ${letters[ai].toLowerCase()}`;

            const letterEl = document.createElement('span');
            letterEl.className = 'answer-letter';
            letterEl.textContent = ans.letter || letters[ai];

            const textEl = document.createElement('span');
            textEl.className = 'answer-text';
            textEl.textContent = ans.text;

            const icon = document.createElement('span');
            icon.className = 'result-icon';

            if (hasAnswered) {
                button.classList.add('locked');
                if (isCorrect) {
                    button.classList.add('correct-answer', 'selected');
                    icon.innerHTML = '<i class="ti ti-check"></i>';
                } else if (isSelected) {
                    button.classList.add('wrong-answer', 'selected');
                    icon.innerHTML = '<i class="ti ti-x"></i>';
                } else {
                    button.classList.add('dim');
                }
            } else {
                button.addEventListener('click', () => {
                    userAnswers[currentPreviewIndex] = ai;
                    renderPreview();
                });
            }

            button.append(letterEl, textEl, icon);
            answersGrid.appendChild(button);
        });

        div.appendChild(answersGrid);
        box.appendChild(div);

        nextBtn.disabled = currentPreviewIndex >= questions.length - 1;
        prevBtn.disabled = currentPreviewIndex <= 0;
    }

    function nextQuestion() {
        if (currentPreviewIndex < questions.length - 1) {
            currentPreviewIndex += 1;
            renderPreview();
        }
    }

    function openSaveModal() {

        if (qcmMetadata) {
            document.getElementById('save-qcm-name').value = qcmMetadata.qcm_name || '';
            document.getElementById('save-author').value = qcmMetadata.auteur;
            document.getElementById('save-theme').value = qcmMetadata.theme;
            document.getElementById('save-visibility').value = qcmMetadata.visibilite ? 'public' : 'private';
            document.getElementById('save-level').value = qcmMetadata.level;
        }
        document.getElementById('save-modal').classList.add('open');
    }

    function closeSaveModal() {
        document.getElementById('save-modal').classList.remove('open');
    }

    function confirmSave() {
        const qcmName = document.getElementById('save-qcm-name').value.trim();
        const author = document.getElementById('save-author').value.trim();
        const visibility = document.getElementById('save-visibility').value;
        const theme = document.getElementById('save-theme').value.trim();
        const level = document.getElementById('save-level').value;

        if (!qcmName || !author || !theme) {
            alert('Veuillez renseigner le nom du QCM, le nom de l\'auteur et le thème.');
            return;
        }

        closeSaveModal();
        saveQCM({ qcmName, author, visibility, theme, level });
    }

    async function saveQCM(metadata = {}) {
        const btn = document.getElementById('save-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="ti ti-loader-2" style="font-size:18px;"></i> Sauvegarde...';

        try {
            const payload = {
                qcm_name: metadata.qcmName,
                auteur: metadata.author,
                theme: metadata.theme,
                visibilite: metadata.visibility === 'public',
                level: metadata.level,
                questions,
            };

            if (qcmMetadata && qcmMetadata.sourceFile) {
                payload.source_file = qcmMetadata.sourceFile;
            }

            const response = await fetch('/api/qcm/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const error = await response.json().catch(() => null);
                throw new Error(error?.detail || 'Erreur lors de la sauvegarde.');
            }

            showToast();
        } catch(e) {
            alert(e.message || 'Erreur lors de la sauvegarde.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="ti ti-device-floppy" style="font-size:18px;"></i> Sauvegarder le QCM';
        }
    }

    function showToast(message = 'QCM sauvegardé avec succès !') {
        const t = document.getElementById('toast');
        if (message.includes('généré')) {
            t.innerHTML = '<i class="ti ti-sparkles"></i> ' + message;
        } else {
            t.innerHTML = '<i class="ti ti-check"></i> ' + message;
        }
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    let dragState = null;

    function startDrag(e, card, qi) {
        e.preventDefault();
        const list = document.getElementById('questions-list');
        const cards = [...list.querySelectorAll('.question-card')];
        const rect = card.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;

        card.style.opacity = '0.5';

        dragState = { qi, card, offsetY };

        const onMove = ev => {
            const target = cards.find(c => {
                if (c === card) return false;
                const r = c.getBoundingClientRect();
                return ev.clientY > r.top && ev.clientY < r.bottom;
            });
            if (target) {
                const ti = parseInt(target.dataset.qi);
                const fromIdx = questions.findIndex((_, i) => i === dragState.qi);
                const [moved] = questions.splice(fromIdx, 1);
                questions.splice(ti, 0, moved);
                dragState.qi = ti;
                renderEdition();
                renderPreview();

                cleanup();
            }
        };

        const onUp = () => { cleanup(); card.style.opacity = ''; dragState = null; };
        const cleanup = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }

    function addQuestion() {
        questions.push(createQuestion('Nouvelle question', [
            { letter: 'A', text: '', correct: true },
            { letter: 'B', text: '', correct: false },
            { letter: 'C', text: '', correct: false },
            { letter: 'D', text: '', correct: false },
        ]));
        userAnswers.push(null);
        renderEdition();
        renderPreview();
    }

    function prevQuestion() {
        if (currentPreviewIndex > 0) {
            currentPreviewIndex -= 1;
            renderPreview();
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        loadQCMFromFile();
    });
