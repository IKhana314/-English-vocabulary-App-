let allWords = [];
let testQuestions = [];
let currentTestIndex = 0;
let testScore = 0;
let testDetails = [];

// ── 分岐ステップ切り替え関数 ──
function showStep(stepId) {
    document.querySelectorAll('.step-card').forEach(card => card.classList.remove('active'));
    const target = document.getElementById(`step-${stepId}`);
    if (target) {
        target.classList.add('active');
    }

    // 各画面を開いた際の自動読み込み
    if (stepId === 'word-manage') fetchWords();
    if (stepId === 'admin-dash') fetchAdminStats();
}

// ── 単語一覧取得 ──
async function fetchWords() {
    try {
        const response = await fetch('/api/words');
        allWords = await response.json();
        filterWords();
    } catch (err) {
        console.error('データ取得失敗', err);
    }
}

function displayWords(words) {
    const listEl = document.getElementById('word-list');
    listEl.innerHTML = '';
    document.getElementById('word-count').textContent = words.length;

    words.forEach(word => {
        const li = document.createElement('li');
        li.innerHTML = `<span><strong>${word.english}</strong> : ${word.japanese}</span>
                        <button style="color:red; background:none; border:none; cursor:pointer;" onclick="deleteWord(${word.id})">削除</button>`;
        listEl.appendChild(li);
    });
}

function filterWords() {
    const keyword = document.getElementById('search').value.toLowerCase().trim();
    const filtered = allWords.filter(w => 
        (w.english && w.english.toLowerCase().includes(keyword)) ||
        (w.japanese && w.japanese.toLowerCase().includes(keyword))
    );
    displayWords(filtered);
}

// ── 小テスト制御 ──
async function startTest(mode = 'normal') {
    let targetWords = [];

    if (mode === 'weak') {
        try {
            const res = await fetch('/api/words/weak');
            targetWords = await res.json();
            if (targetWords.length === 0) {
                alert('苦手な単語（間違えた履歴のある単語）がありません！');
                return;
            }
        } catch (err) {
            console.error(err);
            return;
        }
    } else {
        targetWords = allWords;
    }

    if (targetWords.length === 0) {
        alert('単語を1つ以上登録してください。');
        return;
    }

    const shuffled = [...targetWords].sort(() => 0.5 - Math.random());
    testQuestions = shuffled.slice(0, 5);
    currentTestIndex = 0;
    testScore = 0;
    testDetails = [];

    showStep('quiz-play');
    showNextQuestion();
}

function showNextQuestion() {
    if (currentTestIndex < testQuestions.length) {
        const q = testQuestions[currentTestIndex];
        document.getElementById('quiz-progress').textContent = `問題 ${currentTestIndex + 1} / ${testQuestions.length}`;
        document.getElementById('quiz-question').textContent = `Q. ${q.english}`;
        document.getElementById('quiz-answer').value = '';
        document.getElementById('quiz-answer').focus();
    } else {
        finishTest();
    }
}

async function submitTestAnswer() {
    const userAnswer = document.getElementById('quiz-answer').value.trim();
    const currentWord = testQuestions[currentTestIndex];
    const isCorrect = userAnswer === currentWord.japanese;

    if (isCorrect) testScore++;

    testDetails.push({ wordId: currentWord.id, is_correct: isCorrect });
    currentTestIndex++;
    showNextQuestion();
}

async function finishTest() {
    document.getElementById('quiz-final-score').textContent = `${testQuestions.length}問中 ${testScore}問正解！`;
    showStep('quiz-result');

    try {
        await fetch('/api/test-results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                score: testScore,
                totalQuestions: testQuestions.length,
                details: testDetails
            })
        });
    } catch (err) {
        console.error('保存失敗', err);
    }
}

// ── 単語追加・削除 ──
async function addWord() {
    const english = document.getElementById('english').value.trim();
    const japanese = document.getElementById('japanese').value.trim();

    if (!english || !japanese) {
        alert('両方入力してください');
        return;
    }

    try {
        const res = await fetch('/api/words', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ english, japanese })
        });
        if (res.ok) {
            document.getElementById('english').value = '';
            document.getElementById('japanese').value = '';
            document.getElementById('add-message').textContent = '登録完了！';
            setTimeout(() => document.getElementById('add-message').textContent = '', 2000);
            fetchWords();
        }
    } catch (err) {
        console.error(err);
    }
}

async function deleteWord(id) {
    if (!confirm('削除しますか？')) return;
    try {
        const res = await fetch(`/api/words/${id}`, { method: 'DELETE' });
        if (res.ok) fetchWords();
    } catch (err) {
        console.error(err);
    }
}

// ── 管理者データ取得 ──
async function fetchAdminStats() {
    try {
        const res = await fetch('/api/admin/stats');
        const stats = await res.json();
        document.getElementById('stat-total-tests').textContent = stats.totalTests;
        document.getElementById('stat-avg-score').textContent = stats.avgScore + '%';

        const wrongListEl = document.getElementById('stat-wrong-list');
        wrongListEl.innerHTML = '';
        if (stats.topWrongWords && stats.topWrongWords.length > 0) {
            stats.topWrongWords.forEach(w => {
                const li = document.createElement('li');
                li.innerHTML = `<span><strong>${w.english}</strong> (${w.japanese})</span> <span>${w.wrongCount}回失敗</span>`;
                wrongListEl.appendChild(li);
            });
        }

        fetchAdminWordStats();
    } catch (err) {
        console.error(err);
    }
}

async function fetchAdminWordStats() {
    try {
        const res = await fetch('/api/admin/word-stats');
        const list = await res.json();
        const tbody = document.getElementById('admin-word-stats-table');
        tbody.innerHTML = '';

        list.forEach(item => {
            const total = item.totalTested || 0;
            const correct = item.correctCount || 0;
            const wrong = item.wrongCount || 0;
            const rate = total > 0 ? Math.round((correct / total) * 100) : 0;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${item.english}</strong> (${item.japanese})</td>
                <td>${correct}</td>
                <td>${wrong}</td>
                <td><strong>${total > 0 ? rate + '%' : '-'}</strong></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
    }
}
// ── 自己評価フラッシュカードのロジック ──
let fcCards = [];
let fcCurrentIndex = 0;

async function startFlashcards() {
    if (allWords.length === 0) {
        alert('登録されている単語がありません。まずは単語を追加してください！');
        return;
    }

    // 単語をランダムにシャッフルして最大10枚抽出
    fcCards = [...allWords].sort(() => 0.5 - Math.random()).slice(0, 10);
    fcCurrentIndex = 0;

    showStep('flashcard');
    showCurrentFlashcard();
}

function showCurrentFlashcard() {
    if (fcCurrentIndex < fcCards.length) {
        const card = fcCards[fcCurrentIndex];
        document.getElementById('fc-progress').textContent = `カード ${fcCurrentIndex + 1} / ${fcCards.length}`;
        document.getElementById('fc-word-english').textContent = card.english;
        document.getElementById('fc-word-japanese').textContent = card.japanese;

        // 答えを隠して、「答えを見る」ボタンを表示
        document.getElementById('fc-answer-area').style.display = 'none';
        document.getElementById('fc-action-reveal').style.display = 'block';
        document.getElementById('fc-action-assess').style.display = 'none';
    } else {
        alert('フラッシュカードが終了しました！お疲れ様でした。');
        showStep('main-menu');
    }
}

function revealFlashcardAnswer() {
    // 答えを表示し、自己評価ボタンに切り替え
    document.getElementById('fc-answer-area').style.display = 'block';
    document.getElementById('fc-action-reveal').style.display = 'none';
    document.getElementById('fc-action-assess').style.display = 'block';
}

async function submitFlashcardAssessment(assessment) {
    const card = fcCards[fcCurrentIndex];

    try {
        await fetch('/api/flashcard-results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                wordId: card.id,
                selfAssessment: assessment
            })
        });
    } catch (err) {
        console.error('フラッシュカード結果の保存に失敗しました', err);
    }

    // 次のカードへ
    fcCurrentIndex++;
    showCurrentFlashcard();
}
// ── 苦手カードボックスの制御 ──
async function openWeakCardBox() {
    showStep('weak-box');
    const listEl = document.getElementById('weak-box-list');
    listEl.innerHTML = '<li>読み込み中...</li>';

    try {
        const response = await fetch('/api/words/box/weak');
        const weakWords = await response.json();

        listEl.innerHTML = '';

        if (weakWords && weakWords.length > 0) {
            weakWords.forEach(word => {
                const li = document.createElement('li');
                li.style.padding = '16px';
                li.style.marginBottom = '8px';
                li.style.background = '#fff5f5';
                li.style.border = '1px solid #feb2b2';
                li.style.borderRadius = '8px';
                li.innerHTML = `
                    <div>
                        <strong style="font-size: 18px; color: #c53030;">${word.english}</strong>
                        <span style="display: block; font-size: 14px; color: #4a5568; margin-top: 4px;">意味: ${word.japanese}</span>
                    </div>
                `;
                listEl.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.style.textAlign = 'center';
            li.style.color = '#718096';
            li.textContent = '素晴らしい！現在、苦手な単語はありません。';
            listEl.appendChild(li);
        }
    } catch (err) {
        console.error('苦手カードの取得に失敗しました', err);
        listEl.innerHTML = '<li>データの取得に失敗しました。</li>';
    }
}
// ── 学校の小テスト記録の制御 ──
async function openSchoolTestScreen() {
    showStep('school-test-form');
    document.getElementById('school-score').value = '';
    document.getElementById('school-memo').value = '';
    fetchSchoolTestHistory();
}

async function saveSchoolTestRecord() {
    const score = document.getElementById('school-score').value.trim();
    const maxScore = document.getElementById('school-max-score').value.trim();
    const memo = document.getElementById('school-memo').value.trim();

    if (!score || !maxScore) {
        alert('得点と満点を入力してください。');
        return;
    }

    try {
        const res = await fetch('/api/school-tests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                score: Number(score),
                maxScore: Number(maxScore),
                memo: memo
            })
        });

        if (res.ok) {
            alert('学校のテスト結果を記録しました！');
            document.getElementById('school-score').value = '';
            document.getElementById('school-memo').value = '';
            fetchSchoolTestHistory();
        } else {
            alert('保存に失敗しました。');
        }
    } catch (err) {
        console.error('学校テスト結果の保存エラー', err);
    }
}

async function fetchSchoolTestHistory() {
    const listEl = document.getElementById('school-test-history-list');
    listEl.innerHTML = '<li>読み込み中...</li>';

    try {
        const res = await fetch('/api/school-tests');
        const history = await res.json();

        listEl.innerHTML = '';
        if (history && history.length > 0) {
            history.forEach(item => {
                const li = document.createElement('li');
                li.style.padding = '12px';
                li.style.borderBottom = '1px solid #edf2f7';
                li.style.display = 'flex';
                li.style.justifyContent = 'space-between';
                li.style.alignItems = 'center';

                const dateStr = new Date(item.created_at).toLocaleDateString('ja-JP');
                const rate = Math.round((item.score / item.max_score) * 100);

                li.innerHTML = `
                    <div>
                        <span style="font-size: 12px; color: #718096; display: block;">📅 ${dateStr} ${item.memo ? `(${item.memo})` : ''}</span>
                        <strong style="font-size: 18px; color: #2c3e50;">${item.score} / ${item.max_score} 点 (${rate}%)</strong>
                    </div>
                `;
                listEl.appendChild(li);
            });
        } else {
            listEl.innerHTML = '<li style="text-align: center; color: #718096;">学校のテスト記録はまだありません。</li>';
        }
    } catch (err) {
        console.error('学校テスト履歴の取得エラー', err);
        listEl.innerHTML = '<li>履歴の取得に失敗しました。</li>';
    }
}
// ── 研究用CSVデータのダウンロード処理 ──
function downloadResearchCSV() {
    window.location.href = '/api/admin/export-csv';
}
// 初期化
window.addEventListener('DOMContentLoaded', () => {
    fetchWords();
});