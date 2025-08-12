// pages/index.js
import { useEffect, useRef, useState } from 'react';

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [prevB, setPrevB] = useState('');
  const [historyNotion, setHistoryNotion] = useState([]); // Notion表示用
  const [sending, setSending] = useState(false);
  const [composing, setComposing] = useState(false);

  const bottomRef = useRef(null);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadHistory() {
    try {
      const res = await fetch('/api/fetchLogs');
      const json = await res.json();
      const items = Array.isArray(json) ? json : json.items || [];
      setHistoryNotion(items);
    } catch (e) {
      console.error('failed to load history', e);
    }
  }

  async function sendMessage() {
    if (!input.trim() || sending) return;
    setSending(true);

    try {
      // 1) 最新ログ取得（Notion DB）
      const resLogs = await fetch('/api/fetchLogs');
      const jsonLogs = await resLogs.json();
      const logs = Array.isArray(jsonLogs) ? jsonLogs : jsonLogs.items || [];

      // 2) B/C生成（prevBを渡す）
      const resBC = await fetch('/api/generateBC', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs, prevB })
      });
      const bc = await resBC.json();

      const useB = bc.bOutput && bc.bOutput.trim().toLowerCase() !== 'pass'
        ? bc.bOutput
        : prevB;

      // 3) Aモデルで応答（履歴を渡す）
      const chatRes = await fetch('/api/chatA', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bOutput: useB,
          cOutput: bc.cOutput,
          userMessage: input,
          history: messages // [{role, content}] 形式で渡す
        })
      });
      const chat = await chatRes.json();

      // 4) 画面に反映
      const newMsgs = [
        ...messages,
        { role: 'user', content: input },
        { role: 'assistant', content: chat.reply }
      ];
      setMessages(newMsgs);
      setPrevB(useB);

      // 5) Notionに保存
      const transcript = `User: ${input}\nAssistant: ${chat.reply}`;
      await fetch('/api/saveLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `会話 ${new Date().toISOString()}`,
          text: transcript
        })
      });

      // 6) 下部の履歴更新
      await loadHistory();
      setInput('');
    } catch (e) {
      console.error(e);
      alert('送信に失敗しました。ログを確認してください。');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    const isIME =
      composing || e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229;

    const metaSend = (e.ctrlKey || e.metaKey) && e.key === 'Enter';
    if (metaSend) {
      e.preventDefault();
      if (!isIME) sendMessage();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isIME) return;
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>omni Trinity Chat</h1>

      {/* チャット表示 */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, height: 420, overflowY: 'auto', background: '#fafafa', marginBottom: 12 }}>
        {messages.length === 0 && <div style={{ color: '#6b7280' }}>ここに会話が表示されます。</div>}
        {messages.map((m, i) => (
          <div key={i} style={{ margin: '8px 0' }}>
            <div style={{ fontWeight: 600 }}>{m.role === 'user' ? 'You' : 'Assistant'}</div>
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
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder="メッセージを入力（Enterで送信 / Shift+Enterで改行 / Cmd/Ctrl+Enterでも送信）"
          rows={3}
          style={{ flex: 1, resize: 'vertical', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10 }}
        />
        <button
          onClick={sendMessage}
          disabled={sending || !input.trim()}
          style={{ minWidth: 120, border: 0, borderRadius: 8, padding: '0 16px', background: sending ? '#cbd5e1' : '#111827', color: 'white', cursor: sending ? 'not-allowed' : 'pointer' }}
          title="Enterでも送信できます"
        >
          {sending ? '送信中…' : '送信'}
        </button>
      </div>

      {/* Notionの最新履歴 */}
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>🗂 最新の保存履歴（Notion）</h2>
        {historyNotion.length === 0 ? (
          <div style={{ color: '#6b7280' }}>まだ履歴がありません。</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {historyNotion.map((h, idx) => (
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
