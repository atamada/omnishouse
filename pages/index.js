// pages/index.js

import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid'; // ← npm i uuid

export default function Home() {
  const [sessionId, setSessionId] = useState(uuidv4()); // 初回セッション
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [prevB, setPrevB] = useState('');
  const [historyNotion, setHistoryNotion] = useState([]);
  const [sending, setSending] = useState(false);
  const [composing, setComposing] = useState(false);
  const bottomRef = useRef(null);

  // 新規会話開始
  function startNewSession() {
    setSessionId(uuidv4());
    setMessages([]);
    setPrevB('');
  }

  async function sendMessage() {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const resLogs = await fetch('/api/fetchLogs');
      const jsonLogs = await resLogs.json();
      const logs = Array.isArray(jsonLogs) ? jsonLogs : jsonLogs.items || [];

      const resBC = await fetch('/api/generateBC', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs, prevB })
      });
      const bc = await resBC.json();
      const useB = bc.bOutput && bc.bOutput.trim().toLowerCase() !== 'pass'
        ? bc.bOutput
        : prevB;

      const chatRes = await fetch('/api/chatA', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bOutput: useB,
          cOutput: bc.cOutput,
          userMessage: input,
          history: messages
        })
      });
      const chat = await chatRes.json();

      setMessages(prev => [...prev, { role: 'user', content: input }, { role: 'assistant', content: chat.reply }]);
      setPrevB(useB);

      // 保存
      const transcript = `User: ${input}\nAssistant: ${chat.reply}`;
      const saveRes = await fetch('/api/saveLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `会話 ${new Date().toISOString()}`,
          text: transcript,
          sessionId
        })
      });
      const saveData = await saveRes.json();
      if (saveData.alert) {
        alert(saveData.alert);
      }

      setInput('');
    } catch (e) {
      console.error(e);
      alert('送信に失敗しました。');
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h1>omni Trinity Chat</h1>
      <button onClick={startNewSession}>🆕 新規会話</button>
      

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
