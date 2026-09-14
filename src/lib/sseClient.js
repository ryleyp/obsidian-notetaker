export async function consumeSseText(response, onDelta = () => {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let doneEvent = null;
  while (true) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    if (done && buffer.trim()) buffer += "\n\n";
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      const data = part.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (!data) continue;
      const event = JSON.parse(data);
      if (event.type === "delta") { text += event.text; onDelta(text); }
      else if (event.type === "done") doneEvent = event;
      else if (event.type === "error") throw new Error(event.message);
    }
    if (done) break;
  }
  if (!doneEvent) throw new Error("The model connection ended before completion.");
  return { text, ...doneEvent };
}
