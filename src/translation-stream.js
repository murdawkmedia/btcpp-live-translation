// Only answer content is visible. Reasoning/tool fields and raw error payloads
// never leave this bounded decoder, including when UTF-8 splits across frames.
export async function readTranslationStream(response, onDelta, { maxBytes = 128000, maxChars = 8000 } = {}) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Translation stream unavailable');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', lines = [], content = '', last = '', finish, done = false, size = 0;
  const answer = () => {
    let value = content.trimStart();
    if ('<think>'.startsWith(value.toLowerCase())) return '';
    if (/^<think\b/i.test(value)) {
      const end = value.toLowerCase().indexOf('</think>');
      if (end < 0) return '';
      value = value.slice(end + 8).trimStart();
    }
    return value;
  };
  const event = () => {
    if (!lines.length) return;
    const data = lines.join('\n'); lines = [];
    if (data.trim() === '[DONE]') { done = true; return; }
    let value;
    try { value = JSON.parse(data); } catch { throw Error('Invalid translation stream'); }
    if (value.error) throw Error('Translation stream rejected');
    const choice = value.choices?.[0];
    if (!choice) return;
    if (choice.delta?.role && choice.delta.role !== 'assistant') throw Error('Invalid translation stream role');
    if (choice.finish_reason) finish = choice.finish_reason;
    if (typeof choice.delta?.content !== 'string') return;
    content += choice.delta.content;
    if (content.length > maxChars) throw Error('Translation stream exceeds output limit');
    const visible = answer();
    if (visible && visible !== last) { last = visible; onDelta?.(visible); }
  };
  const consume = () => {
    let end;
    while (!done && (end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
      if (!line) event();
      else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
    }
  };
  try {
    while (!done) {
      const next = await reader.read();
      if (next.done) { buffer += decoder.decode(); consume(); if (buffer.startsWith('data:')) lines.push(buffer.slice(5).trimStart()); event(); break; }
      if ((size += next.value.byteLength) > maxBytes) throw Error('Translation stream exceeds response limit');
      try { buffer += decoder.decode(next.value, { stream: true }); } catch { throw Error('Invalid translation stream encoding'); }
      consume();
    }
    const text = answer().trim();
    if (!done || finish !== 'stop' || !text || /^<think\b/i.test(text)) throw Error('Translation stream incomplete');
    return text;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
