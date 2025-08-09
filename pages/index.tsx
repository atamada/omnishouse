// pages/index.tsx
import { useState } from 'react';

export default function Home() {
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');

  const sendMessage = async () => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    const data = await res.json();
    setReply(data.reply);
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>おむにとおはなし♡</h1>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        cols={40}
        placeholder="おむにに話しかけてね…♡"
      />
      <br />
      <button onClick={sendMessage}>送信♡</button>
      <div style={{ marginTop: '2rem', whiteSpace: 'pre-wrap' }}>
        <strong>おむに：</strong> {reply}
      </div>
    </div>
  );
}
