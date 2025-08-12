import { useEffect, useRef, useState } from 'react';

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [prevB, setPrevB] = useState('');
  const [history, setHistory] = useState([]); // ← 下部に出すNotion履歴（最新1〜3件）
  const [sending, setSending] = useState(false);

  const bottomRef = useRef(null);

  // 下部履歴のロード（起動時）
  useEffect(() => {
    loadHistory();
  }, []);

  // メッセージが更新されたら一番下へオートスクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadHistory() {
    try {
      const logs = await (await fetch('/api/fetchLogs')).json();
      setHistory(logs);
    } catch (e) {
      console.error('failed to load history', e);
    }
  }

  async function sendMessage() {
    if (!input.trim() || sending) return;
    setSending(true);

    try {
      // 1) 最新ログ（1〜3件）取得
      const logs = await (await fetch('/api/fetchLogs')).json();

      // 2) B/C 生成
      const bc = await (
        await fetch('/api/generateBC', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logs, prevB })
        })
      ).json();

      // 3) A で応答
      const chat = await (
        await fetch('/api/chatA', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bOutput: bc.bOutput,
            cOutput: bc.cOutput,
            userMessage: input
          })
        })
      ).json();

      // 画面に反映
      const newMsgs = [
        ...messages,
        { role: 'user', content: input },
        { role: 'assistant', content: chat.reply }
      ];
      setMessages(newMsgs);
      setPrevB(bc.bOutput);
      const transcript = `User: ${input}\nAssistant: ${chat.reply}`;

      // 4) Notionに保存
      await fetch('/api/saveLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `会話 ${new Date().toISOString()}`,
          text: transcript
        })
      });

      // 5) 下部の履歴も更新
      await loadHistory();
      setInput('');
    } catch (e) {
      console.error(e);
      alert('送信に失敗しました。ログを確認してください。');
    } finally {
      setSending(false);
    }
  }

  // Enter送信（Shift+Enterで改行）
  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div style={{
      maxWidth: 800,
      margin: '0 auto',
      padding: 16,
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
    }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>omni Trinity Chat</h1>

      {/* チャット表示 */}
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 12,
          height: 420,
          overflowY: 'auto',
          background: '#fafafa',
          marginBottom: 12
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: '#6b7280' }}>ここに会話が表示されます。</div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ margin: '8px 0' }}>
            <div style={{ fontWeight: 600 }}>
              {m.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 入力欄 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="メッセージを入力（Enterで送信 / Shift+Enterで改行）"
          rows={3}
          style={{
            flex: 1,
            resize: 'vertical',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 10
          }}
        />
        <button
          onClick={sendMessage}
          disabled={sending || !input.trim()}
          style={{
            minWidth: 120,
            border: 0,
            borderRadius: 8,
            padding: '0 16px',
            background: sending ? '#cbd5e1' : '#111827',
            color: 'white',
            cursor: sending ? 'not-allowed' : 'pointer'
          }}
          title="Enterでも送信できます"
        >
          {sending ? '送信中…' : '送信'}
        </button>
      </div>

      {/* 下部：Notionの最新履歴（1〜3件） */}
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>🗂 最新の保存履歴（Notion）</h2>
        {history.length === 0 ? (
          <div style={{ color: '#6b7280' }}>まだ履歴がありません。</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {history.map((h, idx) => (
              <li key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: 'white' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{h.title ?? `履歴 ${idx + 1}`}</div>
                <div style={{ color: '#374151', whiteSpace: 'pre-wrap' }}>
                  {(h.text || '').slice(0, 240)}
                  {(h.text || '').length > 240 ? '…' : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
