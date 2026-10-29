import { json, type Message, type ExecutionEvent } from "./store";

export type ChatStreamEvent =
  | { type: "accepted"; messages: Message[] }
  | { type: "activity"; message_id: string; event: ExecutionEvent }
  | { type: "complete" | "failed"; message: Message }
  | { type: "error"; message: string };

export async function streamTurn(
  chatId: string,
  body: { content: string; language: string; client_message_id: string },
  receive: (event: ChatStreamEvent) => void,
) {
  let response: Response;
  try {
    response = await fetch(`/api/chats/${chatId}/messages/stream`, {
      ...json(body),
      signal: AbortSignal.timeout(160_000),
    });
  } catch {
    throw new Error("NETWORK");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : `Request failed (${response.status})`,
    );
  }
  if (!response.body) throw new Error("NETWORK");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpMatchArray | null;
      while ((boundary = buffer.match(/\r?\n\r?\n/))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index! + boundary[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event: ChatStreamEvent = JSON.parse(data);
        if (event.type === "error") throw new Error(event.message);
        receive(event);
        if (event.type === "complete" || event.type === "failed") {
          finished = true;
          return;
        }
      }
      if (done) break;
    }
    if (!finished) throw new Error("NETWORK");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
