
import React from "react";

const urlRegex = /(https?:\/\/[^\s]+)/g;

export default function Message({ role, content }) {
  const isUser = role === "user";

  const renderLine = (line, index) => {
    const parts = line.split(urlRegex);

    return (
      <div key={index} className="leading-relaxed wrap-break-word">
        {parts.map((part, i) => {
          if (part.match(urlRegex)) {
            return (
              <a
                key={i}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-zinc-700/50 px-2 py-1 text-xs text-indigo-400 hover:bg-zinc-700 hover:text-indigo-300 transition break-all"
              >
                {part}
              </a>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </div>
    );
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] overflow-hidden rounded-2xl px-4 py-3 text-sm shadow
          ${
            isUser
              ? "bg-indigo-600 text-white rounded-br-sm"
              : "bg-zinc-800 text-zinc-100 rounded-bl-sm"
          }`}
      >
        <div className="space-y-1">
          {content.split("\n").map((line, i) => renderLine(line, i))}
        </div>
      </div>
    </div>
  );
}
