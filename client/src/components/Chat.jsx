
import React, { useEffect, useRef, useState } from "react";
import Message from "./Message";
import ChatInput from "./ChatInput";
import { API_BASE_URL } from "../config";

export default function Chat() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hello there 👋\nHow can I assist you today?",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [checkpointId, setCheckpointId] = useState(null);
  const messagesEndRef = useRef(null);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text) => {
    if (!text.trim()) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    let botMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, botMessage]);

    try {
      const params = new URLSearchParams({
        message: text,
      });

      if (checkpointId) {
        params.append("checkpoint_id", checkpointId);
      }

      const response = await fetch(
        `${API_BASE_URL}/chat_stream?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Backend error");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n\n").filter(Boolean);

        for (let line of lines) {
          if (!line.startsWith("data:")) continue;

          const payload = JSON.parse(line.replace("data:", "").trim());

          if (payload.type === "checkpoint") {
            setCheckpointId(payload.checkpoint_id);
          }

          if (payload.type === "content") {
            botMessage.content += payload.content;
            setMessages((prev) => [...prev.slice(0, -1), { ...botMessage }]);
          }

          if (payload.type === "search_start") {
            botMessage.content += `\n\n🔍 Searching: ${payload.query}\n`;
            setMessages((prev) => [...prev.slice(0, -1), { ...botMessage }]);
          }

          if (payload.type === "search_results") {
            const links = payload.urls.map((u) => `• ${u}`).join("\n");
            botMessage.content += `\n${links}\n`;
            setMessages((prev) => [...prev.slice(0, -1), { ...botMessage }]);
          }

          if (payload.type === "end") {
            setLoading(false);
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: "❌ Error connecting to server.",
        },
      ]);
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full justify-center bg-zinc-900 text-zinc-100">
      <div className="flex w-full max-w-4xl flex-col">
        <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/90 px-4 py-3 text-center text-sm font-semibold backdrop-blur">
          GenAI Chatbot - made using Groq
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          {messages.map((msg, idx) => (
            <Message key={idx} role={msg.role} content={msg.content} />
          ))}

          {loading && (
            <div className="text-xs text-zinc-400 italic px-2">
              Assistant is typing…
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <ChatInput onSend={sendMessage} disabled={loading} />
      </div>
    </div>
  );
}
