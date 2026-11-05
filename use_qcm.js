let qcmData = null;
        let currentQuestionIndex = 0;
        let userAnswers = {};
        let submittedQuestions = {};

        document.addEventListener('DOMContentLoaded', () => {
            const params = new URLSearchParams(window.location.search);
            const filePath = params.get('file');
            
            if (!filePath) {
                showError('Aucun QCM sélectionné');
                return;
            }
            
            loadQCM(filePath);
        });

        async function loadQCM(filePath) {
            try {
                const response = await fetch(`/api/qcm/read/${filePath}`);
                if (!response.ok) {
                    throw new Error('Erreur lors du chargement du QCM');
                }
                
                qcmData = await response.json();
                
                if (!qcmData.questions || qcmData.questions.length === 0) {
                    showError('Aucune question disponible dans ce QCM');
                    return;
                }
                
                currentQuestionIndex = 0;
                userAnswers = {};
                submittedQuestions = {};
                renderQuestion();
            } catch (error) {
                console.error('Erreur:', error);
                showError('Impossible de charger le QCM. Veuillez réessayer.');
            }
        }

        function renderQuestion() {
            const container = document.getElementById('qcmContainer');
            const question = qcmData.questions[currentQuestionIndex];
            const totalQuestions = qcmData.questions.length;
            
            document.getElementById('multipleQuestionBadge').classList.toggle('is-visible', !!question.multiple);
            document.getElementById('progressText').textContent = `Question ${currentQuestionIndex + 1} / ${totalQuestions}`;
            
            let html = `
                <div class="question-title">${escapeHtml(question.text || question.question)}</div>
                <div class="answers-grid">
            `;
            
            const answers = question.answers || question.reponses || [];
            const letters = ['a', 'b', 'c', 'd'];
            const answered = userAnswers[currentQuestionIndex];
            const isMultiple = !!question.multiple;
            const hasAnswered = answered !== undefined && (!isMultiple || submittedQuestions[currentQuestionIndex]);
            const selectedIndices = Array.isArray(answered) ? answered : (answered === undefined ? [] : [answered]);
            
            answers.forEach((answer, idx) => {
                const answerText = typeof answer === 'string' ? answer : (answer.text || '');
                const isCorrectAnswer = isCorrect(question, answer, idx);
                const letter = letters[idx].toUpperCase();
                
                let stateClass = '';
                let icon = '';
                if (hasAnswered) {
                    if (isCorrectAnswer) {
                        stateClass = 'correct-answer';
                        icon = '<i class="fa-solid fa-check result-icon"></i>';
                    } else if (selectedIndices.includes(idx)) {
                        stateClass = 'wrong-answer';
                        icon = '<i class="fa-solid fa-xmark result-icon"></i>';
                    } else {
                        stateClass = 'dim';
                    }
                }
                
                html += `
                    <button class="answer-btn ${letters[idx]} ${isMultiple ? 'multi-answer' : ''} ${selectedIndices.includes(idx) && !hasAnswered ? 'selected' : ''} ${stateClass} ${hasAnswered ? 'locked' : ''}" 
                            onclick="selectAnswer(${idx})">
                        <div class="answer-letter">${letter}</div>
                        <div class="answer-text">${escapeHtml(answerText)}</div>
                        ${icon}
                    </button>
                `;
            });
            
            html += `</div>`;

            if (isMultiple && !hasAnswered) {
                html += `<button class="next-btn multi-answer-submit ${selectedIndices.length ? 'show' : ''}" onclick="validateMultipleAnswer()">Valider mes réponses</button>`;
            }
            
            const isLastQuestion = currentQuestionIndex === totalQuestions - 1;
            html += `
                <button class="next-btn ${hasAnswered ? 'show' : ''}" onclick="goToNext()">
                    ${isLastQuestion ? 'Voir le score' : 'Suivant'}
                </button>
            `;
            
            container.innerHTML = html;
        }

        function isCorrect(question, answer, idx) {
            if (answer && typeof answer === 'object' && 'correct' in answer) {
                return !!answer.correct;
            }
            const correctIndex = question.correctAnswer ?? question.correctIndex ?? question.correct;
            if (correctIndex !== undefined) {
                return idx === correctIndex;
            }
            return false;
        }

        function getCorrectIndices(question, answers) {
            const indices = answers.reduce((result, answer, idx) => {
                if (isCorrect(question, answer, idx)) result.push(idx);
                return result;
            }, []);
            return indices.length ? indices : [question.correctAnswer ?? question.correctIndex ?? question.correct ?? 0];
        }

        function selectAnswer(answerIndex) {
            const question = qcmData.questions[currentQuestionIndex];
            if (question.multiple) {
                if (submittedQuestions[currentQuestionIndex]) return;
                const selected = [];
                const current = userAnswers[currentQuestionIndex] || [];
                selected.push(...current);
                const existingIndex = selected.indexOf(answerIndex);
                if (existingIndex === -1) selected.push(answerIndex);
                else selected.splice(existingIndex, 1);
                userAnswers[currentQuestionIndex] = selected;
                renderQuestion();
                return;
            }
            if (userAnswers[currentQuestionIndex] !== undefined) return;
            userAnswers[currentQuestionIndex] = answerIndex;
            renderQuestion();
        }

        function validateMultipleAnswer() {
            const answered = userAnswers[currentQuestionIndex];
            if (!Array.isArray(answered) || answered.length === 0) return;
            userAnswers[currentQuestionIndex] = [...new Set(answered)].sort((a, b) => a - b);
            submittedQuestions[currentQuestionIndex] = true;
            renderQuestion();
        }

        function goToNext() {
            const totalQuestions = qcmData.questions.length;
            if (currentQuestionIndex < totalQuestions - 1) {
                currentQuestionIndex++;
                renderQuestion();
            } else {
                renderScore();
            }
        }

        function getThreshold(percent) {
            if (percent >= 80) {
                return { icon: 'fa-trophy', title: 'Excellent !', desc: 'Tu maîtrises bien ce sujet.' };
            } else if (percent >= 60) {
                return { icon: 'fa-thumbs-up', title: 'Bien joué !', desc: 'Tu as de bonnes bases sur ce sujet.' };
            } else if (percent >= 40) {
                return { icon: 'fa-arrow-trend-up', title: 'Peut mieux faire', desc: 'Encore un peu de travail et ce sera bon.' };
            } else {
                return { icon: 'fa-book', title: 'À retravailler', desc: 'Revois ce chapitre avant de retenter.' };
            }
        }

        function renderScore() {
            const container = document.getElementById('qcmContainer');
            const totalQuestions = qcmData.questions.length;
            let goodCount = 0;
            
            qcmData.questions.forEach((question, idx) => {
                const answers = question.answers || question.reponses || [];
                const answered = userAnswers[idx];
                const selectedIndices = Array.isArray(answered) ? answered : (answered === undefined ? [] : [answered]);
                const correctIndices = getCorrectIndices(question, answers);
                const isSubmitted = !question.multiple || submittedQuestions[idx];
                if (isSubmitted && answered !== undefined && selectedIndices.length === correctIndices.length &&
                    selectedIndices.every(answerIndex => correctIndices.includes(answerIndex))) {
                    goodCount++;
                }
            });
            
            const badCount = totalQuestions - goodCount;
            const percent = totalQuestions > 0 ? Math.round((goodCount / totalQuestions) * 100) : 0;
            const threshold = getThreshold(percent);
            
            const radius = 86;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (percent / 100) * circumference;
            
            const progressEl = document.getElementById('progressText');
            if (progressEl) progressEl.style.display = 'none';
            document.getElementById('multipleQuestionBadge').classList.remove('is-visible');
            
            document.body.style.background = '#F0F1FE';
            document.body.classList.add('score-mode');

            container.innerHTML = `
                <div class="score-wrap" id="scoreWrap">
                    <div class="score-body">
                        <div class="score-left">
                            <div class="score-screen">
                                <div class="score-title">Félicitations ! 🎉</div>
                                <div class="score-subtitle">Bravo, tu as terminé le QCM !</div>

                                <div class="score-circle-wrap">
                                    <svg viewBox="0 0 200 200">
                                        <circle class="score-circle-bg" cx="100" cy="100" r="${radius}"></circle>
                                        <circle class="score-circle-fg" cx="100" cy="100" r="${radius}"
                                            stroke-dasharray="${circumference}"
                                            stroke-dashoffset="${circumference}"
                                            id="scoreCircleFg"></circle>
                                    </svg>
                                    <div class="score-circle-text">
                                        <div class="score-percent">${percent}<sup>%</sup></div>
                                        <div class="score-fraction">${goodCount} / ${totalQuestions} bonnes réponses</div>
                                    </div>
                                </div>

                                <div class="score-threshold">
                                    <div class="score-threshold-icon"><i class="fa-solid ${threshold.icon}"></i></div>
                                    <div class="score-threshold-text">
                                        <div class="score-threshold-title">${threshold.title}</div>
                                        <div class="score-threshold-desc">${threshold.desc}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="score-right">
                            <div>
                                <div class="summary-grid">
                                    <div class="summary-card">
                                        <div class="label">Bonnes réponses</div>
                                        <div class="value">${goodCount}</div>
                                    </div>
                                    <div class="summary-card">
                                        <div class="label">Erreurs</div>
                                        <div class="value">${badCount}</div>
                                    </div>
                                </div>

                                <div class="qcm-info-box">
                                    <div class="qcm-info-row">
                                        <span class="qcm-info-label">Matière</span>
                                        <span class="qcm-info-value">${escapeHtml(qcmData.theme || 'N/A')}</span>
                                    </div>
                                    <div class="qcm-info-row">
                                        <span class="qcm-info-label">QCM</span>
                                        <span class="qcm-info-value">${escapeHtml(qcmData.qcm_name || 'N/A')}</span>
                                    </div>
                                    <div class="qcm-info-row">
                                        <span class="qcm-info-label">Auteur</span>
                                        <span class="qcm-info-value">${escapeHtml(qcmData.auteur || 'N/A')}</span>
                                    </div>
                                </div>
                            </div>

                            <div class="score-actions">
                                <button class="score-btn secondary" onclick="restartQuiz()">
                                    <i class="fa-solid fa-rotate-left"></i> Refaire le QCM
                                </button>
                                <a class="score-btn primary" href="/eleve_dashboard.html">
                                    <i class="fa-solid fa-house"></i> Retour au tableau de bord
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            requestAnimationFrame(() => {
                const circleFg = document.getElementById('scoreCircleFg');
                if (circleFg) circleFg.style.strokeDashoffset = offset;
                const wrapEl = document.getElementById('scoreWrap');
                if (wrapEl) wrapEl.classList.add('zoom');
            });
            
            if (percent >= 60) {
                launchConfetti();
            }
        }

        function launchConfetti() {
            const wrap = document.getElementById('scoreWrap');
            if (!wrap) return;
            const colors = ['#6F4DF2', '#2DBA6F', '#E2A707', '#D32837', '#2A6ACB'];
            const count = 40;
            
            for (let i = 0; i < count; i++) {
                const piece = document.createElement('div');
                piece.className = 'confetti-piece';
                const size = 6 + Math.random() * 6;
                piece.style.width = size + 'px';
                piece.style.height = (size * 0.4) + 'px';
                piece.style.left = Math.random() * 100 + '%';
                piece.style.background = colors[Math.floor(Math.random() * colors.length)];
                piece.style.animationDuration = (1.8 + Math.random() * 1.4) + 's';
                piece.style.animationDelay = (Math.random() * 0.4) + 's';
                wrap.appendChild(piece);
                setTimeout(() => piece.remove(), 3500);
            }
        }

        function restartQuiz() {
            currentQuestionIndex = 0;
            userAnswers = {};
            submittedQuestions = {};
            const progressEl = document.getElementById('progressText');
            if (progressEl) progressEl.style.display = '';
            document.getElementById('multipleQuestionBadge').classList.remove('is-visible');
            document.body.style.background = '';
            document.body.classList.remove('score-mode');
            const wrapEl = document.getElementById('scoreWrap');
            if (wrapEl) wrapEl.classList.remove('zoom');
            renderQuestion();
        }

        function showError(message) {
            const container = document.getElementById('qcmContainer');
            container.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
        }

        function escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return String(text || '').replace(/[&<>"']/g, m => map[m]);
        }