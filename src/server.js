const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// ミドルウェアの設定
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// SQLiteデータベースの初期化
const db = new sqlite3.Database(path.join(__dirname, '../vocab.db'), (err) => {
    if (err) {
        console.error('データベース接続エラー:', err.message);
    } else {
        console.log('SQLiteデータベースに接続しました。');
    }
});

// テーブルの初期化
db.serialize(() => {
    // 単語一覧テーブル
    db.run(`
        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            english TEXT NOT NULL,
            japanese TEXT NOT NULL
        )
    `);

    // 【新規】小テスト成績履歴テーブル
    db.run(`
        CREATE TABLE IF NOT EXISTS test_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            score INTEGER NOT NULL,
            total_questions INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 【新規】テスト解答詳細（どの単語を間違えたか記録する）テーブル
    db.run(`
        CREATE TABLE IF NOT EXISTS test_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            test_id INTEGER NOT NULL,
            word_id INTEGER NOT NULL,
            is_correct INTEGER NOT NULL,
            FOREIGN KEY (test_id) REFERENCES test_results (id),
            FOREIGN KEY (word_id) REFERENCES words (id)
        )
    `);
// 【新規】自己評価フラッシュカードの履歴を保存するテーブル
db.run(`
    CREATE TABLE IF NOT EXISTS flashcard_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word_id INTEGER,
        self_assessment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
});
// 【新規】学校の小テスト結果を保存するテーブル
db.run(`
    CREATE TABLE IF NOT EXISTS school_test_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        score INTEGER,
        max_score INTEGER,
        memo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
// --- API エンドポイント ---

// 1. 単語一覧の取得
app.get('/api/words', (req, res) => {
    db.all('SELECT * FROM words ORDER BY id DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 2. 単語の追加
app.post('/api/words', (req, res) => {
    const { english, japanese } = req.body;
    if (!english || !japanese) {
        res.status(400).json({ error: '英語と日本語の両方を入力してください。' });
        return;
    }
    db.run('INSERT INTO words (english, japanese) VALUES (?, ?)', [english, japanese], function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ id: this.lastID, english, japanese });
    });
});

// 3. 単語の削除
app.delete('/api/words/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM words WHERE id = ?', id, function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: '削除されました', changes: this.changes });
    });
});

// 4. 【新規】小テスト結果の保存API
app.post('/api/test-results', (req, res) => {
    const { score, totalQuestions, details } = req.body; // details: [{ wordId, isCorrect }, ...]

    db.run(
        'INSERT INTO test_results (score, total_questions) VALUES (?, ?)',
        [score, totalQuestions],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            const testId = this.lastID;

            // 各問題の正誤詳細を保存
            if (details && details.length > 0) {
                const stmt = db.prepare('INSERT INTO test_details (test_id, word_id, is_correct) VALUES (?, ?, ?)');
                details.forEach(detail => {
                    stmt.run(testId, detail.wordId, detail.isCorrect ? 1 : 0);
                });
                stmt.finalize();
            }

            res.json({ message: 'テスト結果を保存しました', testId });
        }
    );
});

// 5. 【新規】管理者向け統計データ取得API
app.get('/api/admin/stats', (req, res) => {
    const stats = {};

    // ① 総受験回数と平均正解率
    db.get('SELECT COUNT(*) AS totalTests, AVG(CAST(score AS FLOAT) / total_questions * 100) AS avgScore FROM test_results', [], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        stats.totalTests = row ? row.totalTests : 0;
        stats.avgScore = row && row.avgScore ? Math.round(row.avgScore) : 0;

        // ② 間違いが多い単語ワースト3
        const wrongWordsSql = `
            SELECT w.english, w.japanese, COUNT(td.id) AS wrongCount 
            FROM test_details td
            JOIN words w ON td.word_id = w.id
            WHERE td.is_correct = 0
            GROUP BY td.word_id
            ORDER BY wrongCount DESC
            LIMIT 3
        `;
        db.all(wrongWordsSql, [], (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            stats.topWrongWords = rows;
            res.json(stats);
        });
    });
});
// 【1】過去の小テスト履歴取得
app.get('/api/test-results', (req, res) => {
    db.all('SELECT * FROM test_results ORDER BY created_at DESC LIMIT 10', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 【2】テスト結果の保存
app.post('/api/test-results', (req, res) => {
    const { score, totalQuestions, details } = req.body;
    db.run('INSERT INTO test_results (score, total_questions) VALUES (?, ?)', [score, totalQuestions], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const testId = this.lastID;
        if (details && details.length > 0) {
            const stmt = db.prepare('INSERT INTO test_details (test_id, word_id, is_correct) VALUES (?, ?, ?)');
            details.forEach(d => {
                stmt.run(testId, d.wordId, d.is_correct ? 1 : 0);
            });
            stmt.finalize();
        }
        res.json({ success: true, testId: testId });
    });
});

// 【3】苦手単語（間違えたことがある単語）の取得
app.get('/api/words/weak', (req, res) => {
    const sql = `
        SELECT DISTINCT w.id, w.english, w.japanese
        FROM words w
        JOIN test_details td ON w.id = td.word_id
        WHERE td.is_correct = 0
        ORDER BY w.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 【4】管理者向け：全単語の正答率詳細取得
app.get('/api/admin/word-stats', (req, res) => {
    const sql = `
        SELECT w.id, w.english, w.japanese,
               COUNT(td.id) AS totalTested,
               SUM(CASE WHEN td.is_correct = 1 THEN 1 ELSE 0 END) AS correctCount,
               SUM(CASE WHEN td.is_correct = 0 THEN 1 ELSE 0 END) AS wrongCount
        FROM words w
        LEFT JOIN test_details td ON w.id = td.word_id
        GROUP BY w.id
        ORDER BY w.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});
// 【新規】フラッシュカードの自己評価結果を保存するAPI
app.post('/api/flashcard-results', (req, res) => {
    const { wordId, selfAssessment } = req.body;
    const sql = `INSERT INTO flashcard_logs (word_id, self_assessment) VALUES (?, ?)`;
    
    db.run(sql, [wordId, selfAssessment], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true, id: this.lastID });
    });
});
// 【新規】苦手カードボックス用の単語リスト取得API
app.get('/api/words/box/weak', (req, res) => {
    // フラッシュカードで「あやふや」「忘れていた」と評価された、または小テストで不正解だった単語を重複なく取得
    const sql = `
        SELECT DISTINCT w.id, w.english, w.japanese
        FROM words w
        LEFT JOIN flashcard_logs fl ON w.id = fl.word_id
        LEFT JOIN test_details td ON w.id = td.word_id
        WHERE (fl.self_assessment IN ('あやふや', '忘れていた')) 
           OR (td.is_correct = 0)
        ORDER BY w.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});
// 【新規】学校のテスト結果を保存するAPI
app.post('/api/school-tests', (req, res) => {
    const { score, maxScore, memo } = req.body;
    const sql = `INSERT INTO school_test_records (score, max_score, memo) VALUES (?, ?, ?)`;
    db.run(sql, [score, maxScore, memo || ''], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true, id: this.lastID });
    });
});

// 【新規】学校のテスト結果一覧を取得するAPI
app.get('/api/school-tests', (req, res) => {
    db.all('SELECT * FROM school_test_records ORDER BY created_at DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// 【新規】研究発表用：全学習データのCSVダウンロードAPI
app.get('/api/admin/export-csv', (req, res) => {
    const sql = `
        SELECT 
            w.id AS word_id,
            w.english,
            w.japanese,
            (SELECT self_assessment FROM flashcard_logs WHERE word_id = w.id ORDER BY created_at DESC LIMIT 1) AS last_self_assessment,
            (SELECT COUNT(*) FROM test_details WHERE word_id = w.id AND is_correct = 1) AS correct_count,
            (SELECT COUNT(*) FROM test_details WHERE word_id = w.id AND is_correct = 0) AS wrong_count,
            (SELECT score || '/' || max_score FROM school_test_records ORDER BY created_at DESC LIMIT 1) AS latest_school_test
        FROM words w
        ORDER BY w.id ASC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        // UTF-8 BOM付きCSVヘッダー（Excelでの文字化け防止）
        let csvContent = '\uFEFF英単語,日本語,直近自己評価,アプリ正解回数,アプリ不正解回数,最新学校テスト成績\n';

        rows.forEach(row => {
            const selfAssess = row.last_self_assessment || '未評価';
            const schoolTest = row.latest_school_test || '未記録';
            csvContent += `"${row.english}","${row.japanese}","${selfAssess}",${row.correct_count},${row.wrong_count},"${schoolTest}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="forget_me_not_research_data.csv"');
        res.status(200).send(csvContent);
    });
});
// サーバー起動
app.listen(PORT, () => {
    console.log(`サーバーが起動しました: http://localhost:3000`);
});