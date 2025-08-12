import { useState } from 'react';

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [prevB, setPrevB] = useState('');

  const sendMessage = async () => {
    const logs = await (await fetch('/api/fetchLogs')).json();
    const bc = await (await fetch('/api/generateBC', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs, prevB })
    })).json();

    const chat = await (await fetch('/api/chatA', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bOutput: bc.bOutput, cOutput: bc.cOutput, userMessage: input })
    })).json();

    setMessages([...messages, { role: 'user', content: input }, { role: 'assistant', content: chat.reply }]);
    setPrevB(bc.bOutput);

    await fetch('/api/saveLog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `会話 ${new Date().toISOString()}`, text: `${input}\n${chat.reply}` })
    });

    setInput('');
  };

  return (
    <div>
      <div>
        {messages.map((m, i) => (
          <div key={i}><b>{m.role}:</b> {m.content}</div>
        ))}
      </div>
      <input value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={sendMessage}>送信</button>
    </div>
  );
}
